const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { initializeBaseStorage } = require('../src/storage/initializeStorage');
const {
  registerCorporation,
  readRegistry,
} = require('../src/corporations/corporationRegistryRepository');
const {
  replaceAllAuthCharacters,
  findAllAuthCharacters,
} = require('../src/auth/authCharacterRepository');
const {
  writeMainBindingState,
  readMainBindingState,
} = require('../src/mainBinding/mainBindingRepository');
const { runBindingAudit } = require('../src/mainBinding/bindingAuditService');
const adminCommand = require('../src/discord/commands/adminCommand');
const { commands } = require('../src/discord/commands');

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-binding-audit-'));
  try {
    await initializeBaseStorage(root);
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function member(id, name, options = {}) {
  return {
    id: String(id),
    displayName: name,
    user: {
      id: String(id),
      username: name,
      bot: Boolean(options.bot),
    },
  };
}

function guildWithMembers(items) {
  const map = new Map(items.map((entry) => [entry.user.id, entry]));
  return {
    members: {
      async fetch() {
        return map;
      },
    },
  };
}

test('binding audit reports Discord, Auth, corporation and onboarding integrity problems without mutating storage', async () => {
  await withTempStorage(async (root) => {
    await registerCorporation(root, '88001', { enabled: true });
    await registerCorporation(root, '88002', { enabled: false });
    await replaceAllAuthCharacters(root, [
      { main: 'Healthy Main', alt: 'Healthy Main', corp: 'Corp A' },
      { main: 'Disabled Main', alt: 'Disabled Main', corp: 'Corp B' },
      { main: 'Stale Main', alt: 'Stale Main', corp: 'Old Corp' },
    ]);
    await writeMainBindingState(root, {
      version: 1,
      config: { approvalChannelId: '70001' },
      bindings: [
        {
          discordUserId: '10001',
          discordTag: 'healthy',
          mainName: 'Healthy Main',
          onboardingProfileId: 'default',
          corporationIds: ['88001'],
        },
        {
          discordUserId: '10002',
          discordTag: 'broken',
          mainName: 'Missing Auth Main',
          onboardingProfileId: 'missing-profile',
          corporationIds: [],
        },
        {
          discordUserId: '10005',
          discordTag: 'disabled',
          mainName: 'Disabled Main',
          onboardingProfileId: 'default',
          corporationIds: ['88002'],
        },
        {
          discordUserId: '19999',
          discordTag: 'stale',
          mainName: 'Stale Main',
          onboardingProfileId: 'default',
          corporationIds: ['99999'],
        },
      ],
      requests: [
        {
          id: 'request-1',
          discordUserId: '10003',
          discordTag: 'pending',
          mainName: 'Pending Main',
          status: 'pending',
        },
      ],
    });

    const before = {
      bindings: await readMainBindingState(root),
      auth: await findAllAuthCharacters(root),
      registry: await readRegistry(root),
    };

    const audit = await runBindingAudit(root, guildWithMembers([
      member('10001', 'Healthy User'),
      member('10002', 'Broken User'),
      member('10003', 'Pending User'),
      member('10004', 'Unbound User'),
      member('10005', 'Disabled User'),
      member('10999', 'Bot User', { bot: true }),
    ]));

    assert.equal(audit.totalDiscordUsers, 5);
    assert.equal(audit.approvedBindingsCount, 4);
    assert.equal(audit.pendingRequestsCount, 1);
    assert.equal(audit.boundUsersCount, 3);
    assert.equal(audit.healthyBoundUsersCount, 1);
    assert.equal(audit.boundUsersWithIssuesCount, 2);
    assert.equal(audit.unboundUsersCount, 2);
    assert.equal(audit.pendingUnboundCount, 1);

    assert.equal(audit.issues.staleBindings.length, 1);
    assert.equal(audit.issues.mainMissingAuth.length, 1);
    assert.equal(audit.issues.emptyCorporationIds.length, 1);
    assert.equal(audit.issues.unregisteredCorporations.length, 1);
    assert.deepEqual(audit.issues.unregisteredCorporations[0].corporationIds, ['99999']);
    assert.equal(audit.issues.disabledCorporations.length, 1);
    assert.deepEqual(audit.issues.disabledCorporations[0].corporationIds, ['88002']);
    assert.equal(audit.issues.onboardingProfileMissing.length, 1);
    assert.equal(audit.issues.onboardingProfileMissing[0].onboardingProfileId, 'missing-profile');
    assert.equal(audit.unboundUsers.find((entry) => entry.discordUserId === '10003').pendingRequest.mainName, 'Pending Main');

    const after = {
      bindings: await readMainBindingState(root),
      auth: await findAllAuthCharacters(root),
      registry: await readRegistry(root),
    };
    assert.deepEqual(after, before);
  });
});

test('/admin exposes binding-audit as an admin diagnostic and no standalone binding-audit command is registered', () => {
  const admin = adminCommand.data.toJSON();
  const audit = admin.options.find((option) => option.name === 'binding-audit');
  assert.ok(audit);
  assert.equal(audit.type, 1);
  assert.equal(commands.some((command) => command.data.name === 'binding-audit'), false);
});
