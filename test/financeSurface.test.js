const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { initializeBaseStorage, initializeCorporationStorage } = require('../src/storage/initializeStorage');
const { registerCorporation } = require('../src/corporations/corporationRegistryRepository');
const { writeCorporationProfile } = require('../src/corporations/corporationProfileRepository');
const { updateFinancePolicy } = require('../src/finance/financePolicyRepository');
const { writeJournalState } = require('../src/finance/journalRepository');
const {
  autocompleteFinanceCorporations,
} = require('../src/finance/financeCorporationService');
const {
  CORPORATION_TAX_FALLBACK_COMPATIBILITY_DATE,
  getEsiCorporationTaxRatePercent,
  resolveEsiCorporationTaxRatePercent,
} = require('../src/finance/walletService');
const {
  getSingleCorporationIncomeSummary,
  getSinglePlayerDonationsSummary,
} = require('../src/finance/financeReportService');
const { runFinanceJob } = require('../src/jobs/financeJob');
const financeCommand = require('../src/discord/commands/financeCommand');
const adminCommand = require('../src/discord/commands/adminCommand');
const { createTranslator } = require('../src/localization/localizationService');

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-finance-surface-'));
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
}

function context(root, language = 'en') {
  const config = {
    storage: { rootDir: root },
    localization: { defaultLanguage: 'en', enabledLanguages: ['en', 'ru'] },
  };
  return { config, language, t: createTranslator(language, config) };
}

test('/finance exposes wallet, income and donations and /admin exposes finance policy controls', () => {
  const finance = financeCommand.data.toJSON();
  assert.deepEqual(finance.options.map((option) => option.name), ['wallet', 'income', 'donations']);
  for (const option of finance.options) {
    const corporation = option.options.find((child) => child.name === 'corporation');
    assert.ok(corporation);
    assert.equal(corporation.autocomplete, true);
    assert.equal(corporation.choices, undefined);
  }

  const admin = adminCommand.data.toJSON();
  const financeGroup = admin.options.find((option) => option.name === 'finance');
  assert.ok(financeGroup);
  assert.deepEqual(financeGroup.options.map((option) => option.name), [
    'show',
    'set-alliance-tax',
    'taxable-add',
    'taxable-remove',
    'wallet-exclude',
    'wallet-include',
    'donation-alert-set',
    'donation-alert-disable',
  ]);
  for (const subcommand of financeGroup.options) {
    const corporation = subcommand.options.find((child) => child.name === 'corporation');
    assert.ok(corporation);
    assert.equal(corporation.autocomplete, true);
  }
});

test('finance corporation autocomplete contains only linked enabled finance corporations', async () => {
  await withTempStorage(async (root) => {
    await addCorporation(root, '90001');
    await addCorporation(root, '90002');
    await addCorporation(root, '90003', { features: { finance: false } });
    await writeCorporationProfile(root, '90001', { name: 'Overheat Unlimited', ticker: 'VERH' });
    await writeCorporationProfile(root, '90002', { name: 'Alt Corporation', ticker: 'ALT' });
    await writeCorporationProfile(root, '90003', { name: 'Hidden Finance Corp', ticker: 'HIDE' });

    const financeChoices = await autocompleteFinanceCorporations(root, '', { allowAll: true });
    assert.deepEqual(financeChoices, [
      { name: 'All corporations', value: 'all' },
      { name: 'Overheat Unlimited [VERH]', value: '90001' },
      { name: 'Alt Corporation [ALT]', value: '90002' },
    ]);

    const filtered = await autocompleteFinanceCorporations(root, 'over', { allowAll: true });
    assert.deepEqual(filtered, [
      { name: 'Overheat Unlimited [VERH]', value: '90001' },
    ]);

    const adminChoices = await autocompleteFinanceCorporations(root, '', { allowAll: false });
    assert.equal(adminChoices.some((choice) => choice.value === 'all'), false);
    assert.equal(adminChoices.some((choice) => choice.value === '90003'), false);
  });
});

test('wallet tax accepts current ESI tax fields and preserves a real zero tax', () => {
  assert.deepEqual(
    getEsiCorporationTaxRatePercent({ tax_rate: 0.1 }, '90001'),
    { ratePercent: 10, field: 'tax_rate' }
  );
  assert.deepEqual(
    getEsiCorporationTaxRatePercent({ isk_tax_rate: 0.12 }, '90001'),
    { ratePercent: 12, field: 'isk_tax_rate' }
  );
  assert.deepEqual(
    getEsiCorporationTaxRatePercent({ tax_rate: 0 }, '90001'),
    { ratePercent: 0, field: 'tax_rate' }
  );
  assert.throws(
    () => getEsiCorporationTaxRatePercent({}, '90001'),
    (error) => error.code === 'esi_corporation_tax_rate_missing'
  );
});

