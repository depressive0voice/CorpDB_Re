const { getCorporationAccessContext } = require('../eve/eveAuthorizationService');
const {
  getCorporationPublicInfo,
  getCorporationWalletBalances,
  normalizePercent,
} = require('../eve/eveEsiClient');
const { readCorporationProfile } = require('../corporations/corporationProfileRepository');
const { resolveFinanceCorporationIds } = require('./financeCorporationService');

const CORPORATION_TAX_FALLBACK_COMPATIBILITY_DATE = '2026-07-20';

function formatIsk(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0));
}

function getEsiCorporationTaxRatePercent(publicCorporation, corporationId) {
  const candidates = [
    ['tax_rate', publicCorporation?.tax_rate],
    ['isk_tax_rate', publicCorporation?.isk_tax_rate],
  ];

  for (const [field, raw] of candidates) {
    if (raw === undefined || raw === null || raw === '') continue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) continue;
    return {
      ratePercent: normalizePercent(parsed),
      field,
    };
  }

  const error = new Error(
    `ESI corporation ${corporationId} response has no valid ISK tax rate field.`
  );
  error.code = 'esi_corporation_tax_rate_missing';
  throw error;
}

async function resolveEsiCorporationTaxRatePercent(
  config,
  publicCorporation,
  corporationId,
  options = {}
) {
  try {
    return {
      ...getEsiCorporationTaxRatePercent(publicCorporation, corporationId),
      usedCompatibilityFallback: false,
      compatibilityDate: config.eve.compatibilityDate,
    };
  } catch (error) {
    if (error.code !== 'esi_corporation_tax_rate_missing') throw error;
  }

  const fallbackCorporation = await getCorporationPublicInfo(config, corporationId, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'X-Compatibility-Date': CORPORATION_TAX_FALLBACK_COMPATIBILITY_DATE,
    },
  });
  const fallback = getEsiCorporationTaxRatePercent(fallbackCorporation, corporationId);
  return {
    ...fallback,
    usedCompatibilityFallback: true,
    compatibilityDate: CORPORATION_TAX_FALLBACK_COMPATIBILITY_DATE,
  };
}

async function getSingleWalletSummary(config, storageRoot, corporationId, options = {}) {
  const access = await getCorporationAccessContext(config, storageRoot, corporationId, options);
  const [profile, publicCorporation, balances] = await Promise.all([
    readCorporationProfile(storageRoot, corporationId),
    getCorporationPublicInfo(config, corporationId, options),
    getCorporationWalletBalances(config, corporationId, access.accessToken, options),
  ]);
  const corporationName = String(publicCorporation.name || profile.name || corporationId).trim();
  const taxRate = await resolveEsiCorporationTaxRatePercent(
    config,
    publicCorporation,
    corporationId,
    options
  );
  const divisionBalances = balances.map((entry) => ({
    corporationId: String(corporationId),
    corporationName,
    division: Number(entry.division),
    balance: Number(entry.balance || 0),
    balanceFormatted: formatIsk(entry.balance),
  }));
  const totalBalance = divisionBalances.reduce((sum, entry) => sum + entry.balance, 0);

  return {
    ok: true,
    corporationId: String(corporationId),
    corporationName,
    corporationTaxRatePercent: taxRate.ratePercent,
    corporationTaxRateSource: taxRate.field,
    corporationTaxCompatibilityDate: taxRate.compatibilityDate,
    corporationTaxUsedCompatibilityFallback: taxRate.usedCompatibilityFallback,
    authorizedCharacterId: access.characterId,
    authorizedCharacterName: access.characterName,
    retrievedAt: new Date().toISOString(),
    divisionBalances,
    totals: {
      balance: totalBalance,
      balanceFormatted: formatIsk(totalBalance),
    },
  };
}

function combineWalletSummaries(summaries) {
  const list = Array.isArray(summaries) ? summaries : [];
  const divisionBalances = list.flatMap((summary) => summary.divisionBalances || []);
  const totalBalance = list.reduce(
    (sum, summary) => sum + Number(summary?.totals?.balance || 0),
    0
  );

  return {
    ok: true,
    corporationId: 'all',
    corporationName: 'All corporations',
    authorizedCharacterId: '',
    authorizedCharacterName: '',
    corporationTaxRatePercent: 0,
    retrievedAt: new Date().toISOString(),
    divisionBalances,
    totals: {
      balance: totalBalance,
      balanceFormatted: formatIsk(totalBalance),
    },
    summaries: list,
  };
}

async function getWalletSummary(config, storageRoot, requestedCorporation, options = {}) {
  const corporationIds = await resolveFinanceCorporationIds(
    storageRoot,
    requestedCorporation,
    { allowAll: true }
  );
  const summaries = [];
  for (const corporationId of corporationIds) {
    summaries.push(await getSingleWalletSummary(config, storageRoot, corporationId, options));
  }
  return summaries.length === 1 ? summaries[0] : combineWalletSummaries(summaries);
}

module.exports = {
  CORPORATION_TAX_FALLBACK_COMPATIBILITY_DATE,
  formatIsk,
  getEsiCorporationTaxRatePercent,
  resolveEsiCorporationTaxRatePercent,
  getSingleWalletSummary,
  combineWalletSummaries,
  getWalletSummary,
};
