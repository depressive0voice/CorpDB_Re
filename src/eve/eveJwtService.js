const crypto = require('crypto');
const { getEveJwks } = require('./eveSsoMetadataService');

const ACCEPTED_ISSUERS = new Set([
  'login.eveonline.com',
  'https://login.eveonline.com',
  'https://login.eveonline.com/',
]);
const EVE_AUDIENCE = 'EVE Online';
const CLOCK_SKEW_SECONDS = 30;

function decodeJwtPart(part, label) {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    throw new Error(`Invalid EVE access token ${label}.`);
  }
}

function parseJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error('Invalid EVE access token format.');
  }

  return {
    encodedHeader: parts[0],
    encodedPayload: parts[1],
    encodedSignature: parts[2],
    header: decodeJwtPart(parts[0], 'header'),
    claims: decodeJwtPart(parts[1], 'payload'),
  };
}

function normalizeAudience(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value === undefined || value === null) return [];
  return [String(value)];
}

function parseCharacterIdFromSubject(subject) {
  const match = String(subject || '').match(/^CHARACTER:EVE:(\d+)$/i);
  return match ? match[1] : '';
}

async function validateEveAccessToken(token, clientId, options = {}) {
  const parsed = parseJwt(token);
  const { header, claims } = parsed;

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Unsupported EVE access token signing algorithm or missing key ID.');
  }

  const jwks = options.jwks || await getEveJwks({ fetchImpl: options.fetchImpl });
  const jwk = jwks.keys.find((key) => key.kid === header.kid && (!key.alg || key.alg === header.alg));
  if (!jwk) {
    throw new Error('No matching EVE SSO signing key found.');
  }

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const signedData = Buffer.from(`${parsed.encodedHeader}.${parsed.encodedPayload}`, 'utf8');
  const signature = Buffer.from(parsed.encodedSignature, 'base64url');
  const signatureValid = crypto.verify('RSA-SHA256', signedData, publicKey, signature);

  if (!signatureValid) {
    throw new Error('Invalid EVE access token signature.');
  }

  if (!ACCEPTED_ISSUERS.has(String(claims.iss || ''))) {
    throw new Error(`Unexpected EVE access token issuer: ${claims.iss || '<missing>'}.`);
  }

  const audience = normalizeAudience(claims.aud);
  if (!audience.includes(EVE_AUDIENCE) || !audience.includes(String(clientId))) {
    throw new Error('EVE access token audience does not match this CorpDB application.');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = Number(claims.exp || 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowSeconds - CLOCK_SKEW_SECONDS) {
    throw new Error('EVE access token is expired or has no valid expiration time.');
  }

  const characterId = parseCharacterIdFromSubject(claims.sub);
  if (!characterId) {
    throw new Error('EVE access token does not contain a valid character subject.');
  }

  const scopes = Array.isArray(claims.scp)
    ? claims.scp.map(String)
    : typeof claims.scp === 'string'
      ? claims.scp.split(' ').filter(Boolean)
      : [];

  return {
    claims,
    characterId,
    characterName: String(claims.name || '').trim(),
    scopes,
    expiresAt: expiresAt * 1000,
  };
}

module.exports = {
  ACCEPTED_ISSUERS,
  EVE_AUDIENCE,
  parseJwt,
  parseCharacterIdFromSubject,
  validateEveAccessToken,
};
