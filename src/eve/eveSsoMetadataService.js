const METADATA_URL = 'https://login.eveonline.com/.well-known/oauth-authorization-server';
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedMetadata = null;
let metadataExpiresAt = 0;
let cachedJwks = null;
let jwksUri = '';
let jwksExpiresAt = 0;

function ensureHttpsUrl(value, fieldName) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:') {
    throw new Error(`EVE SSO metadata field ${fieldName} must use HTTPS.`);
  }
  return url.toString();
}

async function fetchJson(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'CorpDB/0.1.0',
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`EVE SSO metadata request failed (${response.status}): ${body}`);
  }

  return response.json();
}

async function getEveSsoMetadata(options = {}) {
  const now = Date.now();
  if (!options.forceRefresh && cachedMetadata && now < metadataExpiresAt) {
    return cachedMetadata;
  }

  const raw = await fetchJson(METADATA_URL, options.fetchImpl);
  const metadata = {
    issuer: String(raw.issuer || '').trim(),
    authorizationEndpoint: ensureHttpsUrl(raw.authorization_endpoint, 'authorization_endpoint'),
    tokenEndpoint: ensureHttpsUrl(raw.token_endpoint, 'token_endpoint'),
    jwksUri: ensureHttpsUrl(raw.jwks_uri, 'jwks_uri'),
    revocationEndpoint: raw.revocation_endpoint
      ? ensureHttpsUrl(raw.revocation_endpoint, 'revocation_endpoint')
      : '',
  };

  cachedMetadata = metadata;
  metadataExpiresAt = now + CACHE_TTL_MS;
  return metadata;
}

async function getEveJwks(options = {}) {
  const metadata = await getEveSsoMetadata(options);
  const now = Date.now();

  if (
    !options.forceRefresh &&
    cachedJwks &&
    jwksUri === metadata.jwksUri &&
    now < jwksExpiresAt
  ) {
    return cachedJwks;
  }

  const raw = await fetchJson(metadata.jwksUri, options.fetchImpl);
  if (!Array.isArray(raw.keys) || raw.keys.length === 0) {
    throw new Error('EVE SSO JWKS response contains no keys.');
  }

  cachedJwks = raw;
  jwksUri = metadata.jwksUri;
  jwksExpiresAt = now + CACHE_TTL_MS;
  return cachedJwks;
}

function clearEveSsoMetadataCache() {
  cachedMetadata = null;
  metadataExpiresAt = 0;
  cachedJwks = null;
  jwksUri = '';
  jwksExpiresAt = 0;
}

module.exports = {
  METADATA_URL,
  getEveSsoMetadata,
  getEveJwks,
  clearEveSsoMetadataCache,
};
