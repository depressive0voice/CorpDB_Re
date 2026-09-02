const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { createPkcePair } = require('../src/eve/eveOAuthService');
const { validateEveAccessToken } = require('../src/eve/eveJwtService');
const {
  savePendingSession,
  getPendingSession,
  consumePendingSession,
  saveEveAuthorization,
  getEveAuthorization,
} = require('../src/eve/eveOAuthRepository');
const {
  assertRequiredScopes,
  buildLocalAuthorizationStartUrl,
  getAuthorizationRedirectUrl,
} = require('../src/eve/eveAuthorizationService');

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-oauth-test-'));
  try {
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function signJwt(privateKey, header, claims) {
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const data = `${encodedHeader}.${encodedClaims}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url');
  return `${data}.${signature}`;
}

test('PKCE challenge is SHA-256 of the generated verifier', () => {
  const pair = createPkcePair();
  const expected = crypto.createHash('sha256').update(pair.verifier, 'utf8').digest('base64url');

  assert.equal(pair.challenge, expected);
  assert.ok(pair.verifier.length >= 43);
});

test('EVE JWT validation checks signature, audience, issuer, character and expiry', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  const clientId = 'corpdb-test-client';
  const token = signJwt(privateKey, { alg: 'RS256', kid: 'test-key', typ: 'JWT' }, {
    iss: 'https://login.eveonline.com/',
    aud: ['EVE Online', clientId],
    exp: Math.floor(Date.now() / 1000) + 1200,
    sub: 'CHARACTER:EVE:123456789',
    name: 'Test Pilot',
    scp: ['esi-corporations.read_structures.v1'],
  });

  const result = await validateEveAccessToken(token, clientId, { jwks: { keys: [jwk] } });
  assert.equal(result.characterId, '123456789');
  assert.equal(result.characterName, 'Test Pilot');
  assert.deepEqual(result.scopes, ['esi-corporations.read_structures.v1']);
});

test('pending OAuth state is single-use', async () => {
  await withTempStorage(async (root) => {
    const session = {
      codeVerifier: 'verifier',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    await savePendingSession(root, 'state-1', session);

    assert.deepEqual(await getPendingSession(root, 'state-1'), session);
    assert.deepEqual(await consumePendingSession(root, 'state-1'), session);
    assert.equal(await consumePendingSession(root, 'state-1'), null);
  });
});

test('Discord OAuth button uses a short local URL that redirects to the full EVE authorize URL', async () => {
  await withTempStorage(async (root) => {
    const state = 'state-'.padEnd(64, 'x');
    const config = {
      eve: {
        redirectUri: 'http://127.0.0.1:3000/auth/eve/callback',
      },
    };
    const fullAuthorizationUrl = `https://login.eveonline.com/v2/oauth/authorize?${'scope=x&'.repeat(120)}state=${state}`;
    const session = {
      codeVerifier: 'verifier',
      authorizationUrl: fullAuthorizationUrl,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };

    await savePendingSession(root, state, session);
    const localUrl = buildLocalAuthorizationStartUrl(config, state);

    assert.ok(fullAuthorizationUrl.length > 512);
    assert.ok(localUrl.length < 512);
    assert.equal(await getAuthorizationRedirectUrl(root, state), fullAuthorizationUrl);
  });
});

test('EVE authorizations are keyed by corporation ID and retain refresh tokens only in secret storage', async () => {
  await withTempStorage(async (root) => {
    await saveEveAuthorization(root, {
      corporationId: '98600001',
      characterId: '123456789',
      characterName: 'Pilot One',
      refreshToken: 'refresh-one',
      scopes: ['scope-a'],
      corporationRoles: ['Director'],
    });
    await saveEveAuthorization(root, {
      corporationId: '98600002',
      characterId: '223456789',
      characterName: 'Pilot Two',
      refreshToken: 'refresh-two',
      scopes: ['scope-a'],
      corporationRoles: [],
    });

    const first = await getEveAuthorization(root, '98600001');
    const second = await getEveAuthorization(root, '98600002');
    assert.equal(first.refreshToken, 'refresh-one');
    assert.equal(second.refreshToken, 'refresh-two');
  });
});

test('required-scope validation fails closed', () => {
  assert.throws(
    () => assertRequiredScopes(['scope-a'], ['scope-a', 'scope-b']),
    /scope-b/
  );
});
