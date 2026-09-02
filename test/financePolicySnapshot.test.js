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
  createDefaultFinancePolicy,
  normalizeFinancePolicy,
  updateFinancePolicy,
} = require('../src/finance/financePolicyRepository');
const {
  readJournalState,
  upsertJournalEntries,
} = require('../src/finance/journalRepository');
const {
  getSingleCorporationIncomeSummary,
} = require('../src/finance/financeReportService');
const { REPORT_PERIODS } = require('../src/finance/reportPeriod');

const CORPORATION_ID = '99001';

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-finance-policy-'));
  try {
    await initializeBaseStorage(root);
    await initializeCorporationStorage(root, CORPORATION_ID);
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('finance policy keeps legacy defaults and accepts configurable taxable types and excluded divisions', () => {
  const defaults = createDefaultFinancePolicy(CORPORATION_ID);
  assert.equal(defaults.allianceTaxRatePercent, 7.5);
  assert.deepEqual(defaults.taxableRefTypes, ['bounty_prizes', 'ess_escrow_transfer']);
  assert.deepEqual(defaults.excludedWalletDivisions, []);

  const normalized = normalizeFinancePolicy(CORPORATION_ID, {
    corporationId: CORPORATION_ID,
    allianceTaxRatePercent: 10,
    taxableRefTypes: ['player_donation', 'BOUNTY_PRIZES', 'player_donation'],
    excludedWalletDivisions: [5, 2, 5, 0, 8],
  });

  assert.equal(normalized.allianceTaxRatePercent, 10);
  assert.deepEqual(normalized.taxableRefTypes, ['player_donation', 'bounty_prizes']);
  assert.deepEqual(normalized.excludedWalletDivisions, [2, 5]);
});

test('existing journal entries preserve the finance policy captured on first ingest', async () => {
  await withTempStorage(async (root) => {
    const firstCapturedAt = '2026-08-15T12:00:00.000Z';
    const laterCapturedAt = '2026-09-01T12:00:00.000Z';

    await upsertJournalEntries(root, CORPORATION_ID, {
      entries: [{
        id: '1001',
        division: 2,
        date: '2026-08-15T10:00:00.000Z',
        refType: 'bounty_prizes',
        amount: 100,
        corporationTaxRatePercent: 10,
        allianceTaxRatePercent: 7.5,
        taxableAtIngest: true,
        includedInFinanceAtIngest: true,
        financePolicyCapturedAt: firstCapturedAt,
        retrievedAt: firstCapturedAt,
      }],
    });

    await updateFinancePolicy(root, CORPORATION_ID, {
      allianceTaxRatePercent: 10,
      taxableRefTypes: [],
      excludedWalletDivisions: [2],
    });

    await upsertJournalEntries(root, CORPORATION_ID, {
      entries: [{
        id: '1001',
        division: 2,
        date: '2026-08-15T10:00:00.000Z',
        refType: 'bounty_prizes',
        amount: 100,
        corporationTaxRatePercent: 15,
        allianceTaxRatePercent: 10,
        taxableAtIngest: false,
        includedInFinanceAtIngest: false,
        financePolicyCapturedAt: laterCapturedAt,
        retrievedAt: laterCapturedAt,
      }, {
        id: '1002',
        division: 2,
        date: '2026-08-20T10:00:00.000Z',
        refType: 'bounty_prizes',
        amount: 200,
        corporationTaxRatePercent: 15,
        allianceTaxRatePercent: 10,
        taxableAtIngest: false,
        includedInFinanceAtIngest: false,
        financePolicyCapturedAt: laterCapturedAt,
        retrievedAt: laterCapturedAt,
      }],
    });

    const state = await readJournalState(root, CORPORATION_ID);
    const oldEntry = state.entries.find((entry) => entry.id === '1001');
    const newEntry = state.entries.find((entry) => entry.id === '1002');

    assert.equal(oldEntry.corporationTaxRatePercent, 10);
    assert.equal(oldEntry.allianceTaxRatePercent, 7.5);
    assert.equal(oldEntry.taxableAtIngest, true);
    assert.equal(oldEntry.includedInFinanceAtIngest, true);
    assert.equal(oldEntry.financePolicyCapturedAt, firstCapturedAt);
    assert.equal(oldEntry.retrievedAt, firstCapturedAt);

    assert.equal(newEntry.allianceTaxRatePercent, 10);
    assert.equal(newEntry.taxableAtIngest, false);
    assert.equal(newEntry.includedInFinanceAtIngest, false);

    const report = await getSingleCorporationIncomeSummary(
      root,
      CORPORATION_ID,
      REPORT_PERIODS.MONTH,
      '08-2026'
    );

    assert.equal(report.periodEntriesCount, 2);
    assert.equal(report.includedPeriodEntriesCount, 1);
    assert.equal(report.excludedWalletEntriesCount, 1);
    assert.equal(report.taxableReceived, 100);
    assert.equal(report.grossTaxableBase, 1000);
    assert.equal(report.allianceTaxDue, 75);
    assert.equal(report.corporationRetained, 25);
  });
});
