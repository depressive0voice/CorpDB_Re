const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  initializeBaseStorage,
  initializeCorporationStorage,
} = require('../src/storage/initializeStorage');
const {
  registerCorporation,
} = require('../src/corporations/corporationRegistryRepository');
const {
  writeCorporationProfile,
} = require('../src/corporations/corporationProfileRepository');
const {
  replaceAllAuthCharacters,
} = require('../src/auth/authCharacterRepository');
const {
  readApplicationConfig,
  updateApplicationConfig,
} = require('../src/applications/applicationConfigRepository');
const {
  readApplicationState,
} = require('../src/applications/applicationStateRepository');
const {
  autocompleteApplicationCorporations,
} = require('../src/applications/applicationCorporationService');
const {
  parseCharacterIdFromNotification,
  inferNotificationStatus,
  processCorporationApplications,
  resetCorporationApplicationCache,
} = require('../src/applications/applicationAlertService');
const {
  runApplicationJob,
} = require('../src/jobs/applicationJob');
const applicationsCommand = require('../src/discord/commands/applicationsCommand');

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-applications-'));
  try {
    await initializeBaseStorage(root);
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function addCorporation(root, corporationId, options = {}) {
  await registerCorporation(root, corporationId, options);
  await initializeCorporationStorage(root, corporationId);
  await writeCorporationProfile(root, corporationId, {
    corporationId,
    name: options.name || `Corporation ${corporationId}`,
    ticker: options.ticker || 'TEST',
  });
}

function config(root) {
  return {
    storage: { rootDir: root },
    eve: { compatibilityDate: '2026-08-31', datasource: 'tranquility' },
    localization: { defaultLanguage: 'en', enabledLanguages: ['en', 'ru'] },
    jobs: {
      enabled: true,
      applicationsEnabled: true,
      applicationsCheckIntervalMinutes: 15,
    },
  };
}

function accessContext() {
  return {
    corporationId: '90001',
    characterId: '70001',
    characterName: 'Service Pilot',
    accessToken: 'token',
    scopes: ['esi-characters.read_notifications.v1'],
  };
}

function applicationNotification(options = {}) {
  return {
    notification_id: options.id || 1,
    sender_id: options.characterId || 1001,
    sender_type: 'character',
    timestamp: options.timestamp || '2026-09-01T08:00:00Z',
    type: options.type || 'CorporationApplicationNew',
    text: options.text || `characterID: ${options.characterId || 1001}`,
  };
}

test('/applications exposes the legacy application actions with linked-corporation autocomplete', () => {
  const data = applicationsCommand.data.toJSON();
  assert.deepEqual(data.options.map((option) => option.name), [
    'show-config',
    'set-alert-channel',
    'clear-alert-channel',
    'reset-cache',
    'check',
  ]);
  for (const subcommand of data.options) {
    const corporation = subcommand.options.find((option) => option.name === 'corporation');
    assert.ok(corporation);
    assert.equal(corporation.autocomplete, true);
  }
});

test('application corporation autocomplete only exposes linked enabled application corporations', async () => {
  await withTempStorage(async (root) => {
    await addCorporation(root, '90001', { name: 'Overheat Unlimited', ticker: 'VERH' });
    await addCorporation(root, '90002', { name: 'Alt Corp', ticker: 'ALT' });
    await addCorporation(root, '90003', {
      name: 'Hidden Corp',
      ticker: 'HIDE',
      features: { applications: false },
    });

    assert.deepEqual(
      await autocompleteApplicationCorporations(root, '', { allowAll: true }),
      [
        { name: 'All corporations', value: 'all' },
        { name: 'Overheat Unlimited [VERH]', value: '90001' },
        { name: 'Alt Corp [ALT]', value: '90002' },
      ]
    );
  });
});

test('notification parser and legacy status inference handle corporation application events', () => {
  assert.equal(parseCharacterIdFromNotification(applicationNotification({ characterId: 12345 })), '12345');
  assert.equal(inferNotificationStatus(applicationNotification(), false), 'applied');
  assert.equal(inferNotificationStatus(applicationNotification({ type: 'CorporationApplicationInvited' }), false), 'invited');
  assert.equal(inferNotificationStatus(applicationNotification({ type: 'CorporationApplicationRejected' }), false), 'rejected');
  assert.equal(inferNotificationStatus(applicationNotification(), true), 'accepted');
  assert.equal(inferNotificationStatus(applicationNotification(), false, 'rejected'), 'rejected');
});

test('new application sends one card, repeated check does not duplicate it, membership acceptance edits the same card', async () => {
  await withTempStorage(async (root) => {
    await addCorporation(root, '90001', { name: 'Overheat Unlimited', ticker: 'VERH' });
    await updateApplicationConfig(root, '90001', { alertChannelId: '123456789012345678' });

    let memberIds = [];
    const deliveries = [];
    const options = {
      now: new Date('2026-09-01T09:00:00Z'),
      accessImpl: async () => accessContext(),
      notificationsImpl: async () => [applicationNotification()],
      membersImpl: async () => memberIds,
      namesImpl: async () => [{ id: 1001, name: 'Applicant One' }],
      authImpl: async () => [],
      deliveryImpl: async (_config, _client, channelId, entry) => {
        const action = entry.messageId ? 'edited' : 'sent';
        deliveries.push({ action, channelId, status: entry.status, messageId: entry.messageId });
        return {
          ok: true,
          action,
          entry: {
            ...entry,
            channelId,
            messageId: entry.messageId || 'message-1',
            messageUrl: 'https://discord.test/message-1',
          },
        };
      },
    };

    const first = await processCorporationApplications(config(root), root, '90001', {}, options);
    assert.equal(first.sentCount, 1);
    assert.equal(first.editedCount, 0);
    assert.equal(first.pendingApplicationsCount, 1);
    assert.equal(deliveries.length, 1);

    const second = await processCorporationApplications(config(root), root, '90001', {}, options);
    assert.equal(second.sentCount, 0);
    assert.equal(second.editedCount, 0);
    assert.equal(second.deliveryQueueCount, 0);
    assert.equal(deliveries.length, 1);

    memberIds = ['1001'];
    const accepted = await processCorporationApplications(config(root), root, '90001', {}, options);
    assert.equal(accepted.sentCount, 0);
    assert.equal(accepted.editedCount, 1);
    assert.equal(accepted.acceptedApplicationsCount, 1);
    assert.equal(deliveries.length, 2);
    assert.equal(deliveries[1].action, 'edited');
    assert.equal(deliveries[1].messageId, 'message-1');
    assert.equal(deliveries[1].status, 'accepted');
  });
});

test('Auth appearing after an application was posted edits the existing application card without a status change', async () => {
  await withTempStorage(async (root) => {
    await addCorporation(root, '90001');
    await updateApplicationConfig(root, '90001', { alertChannelId: '123456789012345678' });
    let authRecords = [];
    const deliveries = [];
    const options = {
      now: new Date('2026-09-01T09:00:00Z'),
      accessImpl: async () => accessContext(),
      notificationsImpl: async () => [applicationNotification()],
      membersImpl: async () => [],
      namesImpl: async () => [{ id: 1001, name: 'Applicant One' }],
      authImpl: async () => authRecords,
      deliveryImpl: async (_config, _client, channelId, entry) => {
        const action = entry.messageId ? 'edited' : 'sent';
        deliveries.push({ action, authFound: entry.authFound, status: entry.status });
        return {
          ok: true,
          action,
          entry: {
            ...entry,
            channelId,
            messageId: entry.messageId || 'message-1',
          },
        };
      },
    };

    await processCorporationApplications(config(root), root, '90001', {}, options);
    authRecords = [{ main: 'Applicant One', alt: 'Applicant One', corp: 'Overheat Unlimited' }];
    const refreshed = await processCorporationApplications(config(root), root, '90001', {}, options);

    assert.equal(refreshed.editedCount, 1);
    assert.equal(refreshed.pendingApplicationsCount, 1);
    assert.equal(refreshed.authMatchedApplicationsCount, 1);
    assert.deepEqual(deliveries.map((entry) => entry.action), ['sent', 'edited']);
    assert.equal(deliveries[1].authFound, true);
    assert.equal(deliveries[1].status, 'applied');
  });
});

test('notifications older than 30 days are ignored and reset-cache preserves alert channel configuration', async () => {
  await withTempStorage(async (root) => {
    await addCorporation(root, '90001');
    await updateApplicationConfig(root, '90001', { alertChannelId: '123456789012345678' });
    const result = await processCorporationApplications(config(root), root, '90001', {}, {
      now: new Date('2026-09-01T09:00:00Z'),
      accessImpl: async () => accessContext(),
      notificationsImpl: async () => [applicationNotification({ timestamp: '2026-07-01T08:00:00Z' })],
      membersImpl: async () => [],
      namesImpl: async () => [],
      authImpl: async () => [],
      deliveryImpl: async () => {
        throw new Error('old notification must not be delivered');
      },
    });
    assert.equal(result.applicationNotificationsCount, 0);
    assert.equal(result.trackedApplicationsCount, 0);

    await resetCorporationApplicationCache(root, '90001', {
      now: new Date('2026-09-01T10:00:00Z'),
    });
    const state = await readApplicationState(root, '90001');
    const appConfig = await readApplicationConfig(root, '90001');
    assert.deepEqual(state.applications, {});
    assert.equal(appConfig.alertChannelId, '123456789012345678');
  });
});

test('applications background job processes enabled corporations sequentially and isolates corporation failures', async () => {
  await withTempStorage(async (root) => {
    await addCorporation(root, '90001');
    await addCorporation(root, '90002');
    await addCorporation(root, '90003', { features: { applications: false } });
    const calls = [];
    const result = await runApplicationJob(config(root), {}, {
      silent: true,
      processImpl: async (_config, _root, corporationId) => {
        calls.push(corporationId);
        if (corporationId === '90002') throw new Error('test applications failure');
        return {
          applicationNotificationsCount: 1,
          trackedApplicationsCount: 1,
          pendingApplicationsCount: 1,
          sentCount: 1,
          editedCount: 0,
        };
      },
    });

    assert.deepEqual(calls, ['90001', '90002']);
    assert.equal(result.checkedCorporations, 2);
    assert.equal(result.succeeded, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.results[1].corporationId, '90002');
  });
});
