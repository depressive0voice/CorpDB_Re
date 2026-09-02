const { CORPORATION_AUTH_SCOPES } = require('./eveScopes');
const {
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  refreshAccessToken,
} = require('./eveOAuthService');
const {
  savePendingSession,
  getPendingSession,
  consumePendingSession,
  saveEveAuthorization,
  getEveAuthorization,
  listEveAuthorizations,
  deleteEveAuthorization,
} = require('./eveOAuthRepository');
const {
  getCharacterPublicInfo,
  getCharacterCorporationRoles,
  resolveCorporationProfileFromCharacter,
} = require('./eveEsiClient');
const { registerCorporation } = require('../corporations/corporationRegistryRepository');
const { writeCorporationProfile, readCorporationProfile } = require('../corporations/corporationProfileRepository');
const { initializeCorporationStorage } = require('../storage/initializeStorage');

const AUTH_SESSION_TTL_MS = 15 * 60 * 1000;
const accessTokenCache = new Map();

function assertRequiredScopes(grantedScopes, requiredScopes = CORPORATION_AUTH_SCOPES) {
  const granted = new Set(grantedScopes || []);
  const missing = requiredScopes.filter((scope) => !granted.has(scope));
  if (missing.length > 0) {
    throw new Error(`EVE authorization is missing required scopes: ${missing.join(', ')}`);
  }
}

