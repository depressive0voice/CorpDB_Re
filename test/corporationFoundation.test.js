const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  initializeBaseStorage,
  initializeCorporationStorage,
} = require('../src/storage/initializeStorage');
const { createStoragePaths } = require('../src/storage/paths');
const {
  readRegistry,
  registerCorporation,
  setDefaultCorporation,
} = require('../src/corporations/corporationRegistryRepository');
const {
  writeCorporationProfile,
} = require('../src/corporations/corporationProfileRepository');
const {
  getCorporationContext,
} = require('../src/corporations/corporationContextService');

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-test-'));
  try {
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('clean storage starts with an empty corporation registry', async () => {
  await withTempStorage(async (root) => {
    await initializeBaseStorage(root);
    const registry = await readRegistry(root);

    assert.equal(registry.defaultCorporationId, null);
    assert.deepEqual(registry.corporations, []);
  });
});

test('registry supports arbitrary corporation IDs without main/secondary aliases', async () => {
  await withTempStorage(async (root) => {
    await initializeBaseStorage(root);
    await registerCorporation(root, '98600001');
    await registerCorporation(root, '98600002', {
      features: { structures: false },
    });
    await setDefaultCorporation(root, '98600002');

    const registry = await readRegistry(root);
    assert.equal(registry.defaultCorporationId, '98600002');
    assert.equal(registry.corporations.length, 2);
    assert.equal(registry.corporations[1].features.structures, false);
    assert.equal(registry.corporations[1].features.finance, true);
  });
});

test('corporation storage is isolated by corporationId', async () => {
  await withTempStorage(async (root) => {
    await initializeBaseStorage(root);
    await registerCorporation(root, '98600001');
    await registerCorporation(root, '98600002');
    await initializeCorporationStorage(root, '98600001');
    await initializeCorporationStorage(root, '98600002');

    const paths = createStoragePaths(root);
    const firstMembers = JSON.parse(
      await fs.readFile(paths.corporationMembersFile('98600001'), 'utf8')
    );
    const secondMembers = JSON.parse(
      await fs.readFile(paths.corporationMembersFile('98600002'), 'utf8')
    );

    assert.deepEqual(firstMembers, []);
    assert.deepEqual(secondMembers, []);
    assert.notEqual(
      paths.corporationMembersFile('98600001'),
      paths.corporationMembersFile('98600002')
    );
  });
});

test('corporation context resolves the configured default profile', async () => {
  await withTempStorage(async (root) => {
    await initializeBaseStorage(root);
    await registerCorporation(root, '98600001');
    await initializeCorporationStorage(root, '98600001');
    await writeCorporationProfile(root, '98600001', {
      corporationId: '98600001',
      name: 'Example Corporation',
      ticker: 'EXPL',
      metadataUpdatedAt: '2026-08-30T00:00:00.000Z',
    });

    const context = await getCorporationContext(root);
    assert.equal(context.corporationId, '98600001');
    assert.equal(context.profile.name, 'Example Corporation');
    assert.equal(context.profile.ticker, 'EXPL');
  });
});
