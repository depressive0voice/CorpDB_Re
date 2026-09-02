const { createStoragePaths, normalizeCorporationId } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

const DEFAULT_MINIMUM_FAT = 3;
const DEFAULT_LOOKBACK_MONTHS = 3;

function normalizePositiveInteger(value, fallback, max = 120) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric) || numeric < 1) return fallback;
  return Math.min(max, numeric);
}

function createDefaultActivityPolicy(corporationId) {
  return {
    version: 1,
    corporationId: normalizeCorporationId(corporationId),
    minimumFat: DEFAULT_MINIMUM_FAT,
    lookbackMonths: DEFAULT_LOOKBACK_MONTHS,
  };
}

function normalizeActivityPolicy(corporationId, value = {}) {
  const normalizedId = normalizeCorporationId(corporationId);
  const defaults = createDefaultActivityPolicy(normalizedId);
  return {
    version: 1,
    corporationId: normalizedId,
    minimumFat: normalizePositiveInteger(value.minimumFat, defaults.minimumFat, 1000),
    lookbackMonths: normalizePositiveInteger(value.lookbackMonths, defaults.lookbackMonths, 24),
  };
}

async function readActivityPolicy(storageRoot, corporationId) {
  const normalizedId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const raw = await readJson(paths.activityPolicyFile(normalizedId), {
    defaultFactory: () => createDefaultActivityPolicy(normalizedId),
  });
  return normalizeActivityPolicy(normalizedId, raw);
}

async function writeActivityPolicy(storageRoot, corporationId, value) {
  const normalizedId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeActivityPolicy(normalizedId, value);
  await writeJsonAtomic(paths.activityPolicyFile(normalizedId), normalized);
  return normalized;
}

module.exports = {
  DEFAULT_MINIMUM_FAT,
  DEFAULT_LOOKBACK_MONTHS,
  createDefaultActivityPolicy,
  normalizeActivityPolicy,
  readActivityPolicy,
  writeActivityPolicy,
};
