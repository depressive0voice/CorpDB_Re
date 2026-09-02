const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');
const zlib = require('zlib');

const { initializeBaseStorage } = require('../src/storage/initializeStorage');
const { createStoragePaths } = require('../src/storage/paths');
const { registerCorporation } = require('../src/corporations/corporationRegistryRepository');
const { buildStorageExport, getStorageStatus } = require('../src/system/storageExportService');
const { runMemberSyncJob } = require('../src/jobs/memberSyncJob');
const systemCommand = require('../src/discord/commands/systemCommand');
const { commands } = require('../src/discord/commands');
const {
  ACCESS_LEVELS,
  COMMAND_ACCESS_DEFAULTS,
} = require('../src/access/accessConfigRepository');

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-system-'));
  try {
    await initializeBaseStorage(root);
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('safe storage export contains ordinary data and never includes storage/secrets', async () => {
  await withTempStorage(async (root) => {
    const paths = createStoragePaths(root);
    await fs.writeFile(path.join(paths.instanceDir, 'export-test.json'), '{"ok":true}\n', 'utf8');
    await fs.writeFile(paths.eveOAuthSecretsFile, '{"refreshToken":"must-not-leak"}\n', 'utf8');

    const status = await getStorageStatus(root);
    assert.ok(status.dataFileCount > 0);
    assert.equal(status.secretFileCount, 1);
    assert.equal(status.secretsExcludedFromExport, true);

    const result = await buildStorageExport(root, {
      now: new Date('2026-09-02T00:00:00.000Z'),
    });
    const payload = JSON.parse(zlib.gunzipSync(result.buffer).toString('utf8'));

    assert.equal(payload.format, 'corpdb-storage-export');
    assert.equal(payload.version, 1);
    assert.equal(payload.secretsIncluded, false);
    assert.deepEqual(payload.excludedPaths, ['secrets/**']);
    assert.ok(payload.files.some((file) => file.path === 'instance/export-test.json'));
    assert.equal(payload.files.some((file) => file.path.startsWith('secrets/')), false);
    assert.equal(zlib.gunzipSync(result.buffer).includes(Buffer.from('must-not-leak')), false);
    assert.match(result.fileName, /^corpdb-storage-.*\.json\.gz$/);
  });
});

test('member sync manual run can be restricted to one enabled corporation without changing scheduled default behavior', async () => {
  await withTempStorage(async (root) => {
    await registerCorporation(root, '88001', { enabled: true });
    await registerCorporation(root, '88002', { enabled: true });
    const called = [];
    const config = { storage: { rootDir: root } };
    const syncImpl = async (_config, _root, corporationId) => {
      called.push(corporationId);
      return {
        activeCount: 1,
        addedCount: 0,
        updatedCount: 0,
        unchangedCount: 1,
        leftCount: 0,
      };
    };

    const scoped = await runMemberSyncJob(config, {
      corporationId: '88002',
      silent: true,
      syncImpl,
    });
    assert.deepEqual(called, ['88002']);
    assert.equal(scoped.checkedCorporations, 1);

    called.length = 0;
    const all = await runMemberSyncJob(config, { silent: true, syncImpl });
    assert.deepEqual(called.sort(), ['88001', '88002']);
    assert.equal(all.checkedCorporations, 2);
  });
});

test('/system exposes only safe storage operations and remains master-admin by default', () => {
  const json = systemCommand.data.toJSON();
  assert.equal(json.name, 'system');
  const rootNames = json.options.filter((option) => option.type === 1).map((option) => option.name);
  assert.deepEqual(rootNames, ['ping', 'status', 'run-job']);

  const storage = json.options.find((option) => option.type === 2 && option.name === 'storage');
  assert.ok(storage);
  assert.deepEqual(storage.options.map((option) => option.name), ['status', 'export']);
  assert.equal(storage.options.some((option) => ['import', 'reset'].includes(option.name)), false);
  assert.equal(commands.some((command) => command.data.name === 'system'), true);
  assert.equal(COMMAND_ACCESS_DEFAULTS.system, ACCESS_LEVELS.MASTER_ADMIN);
});
