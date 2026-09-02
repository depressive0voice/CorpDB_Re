const { createStoragePaths } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');
const {
  MODULE_KEYS,
  MODULE_DEFINITIONS,
  MODULE_ORDER,
  normalizeModuleKey,
  getModuleDefinition,
} = require('./moduleRegistry');

const DEFAULT_MODULE_STATES = Object.freeze(Object.fromEntries(
  MODULE_ORDER.map((key) => [key, MODULE_DEFINITIONS[key].defaultEnabled !== false])
));

function createDefaultModuleConfig() {
  return {
    version: 1,
    modules: { ...DEFAULT_MODULE_STATES },
  };
}

function normalizeModuleConfig(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const modules = { ...DEFAULT_MODULE_STATES };
  for (const key of MODULE_ORDER) {
    if (typeof source.modules?.[key] === 'boolean') modules[key] = source.modules[key];
  }
  return { version: 1, modules };
}

async function readModuleConfig(storageRoot) {
  const paths = createStoragePaths(storageRoot);
  const raw = await readJson(paths.modulesFile, { defaultFactory: createDefaultModuleConfig });
  return normalizeModuleConfig(raw);
}

async function writeModuleConfig(storageRoot, value) {
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeModuleConfig(value);
  await writeJsonAtomic(paths.modulesFile, normalized);
  return normalized;
}

async function getModuleStateMap(storageRoot) {
  const config = await readModuleConfig(storageRoot);
  return { ...config.modules };
}

async function isModuleEnabled(storageRoot, moduleKey) {
  const key = normalizeModuleKey(moduleKey);
  if (!getModuleDefinition(key)) return false;
  const config = await readModuleConfig(storageRoot);
  return config.modules[key] !== false;
}

function createModuleError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

async function setModuleEnabled(storageRoot, moduleKey, enabled) {
  const key = normalizeModuleKey(moduleKey);
  const definition = getModuleDefinition(key);
  if (!definition) {
    throw createModuleError(`Unknown CorpDB module: ${moduleKey}.`, 'module_unknown', { moduleKey: key });
  }
  if (typeof enabled !== 'boolean') {
    throw createModuleError('Module enabled state must be boolean.', 'module_state_invalid', { moduleKey: key });
  }

  const current = await readModuleConfig(storageRoot);
  if (enabled) {
    const missingDependencies = definition.dependencies.filter((dependency) => current.modules[dependency] === false);
    if (missingDependencies.length) {
      throw createModuleError(
        `Module ${key} requires enabled module(s): ${missingDependencies.join(', ')}.`,
        'module_dependency_disabled',
        { moduleKey: key, dependencies: missingDependencies }
      );
    }
  } else {
    const enabledDependents = MODULE_ORDER.filter((candidateKey) => {
      if (current.modules[candidateKey] === false) return false;
      return MODULE_DEFINITIONS[candidateKey].dependencies.includes(key);
    });
    if (enabledDependents.length) {
      throw createModuleError(
        `Module ${key} is required by enabled module(s): ${enabledDependents.join(', ')}.`,
        'module_required_by_enabled_module',
        { moduleKey: key, dependents: enabledDependents }
      );
    }
  }

  return writeModuleConfig(storageRoot, {
    ...current,
    modules: { ...current.modules, [key]: enabled },
  });
}

async function listModuleStates(storageRoot) {
  const config = await readModuleConfig(storageRoot);
  return MODULE_ORDER.map((key) => ({
    key,
    label: MODULE_DEFINITIONS[key].label,
    enabled: config.modules[key] !== false,
    dependencies: [...MODULE_DEFINITIONS[key].dependencies],
  }));
}

module.exports = {
  MODULE_KEYS,
  MODULE_DEFINITIONS,
  DEFAULT_MODULE_STATES,
  createDefaultModuleConfig,
  normalizeModuleConfig,
  readModuleConfig,
  writeModuleConfig,
  getModuleStateMap,
  isModuleEnabled,
  setModuleEnabled,
  listModuleStates,
};