function buildLocalAuthorizationStartUrl(config, state) {
  const url = new URL('/auth/eve/start', config.eve.redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

async function beginCorporationAuthorization(config, storageRoot, context = {}, options = {}) {
  const request = await createAuthorizationRequest(config, CORPORATION_AUTH_SCOPES, options);
  const now = Date.now();
  const session = {
    version: 1,
    codeVerifier: request.codeVerifier,
    authorizationUrl: request.authorizationUrl,
    scopes: request.scopes,
    initiatedByDiscordUserId: String(context.discordUserId || ''),
    guildId: String(context.guildId || ''),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + AUTH_SESSION_TTL_MS).toISOString(),
  };

  await savePendingSession(storageRoot, request.state, session);
  return {
    authorizationUrl: request.authorizationUrl,
    localAuthorizationUrl: buildLocalAuthorizationStartUrl(config, request.state),
    state: request.state,
    expiresAt: session.expiresAt,
    scopes: request.scopes,
  };
}

async function getAuthorizationRedirectUrl(storageRoot, state) {
  const key = String(state || '').trim();
  if (!key) throw new Error('EVE OAuth start request is missing state.');

  const session = await getPendingSession(storageRoot, key);
  if (!session) throw new Error('EVE OAuth state is invalid or expired. Run /auth setup again.');
  if (Date.parse(session.expiresAt || '') <= Date.now()) {
    throw new Error('EVE OAuth setup session expired. Run /auth setup again.');
  }

  const authorizationUrl = String(session.authorizationUrl || '').trim();
  if (!authorizationUrl) {
    throw new Error('EVE OAuth setup session has no authorization URL. Run /auth setup again.');
  }

  return authorizationUrl;
}

async function completeCorporationAuthorization(config, storageRoot, callback, options = {}) {
  const state = String(callback?.state || '').trim();
  const code = String(callback?.code || '').trim();
  if (!state || !code) throw new Error('EVE OAuth callback is missing state or code.');

  const session = await consumePendingSession(storageRoot, state);
  if (!session) throw new Error('EVE OAuth state is invalid, expired, or already used.');
  if (Date.parse(session.expiresAt || '') <= Date.now()) {
    throw new Error('EVE OAuth setup session expired. Run /auth setup again.');
  }

  const tokenContext = await exchangeAuthorizationCode(
    config,
    code,
    session.codeVerifier,
    options
  );
  assertRequiredScopes(tokenContext.scopes, session.scopes);

  const profile = await resolveCorporationProfileFromCharacter(
    config,
    tokenContext.characterId,
    options
  );

  let corporationRoles = [];
  try {
    corporationRoles = await getCharacterCorporationRoles(
      config,
      tokenContext.characterId,
      tokenContext.accessToken,
      options
    );
  } catch (error) {
    console.warn(`[eve-auth] could not read corporation roles for ${tokenContext.characterName || tokenContext.characterId}: ${error.message}`);
  }

  const existingAuthorizations = await listEveAuthorizations(storageRoot);
  for (const existing of existingAuthorizations) {
    if (
      existing.characterId === tokenContext.characterId &&
      existing.corporationId !== profile.corporationId
    ) {
      await deleteEveAuthorization(storageRoot, existing.corporationId);
      accessTokenCache.delete(existing.corporationId);
    }
  }

  await registerCorporation(storageRoot, profile.corporationId);
  await initializeCorporationStorage(storageRoot, profile.corporationId);
  await writeCorporationProfile(storageRoot, profile.corporationId, profile);

  const authorization = await saveEveAuthorization(storageRoot, {
    corporationId: profile.corporationId,
    characterId: tokenContext.characterId,
    characterName: tokenContext.characterName,
    refreshToken: tokenContext.refreshToken,
    scopes: tokenContext.scopes,
    corporationRoles,
  });

  accessTokenCache.set(profile.corporationId, {
    accessToken: tokenContext.accessToken,
    expiresAt: tokenContext.expiresAt,
    characterId: tokenContext.characterId,
    characterName: tokenContext.characterName,
    scopes: tokenContext.scopes,
  });

  return {
    session,
    profile,
    authorization: {
      corporationId: authorization.corporationId,
      characterId: authorization.characterId,
      characterName: authorization.characterName,
      scopes: [...authorization.scopes],
      corporationRoles: [...authorization.corporationRoles],
      authorizedAt: authorization.authorizedAt,
      updatedAt: authorization.updatedAt,
    },
  };
}

async function getCorporationAccessContext(config, storageRoot, corporationId, options = {}) {
  const id = String(corporationId || '').trim();
  const authorization = await getEveAuthorization(storageRoot, id);
  if (!authorization) {
    throw new Error(`Corporation ${id} has no EVE authorization.`);
  }

  const cached = accessTokenCache.get(id);
  if (!options.forceRefresh && cached && cached.expiresAt - 60_000 > Date.now()) {
    return { corporationId: id, ...cached };
  }

  const refreshed = await refreshAccessToken(config, authorization.refreshToken, options);
  assertRequiredScopes(refreshed.scopes, authorization.scopes);

  if (refreshed.characterId !== authorization.characterId) {
    throw new Error(
      `EVE refresh token character mismatch for corporation ${id}: expected ${authorization.characterId}, got ${refreshed.characterId}.`
    );
  }

  const character = await getCharacterPublicInfo(config, refreshed.characterId, options);
  const currentCorporationId = String(character.corporation_id || '').trim();
  if (currentCorporationId !== id) {
    const error = new Error(
      `EVE authorization mismatch: corporation ${id} is bound to character ${refreshed.characterName || refreshed.characterId}, now in corporation ${currentCorporationId || 'unknown'}. Reauthorization is required.`
    );
    error.code = 'eve_authorization_corporation_mismatch';
    throw error;
  }

  if (refreshed.refreshToken !== authorization.refreshToken) {
    await saveEveAuthorization(storageRoot, {
      ...authorization,
      refreshToken: refreshed.refreshToken,
      scopes: refreshed.scopes,
    });
  }

  const next = {
    accessToken: refreshed.accessToken,
    expiresAt: refreshed.expiresAt,
    characterId: refreshed.characterId,
    characterName: refreshed.characterName,
    scopes: refreshed.scopes,
  };
  accessTokenCache.set(id, next);
  return { corporationId: id, ...next };
}

async function getAuthorizationStatus(storageRoot) {
  const authorizations = await listEveAuthorizations(storageRoot);
  const results = [];

  for (const authorization of authorizations) {
    const profile = await readCorporationProfile(
      storageRoot,
      authorization.corporationId,
      { createIfMissing: false }
    ).catch(() => null);

    results.push({
      corporationId: authorization.corporationId,
      corporationName: profile?.name || '',
      corporationTicker: profile?.ticker || '',
      characterId: authorization.characterId,
      characterName: authorization.characterName,
      scopes: [...(authorization.scopes || [])],
      corporationRoles: [...(authorization.corporationRoles || [])],
      authorizedAt: authorization.authorizedAt,
      updatedAt: authorization.updatedAt,
    });
  }

  return results;
}

module.exports = {
  AUTH_SESSION_TTL_MS,
  assertRequiredScopes,
  buildLocalAuthorizationStartUrl,
  beginCorporationAuthorization,
  getAuthorizationRedirectUrl,
  completeCorporationAuthorization,
  getCorporationAccessContext,
  getAuthorizationStatus,
};
