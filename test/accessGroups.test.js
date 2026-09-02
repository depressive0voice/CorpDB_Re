const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { initializeBaseStorage } = require('../src/storage/initializeStorage');
const { setGuestRole } = require('../src/roles/managedRolePolicyRepository');
const { ensureGuestFallbackForMember } = require('../src/roles/guestFallbackService');
const { createAccessGroup } = require('../src/accessGroups/accessGroupRepository');
const {
  evaluateEligibility,
  requestAccessGroup,
  approveAccessGroupRequest,
  revokeAccessGroup,
} = require('../src/accessGroups/accessGroupService');

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-groups-test-'));
  try {
    await initializeBaseStorage(root);
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function createMockGuild() {
  const guild = {
    id: '99999',
    name: 'Test Guild',
    roles: { cache: new Map() },
    members: {
      map: new Map(),
      async fetch(userId) {
        if (userId === undefined) return this.map;
        const member = this.map.get(String(userId));
        if (!member) throw new Error('Unknown member');
        return member;
      },
    },
  };

  guild.roles.cache.set(guild.id, { id: guild.id, name: '@everyone', editable: false });
  return guild;
}

function addRole(guild, id, name, editable = true) {
  const role = { id: String(id), name, editable };
  guild.roles.cache.set(role.id, role);
  return role;
}

function createMockMember(guild, id, roleIds = [], options = {}) {
  const member = {
    id: String(id),
    guild,
    user: {
      id: String(id),
      tag: options.tag || `user-${id}`,
      username: options.tag || `user-${id}`,
      bot: Boolean(options.bot),
    },
    displayName: options.tag || `user-${id}`,
    roles: {
      cache: new Map([[guild.id, guild.roles.cache.get(guild.id)]]),
      async add(roleId) {
        const role = guild.roles.cache.get(String(roleId));
        if (!role) throw new Error(`Missing role ${roleId}`);
        this.cache.set(role.id, role);
      },
      async remove(roleId) {
        this.cache.delete(String(roleId));
      },
    },
  };

  for (const roleId of roleIds) {
    member.roles.cache.set(String(roleId), guild.roles.cache.get(String(roleId)));
  }
  guild.members.map.set(member.id, member);
  return member;
}

test('eligibility supports required-all, required-any and forbidden roles', () => {
  const group = {
    eligibility: {
      requireAllRoleIds: ['10001'],
      requireAnyRoleIds: ['10002', '10003'],
      forbiddenRoleIds: ['10004'],
    },
  };

  assert.equal(evaluateEligibility(group, ['10001', '10003']).eligible, true);
  assert.equal(evaluateEligibility(group, ['10003']).eligible, false);
  assert.equal(evaluateEligibility(group, ['10001']).eligible, false);
  assert.equal(evaluateEligibility(group, ['10001', '10002', '10004']).eligible, false);
});

test('two officer approvals grant only configured group roles and revoke preserves manual roles', async () => {
  await withTempStorage(async (root) => {
    const guild = createMockGuild();
    addRole(guild, '10001', 'Member', false);
    addRole(guild, '20001', 'Capital Pilot', true);
    addRole(guild, '30001', 'Officer', false);
    addRole(guild, '40001', 'Manual FC', false);

    const target = createMockMember(guild, '50001', ['10001', '40001'], { tag: 'target' });
    const officerOne = createMockMember(guild, '50002', ['30001'], { tag: 'officer-one' });
    const officerTwo = createMockMember(guild, '50003', ['30001'], { tag: 'officer-two' });

    await createAccessGroup(root, {
      id: 'capital-pilots',
      name: 'Capital Pilots',
      scope: 'instance',
      grantRoleIds: ['20001'],
      eligibility: {
        requireAllRoleIds: ['10001'],
        requireAnyRoleIds: [],
        forbiddenRoleIds: [],
      },
      approval: {
        approverRoleIds: ['30001'],
        requiredApprovals: 2,
      },
      revokePolicy: 'manual',
    });

    const request = await requestAccessGroup(root, target, 'capital-pilots');
    const config = { discord: { ownerIds: [] } };

    const first = await approveAccessGroupRequest(root, config, guild, officerOne, request.id);
    assert.equal(first.finalized, false);
    assert.equal(target.roles.cache.has('20001'), false);

    const second = await approveAccessGroupRequest(root, config, guild, officerTwo, request.id);
    assert.equal(second.finalized, true);
    assert.equal(target.roles.cache.has('20001'), true);
    assert.equal(target.roles.cache.has('40001'), true);

    await revokeAccessGroup(root, config, guild, officerOne, 'capital-pilots', target.id, 'test revoke');
    assert.equal(target.roles.cache.has('20001'), false);
    assert.equal(target.roles.cache.has('40001'), true);
    assert.equal(target.roles.cache.has('10001'), true);
  });
});

test('guest fallback grants Guest when existing roles are not manageable by the bot', async () => {
  await withTempStorage(async (root) => {
    const guild = createMockGuild();
    addRole(guild, '60001', 'Guest', true);
    addRole(guild, '60002', 'Manual', false);
    await setGuestRole(root, '60001');

    const emptyMember = createMockMember(guild, '70001', [], { tag: 'empty' });
    const manualMember = createMockMember(guild, '70002', ['60002'], { tag: 'manual' });

    const first = await ensureGuestFallbackForMember(root, emptyMember);
    const second = await ensureGuestFallbackForMember(root, manualMember);

    assert.equal(first.changed, true);
    assert.equal(emptyMember.roles.cache.has('60001'), true);
    assert.equal(second.changed, true);
    assert.equal(manualMember.roles.cache.has('60001'), true);
    assert.equal(manualMember.roles.cache.has('60002'), true);
  });
});
