const { startFinanceJob } = require('../jobs/financeJob');
const { startStructureFuelJob } = require('../jobs/structureFuelJob');
const { startFatRewardsReminderJob } = require('../jobs/fatRewardsReminderJob');
const { startRoleExpiryJob } = require('../jobs/roleExpiryJob');
const { MODULE_KEYS } = require('./moduleRegistry');
const { getModuleStateMap } = require('./moduleConfigRepository');

const JOB_STARTERS = Object.freeze({
  [MODULE_KEYS.FINANCE]: (config, client) => startFinanceJob(config, client),
  [MODULE_KEYS.STRUCTURE_FUEL]: (config, client) => startStructureFuelJob(config, client),
  [MODULE_KEYS.FAT_REWARDS]: (config, client) => startFatRewardsReminderJob(config, client),
  [MODULE_KEYS.ROLE_EXPIRY]: (config, client) => startRoleExpiryJob(config, client),
});

function createModuleRuntimeManager(config, client) {
  const handles = new Map();

  function stopHandle(moduleKey) {
    const handle = handles.get(moduleKey);
    if (handle && typeof handle.stop === 'function') handle.stop();
    handles.delete(moduleKey);
  }

  async function startHandle(moduleKey) {
    if (handles.has(moduleKey)) return handles.get(moduleKey);
    const starter = JOB_STARTERS[moduleKey];
    if (!starter) return null;
    const handle = (await starter(config, client)) || null;
    if (handle && handle.enabled !== false) handles.set(moduleKey, handle);
    return handle;
  }

  async function setModuleEnabled(moduleKey, enabled) {
    const key = String(moduleKey || '').trim().toLowerCase();
    if (!JOB_STARTERS[key]) return { moduleKey: key, hasBackgroundJob: false, running: false };
    if (enabled) await startHandle(key);
    else stopHandle(key);
    return {
      moduleKey: key,
      hasBackgroundJob: true,
      running: handles.has(key),
    };
  }

  async function restartModule(moduleKey) {
    const key = String(moduleKey || '').trim().toLowerCase();
    stopHandle(key);
    const states = await getModuleStateMap(config.storage.rootDir);
    if (states[key] !== false) await startHandle(key);
    return {
      moduleKey: key,
      hasBackgroundJob: Boolean(JOB_STARTERS[key]),
      running: handles.has(key),
    };
  }

  async function startEnabledModules() {
    const states = await getModuleStateMap(config.storage.rootDir);
    for (const moduleKey of Object.keys(JOB_STARTERS)) {
      if (states[moduleKey] !== false) await startHandle(moduleKey);
      else stopHandle(moduleKey);
    }
    return getStatus();
  }

  function stopAll() {
    for (const moduleKey of [...handles.keys()]) stopHandle(moduleKey);
  }

  function getStatus() {
    return Object.keys(JOB_STARTERS).map((moduleKey) => ({
      moduleKey,
      running: handles.has(moduleKey),
    }));
  }

  return {
    startEnabledModules,
    setModuleEnabled,
    restartModule,
    stopAll,
    getStatus,
  };
}

module.exports = {
  JOB_STARTERS,
  createModuleRuntimeManager,
};
