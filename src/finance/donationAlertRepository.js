const { createStoragePaths, normalizeCorporationId } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

function createDefaultDonationAlertState(corporationId) {
  return {
    version: 1,
    corporationId: normalizeCorporationId(corporationId),
    lastCheckedAt: '',
    alertedEntries: {},
  };
}

function normalizeDonationAlertState(corporationId, value) {
  const normalizedId = normalizeCorporationId(corporationId);
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const entries = source.alertedEntries && typeof source.alertedEntries === 'object' && !Array.isArray(source.alertedEntries)
    ? source.alertedEntries
    : {};
  return {
    version: 1,
    corporationId: normalizedId,
    lastCheckedAt: String(source.lastCheckedAt || '').trim(),
    alertedEntries: { ...entries },
  };
}

async function readDonationAlertState(storageRoot, corporationId) {
  const normalizedId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const raw = await readJson(paths.donationAlertStateFile(normalizedId), {
    defaultFactory: () => createDefaultDonationAlertState(normalizedId),
  });
  return normalizeDonationAlertState(normalizedId, raw);
}

async function writeDonationAlertState(storageRoot, corporationId, value) {
  const normalizedId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeDonationAlertState(normalizedId, value);
  await writeJsonAtomic(paths.donationAlertStateFile(normalizedId), normalized);
  return normalized;
}

module.exports = {
  createDefaultDonationAlertState,
  readDonationAlertState,
  writeDonationAlertState,
};
