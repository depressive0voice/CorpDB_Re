const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');
const ExcelJS = require('exceljs');

const { initializeBaseStorage, initializeCorporationStorage } = require('../src/storage/initializeStorage');
const { registerCorporation } = require('../src/corporations/corporationRegistryRepository');
const { writeMembers } = require('../src/members/memberRepository');
const { replaceAllAuthCharacters } = require('../src/auth/authCharacterRepository');
const {
  importFatActivityBuffer,
} = require('../src/activity/fatImportService');
const {
  readFatMonthlyReportState,
} = require('../src/activity/fatMonthlyReportRepository');
const {
  PAYOUT_RULES,
  basePointsRegressive,
  buildPayoutRows,
  calculateFatPayoutReport,
} = require('../src/activity/fatRewardsService');
const { saveFatSummaryBuffer } = require('../src/activity/fatSummaryRepository');
const {
  MODULE_KEYS,
  isModuleEnabled,
  setModuleEnabled,
} = require('../src/modules/moduleConfigRepository');
const { listVisibleCommands } = require('../src/discord/commandRegistrationService');
const { allCommands } = require('../src/discord/commands');

const CORPORATION_ID = '88001';

async function withStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-fat-rewards-'));
  try {
    await initializeBaseStorage(root);
    await registerCorporation(root, CORPORATION_ID, { makeDefault: true });
    await initializeCorporationStorage(root, CORPORATION_ID);
    await writeMembers(root, CORPORATION_ID, [
      {
        characterId: '91000001',
        name: 'Main Pilot',
        corporationName: 'Test Corp',
        isCorporationMember: true,
        corporationJoinDate: '2026-01-01T00:00:00.000Z',
      },
      {
        characterId: '91000002',
        name: 'Alt Pilot',
        corporationName: 'Test Corp',
        isCorporationMember: true,
        corporationJoinDate: '2026-01-01T00:00:00.000Z',
      },
      {
        characterId: '91000003',
        name: 'Solo Pilot',
        corporationName: 'Test Corp',
        isCorporationMember: true,
        corporationJoinDate: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await replaceAllAuthCharacters(root, [
      { main: 'Main Pilot', alt: 'Main Pilot', corp: 'Test Corp' },
      { main: 'Main Pilot', alt: 'Alt Pilot', corp: 'Test Corp' },
      { main: 'Solo Pilot', alt: 'Solo Pilot', corp: 'Test Corp' },
    ]);
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function fatWorkbookBuffer(rows, options = {}) {
  const workbook = new ExcelJS.Workbook();
  const splitAt = options.splitAt || rows.length;
  const chunks = [rows.slice(0, splitAt), rows.slice(splitAt)].filter((chunk) => chunk.length > 0);
  for (let index = 0; index < chunks.length; index += 1) {
    const sheet = workbook.addWorksheet(`FAT ${index + 1}`);
    sheet.addRow(['Character', 'FAT']);
    for (const row of chunks[index]) sheet.addRow([row.character, row.fat]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test('legacy payout curve keeps 10 FAT minimum and regressive 50/60/70 tiers', () => {
  assert.equal(basePointsRegressive(9, PAYOUT_RULES), 0);
  assert.equal(basePointsRegressive(10, PAYOUT_RULES), 10);
  assert.equal(basePointsRegressive(50, PAYOUT_RULES), 50);
  assert.equal(basePointsRegressive(60, PAYOUT_RULES), 58);
  assert.equal(basePointsRegressive(70, PAYOUT_RULES), 64);
  assert.equal(basePointsRegressive(80, PAYOUT_RULES), 68);

  const aggregation = {
    rows: [
      { mainName: 'Multi', fatCount: 50, altsFat: 10 },
      { mainName: 'Solo', fatCount: 50, altsFat: 0 },
      { mainName: 'Bad', fatCount: 2, altsFat: 0 },
    ],
    familyContext: {
      hasAlts: new Map([
        ['multi', true],
        ['solo', false],
        ['bad', false],
      ]),
    },
  };
  const report = buildPayoutRows(aggregation, PAYOUT_RULES, 2500);
  assert.equal(report.multiRows[0].weight, 75);
  assert.equal(report.soloRows[0].weight, 50);
  assert.equal(report.badRows[0].payout, 0);
  assert.ok(Math.abs(report.distributedAmount - 2500) < 1e-6);
});

test('Activity FAT import persists closed months and keeps current month preview-only', async () => {
  await withStorage(async (root) => {
    const buffer = await fatWorkbookBuffer([
      { character: 'Main Pilot', fat: 30 },
      { character: 'Alt Pilot', fat: 20 },
      { character: 'Solo Pilot', fat: 15 },
    ], { splitAt: 2 });

    const closed = await importFatActivityBuffer({
      storageRoot: root,
      corporationId: CORPORATION_ID,
      month: '08-2026',
      buffer,
      sourceFileName: 'august.xlsx',
      now: new Date('2026-09-01T12:00:00.000Z'),
    });
    assert.equal(closed.mode, 'persisted');
    assert.equal(closed.rowsCount, 2);
    assert.equal(closed.activityTotalFat, 65);
    assert.equal(closed.savedRowsCount, 2);

    const beforePreview = await readFatMonthlyReportState(root, CORPORATION_ID);
    const preview = await importFatActivityBuffer({
      storageRoot: root,
      corporationId: CORPORATION_ID,
      month: '09-2026',
      buffer,
      sourceFileName: 'september.xlsx',
      now: new Date('2026-09-15T12:00:00.000Z'),
    });
    assert.equal(preview.mode, 'preview');
    assert.equal(preview.savedRowsCount, 0);
    assert.deepEqual(await readFatMonthlyReportState(root, CORPORATION_ID), beforePreview);
  });
});

test('Activity FAT import rejects duplicate and unmatched characters before persistence', async () => {
  await withStorage(async (root) => {
    const duplicate = await fatWorkbookBuffer([
      { character: 'Main Pilot', fat: 3 },
      { character: 'Main Pilot', fat: 4 },
    ]);
    await assert.rejects(
      importFatActivityBuffer({
        storageRoot: root,
        corporationId: CORPORATION_ID,
        month: '08-2026',
        buffer: duplicate,
        now: new Date('2026-09-01T12:00:00.000Z'),
      }),
      (error) => error.code === 'fat_summary_duplicates_detected'
    );

    const unmatched = await fatWorkbookBuffer([{ character: 'Unknown Pilot', fat: 7 }]);
    await assert.rejects(
      importFatActivityBuffer({
        storageRoot: root,
        corporationId: CORPORATION_ID,
        month: '08-2026',
        buffer: unmatched,
        now: new Date('2026-09-01T12:00:00.000Z'),
      }),
      (error) => error.code === 'fat_activity_unmatched_characters'
    );
    assert.equal((await readFatMonthlyReportState(root, CORPORATION_ID)).records.length, 0);
  });
});

test('FAT rewards calculate uses stored closed summary, creates workbook and persists Activity', async () => {
  await withStorage(async (root) => {
    const buffer = await fatWorkbookBuffer([
      { character: 'Main Pilot', fat: 30 },
      { character: 'Alt Pilot', fat: 20 },
      { character: 'Solo Pilot', fat: 60 },
    ], { splitAt: 2 });
    await saveFatSummaryBuffer(root, CORPORATION_ID, {
      buffer,
      reportMonth: '08-2026',
      sourceFileName: 'final-august.xlsx',
      now: new Date('2026-09-01T10:00:00.000Z'),
    });

    const result = await calculateFatPayoutReport({
      storageRoot: root,
      corporationId: CORPORATION_ID,
      budget: 1000000000,
      month: '08-2026',
      now: new Date('2026-09-01T12:00:00.000Z'),
    });
    assert.equal(result.month, '08-2026');
    assert.equal(result.multiCount, 1);
    assert.equal(result.soloCount, 1);
    assert.equal(result.badCount, 0);
    assert.equal(result.activityRowsCount, 2);
    assert.equal(result.sourceTotalFat, 110);
    assert.equal(result.activityTotalFat, 110);
    assert.ok(Buffer.isBuffer(result.content));
    assert.ok(result.content.length > 1000);
    assert.ok(Math.abs(result.distributedAmount - 1000000000) < 0.01);
    const state = await readFatMonthlyReportState(root, CORPORATION_ID);
    assert.equal(state.records.filter((row) => row.month === '08-2026').length, 2);
  });
});

test('FAT rewards is a standalone optional command and disabling the module removes it from visible registration', async () => {
  await withStorage(async (root) => {
    assert.equal(allCommands.some((command) => command.data.name === 'fat-rewards'), true);
    assert.equal(await isModuleEnabled(root, MODULE_KEYS.FAT_REWARDS), true);
    assert.equal((await listVisibleCommands(root)).some((command) => command.data.name === 'fat-rewards'), true);

    await setModuleEnabled(root, MODULE_KEYS.FAT_REWARDS, false);
    assert.equal((await listVisibleCommands(root)).some((command) => command.data.name === 'fat-rewards'), false);

    await setModuleEnabled(root, MODULE_KEYS.FAT_REWARDS, true);
    assert.equal((await listVisibleCommands(root)).some((command) => command.data.name === 'fat-rewards'), true);

    const fatRewards = allCommands.find((command) => command.data.name === 'fat-rewards').data.toJSON();
    assert.deepEqual(fatRewards.options.map((option) => option.name), ['import', 'calculate', 'status', 'set-reminder']);
    const admin = allCommands.find((command) => command.data.name === 'admin').data.toJSON();
    const modules = admin.options.find((option) => option.name === 'modules');
    assert.ok(modules);
    const moduleOptionNames = modules.options.map((option) => option.name);
    assert.equal(moduleOptionNames.includes('list'), true);
    assert.equal(moduleOptionNames.includes('set'), true);
    assert.equal(moduleOptionNames.includes('fat-rewards'), true);
  });
});
