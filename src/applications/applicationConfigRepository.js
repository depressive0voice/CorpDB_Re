const { createStoragePaths, normalizeCorporationId } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

function normalizeText(value) {
  return String(value || '').trim();
}

function createDefaultApplicationConfig(corporationId) {
  return {
    version: 1,
    corporationId: normalizeCorporationId(corporationId),
    alertChannelId: '',
  };
}

function normalizeApplicationConfig(corporationId, value = {}) {
  const normalizedCorporationId = normalizeCorporationId(corporationId);
  return {
    version: 1,
    corporationId: normalizedCorporationId,
    alertChannelId: normalizeText(value.alertChannelId),
  };
}

async function readApplicationConfig(storageRoot, corporationId) {
  const normalizedCorporationId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const raw = await readJson(paths.applicationsConfigFile(normalizedCorporationId), {
    defaultFactory: () => createDefaultApplicationConfig(normalizedCorporationId),
  });
  return normalizeApplicationConfig(normalizedCorporationId, raw);
}

async function writeApplicationConfig(storageRoot, corporationId, value) {
  const normalizedCorporationId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeApplicationConfig(normalizedCorporationId, value);
  await writeJsonAtomic(paths.applicationsConfigFile(normalizedCorporationId), normalized);
  return normalized;
}

async function updateApplicationConfig(storageRoot, corporationId, patch = {}) {
  const current = await readApplicationConfig(storageRoot, corporationId);
  return writeApplicationConfig(storageRoot, corporationId, {
    ...current,
    ...patch,
  });
}

module.exports = {
  createDefaultApplicationConfig,
  normalizeApplicationConfig,
  readApplicationConfig,
  writeApplicationConfig,
  updateApplicationConfig,
};
