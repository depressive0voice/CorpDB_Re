const {
  listEnabledApplicationCorporationIds,
} = require('../applications/applicationCorporationService');
const {
  processCorporationApplications,
} = require('../applications/applicationAlertService');
const { filterCorporationIds } = require('./jobCorporationSelection');

async function runApplicationJob(config, client, options = {}) {
  const storageRoot = config.storage.rootDir;
  const processImpl = options.processImpl || processCorporationApplications;
  const corporationIds = filterCorporationIds(
    await listEnabledApplicationCorporationIds(storageRoot),
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
        options
      );
      results.push({ corporationId, ok: true, result });
      if (!options.silent) {
        console.log(
          `[jobs:applications] corporation=${corporationId} notifications=${result.applicationNotificationsCount || 0} tracked=${result.trackedApplicationsCount || 0} pending=${result.pendingApplicationsCount || 0} sent=${result.sentCount || 0} edited=${result.editedCount || 0}`
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
        `[jobs:applications] corporation=${corporationId} failed:`,
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

function startApplicationJob(config, client, options = {}) {
  if (!config.jobs.enabled || !config.jobs.applicationsEnabled) {
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

  const intervalMs = config.jobs.applicationsCheckIntervalMinutes * 60_000;
  let timer = null;
  let running = false;
  let stopped = false;

  const trigger = async () => {
    if (running || stopped) return null;
    running = true;
    try {
      return await runApplicationJob(config, client, options);
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => {
    trigger().catch((error) => {
      console.error('[jobs:applications] unhandled run failure:', error?.stack || error);
    });
  }, intervalMs);
  timer.unref?.();

  if (options.runImmediately !== false) {
    setImmediate(() => {
      trigger().catch((error) => {
        console.error('[jobs:applications] initial run failure:', error?.stack || error);
      });
    });
  }

  console.log(`[jobs:applications] enabled interval=${config.jobs.applicationsCheckIntervalMinutes}m`);

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
  runApplicationJob,
  startApplicationJob,
};
