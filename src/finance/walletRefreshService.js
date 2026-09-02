const { getCorporationAccessContext } = require('../eve/eveAuthorizationService');
const {
  getCorporationPublicInfo,
  getCorporationWalletBalances,
  getCorporationWalletJournalByDivision,
} = require('../eve/eveEsiClient');
const { readCorporationProfile, writeCorporationProfile } = require('../corporations/corporationProfileRepository');
const { readFinancePolicy } = require('./financePolicyRepository');
const { readWalletSnapshot, writeWalletSnapshot } = require('./walletRepository');
const { upsertJournalEntries } = require('./journalRepository');
const { resolveEsiCorporationTaxRatePercent } = require('./walletService');

const DEFAULT_WALLET_JOURNAL_MAX_PAGES = 5;

function normalizeMaxJournalPages(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_WALLET_JOURNAL_MAX_PAGES;
  return Math.min(parsed, 100);
}

function formatIsk(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0));
}

function hasDivisionChanged(existing, next) {
  if (!existing) return true;
  return Number(existing.balance || 0) !== Number(next.balance || 0);
}

function dedupeJournalEntries(entries) {
  const unique = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry?.id) continue;
    const key = `${Number(entry.division || 0)}:${entry.id}`;
    if (!unique.has(key)) unique.set(key, entry);
  }
  return [...unique.values()];
}

function buildFinancePolicySnapshot(entry, policy, capturedAt) {
  const refType = String(entry?.refType || entry?.ref_type || '').trim().toLowerCase();
  const division = Number(entry?.division || 0);
  return {
    allianceTaxRatePercent: policy.allianceTaxRatePercent,
    taxableAtIngest: policy.taxableRefTypes.includes(refType),
    includedInFinanceAtIngest: !policy.excludedWalletDivisions.includes(division),
    financePolicyCapturedAt: capturedAt,
  };
}

async function refreshCorporationWallet(config, storageRoot, corporationId, options = {}) {
  const access = await getCorporationAccessContext(config, storageRoot, corporationId, options);
  const [profile, policy, publicCorporation, balances] = await Promise.all([
    readCorporationProfile(storageRoot, corporationId),
    readFinancePolicy(storageRoot, corporationId),
    getCorporationPublicInfo(config, corporationId, options),
    getCorporationWalletBalances(config, corporationId, access.accessToken, options),
  ]);

  const refreshedAt = new Date().toISOString();
  const corporationName = String(publicCorporation.name || profile.name || corporationId).trim();
  const taxRate = await resolveEsiCorporationTaxRatePercent(
    config,
    publicCorporation,
    corporationId,
    options
  );
  const corporationTaxRatePercent = taxRate.ratePercent;
  const previous = await readWalletSnapshot(storageRoot, corporationId);
  const previousByDivision = new Map(previous.divisions.map((entry) => [entry.division, entry]));
  const nextDivisions = balances.map((entry) => ({
    division: Number(entry.division),
    balance: Number(entry.balance || 0),
  }));

  let updatedCount = 0;
  let unchangedCount = 0;
  for (const division of nextDivisions) {
    if (hasDivisionChanged(previousByDivision.get(division.division), division)) updatedCount += 1;
    else unchangedCount += 1;
  }
  const nextDivisionIds = new Set(nextDivisions.map((entry) => entry.division));
  const removedCount = previous.divisions.filter((entry) => !nextDivisionIds.has(entry.division)).length;

  await writeWalletSnapshot(storageRoot, corporationId, {
    corporationId,
    corporationName,
    authorizedCharacterId: access.characterId,
    authorizedCharacterName: access.characterName,
    retrievedAt: refreshedAt,
    divisions: nextDivisions,
  });

  await writeCorporationProfile(storageRoot, corporationId, {
    ...profile,
    name: corporationName,
    ticker: String(publicCorporation.ticker || profile.ticker || '').trim(),
    allianceId: String(publicCorporation.alliance_id || profile.allianceId || '').trim(),
    taxRatePercent: corporationTaxRatePercent,
    metadataUpdatedAt: refreshedAt,
  });

  const maxJournalPages = normalizeMaxJournalPages(options.maxJournalPages);
  const batches = [];
  for (const division of nextDivisions.map((entry) => entry.division)) {
    batches.push(await getCorporationWalletJournalByDivision(
      config,
      corporationId,
      division,
      access.accessToken,
      { ...options, maxPages: maxJournalPages }
    ));
  }

  const journalEntries = dedupeJournalEntries(batches.flat()).map((entry) => ({
    ...entry,
    corporationId,
    corporationName,
    authorizedCharacterId: access.characterId,
    authorizedCharacterName: access.characterName,
    corporationTaxRatePercent,
    ...buildFinancePolicySnapshot(entry, policy, refreshedAt),
    retrievedAt: refreshedAt,
  }));

  const history = await upsertJournalEntries(storageRoot, corporationId, {
    metaPatch: {
      lastRefreshedAt: refreshedAt,
      corporationName,
      authorizedCharacterId: access.characterId,
      authorizedCharacterName: access.characterName,
      currentCorporationTaxRatePercent: corporationTaxRatePercent,
      allianceTaxRatePercent: policy.allianceTaxRatePercent,
    },
    entries: journalEntries,
  });

  const totalBalance = nextDivisions.reduce((sum, entry) => sum + entry.balance, 0);
  return {
    ok: true,
    corporationId: String(corporationId),
    corporationName,
    authorizedCharacterId: access.characterId,
    authorizedCharacterName: access.characterName,
    corporationTaxRatePercent,
    corporationTaxRateSource: taxRate.field,
    corporationTaxCompatibilityDate: taxRate.compatibilityDate,
    corporationTaxUsedCompatibilityFallback: taxRate.usedCompatibilityFallback,
    allianceTaxRatePercent: policy.allianceTaxRatePercent,
    refreshedAt,
    maxJournalPages,
    divisionCount: nextDivisions.length,
    updatedCount,
    unchangedCount,
    removedCount,
    totalBalance,
    totalBalanceFormatted: formatIsk(totalBalance),
    journalEntryCount: journalEntries.length,
    historyAddedCount: history.addedCount,
    historyUpdatedCount: history.updatedCount,
    historyUnchangedCount: history.unchangedCount,
    historyTotalCount: history.totalCount,
  };
}

module.exports = {
  DEFAULT_WALLET_JOURNAL_MAX_PAGES,
  normalizeMaxJournalPages,
  dedupeJournalEntries,
  buildFinancePolicySnapshot,
  refreshCorporationWallet,
};
