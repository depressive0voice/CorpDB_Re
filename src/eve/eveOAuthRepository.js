const fs = require('fs/promises');
const { createStoragePaths, normalizeCorporationId } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

function createAuthorizationStore() {
  return {
    version: 1,
    authorizations: {},
  };
}

function createPendingStore() {
  return {
    version: 1,
    sessions: {},
  };
}

async function writeSecureJson(filePath, value) {
  await writeJsonAtomic(filePath, value);
  await fs.chmod(filePath, 0o600).catch(() => null);
}

async function readAuthorizationStore(storageRoot) {
  const paths = createStoragePaths(storageRoot);
  const value = await readJson(paths.eveOAuthSecretsFile, {
    createIfMissing: false,
    defaultFactory: createAuthorizationStore,
  });

  return value && typeof value === 'object' && !Array.isArray(value)
    ? { version: 1, authorizations: value.authorizations || {} }
    : createAuthorizationStore();
}

async function writeAuthorizationStore(storageRoot, store) {
  const paths = createStoragePaths(storageRoot);
  const normalized = {
    version: 1,
    authorizations: store?.authorizations && typeof store.authorizations === 'object'
      ? store.authorizations
      : {},
  };
  await writeSecureJson(paths.eveOAuthSecretsFile, normalized);
  return normalized;
}

async function saveEveAuthorization(storageRoot, authorization) {
  const corporationId = normalizeCorporationId(authorization?.corporationId);
  const store = await readAuthorizationStore(storageRoot);
  const now = new Date().toISOString();
  const previous = store.authorizations[corporationId] || {};

  const normalized = {
    corporationId,
    characterId: String(authorization.characterId || '').trim(),
    characterName: String(authorization.characterName || '').trim(),
    refreshToken: String(authorization.refreshToken || '').trim(),
    scopes: [...new Set((authorization.scopes || []).map(String))],
    corporationRoles: [...new Set((authorization.corporationRoles || []).map(String))],
    authorizedAt: String(previous.authorizedAt || authorization.authorizedAt || now),
    updatedAt: now,
  };

  if (!normalized.characterId || !normalized.refreshToken) {
    throw new Error('Cannot save incomplete EVE authorization.');
  }

  store.authorizations[corporationId] = normalized;
  await writeAuthorizationStore(storageRoot, store);
  return normalized;
}

async function getEveAuthorization(storageRoot, corporationId) {
  const normalizedId = normalizeCorporationId(corporationId);
  const store = await readAuthorizationStore(storageRoot);
  return store.authorizations[normalizedId] || null;
}

async function listEveAuthorizations(storageRoot) {
  const store = await readAuthorizationStore(storageRoot);
  return Object.values(store.authorizations || {});
}

async function deleteEveAuthorization(storageRoot, corporationId) {
  const normalizedId = normalizeCorporationId(corporationId);
  const store = await readAuthorizationStore(storageRoot);
  const existed = Boolean(store.authorizations[normalizedId]);
  delete store.authorizations[normalizedId];
  if (existed) await writeAuthorizationStore(storageRoot, store);
  return existed;
}

async function readPendingStore(storageRoot) {
  const paths = createStoragePaths(storageRoot);
  const value = await readJson(paths.eveOAuthPendingFile, {
    createIfMissing: false,
    defaultFactory: createPendingStore,
  });

  return value && typeof value === 'object' && !Array.isArray(value)
    ? { version: 1, sessions: value.sessions || {} }
    : createPendingStore();
}

function purgeExpiredSessions(store, now = Date.now()) {
  for (const [state, session] of Object.entries(store.sessions || {})) {
    const expiresAt = Date.parse(session?.expiresAt || '');
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      delete store.sessions[state];
    }
  }
  return store;
}

async function savePendingSession(storageRoot, state, session) {
  const paths = createStoragePaths(storageRoot);
  const store = purgeExpiredSessions(await readPendingStore(storageRoot));
  store.sessions[String(state)] = session;
  await writeSecureJson(paths.eveOAuthPendingFile, store);
  return session;
}

async function getPendingSession(storageRoot, state) {
  const paths = createStoragePaths(storageRoot);
  const store = purgeExpiredSessions(await readPendingStore(storageRoot));
  await writeSecureJson(paths.eveOAuthPendingFile, store);
  return store.sessions[String(state || '')] || null;
}

async function consumePendingSession(storageRoot, state) {
  const paths = createStoragePaths(storageRoot);
  const store = purgeExpiredSessions(await readPendingStore(storageRoot));
  const key = String(state || '');
  const session = store.sessions[key] || null;
  if (session) delete store.sessions[key];
  await writeSecureJson(paths.eveOAuthPendingFile, store);
  return session;
}

module.exports = {
  createAuthorizationStore,
  createPendingStore,
  readAuthorizationStore,
  saveEveAuthorization,
  getEveAuthorization,
  listEveAuthorizations,
  deleteEveAuthorization,
  savePendingSession,
  getPendingSession,
  consumePendingSession,
  purgeExpiredSessions,
};
