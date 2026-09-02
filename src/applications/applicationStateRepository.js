const { createStoragePaths, normalizeCorporationId } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

function normalizeText(value) {
  return String(value || '').trim();
}

function createDefaultApplicationState(corporationId) {
  return {
    version: 1,
    corporationId: normalizeCorporationId(corporationId),
    lastCheckedAt: '',
    lastResetAt: '',
    applications: {},
  };
}

function normalizeApplicationEntry(corporationId, characterId, value = {}) {
  const normalizedCorporationId = normalizeCorporationId(corporationId);
  const normalizedCharacterId = String(characterId || value.characterId || '').trim();
  if (!/^\d+$/.test(normalizedCharacterId)) {
    throw new Error(`Invalid EVE characterId in application state: ${normalizedCharacterId || '<empty>'}`);
  }

  return {
    applicationKey: normalizedCharacterId,
    corporationId: normalizedCorporationId,
    characterId: normalizedCharacterId,
    characterName: normalizeText(value.characterName),
    status: normalizeText(value.status) || 'unknown',
    appliedAt: normalizeText(value.appliedAt),
    lastNotificationAt: normalizeText(value.lastNotificationAt),
    lastNotificationId: normalizeText(value.lastNotificationId),
    lastNotificationType: normalizeText(value.lastNotificationType),
    authFound: Boolean(value.authFound),
    authRole: normalizeText(value.authRole),
    authMain: normalizeText(value.authMain),
    authCorp: normalizeText(value.authCorp),
    authUpdatedAt: normalizeText(value.authUpdatedAt),
    authCardValue: normalizeText(value.authCardValue),
    authCardSyncedAt: normalizeText(value.authCardSyncedAt),
    authCardSyncError: normalizeText(value.authCardSyncError),
    channelId: normalizeText(value.channelId),
    messageId: normalizeText(value.messageId),
    messageUrl: normalizeText(value.messageUrl),
    postedAt: normalizeText(value.postedAt),
    createdAt: normalizeText(value.createdAt),
    updatedAt: normalizeText(value.updatedAt),
    lastStatusChangeAt: normalizeText(value.lastStatusChangeAt),
    updateCount: Math.max(0, Number(value.updateCount) || 0),
  };
}

function normalizeApplicationState(corporationId, value = {}) {
  const normalizedCorporationId = normalizeCorporationId(corporationId);
  const applications = {};
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

  for (const [rawCharacterId, rawEntry] of Object.entries(source.applications || {})) {
    const characterId = String(rawEntry?.characterId || rawCharacterId || '').trim();
    if (!/^\d+$/.test(characterId)) continue;
    applications[characterId] = normalizeApplicationEntry(
      normalizedCorporationId,
      characterId,
      rawEntry
    );
  }

  return {
    version: 1,
    corporationId: normalizedCorporationId,
    lastCheckedAt: normalizeText(source.lastCheckedAt),
    lastResetAt: normalizeText(source.lastResetAt),
    applications,
  };
}

async function readApplicationState(storageRoot, corporationId) {
  const normalizedCorporationId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const raw = await readJson(paths.applicationsStateFile(normalizedCorporationId), {
    defaultFactory: () => createDefaultApplicationState(normalizedCorporationId),
  });
  return normalizeApplicationState(normalizedCorporationId, raw);
}

async function writeApplicationState(storageRoot, corporationId, value) {
  const normalizedCorporationId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeApplicationState(normalizedCorporationId, value);
  await writeJsonAtomic(paths.applicationsStateFile(normalizedCorporationId), normalized);
  return normalized;
}

async function resetApplicationState(storageRoot, corporationId, options = {}) {
  const normalizedCorporationId = normalizeCorporationId(corporationId);
  const now = options.now instanceof Date ? options.now : new Date();
  return writeApplicationState(storageRoot, normalizedCorporationId, {
    ...createDefaultApplicationState(normalizedCorporationId),
    lastResetAt: now.toISOString(),
  });
}

module.exports = {
  createDefaultApplicationState,
  normalizeApplicationEntry,
  normalizeApplicationState,
  readApplicationState,
  writeApplicationState,
  resetApplicationState,
};
