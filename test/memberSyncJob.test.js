const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { initializeBaseStorage } = require('../src/storage/initializeStorage');
const { registerCorporation } = require('../src/corporations/corporationRegistryRepository');
const { runMemberSyncJob } = require('../src/jobs/memberSyncJob');

async function createTempStorage() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-member-job-'));
}

function createConfig(storageRoot) {
  return {
    storage: { rootDir: storageRoot },
    jobs: {
      enabled: true,
      memberSyncIntervalMinutes: 30,
    },
  };
}

test('member sync job processes every enabled corporation with members feature', async (t) => {
  const storageRoot = await createTempStorage();
  t.after(() => fs.rm(storageRoot, { recursive: true, force: true }));

  await initializeBaseStorage(storageRoot);
  await registerCorporation(storageRoot, '1001');
  await registerCorporation(storageRoot, '1002');
  await registerCorporation(storageRoot, '1003', { features: { members: false } });

  const calls = [];
  const result = await runMemberSyncJob(createConfig(storageRoot), {
    silent: true,
    syncImpl: async (_config, _storageRoot, corporationId) => {
      calls.push(corporationId);
      return {
        activeCount: 2,
        addedCount: 0,
        updatedCount: 0,
        unchangedCount: 2,
        leftCount: 0,
      };
    },
  });

  assert.deepEqual(calls, ['1001', '1002']);
  assert.equal(result.checkedCorporations, 2);
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 0);
});

test('member sync job isolates one corporation failure from the others', async (t) => {
  const storageRoot = await createTempStorage();
  t.after(() => fs.rm(storageRoot, { recursive: true, force: true }));

  await initializeBaseStorage(storageRoot);
  await registerCorporation(storageRoot, '2001');
  await registerCorporation(storageRoot, '2002');
  await registerCorporation(storageRoot, '2003');

  const calls = [];
  const result = await runMemberSyncJob(createConfig(storageRoot), {
    silent: true,
    syncImpl: async (_config, _storageRoot, corporationId) => {
      calls.push(corporationId);
      if (corporationId === '2002') {
        const error = new Error('test auth failure');
        error.code = 'test_failure';
        throw error;
      }
      return {
        activeCount: 1,
        addedCount: 0,
        updatedCount: 0,
        unchangedCount: 1,
        leftCount: 0,
      };
    },
  });

  assert.deepEqual(calls, ['2001', '2002', '2003']);
  assert.equal(result.checkedCorporations, 3);
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.results[1].corporationId, '2002');
  assert.equal(result.results[1].errorCode, 'test_failure');
});
