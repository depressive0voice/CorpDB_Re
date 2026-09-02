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
const { writeMembers } = require('../src/members/memberRepository');
const { replaceAllAuthCharacters } = require('../src/auth/authCharacterRepository');
const { writeMainBindingState } = require('../src/mainBinding/mainBindingRepository');
const { writeJournalState } = require('../src/finance/journalRepository');
const {
  replaceClosedFatMonthReports,
  readFatMonthlyReportState,
} = require('../src/activity/fatMonthlyReportRepository');
const { buildActivityReport } = require('../src/activity/activityReportService');
const {
  trackMemberByName,
  trackMemberByDiscordUserId,
} = require('../src/activity/trackService');
const trackCommand = require('../src/discord/commands/trackCommand');
const { commandsByName, allCommandsByName } = require('../src/discord/commands');

const CORPORATION_ID = '98817479';
const CORPORATION_NAME = 'NO PANIC GROUP';

async function withStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-activity-track-'));
  try {
    await initializeBaseStorage(root);
    await registerCorporation(root, CORPORATION_ID, { makeDefault: true });
    await initializeCorporationStorage(root, CORPORATION_ID);
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function member(overrides = {}) {
  return {
    characterId: overrides.characterId || '91000001',
    name: overrides.name || 'Main Pilot',
    corporationId: CORPORATION_ID,
    corporationName: CORPORATION_NAME,
    isCorporationMember: overrides.isCorporationMember !== false,
    status: overrides.status || 'active',
    corporationJoinDate: overrides.corporationJoinDate || '2026-01-10T00:00:00.000Z',
    lastLogonAt: overrides.lastLogonAt || '2026-07-14T10:00:00.000Z',
    lastLogoffAt: overrides.lastLogoffAt || '2026-07-14T12:00:00.000Z',
    locationId: '',
    shipTypeId: '',
    leftAt: '',
    firstSeenAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-07-14T12:00:00.000Z',
  };
}

async function seedFamily(root) {
  await writeMembers(root, CORPORATION_ID, [
    member(),
    member({
      characterId: '91000002',
      name: 'Alt Pilot',
      corporationJoinDate: '2026-02-01T00:00:00.000Z',
      lastLogonAt: '2026-07-15T08:00:00.000Z',
    }),
    member({
      characterId: '91000003',
      name: 'New Pilot',
      corporationJoinDate: '2026-06-15T00:00:00.000Z',
      lastLogonAt: '2026-07-13T08:00:00.000Z',
    }),
  ]);
  await replaceAllAuthCharacters(root, [
    { main: 'Main Pilot', alt: 'Main Pilot', corp: CORPORATION_NAME },
    { main: 'Main Pilot', alt: 'Alt Pilot', corp: CORPORATION_NAME },
    { main: 'New Pilot', alt: 'New Pilot', corp: CORPORATION_NAME },
  ]);
  await writeMainBindingState(root, {
    version: 1,
    config: { approvalChannelId: '' },
    bindings: [{
      discordUserId: '700000000000000001',
      discordTag: 'main-user',
      mainName: 'Main Pilot',
      approvedAt: '2026-02-01T00:00:00.000Z',
      approvedByUserId: '700000000000000099',
      approvedByTag: 'reviewer',
      approvedRoleId: '',
      onboardingProfileId: 'default',
      corporationIds: [CORPORATION_ID],
    }],
    requests: [],
  });
}

async function seedClosedFatHistory(root) {
  const now = new Date('2026-07-15T12:00:00.000Z');
  await replaceClosedFatMonthReports(root, CORPORATION_ID, '04-2026', [
    { mainName: 'Main Pilot', fatCount: 1 },
    { mainName: 'New Pilot', fatCount: 0 },
  ], { now });
  await replaceClosedFatMonthReports(root, CORPORATION_ID, '05-2026', [
    { mainName: 'Main Pilot', fatCount: 2 },
    { mainName: 'New Pilot', fatCount: 0 },
  ], { now });
  await replaceClosedFatMonthReports(root, CORPORATION_ID, '06-2026', [
    { mainName: 'Main Pilot', fatCount: 1 },
    { mainName: 'New Pilot', fatCount: 0 },
  ], { now });
}

async function seedFarm(root) {
  await writeJournalState(root, CORPORATION_ID, {
    version: 1,
    corporationId: CORPORATION_ID,
    meta: {
      lastRefreshedAt: '2026-07-15T11:00:00.000Z',
      corporationName: CORPORATION_NAME,
      authorizedCharacterId: '90000001',
      authorizedCharacterName: 'Service Pilot',
      currentCorporationTaxRatePercent: 10,
      allianceTaxRatePercent: 7.5,
    },
    entries: [
      {
        id: '1001',
        division: 1,
        date: '2026-07-10T00:00:00.000Z',
        refType: 'bounty_prizes',
        amount: 100,
        balance: 1000,
        description: 'Alt Pilot got bounty prizes',
        secondPartyId: '91000002',
        corporationTaxRatePercent: 10,
        allianceTaxRatePercent: 7.5,
        taxableAtIngest: true,
        includedInFinanceAtIngest: true,
        financePolicyCapturedAt: '2026-07-10T00:05:00.000Z',
        retrievedAt: '2026-07-10T00:05:00.000Z',
      },
      {
        id: '1002',
        division: 7,
        date: '2026-07-11T00:00:00.000Z',
        refType: 'ess_escrow_transfer',
        amount: 50,
        balance: 1050,
        description: 'ESS escrow transferred funds to Main Pilot',
        secondPartyId: '91000001',
        corporationTaxRatePercent: 10,
        allianceTaxRatePercent: 7.5,
        taxableAtIngest: true,
        includedInFinanceAtIngest: false,
        financePolicyCapturedAt: '2026-07-11T00:05:00.000Z',
        retrievedAt: '2026-07-11T00:05:00.000Z',
      },
    ],
  });
}

test('closed FAT months persist while the current month remains preview-only', async () => {
  await withStorage(async (root) => {
    const now = new Date('2026-09-01T10:00:00.000Z');
    const saved = await replaceClosedFatMonthReports(root, CORPORATION_ID, '08-2026', [
      { mainName: 'Main Pilot', fatCount: 5 },
    ], { now, sourceFileName: 'august.xlsx' });
    assert.equal(saved.length, 1);
    assert.equal(saved[0].fatCount, 5);

    await assert.rejects(
      replaceClosedFatMonthReports(root, CORPORATION_ID, '09-2026', [
        { mainName: 'Main Pilot', fatCount: 1 },
      ], { now }),
      (error) => error.code === 'activity_month_not_closed'
    );
    const state = await readFatMonthlyReportState(root, CORPORATION_ID);
    assert.deepEqual(state.records.map((record) => record.month), ['08-2026']);
  });
});

test('Activity reports use current corporation families and only mark full-tenure families chronic', async () => {
  await withStorage(async (root) => {
    await seedFamily(root);
    await seedClosedFatHistory(root);
    const report = await buildActivityReport({
      storageRoot: root,
      corporationId: CORPORATION_ID,
      month: '06-2026',
    });

    assert.equal(report.minimumFat, 3);
    assert.deepEqual(report.lookbackMonths, ['06-2026', '05-2026', '04-2026']);
    assert.equal(report.familiesCount, 2);
    assert.deepEqual(report.chronic.map((row) => row.mainName), ['Main Pilot']);
    assert.deepEqual(report.lookbackIneligible.map((row) => row.mainName), ['New Pilot']);
    assert.equal(report.rows.find((row) => row.mainName === 'Main Pilot').activeCharacters.length, 2);
  });
});

test('Track resolves an alt to its main and excludes historically disabled wallet divisions from farm', async () => {
  await withStorage(async (root) => {
    await seedFamily(root);
    await seedClosedFatHistory(root);
    await seedFarm(root);

    const result = await trackMemberByName(root, 'Alt Pilot', {
      farmPeriod: 'current-month',
      activityMonth: '06-2026',
      now: new Date('2026-07-15T12:00:00.000Z'),
    });

    assert.equal(result.found, true);
    assert.equal(result.mainName, 'Main Pilot');
    assert.equal(result.member.name, 'Alt Pilot');
    assert.equal(result.alts.some((entry) => entry.name === 'Alt Pilot'), true);
    assert.equal(result.activity.month, '06-2026');
    assert.equal(result.activity.fatCount, 1);
    assert.equal(result.farm.entriesCount, 1);
    assert.equal(result.farm.totalTaxReceived, 100);
    assert.equal(result.farm.totalGrossBase, 1000);
    assert.equal(
      result.farm.groups.find((group) => group.refType === 'ess_escrow_transfer').entriesCount,
      0
    );
  });
});

test('Track resolves Discord users through approved main bindings', async () => {
  await withStorage(async (root) => {
    await seedFamily(root);
    await seedClosedFatHistory(root);
    await seedFarm(root);
    const result = await trackMemberByDiscordUserId(root, '700000000000000001', {
      farmPeriod: 'current-month',
      activityMonth: '06-2026',
      now: new Date('2026-07-15T12:00:00.000Z'),
    });
    assert.equal(result.found, true);
    assert.equal(result.mainName, 'Main Pilot');
    assert.equal(result.discordBinding.discordUserId, '700000000000000001');
  });
});

test('/track exposes member plus Activity import/report surface while rewards stay standalone', () => {
  const json = trackCommand.data.toJSON();
  assert.equal(json.name, 'track');
  const memberCommand = json.options.find((option) => option.name === 'member');
  const activityGroup = json.options.find((option) => option.name === 'activity');
  assert.ok(memberCommand);
  assert.ok(activityGroup);
  assert.deepEqual(
    memberCommand.options.map((option) => option.name),
    ['name', 'user', 'period', 'month', 'fat-month']
  );
  assert.deepEqual(
    activityGroup.options.map((option) => option.name),
    ['import', 'report', 'rookies', 'three-months', 'months']
  );
  const importCommand = activityGroup.options.find((option) => option.name === 'import');
  assert.deepEqual(importCommand.options.map((option) => option.name), ['month', 'file', 'corporation']);
  assert.equal(commandsByName.has('activity'), false);
  assert.equal(commandsByName.has('fat-rewards'), false);
  assert.equal(allCommandsByName.has('fat-rewards'), true);
});
