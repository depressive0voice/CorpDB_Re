const { createStoragePaths, normalizeCorporationId } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

const DEFAULT_DISABLED_TYPE_IDS = Object.freeze(['81826']);

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeTypeIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeText(value))
    .filter((value) => /^\d+$/.test(value)))]
    .sort((left, right) => Number(left) - Number(right));
}

function normalizeAlertClass(value) {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === 'upwell' || normalized === 'pos' ? normalized : '';
}

function normalizeAlertFilter(value = {}) {
  return {
    class: normalizeAlertClass(value.class),
    groupId: /^\d+$/.test(normalizeText(value.groupId)) ? normalizeText(value.groupId) : '',
    typeId: /^\d+$/.test(normalizeText(value.typeId)) ? normalizeText(value.typeId) : '',
    structureId: normalizeText(value.structureId),
  };
}

function alertFilterKey(value) {
  const filter = normalizeAlertFilter(value);
  return [filter.class, filter.groupId, filter.typeId, filter.structureId].join('|');
}

function normalizeAlertFilters(values) {
  const result = new Map();
  for (const raw of Array.isArray(values) ? values : []) {
    const filter = normalizeAlertFilter(raw);
    if (!filter.class && !filter.groupId && !filter.typeId && !filter.structureId) continue;
    result.set(alertFilterKey(filter), filter);
  }
  return [...result.values()].sort((left, right) => alertFilterKey(left).localeCompare(alertFilterKey(right)));
}

function createDefaultStructureConfig() {
  return {
    version: 2,
    alertChannelId: '',
    alertRoleId: '',
    disabledTypeIds: [...DEFAULT_DISABLED_TYPE_IDS],
    disabledAlertFilters: [],
  };
}

function normalizeStructureConfig(value = {}) {
  const defaults = createDefaultStructureConfig();
  return {
    version: 2,
    alertChannelId: normalizeText(value.alertChannelId),
    alertRoleId: normalizeText(value.alertRoleId),
    disabledTypeIds: normalizeTypeIds(
      value.disabledTypeIds === undefined ? defaults.disabledTypeIds : value.disabledTypeIds
    ),
    disabledAlertFilters: normalizeAlertFilters(value.disabledAlertFilters),
  };
}

async function readStructureConfig(storageRoot, corporationId) {
  const id = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const value = await readJson(paths.structuresConfigFile(id), {
    defaultFactory: createDefaultStructureConfig,
  });
  return normalizeStructureConfig(value);
}

async function writeStructureConfig(storageRoot, corporationId, value) {
  const id = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeStructureConfig(value);
  await writeJsonAtomic(paths.structuresConfigFile(id), normalized);
  return normalized;
}

async function updateStructureConfig(storageRoot, corporationId, patch = {}) {
  const current = await readStructureConfig(storageRoot, corporationId);
  return writeStructureConfig(storageRoot, corporationId, {
    ...current,
    ...patch,
  });
}

module.exports = {
  DEFAULT_DISABLED_TYPE_IDS,
  normalizeTypeIds,
  normalizeAlertClass,
  normalizeAlertFilter,
  alertFilterKey,
  normalizeAlertFilters,
  createDefaultStructureConfig,
  normalizeStructureConfig,
  readStructureConfig,
  writeStructureConfig,
  updateStructureConfig,
};
