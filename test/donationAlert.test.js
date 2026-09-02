const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { initializeBaseStorage, initializeCorporationStorage } = require('../src/storage/initializeStorage');
const { registerCorporation } = require('../src/corporations/corporationRegistryRepository');
const { updateFinancePolicy } = require('../src/finance/financePolicyRepository');
const { writeJournalState } = require('../src/finance/journalRepository');
const { processCorporationDonationAlerts } = require('../src/finance/donationAlertService');
const { readDonationAlertState } = require('../src/finance/donationAlertRepository');

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-donation-alert-'));
  try {
    await initializeBaseStorage(root);
    await registerCorporation(root, '90001');
    await initializeCorporationStorage(root, '90001');
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function createConfig(root) {
  return {
    storage: { rootDir: root },
    localization: {
      defaultLanguage: 'en',
      enabledLanguages: ['en', 'ru'],
    },
  };
}

test('configured player donation alert sends matching division once and deduplicates later checks', async () => {
  await withTempStorage(async (root) => {
    await updateFinancePolicy(root, '90001', {
      donationAlert: { discordUserId: '70001', division: 4 },
    });
    await writeJournalState(root, '90001', {
      meta: {
        lastRefreshedAt: '2026-09-01T00:00:00.000Z',
        corporationName: 'Test Corp',
      },
      entries: [
        {
          id: 'donation-1',
          division: 4,
          date: '2026-09-01T01:00:00.000Z',
          refType: 'player_donation',
          amount: 250000000,
          description: 'Helpful Pilot deposited cash into Test Corp',
          reason: 'SRP',
          retrievedAt: '2026-09-01T01:00:00.000Z',
        },
        {
          id: 'donation-other-division',
          division: 2,
          date: '2026-09-01T02:00:00.000Z',
          refType: 'player_donation',
          amount: 500000000,
          description: 'Other Pilot deposited cash into Test Corp',
          retrievedAt: '2026-09-01T02:00:00.000Z',
        },
      ],
    });

    const sent = [];
    const client = {
      users: {
        async fetch(userId) {
          assert.equal(userId, '70001');
          return {
            async send(payload) {
              sent.push(payload);
            },
          };
        },
      },
    };

    const first = await processCorporationDonationAlerts(
      createConfig(root),
      root,
      '90001',
      client
    );
    assert.equal(first.alertedCount, 1);
    assert.equal(first.dmSent, true);
    assert.equal(sent.length, 1);
    assert.match(sent[0].content, /Helpful Pilot/);
    assert.doesNotMatch(sent[0].content, /Other Pilot/);

    const second = await processCorporationDonationAlerts(
      createConfig(root),
      root,
      '90001',
      client
    );
    assert.equal(second.alertedCount, 0);
    assert.equal(second.dmSent, false);
    assert.equal(sent.length, 1);

    const state = await readDonationAlertState(root, '90001');
    assert.ok(state.alertedEntries['4:donation-1']);
    assert.equal(state.alertedEntries['2:donation-other-division'], undefined);
  });
});
