const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { initializeBaseStorage } = require('../src/storage/initializeStorage');
const { registerCorporation } = require('../src/corporations/corporationRegistryRepository');
const { writeMembers } = require('../src/members/memberRepository');
const {
  readOnboardingConfig,
  upsertOnboardingProfile,
  deleteOnboardingProfile,
  assignCorporationProfile,
  resolveOnboardingProfileForCorporation,
  updateWelcomeConfig,
} = require('../src/onboarding/onboardingConfigRepository');
const { resolveOnboardingProfileForAuthFamily } = require('../src/onboarding/onboardingProfileService');
const {
  addUtcMonths,
  normalizeFinalRole,
  resolveProbationRoleId,
  promoteMember,
  processProbationExpirations,
} = require('../src/onboarding/promotionService');
const { handleGuildMemberJoin } = require('../src/onboarding/onboardingService');
const { listPromotionRequests } = require('../src/onboarding/promotionStateRepository');
const { upsertApprovedBinding } = require('../src/mainBinding/mainBindingRepository');
const { bindManagedRole } = require('../src/roles/managedRolePolicyRepository');
const { createTranslator } = require('../src/localization/localizationService');

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-onboarding-'));
  try {
    await initializeBaseStorage(root);
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function createConfig(root) {
  return {
    storage: { rootDir: root },
    discord: { ownerIds: ['90001'] },
    localization: { defaultLanguage: 'en', enabledLanguages: ['en', 'ru'] },
  };
}

function memberRecord(corporationId, characterId, name) {
  return {
    corporationId,
    characterId,
    name,
    corporationName: `Corp ${corporationId}`,
    isCorporationMember: true,
    status: 'active',
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function createDiscordFixture() {
  const roles = new Map();
  const guild = {
    id: '70001',
    name: 'Test Guild',
    roles: { cache: roles },
    members: {
      cache: new Map(),
      async fetch(userId) {
        if (userId === undefined) return this.cache;
        return this.cache.get(String(userId)) || null;
      },
    },
    channels: {
      cache: new Map(),
      async fetch(channelId) { return this.cache.get(String(channelId)) || null; },
    },
  };
  roles.set(guild.id, { id: guild.id, name: '@everyone', managed: false, editable: false });

  function addRole(id, name, options = {}) {
    const role = {
      id: String(id),
      name,
      managed: Boolean(options.managed),
      editable: options.editable !== false,
      toString() { return `<@&${this.id}>`; },
    };
    roles.set(role.id, role);
    return role;
  }

  function addMember(id, roleIds, options = {}) {
    const cache = new Map([[guild.id, roles.get(guild.id)]]);
    for (const roleId of roleIds) cache.set(String(roleId), roles.get(String(roleId)));
    const member = {
      id: String(id),
      guild,
      user: { id: String(id), tag: options.tag || `user-${id}`, username: options.tag || `user-${id}`, bot: false },
      roles: {
        cache,
        async add(roleId) { cache.set(String(roleId), roles.get(String(roleId))); },
        async remove(roleId) { cache.delete(String(roleId)); },
      },
    };
    guild.members.cache.set(member.id, member);
    return member;
  }

  function addChannel(id) {
    const sent = [];
    const channel = {
      id: String(id),
      sent,
      isTextBased: () => true,
      async send(payload) {
        sent.push(payload);
        return { id: `message-${sent.length}` };
      },
      toString() { return `<#${this.id}>`; },
    };
    guild.channels.cache.set(channel.id, channel);
    return channel;
  }

  return { guild, addRole, addMember, addChannel };
}

test('one enabled corporation uses the default onboarding profile without explicit mapping', async () => {
  await withTempStorage(async (root) => {
    await registerCorporation(root, '88001');
    const config = await readOnboardingConfig(root);
    const resolved = resolveOnboardingProfileForCorporation(config, '88001', ['88001']);
    assert.equal(resolved.profileId, 'default');
    assert.equal(resolved.implicit, true);
    assert.equal(resolved.profile.probationMonths, 3);
    assert.equal(config.welcome.enabled, true);
  });
});

test('multiple corporations use default unless an explicit onboarding profile is mapped', async () => {
  await withTempStorage(async (root) => {
    await registerCorporation(root, '88001');
    await registerCorporation(root, '88002');
    await upsertOnboardingProfile(root, 'special', { probationMonths: 6 });
    await assignCorporationProfile(root, '88002', 'special');

    const config = await readOnboardingConfig(root);
    const first = resolveOnboardingProfileForCorporation(config, '88001', ['88001', '88002']);
    const second = resolveOnboardingProfileForCorporation(config, '88002', ['88001', '88002']);
    assert.equal(first.profileId, 'default');
    assert.equal(first.implicit, true);
    assert.equal(second.profileId, 'special');
    assert.equal(second.implicit, false);
    assert.equal(second.profile.probationMonths, 6);
  });
});

test('default onboarding profile is protected and deleting another profile removes its corporation mappings', async () => {
  await withTempStorage(async (root) => {
    await registerCorporation(root, '88001');
    await registerCorporation(root, '88002');
    await upsertOnboardingProfile(root, 'special', { probationMonths: 6 });
    await assignCorporationProfile(root, '88001', 'special');

    await assert.rejects(
      deleteOnboardingProfile(root, 'default'),
      (error) => error.code === 'onboarding_default_profile_protected'
    );

    await deleteOnboardingProfile(root, 'special');
    const config = await readOnboardingConfig(root);
    assert.equal(config.profiles.default.probationMonths, 3);
    assert.equal(config.profiles.special, undefined);
    assert.equal(config.corporationProfiles['88001'], undefined);

    const resolved = resolveOnboardingProfileForCorporation(config, '88001', ['88001', '88002']);
    assert.equal(resolved.profileId, 'default');
    assert.equal(resolved.implicit, true);
  });
});

test('main and alt corporations may share one onboarding profile', async () => {
  await withTempStorage(async (root) => {
    await registerCorporation(root, '88001');
    await registerCorporation(root, '88002');
    await upsertOnboardingProfile(root, 'shared', { probationMonths: 3 });
    await assignCorporationProfile(root, '88001', 'shared');
    await assignCorporationProfile(root, '88002', 'shared');
    await writeMembers(root, '88001', [memberRecord('88001', '10001', 'Main Pilot')]);
    await writeMembers(root, '88002', [memberRecord('88002', '10002', 'Alt Pilot')]);

    const resolved = await resolveOnboardingProfileForAuthFamily(root, [
      { main: 'Main Pilot', alt: 'Main Pilot', corp: 'Main Corp' },
      { main: 'Main Pilot', alt: 'Alt Pilot', corp: 'Alt Corp' },
    ]);
    assert.equal(resolved.profileId, 'shared');
    assert.deepEqual(resolved.corporationIds.sort(), ['88001', '88002']);
  });
});

test('auth family spanning corporations with different profiles is rejected as ambiguous', async () => {
  await withTempStorage(async (root) => {
    await registerCorporation(root, '88001');
    await registerCorporation(root, '88002');
    await upsertOnboardingProfile(root, 'maincorp', {});
    await upsertOnboardingProfile(root, 'altcorp', {});
    await assignCorporationProfile(root, '88001', 'maincorp');
    await assignCorporationProfile(root, '88002', 'altcorp');
    await writeMembers(root, '88001', [memberRecord('88001', '10001', 'Main Pilot')]);
    await writeMembers(root, '88002', [memberRecord('88002', '10002', 'Alt Pilot')]);

    await assert.rejects(
      resolveOnboardingProfileForAuthFamily(root, [
        { main: 'Main Pilot', alt: 'Main Pilot', corp: 'Main Corp' },
        { main: 'Main Pilot', alt: 'Alt Pilot', corp: 'Alt Corp' },
      ]),
      (error) => error.code === 'onboarding_profile_ambiguous'
    );
  });
});

test('Rookie is the canonical probation role and promotion only targets Main', async () => {
  await withTempStorage(async (root) => {
    await upsertOnboardingProfile(root, 'default', { rookieRoleId: '73004', mainRoleId: '73003' });
    const config = await readOnboardingConfig(root);
    assert.equal(config.profiles.default.rookieRoleId, '73004');
    assert.equal(config.profiles.default.probationRoleId, '73004');
    assert.equal(resolveProbationRoleId(config.profiles.default), '73004');
    assert.equal(normalizeFinalRole('main'), 'main');
    assert.equal(normalizeFinalRole('rookie'), '');
    assert.equal(addUtcMonths('2026-01-31T12:00:00.000Z', 1).toISOString(), '2026-02-28T12:00:00.000Z');
  });
});

test('manual promotion grants Main and removes Guest and Rookie without touching unrelated roles', async () => {
  await withTempStorage(async (root) => {
    await registerCorporation(root, '88001');
    await upsertOnboardingProfile(root, 'default', {
      mainRoleId: '73003',
      rookieRoleId: '73004',
      probationMonths: 3,
    });
    await bindManagedRole(root, 'guest', '73001');
    await upsertApprovedBinding(root, {
      discordUserId: '72001', discordTag: 'pilot', mainName: 'Main Pilot',
      approvedAt: '2026-01-01T00:00:00.000Z', onboardingProfileId: 'default', corporationIds: ['88001'],
    });

    const fixture = createDiscordFixture();
    fixture.addRole('73001', 'Guest');
    fixture.addRole('73003', 'Main');
    fixture.addRole('73004', 'Rookie');
    fixture.addRole('73005', 'Manual FC', { editable: false });
    const member = fixture.addMember('72001', ['73001', '73004', '73005'], { tag: 'pilot' });
    const client = { users: { async fetch() { return { async send() {} }; } } };
    const config = createConfig(root);
    const t = createTranslator('en', config);

    const result = await promoteMember({
      config, storageRoot: root, guild: fixture.guild, client,
      discordUserId: member.id, role: 'main', reviewedByUser: { id: '90001', tag: 'owner' }, t,
    });

    assert.equal(result.finalRole, 'main');
    assert.equal(member.roles.cache.has('73003'), true);
    assert.equal(member.roles.cache.has('73001'), false);
    assert.equal(member.roles.cache.has('73004'), false);
    assert.equal(member.roles.cache.has('73005'), true);
    const requests = await listPromotionRequests(root);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].status, 'approved-main');
  });
});

test('Rookie probation expiration posts one Main promotion notification', async () => {
  await withTempStorage(async (root) => {
    await registerCorporation(root, '88001');
    await upsertOnboardingProfile(root, 'default', {
      mainRoleId: '73003', rookieRoleId: '73004', recruiterRoleId: '73006',
      promotionChannelId: '71001', probationMonths: 3,
    });
    await upsertApprovedBinding(root, {
      discordUserId: '72001', discordTag: 'pilot', mainName: 'Main Pilot',
      approvedAt: '2026-01-01T00:00:00.000Z', onboardingProfileId: 'default', corporationIds: ['88001'],
    });

    const fixture = createDiscordFixture();
    fixture.addRole('73003', 'Main');
    fixture.addRole('73004', 'Rookie');
    fixture.addRole('73006', 'Recruiter', { editable: false });
    fixture.addMember('72001', ['73004'], { tag: 'pilot' });
    const channel = fixture.addChannel('71001');
    const config = createConfig(root);

    const first = await processProbationExpirations({
      config, storageRoot: root, guild: fixture.guild, now: new Date('2026-04-02T00:00:00.000Z'),
    });
    assert.equal(first.eligibleCount, 1);
    assert.equal(first.createdCount, 1);
    assert.equal(channel.sent.length, 1);
    const embedText = channel.sent[0].embeds[0].data.description;
    assert.match(embedText, /\/promote role:main/);
    assert.doesNotMatch(embedText, /role:rookie/);

    const second = await processProbationExpirations({
      config, storageRoot: root, guild: fixture.guild, now: new Date('2026-04-02T01:00:00.000Z'),
    });
    assert.equal(second.createdCount, 0);
    assert.equal(channel.sent.length, 1);
  });
});

test('welcome messages can be disabled without disabling onboarding', async () => {
  await withTempStorage(async (root) => {
    await updateWelcomeConfig(root, { enabled: false });
    const result = await handleGuildMemberJoin(root, {
      id: '72001',
      user: { id: '72001', bot: false },
      guild: { id: '70001' },
      async send() { throw new Error('welcome must not be sent when disabled'); },
    });
    assert.equal(result.welcomeSentTo, 'disabled');
    assert.equal((await readOnboardingConfig(root)).welcome.enabled, false);
  });
});
