const { listEnabledFinanceCorporationIds } = require('../finance/financeCorporationService');
const { refreshCorporationWallet } = require('../finance/walletRefreshService');
const { processCorporationDonationAlerts } = require('../finance/donationAlertService');
const { filterCorporationIds } = require('./jobCorporationSelection');

async function runFinanceJob(config, client, options = {}) {
  const storageRoot = config.storage.rootDir;
  const refreshImpl = options.refreshImpl || refreshCorporationWallet;
  const alertImpl = options.alertImpl || processCorporationDonationAlerts;
  const corporationIds = filterCorporationIds(
    await listEnabledFinanceCorporationIds(storageRoot),
    options.corporationId
  );
  const results = [];

  for (const corporationId of corporationIds) {
    try {
      const refresh = await refreshImpl(config, storageRoot, corporationId, options);
      let alert = null;
      try {
        alert = await alertImpl(config, storageRoot, corporationId, client);
      } catch (error) {
        alert = {
          enabled: true,
          alertedCount: 0,
          dmSent: false,
          reason: error?.message || String(error),
        };
        console.error(
          `[jobs:finance] corporation=${corporationId} donation alert failed:`,
          error?.stack || error
        );
      }

      results.push({ corporationId, ok: true, refresh, alert });
      if (!options.silent) {
        console.log(
          `[jobs:finance] corporation=${corporationId} balance=${refresh.totalBalanceFormatted} history+${refresh.historyAddedCount} alerts=${alert?.alertedCount || 0}`
        );
      }
    } catch (error) {
      results.push({
        corporationId,
        ok: false,
        error: error?.message || String(error),
        errorCode: error?.code || '',
      });
      console.error(
        `[jobs:finance] corporation=${corporationId} failed:`,
        error?.stack || error
      );
    }
  }

  return {
    checkedCorporations: corporationIds.length,
    succeeded: results.filter((entry) => entry.ok).length,
    failed: results.filter((entry) => !entry.ok).length,
    results,
  };
}

function startFinanceJob(config, client, options = {}) {
  if (!config.jobs.enabled || !config.jobs.financeEnabled) {
    return {
      enabled: false,
      stop() {},
      trigger: () => Promise.resolve({
        checkedCorporations: 0,
        succeeded: 0,
        failed: 0,
        results: [],
      }),
    };
  }

  const intervalMs = config.jobs.financeRefreshIntervalMinutes * 60_000;
  let timer = null;
  let running = false;
  let stopped = false;

  const trigger = async () => {
    if (running || stopped) return null;
    running = true;
    try {
      return await runFinanceJob(config, client, options);
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => {
    trigger().catch((error) => {
      console.error('[jobs:finance] unhandled run failure:', error?.stack || error);
    });
  }, intervalMs);
  timer.unref?.();

  if (options.runImmediately !== false) {
    setImmediate(() => {
      trigger().catch((error) => {
        console.error('[jobs:finance] initial run failure:', error?.stack || error);
      });
    });
  }

  console.log(`[jobs:finance] enabled interval=${config.jobs.financeRefreshIntervalMinutes}m`);

  return {
    enabled: true,
    trigger,
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = {
  runFinanceJob,
  startFinanceJob,
};
