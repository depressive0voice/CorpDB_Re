const crypto = require('crypto');
const { getEveSsoMetadata } = require('./eveSsoMetadataService');
const { validateEveAccessToken } = require('./eveJwtService');

function randomBase64Url(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function createPkcePair() {
  const verifier = randomBase64Url(32);
  const challenge = crypto.createHash('sha256').update(verifier, 'utf8').digest('base64url');
  return { verifier, challenge };
}

async function createAuthorizationRequest(config, scopes, options = {}) {
  const metadata = await getEveSsoMetadata({ fetchImpl: options.fetchImpl });
  const state = randomBase64Url(32);
  const pkce = createPkcePair();
  const authorizationUrl = new URL(metadata.authorizationEndpoint);

  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', config.eve.clientId);
  authorizationUrl.searchParams.set('redirect_uri', config.eve.redirectUri);
  authorizationUrl.searchParams.set('scope', scopes.join(' '));
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('code_challenge', pkce.challenge);
  authorizationUrl.searchParams.set('code_challenge_method', 'S256');

  return {
    state,
    codeVerifier: pkce.verifier,
    authorizationUrl: authorizationUrl.toString(),
    scopes: [...scopes],
  };
}

async function requestToken(config, body, options = {}) {
  const metadata = await getEveSsoMetadata({ fetchImpl: options.fetchImpl });
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(metadata.tokenEndpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'CorpDB/0.1.0',
    },
    body: new URLSearchParams(body).toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`EVE SSO token request failed (${response.status}): ${text}`);
  }

  const tokenData = await response.json();
  if (!tokenData.access_token || !tokenData.refresh_token) {
    throw new Error('EVE SSO token response is incomplete.');
  }
  return tokenData;
}

async function exchangeAuthorizationCode(config, code, codeVerifier, options = {}) {
  const tokenData = await requestToken(config, {
    grant_type: 'authorization_code',
    code,
    client_id: config.eve.clientId,
    code_verifier: codeVerifier,
  }, options);

  const validated = await validateEveAccessToken(tokenData.access_token, config.eve.clientId, options);
  return {
    ...validated,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    tokenType: String(tokenData.token_type || 'Bearer'),
  };
}

async function refreshAccessToken(config, refreshToken, options = {}) {
  const tokenData = await requestToken(config, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.eve.clientId,
  }, options);

  const validated = await validateEveAccessToken(tokenData.access_token, config.eve.clientId, options);
  return {
    ...validated,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || refreshToken,
    tokenType: String(tokenData.token_type || 'Bearer'),
  };
}

module.exports = {
  randomBase64Url,
  createPkcePair,
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  refreshAccessToken,
};
