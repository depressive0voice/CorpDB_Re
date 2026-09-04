const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { initializeBaseStorage } = require('../src/storage/initializeStorage');
const {
  createAccessGroup,
  deleteAccessGroup,
  getAccessGroup,
} = require('../src/accessGroups/accessGroupRepository');
const {
  createAccessGroupRequest,
  deleteAccessGroupRequests,
  listAccessGroupRequests,
} = require('../src/accessGroups/accessGroupRequestRepository');
const groupsCommand = require('../src/discord/commands/groupsCommand');

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-group-delete-test-'));
  try {
    await initializeBaseStorage(root);
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function groupDefinition(id, name) {
  return {
    id,
    name,
    scope: 'instance',
    grantRoleIds: ['20001'],
    eligibility: {
      requireAllRoleIds: [],
      requireAnyRoleIds: [],
      forbiddenRoleIds: [],
    },
    approval: {
      approverRoleIds: ['30001'],
      requiredApprovals: 1,
    },
    revokePolicy: 'manual',
  };
}

test('deleting an access group removes all requests for that group only', async () => {
  await withTempStorage(async (root) => {
    await createAccessGroup(root, groupDefinition('friends', 'Friends'));
    await createAccessGroup(root, groupDefinition('capital-pilots', 'Capital Pilots'));

    await createAccessGroupRequest(root, {
      id: 'request-friends-1',
      groupId: 'friends',
      discordUserId: '50001',
      discordTag: 'one',
    });
    await createAccessGroupRequest(root, {
      id: 'request-friends-2',
      groupId: 'friends',
      discordUserId: '50002',
      discordTag: 'two',
    });
    await createAccessGroupRequest(root, {
      id: 'request-capitals-1',
      groupId: 'capital-pilots',
      discordUserId: '50003',
      discordTag: 'three',
    });

    const deletedRequests = await deleteAccessGroupRequests(root, 'friends');
    const deletedGroup = await deleteAccessGroup(root, 'friends');

    assert.equal(deletedRequests, 2);
    assert.equal(deletedGroup.id, 'friends');
    assert.equal(await getAccessGroup(root, 'friends'), null);
    assert.equal((await listAccessGroupRequests(root, { groupId: 'friends' })).length, 0);
    assert.equal((await listAccessGroupRequests(root, { groupId: 'capital-pilots' })).length, 1);
    assert.equal((await getAccessGroup(root, 'capital-pilots')).name, 'Capital Pilots');
  });
});

test('/groups delete is owner-management surface with group autocomplete', () => {
  const json = groupsCommand.data.toJSON();
  const deleteSubcommand = json.options.find((option) => option.name === 'delete');

  assert.ok(deleteSubcommand);
  assert.equal(deleteSubcommand.description, 'Delete an access group and all of its requests (owner only)');
  assert.equal(deleteSubcommand.options.length, 1);
  assert.equal(deleteSubcommand.options[0].name, 'group');
  assert.equal(deleteSubcommand.options[0].required, true);
  assert.equal(deleteSubcommand.options[0].autocomplete, true);
  assert.equal(typeof groupsCommand.autocomplete, 'function');
});
