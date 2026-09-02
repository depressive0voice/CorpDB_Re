const { createStoragePaths, normalizeCorporationId } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createDefaultMetenoxGuardState() {
  return {
    version: 1,
    structures: {},
  };
}

function normalizeGuardEntry(structureId, value = {}) {
  return {
    structureId: normalizeText(value.structureId || structureId),
    zeroFuelBlockCriticalCount: Math.max(0, normalizeNumber(value.zeroFuelBlockCriticalCount, 0)),
    zeroGasCriticalCount: Math.max(0, normalizeNumber(value.zeroGasCriticalCount, 0)),
    stableCritical: Boolean(value.stableCritical),
    lastSeenAt: normalizeText(value.lastSeenAt),
    lastSuppressedAt: normalizeText(value.lastSuppressedAt),
    lastStableCriticalAt: normalizeText(value.lastStableCriticalAt),
    lastRecoveredAt: normalizeText(value.lastRecoveredAt),
    lastFuelBlockHoursRemaining: value.lastFuelBlockHoursRemaining === null
      ? null
      : normalizeNumber(value.lastFuelBlockHoursRemaining, null),
    lastFuelBlockQuantity: normalizeNumber(value.lastFuelBlockQuantity, 0),
    lastMagmaticGasHoursRemaining: value.lastMagmaticGasHoursRemaining === null
      ? null
      : normalizeNumber(value.lastMagmaticGasHoursRemaining, null),
    lastMagmaticGasQuantity: normalizeNumber(value.lastMagmaticGasQuantity, 0),
  };
}

function normalizeMetenoxGuardState(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rawStructures = source.structures && typeof source.structures === 'object' && !Array.isArray(source.structures)
    ? source.structures
    : {};
  const structures = {};
  for (const [structureId, entry] of Object.entries(rawStructures)) {
    const key = normalizeText(structureId);
    if (!key) continue;
    structures[key] = normalizeGuardEntry(key, entry);
  }
  return { version: 1, structures };
}

async function readMetenoxGuardState(storageRoot, corporationId) {
  const id = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const value = await readJson(paths.structuresMetenoxGuardFile(id), {
    defaultFactory: createDefaultMetenoxGuardState,
  });
  return normalizeMetenoxGuardState(value);
}

async function writeMetenoxGuardState(storageRoot, corporationId, value) {
  const id = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeMetenoxGuardState(value);
  await writeJsonAtomic(paths.structuresMetenoxGuardFile(id), normalized);
  return normalized;
}

module.exports = {
  createDefaultMetenoxGuardState,
  normalizeGuardEntry,
  normalizeMetenoxGuardState,
  readMetenoxGuardState,
  writeMetenoxGuardState,
};
