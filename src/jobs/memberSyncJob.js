const { listCorporations } = require('../corporations/corporationRegistryRepository');
const { syncCorporationMembers } = require('../members/memberSyncService');
const { filterRegistrations } = require('./jobCorporationSelection');

function formatResult(result) {
  return [
    `active=${result.activeCount}`,
    `added=${result.addedCount}`,
    `updated=${result.updatedCount}`,
    `unchanged=${result.unchangedCount}`,
    `left=${result.leftCount}`,
  ].join(' ');
}

async function runMemberSyncJob(config, options = {}) {
  const storageRoot = config.storage.rootDir;
  const syncImpl = options.syncImpl || syncCorporationMembers;
  const registrations = await listCorporations(storageRoot, { enabledOnly: true });
  const eligible = filterRegistrations(
    registrations.filter((entry) => entry.features?.members !== false),
    options.corporationId
  );
  const results = [];

  for (const registration of eligible) {
    const corporationId = registration.corporationId;
    try {
      const result = await syncImpl(config, storageRoot, corporationId, options);
      results.push({ corporationId, ok: true, result });
      if (!options.silent) {
        console.log(`[jobs:members] corporation=${corporationId} ${formatResult(result)}`);
      }
    } catch (error) {
      results.push({
        corporationId,
        ok: false,
        error: error?.message || String(error),
        errorCode: error?.code || '',
      });
      console.error(
        `[jobs:members] corporation=${corporationId} failed:`,
        error?.stack || error
      );
    }
  }

  return {
    checkedCorporations: eligible.length,
    succeeded: results.filter((entry) => entry.ok).length,
    failed: results.filter((entry) => !entry.ok).length,
    results,
  };
}

function startMemberSyncJob(config, options = {}) {
  if (!config.jobs.enabled) {
    return {
      enabled: false,
      stop() {},
      trigger: () => Promise.resolve({ checkedCorporations: 0, succeeded: 0, failed: 0, results: [] }),
    };
  }

  const intervalMs = config.jobs.memberSyncIntervalMinutes * 60_000;
  let timer = null;
  let running = false;
  let stopped = false;

  const trigger = async () => {
    if (running || stopped) {
      return null;
    }

    running = true;
    try {
      return await runMemberSyncJob(config, options);
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => {
    trigger().catch((error) => {
      console.error('[jobs:members] unhandled run failure:', error?.stack || error);
    });
  }, intervalMs);
  timer.unref?.();

  if (options.runImmediately !== false) {
    setImmediate(() => {
      trigger().catch((error) => {
        console.error('[jobs:members] initial run failure:', error?.stack || error);
      });
    });
  }

  console.log(`[jobs:members] enabled interval=${config.jobs.memberSyncIntervalMinutes}m`);

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
  runMemberSyncJob,
  startMemberSyncJob,
};