test('wallet tax falls back to the pre-2026-07-21 ESI corporation schema when current response omits ISK tax', async () => {
  const calls = [];
  const result = await resolveEsiCorporationTaxRatePercent(
    {
      eve: {
        datasource: 'tranquility',
        compatibilityDate: '2026-08-31',
      },
    },
    { name: 'Test Corp', lp_tax_rate: 0.05 },
    '90001',
    {
      fetchImpl: async (_url, init) => {
        calls.push(init.headers);
        return {
          ok: true,
          status: 200,
          async json() {
            return { name: 'Test Corp', tax_rate: 0.1 };
          },
        };
      },
    }
  );

  assert.equal(result.ratePercent, 10);
  assert.equal(result.field, 'tax_rate');
  assert.equal(result.usedCompatibilityFallback, true);
  assert.equal(result.compatibilityDate, CORPORATION_TAX_FALLBACK_COMPATIBILITY_DATE);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]['X-Compatibility-Date'],
    CORPORATION_TAX_FALLBACK_COMPATIBILITY_DATE
  );
});

test('finance timestamps use Discord local-time formatting', () => {
  assert.equal(
    financeCommand.formatDiscordTimestamp('2026-09-01T08:10:52.568Z'),
    '<t:1788250252:f>'
  );
  assert.equal(financeCommand.formatDiscordTimestamp(''), '—');
});

test('excluded wallet divisions stay visible in wallet output but are marked excluded', async () => {
  await withTempStorage(async (root) => {
    await addCorporation(root, '90001');
    await updateFinancePolicy(root, '90001', { excludedWalletDivisions: [4] });
    const lines = await financeCommand.buildWalletLines(context(root, 'en'), {
      corporationId: '90001',
      corporationName: 'Test Corp',
      corporationTaxRatePercent: 10,
      retrievedAt: '2026-09-01T00:00:00.000Z',
      totals: { balanceFormatted: '3,000' },
      divisionBalances: [
        { division: 1, balanceFormatted: '1,000' },
        { division: 4, balanceFormatted: '2,000' },
      ],
    }, root);

    assert.equal(lines.some((line) => line.includes('Division 1') && line.includes('1,000')), true);
    assert.equal(lines.some((line) => line.includes('Division 4') && line.includes('2,000')), true);
    assert.equal(lines.some((line) => line.includes('Division 4') && line.includes('excluded')), true);
    assert.equal(lines.some((line) => line.includes('<t:1788220800:f>')), true);
  });
});

test('player donations remain reportable even when their wallet division was excluded from finance calculations', async () => {
  await withTempStorage(async (root) => {
    await addCorporation(root, '90001');
    await writeJournalState(root, '90001', {
      meta: {
        lastRefreshedAt: '2026-09-01T00:00:00.000Z',
        corporationName: 'Test Corp',
        currentCorporationTaxRatePercent: 10,
        allianceTaxRatePercent: 7.5,
      },
      entries: [
        {
          id: '1',
          division: 4,
          date: '2026-09-01T01:00:00.000Z',
          refType: 'player_donation',
          amount: 500000000,
          description: 'Pilot deposited cash into Test Corp',
          corporationTaxRatePercent: 10,
          allianceTaxRatePercent: 7.5,
          taxableAtIngest: false,
          includedInFinanceAtIngest: false,
          financePolicyCapturedAt: '2026-09-01T00:00:00.000Z',
          retrievedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    });

    const income = await getSingleCorporationIncomeSummary(
      root,
      '90001',
      'current-month',
      '',
      { now: new Date('2026-09-15T00:00:00.000Z') }
    );
    assert.equal(income.excludedWalletEntriesCount, 1);
    assert.equal(income.excludedInflows, 0);

    const donations = await getSinglePlayerDonationsSummary(
      root,
      '90001',
      'current-month',
      '',
      { now: new Date('2026-09-15T00:00:00.000Z') }
    );
    assert.equal(donations.donationEntryCount, 1);
    assert.equal(donations.totalAmount, 500000000);
    assert.equal(donations.recentDonations[0].division, 4);
  });
});

test('finance background job processes enabled finance corporations sequentially and isolates failures', async () => {
  await withTempStorage(async (root) => {
    await addCorporation(root, '90001');
    await addCorporation(root, '90002');
    await addCorporation(root, '90003', { features: { finance: false } });
    const calls = [];
    const config = {
      storage: { rootDir: root },
      localization: { defaultLanguage: 'en', enabledLanguages: ['en'] },
      jobs: { enabled: true, financeEnabled: true, financeRefreshIntervalMinutes: 15 },
    };

    const result = await runFinanceJob(config, {}, {
      silent: true,
      refreshImpl: async (_config, _root, corporationId) => {
        calls.push(`refresh:${corporationId}`);
        if (corporationId === '90002') throw new Error('test wallet failure');
        return {
          totalBalanceFormatted: '1,000',
          historyAddedCount: 1,
        };
      },
      alertImpl: async (_config, _root, corporationId) => {
        calls.push(`alert:${corporationId}`);
        return { enabled: true, alertedCount: 1, dmSent: true };
      },
    });

    assert.deepEqual(calls, ['refresh:90001', 'alert:90001', 'refresh:90002']);
    assert.equal(result.checkedCorporations, 2);
    assert.equal(result.succeeded, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.results[1].corporationId, '90002');
  });
});
