const {
  listEnabledStructureCorporationIds,
} = require('../structures/structureCorporationService');
const {
  processStructureFuelAlertsWithFilters,
} = require('../structures/structureAlertFilterService');
const {
  createStructureAlertSender,
} = require('../structures/structurePresentation');
const { filterCorporationIds } = require('./jobCorporationSelection');

async function runStructureFuelJob(config, client, options = {}) {
  const storageRoot = config.storage.rootDir;
  const processImpl = options.processImpl || processStructureFuelAlertsWithFilters;
  const sender = options.sendAlerts || createStructureAlertSender(config);
  const corporationIds = filterCorporationIds(
    await listEnabledStructureCorporationIds(storageRoot),
    options.corporationId
  );
  const results = [];

  for (const corporationId of corporationIds) {
    try {
      const result = await processImpl(
        config,
        storageRoot,
        corporationId,
        client,
        {
          ...options,
          sendAlerts: sender,
        }
      );
      results.push({ corporationId, ok: true, result });
      if (!options.silent) {
        console.log(
          `[jobs:structure-fuel] corporation=${corporationId} total=${result.totalCount || 0} critical=${result.criticalCount || 0} upwell=${result.criticalUpwellCount || 0} metenox=${result.criticalMetenoxCount || 0} pos=${result.criticalPosCount || 0} suppressed=${result.alertSuppressedCount || 0} new=${result.newCriticalAlertsCount || 0} recovered=${result.recoveredAlertsCount || 0}`
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
        `[jobs:structure-fuel] corporation=${corporationId} failed:`,
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

function startStructureFuelJob(config, client, options = {}) {
  if (!config.jobs.enabled || !config.jobs.structureFuelEnabled) {
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

  const intervalMs = config.jobs.structureFuelCheckIntervalMinutes * 60_000;
  let timer = null;
  let running = false;
  let stopped = false;

  const trigger = async () => {
    if (running || stopped) return null;
    running = true;
    try {
      return await runStructureFuelJob(config, client, options);
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => {
    trigger().catch((error) => {
      console.error('[jobs:structure-fuel] unhandled run failure:', error?.stack || error);
    });
  }, intervalMs);
  timer.unref?.();

  if (options.runImmediately === true) {
    setImmediate(() => {
      trigger().catch((error) => {
        console.error('[jobs:structure-fuel] initial run failure:', error?.stack || error);
      });
    });
  }

  console.log(`[jobs:structure-fuel] enabled interval=${config.jobs.structureFuelCheckIntervalMinutes}m`);

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
  runStructureFuelJob,
  startStructureFuelJob,
};
