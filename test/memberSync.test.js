const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  applyCorporationMemberSnapshot,
  readMembers,
} = require('../src/members/memberRepository');
const {
  getCorporationMemberIds,
  resolveUniverseNames,
} = require('../src/eve/eveEsiClient');

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-members-test-'));
  try {
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function responseJson(value, options = {}) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(options.headers || {}),
    json: async () => value,
    text: async () => JSON.stringify(value),
  };
}

const config = {
  eve: {
    datasource: 'tranquility',
    compatibilityDate: '2026-08-31',
  },
};

test('member snapshots are isolated by corporation ID and keyed by character ID', async () => {
  await withTempStorage(async (root) => {
    await applyCorporationMemberSnapshot(root, '98842748', [
      { characterId: '1001', name: 'Pilot One', corporationName: 'Alpha' },
      { characterId: '1002', name: 'Pilot Two', corporationName: 'Alpha' },
    ], { now: new Date('2026-09-01T00:00:00Z') });

    await applyCorporationMemberSnapshot(root, '98842749', [
      { characterId: '2001', name: 'Other Pilot', corporationName: 'Beta' },
    ], { now: new Date('2026-09-01T00:00:00Z') });

    const alpha = await readMembers(root, '98842748');
    const beta = await readMembers(root, '98842749');

    assert.deepEqual(alpha.map((member) => member.characterId).sort(), ['1001', '1002']);
    assert.deepEqual(beta.map((member) => member.characterId), ['2001']);
  });
});

test('renames update the same member and missing members are marked left only in that corporation', async () => {
  await withTempStorage(async (root) => {
    await applyCorporationMemberSnapshot(root, '98842748', [
      { characterId: '1001', name: 'Old Name', corporationName: 'Alpha' },
      { characterId: '1002', name: 'Pilot Two', corporationName: 'Alpha' },
    ], { now: new Date('2026-09-01T00:00:00Z') });

    const result = await applyCorporationMemberSnapshot(root, '98842748', [
      { characterId: '1001', name: 'New Name', corporationName: 'Alpha' },
    ], { now: new Date('2026-09-02T00:00:00Z') });

    const members = await readMembers(root, '98842748');
    const renamed = members.find((member) => member.characterId === '1001');
    const left = members.find((member) => member.characterId === '1002');

    assert.equal(result.updatedCount, 1);
    assert.equal(result.leftCount, 1);
    assert.equal(renamed.name, 'New Name');
    assert.equal(renamed.isCorporationMember, true);
    assert.equal(left.status, 'left-corporation');
    assert.equal(left.isCorporationMember, false);
  });
});

test('corporation member IDs follow ESI X-Pages pagination', async () => {
  const seenPages = [];
  const fetchImpl = async (url) => {
    const page = Number(new URL(url).searchParams.get('page'));
    seenPages.push(page);
    if (page === 1) return responseJson([1001, 1002], { headers: { 'x-pages': '2' } });
    return responseJson([1003]);
  };

  const ids = await getCorporationMemberIds(config, '98842748', 'token', { fetchImpl });
  assert.deepEqual(ids, ['1001', '1002', '1003']);
  assert.deepEqual(seenPages, [1, 2]);
});

test('universe name resolution uses POST JSON batches', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({
      url: String(url),
      method: options.method,
      body: JSON.parse(options.body),
    });
    return responseJson([
      { category: 'character', id: 1001, name: 'Pilot One' },
      { category: 'character', id: 1002, name: 'Pilot Two' },
    ]);
  };

  const values = await resolveUniverseNames(config, ['1001', '1002'], { fetchImpl });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.deepEqual(requests[0].body, [1001, 1002]);
  assert.equal(values.length, 2);
});
