const { createStoragePaths, normalizeCorporationId } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

function normalizeText(value) {
  return String(value || '').trim();
}

function createDefaultStructureAlertState() {
  return {
    version: 1,
    lastCheckedAt: '',
    structures: {},
  };
}

function normalizeAlertEntry(structureId, value = {}) {
  return {
    structureId: normalizeText(value.structureId || structureId),
    name: normalizeText(value.name),
    systemName: normalizeText(value.systemName),
    itemKind: normalizeText(value.itemKind),
    objectTypeLabel: normalizeText(value.objectTypeLabel),
    isPos: Boolean(value.isPos),
    isMetenox: Boolean(value.isMetenox),
    isCritical: Boolean(value.isCritical),
    alertStatusLabel: normalizeText(value.alertStatusLabel),
    timeRemainingLabel: normalizeText(value.timeRemainingLabel),
    lastFuelExpires: normalizeText(value.lastFuelExpires),
    lastAlertAt: normalizeText(value.lastAlertAt),
    lastResolvedAt: normalizeText(value.lastResolvedAt),
    updatedAt: normalizeText(value.updatedAt),
  };
}

function normalizeStructureAlertState(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rawStructures = source.structures && typeof source.structures === 'object' && !Array.isArray(source.structures)
    ? source.structures
    : {};
  const structures = {};
  for (const [structureId, entry] of Object.entries(rawStructures)) {
    const key = normalizeText(structureId);
    if (!key) continue;
    structures[key] = normalizeAlertEntry(key, entry);
  }
  return {
    version: 1,
    lastCheckedAt: normalizeText(source.lastCheckedAt),
    structures,
  };
}

async function readStructureAlertState(storageRoot, corporationId) {
  const id = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const value = await readJson(paths.structuresAlertStateFile(id), {
    defaultFactory: createDefaultStructureAlertState,
  });
  return normalizeStructureAlertState(value);
}

async function writeStructureAlertState(storageRoot, corporationId, value) {
  const id = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeStructureAlertState(value);
  await writeJsonAtomic(paths.structuresAlertStateFile(id), normalized);
  return normalized;
}

module.exports = {
  createDefaultStructureAlertState,
  normalizeStructureAlertState,
  readStructureAlertState,
  writeStructureAlertState,
};
