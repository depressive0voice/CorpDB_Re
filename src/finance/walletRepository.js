const { createStoragePaths, normalizeCorporationId } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

function normalizeText(value) {
  return String(value ?? '').trim();
}

function createEmptyWalletSnapshot(corporationId) {
  return {
    version: 1,
    corporationId: normalizeCorporationId(corporationId),
    corporationName: '',
    authorizedCharacterId: '',
    authorizedCharacterName: '',
    retrievedAt: '',
    divisions: [],
  };
}

function normalizeDivision(value = {}) {
  const division = Number(value.division || 0);
  return {
    division: Number.isInteger(division) && division > 0 ? division : 0,
    balance: Number.isFinite(Number(value.balance)) ? Number(value.balance) : 0,
  };
}

function normalizeWalletSnapshot(corporationId, value) {
  const normalizedId = normalizeCorporationId(corporationId);
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  if (source.corporationId && normalizeCorporationId(source.corporationId) !== normalizedId) {
    throw new Error(`Wallet snapshot corporation mismatch: ${source.corporationId} != ${normalizedId}.`);
  }

  return {
    version: 1,
    corporationId: normalizedId,
    corporationName: normalizeText(source.corporationName),
    authorizedCharacterId: normalizeText(source.authorizedCharacterId),
    authorizedCharacterName: normalizeText(source.authorizedCharacterName),
    retrievedAt: normalizeText(source.retrievedAt),
    divisions: (Array.isArray(source.divisions) ? source.divisions : [])
      .map(normalizeDivision)
      .filter((entry) => entry.division > 0)
      .sort((left, right) => left.division - right.division),
  };
}

async function readWalletSnapshot(storageRoot, corporationId) {
  const normalizedId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const raw = await readJson(paths.financeWalletSnapshotFile(normalizedId), {
    defaultFactory: () => createEmptyWalletSnapshot(normalizedId),
  });
  return normalizeWalletSnapshot(normalizedId, raw);
}

async function writeWalletSnapshot(storageRoot, corporationId, value) {
  const normalizedId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeWalletSnapshot(normalizedId, value);
  await writeJsonAtomic(paths.financeWalletSnapshotFile(normalizedId), normalized);
  return normalized;
}

module.exports = {
  createEmptyWalletSnapshot,
  normalizeWalletSnapshot,
  readWalletSnapshot,
  writeWalletSnapshot,
};
