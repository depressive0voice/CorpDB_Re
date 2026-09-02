const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { initializeBaseStorage } = require('../src/storage/initializeStorage');
const {
  bindManagedRole,
  unbindManagedRole,
  readManagedRolePolicy,
} = require('../src/roles/managedRolePolicyRepository');
const {
  listDiscordManageableRoleIds,
} = require('../src/roles/managedRoleService');
const {
  ensureGuestFallbackForMember,
} = require('../src/roles/guestFallbackService');

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-role-test-'));
  try {
    await initializeBaseStorage(root);
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function createRole(id, options = {}) {
  return {
    id,
    name: options.name || `Role ${id}`,
    managed: Boolean(options.managed),
    editable: options.editable === undefined ? true : Boolean(options.editable),
  };
}

function createMember(roleDefinitions, memberRoleIds) {
  const guild = {
    id: '99999',
    name: 'Test Guild',
    roles: {
      cache: new Map(roleDefinitions.map((role) => [role.id, role])),
    },
  };

  const cache = new Map(
    memberRoleIds.map((roleId) => [roleId, guild.roles.cache.get(roleId)])
  );

  const member = {
    id: '77777',
    user: { bot: false },
    guild,
    roles: {
      cache,
      add: async (roleId) => {
        cache.set(roleId, guild.roles.cache.get(roleId));
      },
      remove: async (roleId) => {
        cache.delete(roleId);
      },
    },
  };

  return member;
}

test('named role bindings reuse existing Discord role IDs and can be removed without touching Discord', async () => {
  await withTempStorage(async (root) => {
    await bindManagedRole(root, 'Guest', '10001');
    await bindManagedRole(root, 'member', '10002');
    await bindManagedRole(root, 'officer', '10003');

    let policy = await readManagedRolePolicy(root);
    assert.deepEqual(policy.bindings, {
      guest: '10001',
      member: '10002',
      officer: '10003',
    });

    await unbindManagedRole(root, 'member');
    policy = await readManagedRolePolicy(root);
    assert.equal(policy.bindings.member, undefined);
    assert.equal(policy.bindings.guest, '10001');
    assert.equal(policy.bindings.officer, '10003');
  });
});

test('Discord manageable-role detection ignores everyone, integration roles, and roles above the bot', () => {
  const roles = [
    createRole('99999', { name: '@everyone', editable: false }),
    createRole('10001', { name: 'Integration', managed: true, editable: false }),
    createRole('10002', { name: 'Director', managed: false, editable: false }),
    createRole('10003', { name: 'Member', managed: false, editable: true }),
  ];

  const member = createMember(roles, ['99999', '10001', '10002', '10003']);
  assert.deepEqual(listDiscordManageableRoleIds(member), ['10003']);
});

test('Guest is granted when a member has roles but none are manageable by the bot', async () => {
  await withTempStorage(async (root) => {
    await bindManagedRole(root, 'guest', '10004');

    const roles = [
      createRole('99999', { name: '@everyone', editable: false }),
      createRole('10001', { name: 'Integration', managed: true, editable: false }),
      createRole('10002', { name: 'Director', managed: false, editable: false }),
      createRole('10004', { name: 'Guest', managed: false, editable: true }),
    ];

    const member = createMember(roles, ['99999', '10001', '10002']);
    const result = await ensureGuestFallbackForMember(root, member);

    assert.equal(result.status, 'guest-granted');
    assert.equal(result.changed, true);
    assert.equal(member.roles.cache.has('10004'), true);
  });
});

test('Guest is not granted when any existing member role is manageable by the bot', async () => {
  await withTempStorage(async (root) => {
    await bindManagedRole(root, 'guest', '10004');

    const roles = [
      createRole('99999', { name: '@everyone', editable: false }),
      createRole('10001', { name: 'Integration', managed: true, editable: false }),
      createRole('10003', { name: 'Manual FC', managed: false, editable: true }),
      createRole('10004', { name: 'Guest', managed: false, editable: true }),
    ];

    const member = createMember(roles, ['99999', '10001', '10003']);
    const result = await ensureGuestFallbackForMember(root, member);

    assert.equal(result.status, 'has-manageable-role');
    assert.equal(result.changed, false);
    assert.equal(member.roles.cache.has('10004'), false);
  });
});
