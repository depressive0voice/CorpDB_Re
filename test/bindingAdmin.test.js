const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { initializeBaseStorage } = require('../src/storage/initializeStorage');
const { registerCorporation } = require('../src/corporations/corporationRegistryRepository');
const { replaceAllAuthCharacters } = require('../src/auth/authCharacterRepository');
const {
  createPendingRequest,
  findApprovedBindingByDiscordUserId,
  findRequestById,
  updateMainBindingConfig,
} = require('../src/mainBinding/mainBindingRepository');
const {
  bindDiscordUserToMain,
  repostMainBindingRequest,
  unlinkBindingByDiscordUserId,
  getMainBindingAdminSummary,
} = require('../src/mainBinding/mainBindingAdminService');
const { bindManagedRole } = require('../src/roles/managedRolePolicyRepository');
const { upsertOnboardingProfile } = require('../src/onboarding/onboardingConfigRepository');
const { createTranslator } = require('../src/localization/localizationService');
const { COMMAND_ACCESS_DEFAULTS, ACCESS_LEVELS } = require('../src/access/accessConfigRepository');
const bindingAdminCommand = require('../src/discord/commands/bindingAdminCommand');

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-binding-admin-'));
  try {
    await initializeBaseStorage(root);
    await registerCorporation(root, '88001');
    await replaceAllAuthCharacters(root, [
      { main: 'Main Pilot', alt: 'Main Pilot', corp: 'Corp A' },
      { main: 'Main Pilot', alt: 'Alt Pilot', corp: 'Corp A' },
      { main: 'Other Pilot', alt: 'Other Pilot', corp: 'Corp A' },
    ]);
    await upsertOnboardingProfile(root, 'default', { probationRoleId: '73002' });
    await bindManagedRole(root, 'guest', '73001');
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function addRole(guild, id, name) {
  const role = { id: String(id), name, editable: true, managed: false };
  guild.roles.cache.set(role.id, role);
  return role;
}

function createGuild() {
  const messages = [];
  const channel = {
    id: '71001',
    isTextBased: () => true,
    async send(payload) {
      messages.push(payload);
      return { id: `message-${messages.length}` };
    },
  };
  const guild = {
    id: '70001',
    name: 'Test Guild',
    roles: { cache: new Map() },
    members: {
      map: new Map(),
      async fetch(userId) {
        return this.map.get(String(userId)) || null;
      },
    },
    channels: {
      async fetch(channelId) {
        return String(channelId) === channel.id ? channel : null;
      },
    },
  };
  guild.roles.cache.set(guild.id, {
    id: guild.id,
    name: '@everyone',
    editable: false,
    managed: false,
  });
  addRole(guild, '73001', 'Guest');
  addRole(guild, '73002', 'Probation');
  addRole(guild, '73003', 'Manual Role');
  return { guild, channel, messages };
}

function createMember(guild, id, roleIds = []) {
  const member = {
    id: String(id),
    guild,
    nickname: '',
    displayName: `user-${id}`,
    manageable: true,
    user: { id: String(id), tag: `user-${id}`, username: `user-${id}`, bot: false },
    roles: {
      cache: new Map([[guild.id, guild.roles.cache.get(guild.id)]]),
      async add(roleId) {
        this.cache.set(String(roleId), guild.roles.cache.get(String(roleId)));
      },
      async remove(roleId) {
        this.cache.delete(String(roleId));
      },
    },
    async setNickname(value) {
      this.nickname = String(value);
    },
  };
  for (const roleId of roleIds) {
    member.roles.cache.set(String(roleId), guild.roles.cache.get(String(roleId)));
  }
  guild.members.map.set(member.id, member);
  return member;
}

function createContext(root) {
  const config = {
    storage: { rootDir: root },
    discord: { ownerIds: ['90001'] },
    localization: { defaultLanguage: 'en', enabledLanguages: ['en', 'ru'] },
  };
  return {
    config,
    language: 'en',
    t: createTranslator('en', config),
  };
}

function createInteraction(guild, reviewer, dms) {
  return {
    guild,
    member: reviewer,
    user: reviewer.user,
    client: {
      users: {
        async fetch(userId) {
          return {
            async send(payload) {
              dms.push({ userId: String(userId), payload });
            },
          };
        },
      },
    },
  };
}

function pendingRequest(id, userId, mainName) {
  return {
    id,
    discordUserId: String(userId),
    discordTag: `user-${userId}`,
    mainName,
    status: 'pending',
    language: 'en',
    requestedAt: '2026-08-01T12:00:00.000Z',
    approvalChannelId: '',
    approvalMessageId: '',
    reviewedAt: '',
    reviewedByUserId: '',
    reviewedByTag: '',
    approvedRoleId: '',
    onboardingProfileId: '',
    corporationIds: [],
  };
}

test('manual binding uses onboarding, closes matching pending, preserves unrelated roles, and unlinks cleanly', async () => {
  await withTempStorage(async (root) => {
    const { guild } = createGuild();
    const target = createMember(guild, '72001', ['73001', '73003']);
    const reviewer = createMember(guild, '90001');
    const dms = [];
    const interaction = createInteraction(guild, reviewer, dms);
    const context = createContext(root);
    await createPendingRequest(root, pendingRequest('request-1', target.id, 'Main Pilot'));

    const result = await bindDiscordUserToMain(
      interaction,
      context,
      target.user,
      'main pilot',
      { manageRoles: true }
    );

    assert.equal(result.mainName, 'Main Pilot');
    assert.equal(result.approvedRoleId, '73002');
    assert.equal(result.pendingClosed, true);
    assert.equal(target.roles.cache.has('73002'), true);
    assert.equal(target.roles.cache.has('73001'), false);
    assert.equal(target.roles.cache.has('73003'), true);
    assert.equal(target.nickname, 'Main Pilot');
    assert.equal(dms.length, 1);

    const binding = await findApprovedBindingByDiscordUserId(root, target.id);
    assert.equal(binding.mainName, 'Main Pilot');
    assert.equal(binding.onboardingProfileId, 'default');
    assert.deepEqual(binding.corporationIds, ['88001']);
    assert.equal((await findRequestById(root, 'request-1')).status, 'approved');

    const unlinked = await unlinkBindingByDiscordUserId(root, guild, target.id);
    assert.equal(unlinked.binding.mainName, 'Main Pilot');
    assert.equal(unlinked.approvedRoleRemoved, true);
    assert.equal(target.roles.cache.has('73002'), false);
    assert.equal(target.roles.cache.has('73003'), true);
    assert.equal(await findApprovedBindingByDiscordUserId(root, target.id), null);
  });
});

test('manual binding refuses mismatched pending ownership', async () => {
  await withTempStorage(async (root) => {
    const { guild } = createGuild();
    const target = createMember(guild, '72001', ['73001']);
    const reviewer = createMember(guild, '90001');
    const interaction = createInteraction(guild, reviewer, []);
    const context = createContext(root);
    await createPendingRequest(root, pendingRequest('request-other', target.id, 'Other Pilot'));

    await assert.rejects(
      bindDiscordUserToMain(interaction, context, target.user, 'Main Pilot'),
      (error) => error.code === 'binding_request_pending_for_user'
    );
    assert.equal(await findApprovedBindingByDiscordUserId(root, target.id), null);
  });
});

test('repost keeps the request and updates its approval message id', async () => {
  await withTempStorage(async (root) => {
    const { guild, channel, messages } = createGuild();
    const reviewer = createMember(guild, '90001');
    const interaction = createInteraction(guild, reviewer, []);
    const context = createContext(root);
    await updateMainBindingConfig(root, { approvalChannelId: channel.id });
    await createPendingRequest(root, pendingRequest('request-2', '72001', 'Main Pilot'));

    const result = await repostMainBindingRequest(interaction, context, 'request-2');
    assert.equal(result.channelId, channel.id);
    assert.equal(result.messageId, 'message-1');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].components.length, 1);
    const stored = await findRequestById(root, 'request-2');
    assert.equal(stored.status, 'pending');
    assert.equal(stored.approvalChannelId, channel.id);
    assert.equal(stored.approvalMessageId, 'message-1');
  });
});

test('binding admin surface excludes nickname migration and defaults to admin access', async () => {
  const json = bindingAdminCommand.data.toJSON();
  const names = json.options.map((option) => option.name);
  assert.deepEqual(names, [
    'status',
    'show-user',
    'show-main',
    'show-request',
    'list-pending',
    'approve',
    'bind-user',
    'reject',
    'repost-request',
    'list-approved',
    'unlink-user',
    'unlink-main',
  ]);
  assert.equal(names.includes('migrate-nicknames'), false);
  assert.equal(COMMAND_ACCESS_DEFAULTS['binding-admin'], ACCESS_LEVELS.ADMIN);
});

test('binding admin summary reports approval channel, approved count, and pending count', async () => {
  await withTempStorage(async (root) => {
    await updateMainBindingConfig(root, { approvalChannelId: '71001' });
    await createPendingRequest(root, pendingRequest('request-3', '72001', 'Main Pilot'));
    const summary = await getMainBindingAdminSummary(root);
    assert.equal(summary.config.approvalChannelId, '71001');
    assert.equal(summary.approvedBindingsCount, 0);
    assert.equal(summary.pendingRequestsCount, 1);
  });
});
