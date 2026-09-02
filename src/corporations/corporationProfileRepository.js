const { createStoragePaths, normalizeCorporationId } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

function normalizeTaxRatePercent(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function createEmptyCorporationProfile(corporationId) {
  return {
    version: 1,
    corporationId: normalizeCorporationId(corporationId),
    name: '',
    ticker: '',
    allianceId: '',
    allianceName: '',
    taxRatePercent: 0,
    metadataUpdatedAt: '',
  };
}

function normalizeProfile(corporationId, value) {
  const normalizedId = normalizeCorporationId(corporationId);
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

  if (source.corporationId && normalizeCorporationId(source.corporationId) !== normalizedId) {
    throw new Error(
      `Corporation profile mismatch: path=${normalizedId}, profile=${source.corporationId}`
    );
  }

  return {
    version: 1,
    corporationId: normalizedId,
    name: String(source.name ?? '').trim(),
    ticker: String(source.ticker ?? '').trim(),
    allianceId: String(source.allianceId ?? '').trim(),
    allianceName: String(source.allianceName ?? '').trim(),
    taxRatePercent: normalizeTaxRatePercent(source.taxRatePercent),
    metadataUpdatedAt: String(source.metadataUpdatedAt ?? '').trim(),
  };
}

async function readCorporationProfile(storageRoot, corporationId, options = {}) {
  const normalizedId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const raw = await readJson(paths.corporationProfileFile(normalizedId), {
    createIfMissing: options.createIfMissing !== false,
    defaultFactory: () => createEmptyCorporationProfile(normalizedId),
  });
  return normalizeProfile(normalizedId, raw);
}

async function writeCorporationProfile(storageRoot, corporationId, profile) {
  const normalizedId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeProfile(normalizedId, profile);
  await writeJsonAtomic(paths.corporationProfileFile(normalizedId), normalized);
  return normalized;
}

module.exports = {
  createEmptyCorporationProfile,
  readCorporationProfile,
  writeCorporationProfile,
};
