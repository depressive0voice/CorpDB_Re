const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { initializeBaseStorage } = require('../src/storage/initializeStorage');
const { registerCorporation } = require('../src/corporations/corporationRegistryRepository');
const {
  replaceAllAuthCharacters,
  findAllAuthCharacters,
} = require('../src/auth/authCharacterRepository');
const {
  parseAuthHtml,
  importAuthHtmlFromAttachment,
} = require('../src/auth/authHtmlImportService');
const {
  setApprovalChannel,
  requestMainBinding,
  approveMainBindingRequest,
  isBindingReviewer,
} = require('../src/mainBinding/mainBindingService');
const {
  findApprovedBindingByDiscordUserId,
  findApprovedBindingByMainName,
  findPendingRequestByDiscordUserId,
} = require('../src/mainBinding/mainBindingRepository');
const { bindManagedRole } = require('../src/roles/managedRolePolicyRepository');
const { upsertOnboardingProfile } = require('../src/onboarding/onboardingConfigRepository');
const { addAdminRole } = require('../src/access/accessService');
const { createTranslator } = require('../src/localization/localizationService');
const { commands, allCommands } = require('../src/discord/commands');

const TEST_CORPORATION_ID = '88001';

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-main-binding-'));
  try {
    await initializeBaseStorage(root);
    await registerCorporation(root, TEST_CORPORATION_ID);
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function createConfig(root, ownerIds = ['90001']) {
  return {
    storage: { rootDir: root },
    discord: { ownerIds },
    localization: {
      defaultLanguage: 'en',
      enabledLanguages: ['en', 'ru'],
    },
  };
}

function addRole(guild, id, name, options = {}) {
  const role = {
    id: String(id),
    name,
    editable: options.editable !== false,
    managed: Boolean(options.managed),
    toString() {
      return `<@&${this.id}>`;
    },
  };
  guild.roles.cache.set(role.id, role);
  return role;
}

function createMember(guild, id, roleIds = [], options = {}) {
  const member = {
    id: String(id),
    guild,
    nickname: options.nickname || '',
    displayName: options.displayName || options.tag || `user-${id}`,
    manageable: options.manageable !== false,
    user: {
      id: String(id),
      tag: options.tag || `user-${id}`,
      username: options.tag || `user-${id}`,
      bot: false,
    },
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

function createGuild() {
  const sentMessages = [];
  const channel = {
    id: '71001',
    isTextBased: () => true,
    async send(payload) {
      sentMessages.push(payload);
      return { id: `message-${sentMessages.length}` };
    },
  };

  const guild = {
    id: '70001',
    name: 'Test Guild',
    roles: { cache: new Map() },
    members: {
      map: new Map(),
      async fetch(userId) {
        if (userId === undefined) return this.map;
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
  return { guild, channel, sentMessages };
}

function createInteraction(guild, member, options = {}) {
  const dms = [];
  const client = {
    users: {
      async fetch(userId) {
        const target = guild.members.map.get(String(userId));
        if (!target) return null;
        return {
          async send(payload) {
            dms.push({ userId: String(userId), payload });
          },
        };
      },
    },
  };

  return {
    guild,
    guildId: guild.id,
    member,
    user: member.user,
    client,
    dms,
    ...options,
  };
}

function createContext(root, ownerIds = ['90001'], language = 'en') {
  const config = createConfig(root, ownerIds);
  return {
    config,
    language,
    t: createTranslator(language, config),
  };
}

const AUTH_RECORDS = [
  { main: 'Main Pilot', alt: 'Main Pilot', corp: 'Corp A' },
  { main: 'Main Pilot', alt: 'Alt Pilot', corp: 'Corp A' },
];

test('auth HTML parser and import preserve legacy main/alt/corp records', async () => {
  await withTempStorage(async (root) => {
    const html = `
      <div class="caption text-center">Main Pilot<br>Account</div>
      <table class="table table-hover">
        <tr><td>x</td><td>Main Pilot</td><td>Corp A</td><td>ok</td><td>x</td></tr>
        <tr><td>x</td><td>Alt Pilot</td><td>Corp A</td><td>ok</td><td>x</td></tr>
      </table>`;

    const parsed = parseAuthHtml(html);
    assert.deepEqual(parsed, AUTH_RECORDS);

    const result = await importAuthHtmlFromAttachment(root, 'https://example.test/auth.html', {
      fetchImpl: async () => ({ ok: true, text: async () => html }),
    });

    assert.equal(result.recordsCount, 2);
    assert.equal(result.mainsCount, 1);
    assert.equal(result.corpsCount, 1);
    assert.deepEqual(await findAllAuthCharacters(root), [AUTH_RECORDS[1], AUTH_RECORDS[0]]);
  });
});

test('request-main creates a pending request and posts approval buttons for a known auth main', async () => {
  await withTempStorage(async (root) => {
    await replaceAllAuthCharacters(root, AUTH_RECORDS);
    const { guild, channel, sentMessages } = createGuild();
    const applicant = createMember(guild, '72001', [], { tag: 'applicant' });
    const context = createContext(root);
    await setApprovalChannel(root, channel.id);

    const result = await requestMainBinding(
      createInteraction(guild, applicant),
      context,
      'main pilot'
    );

    assert.equal(result.request.mainName, 'Main Pilot');
    assert.equal(result.request.status, 'pending');
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].components.length, 1);
    assert.equal(sentMessages[0].components[0].components.length, 2);
    assert.equal(
      (await findPendingRequestByDiscordUserId(root, applicant.id)).mainName,
      'Main Pilot'
    );
  });
});

test('request-main rejects an unknown main and duplicate pending ownership', async () => {
  await withTempStorage(async (root) => {
    await replaceAllAuthCharacters(root, AUTH_RECORDS);
    const { guild, channel } = createGuild();
    const first = createMember(guild, '72001', [], { tag: 'first' });
    const second = createMember(guild, '72002', [], { tag: 'second' });
    const context = createContext(root);
    await setApprovalChannel(root, channel.id);

    await assert.rejects(
      requestMainBinding(createInteraction(guild, first), context, 'Unknown Main'),
      (error) => error.code === 'binding_main_not_found_in_auth'
    );

    await requestMainBinding(createInteraction(guild, first), context, 'Main Pilot');
    await assert.rejects(
      requestMainBinding(createInteraction(guild, second), context, 'Main Pilot'),
      (error) => error.code === 'binding_request_pending_for_main'
    );
  });
});

test('admin approval grants profile Rookie, removes Guest, preserves manual roles, and persists profile binding', async () => {
  await withTempStorage(async (root) => {
    await replaceAllAuthCharacters(root, AUTH_RECORDS);
    const { guild, channel } = createGuild();
    addRole(guild, '73001', 'Guest');
    addRole(guild, '73002', 'Rookie');
    addRole(guild, '73003', 'Admin', { editable: false });
    addRole(guild, '73004', 'Manual FC', { editable: false });
    await bindManagedRole(root, 'guest', '73001');
    await upsertOnboardingProfile(root, 'default', { rookieRoleId: '73002' });
    await addAdminRole(root, '73003');
    await setApprovalChannel(root, channel.id);

    const applicant = createMember(guild, '72001', ['73001', '73004'], { tag: 'applicant' });
    const reviewer = createMember(guild, '72002', ['73003'], { tag: 'reviewer' });
    const context = createContext(root, []);
    const requested = await requestMainBinding(createInteraction(guild, applicant), context, 'Main Pilot');

    const result = await approveMainBindingRequest(
      createInteraction(guild, reviewer),
      context,
      requested.request.id
    );

    assert.equal(result.request.status, 'approved');
    assert.equal(applicant.roles.cache.has('73002'), true);
    assert.equal(applicant.roles.cache.has('73001'), false);
    assert.equal(applicant.roles.cache.has('73004'), true);
    assert.equal(applicant.nickname, 'Main Pilot');

    const byUser = await findApprovedBindingByDiscordUserId(root, applicant.id);
    const byMain = await findApprovedBindingByMainName(root, 'main pilot');
    assert.equal(byUser.mainName, 'Main Pilot');
    assert.equal(byMain.discordUserId, applicant.id);
    assert.equal(byUser.onboardingProfileId, 'default');
    assert.deepEqual(byUser.corporationIds, [TEST_CORPORATION_ID]);
  });
});

test('main binding review requires owner or legacy admin role', async () => {
  await withTempStorage(async (root) => {
    const { guild } = createGuild();
    addRole(guild, '73003', 'Admin', { editable: false });
    await addAdminRole(root, '73003');
    const ordinary = createMember(guild, '72001', [], { tag: 'ordinary' });
    const admin = createMember(guild, '72002', ['73003'], { tag: 'admin' });
    const owner = createMember(guild, '90001', [], { tag: 'owner' });
    const config = createConfig(root, ['90001']);

    assert.equal(await isBindingReviewer(config, root, ordinary), false);
    assert.equal(await isBindingReviewer(config, root, admin), true);
    assert.equal(await isBindingReviewer(config, root, owner), true);
  });
});

test('command registry separates core from optional modules and has no identity command', () => {
  const coreNames = commands.map((command) => command.data.name);
  const allNames = allCommands.map((command) => command.data.name);

  for (const name of [
    'request-main',
    'binding-config',
    'binding-admin',
    'access',
    'admin',
    'promote',
    'applications',
    'track',
    'system',
  ]) {
    assert.equal(coreNames.includes(name), true, `${name} must stay in core`);
  }

  for (const name of ['groups', 'finance', 'structure-fuel', 'blacklist', 'fat-rewards']) {
    assert.equal(coreNames.includes(name), false, `${name} must not be in core`);
    assert.equal(allNames.includes(name), true, `${name} must remain in the complete command registry`);
  }

  assert.equal(allNames.includes('identity'), false);
  assert.equal(coreNames.length, 13);
  assert.equal(allNames.length, 18);

  const promote = commands.find((command) => command.data.name === 'promote').data.toJSON();
  const roleOption = promote.options.find((option) => option.name === 'role');
  assert.deepEqual(roleOption.choices.map((choice) => choice.value), ['main']);
  assert.equal(roleOption.choices.some((choice) => choice.value === 'rookie'), false);
});
