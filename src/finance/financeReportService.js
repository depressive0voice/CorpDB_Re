const { readCorporationProfile } = require('../corporations/corporationProfileRepository');
const { readFinancePolicy } = require('./financePolicyRepository');
const { readJournalState } = require('./journalRepository');
const { resolveFinanceCorporationIds } = require('./financeCorporationService');
const { buildReportPeriod, isEntryInReportPeriod } = require('./reportPeriod');
const { formatIsk } = require('./walletService');

function normalizeText(value) {
  return String(value || '').trim();
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function positivePercent(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativePercent(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function isEntryIncludedInFinance(entry) {
  return entry?.includedInFinanceAtIngest !== false;
}

function isEntryTaxable(entry, taxableRefTypes) {
  if (entry?.taxableAtIngest === true || entry?.taxableAtIngest === false) {
    return entry.taxableAtIngest;
  }
  const refType = normalizeText(entry?.refType).toLowerCase();
  return taxableRefTypes.includes(refType);
}

function classifyEntry(entry, taxableRefTypes) {
  if (!isEntryIncludedInFinance(entry)) return 'excluded_wallet_division';
  const amount = Number(entry.amount || 0);
  if (amount > 0 && isEntryTaxable(entry, taxableRefTypes)) return 'taxable_income';
  if (amount > 0) return 'excluded_inflow';
  if (amount < 0) return 'outflow';
  return 'neutral';
}

function addGroup(map, refType, amount) {
  map.set(refType, (map.get(refType) || 0) + Number(amount || 0));
}

function sortedGroups(map) {
  return [...map.entries()]
    .map(([refType, amount]) => ({
      refType,
      amount,
      amountFormatted: formatIsk(amount),
    }))
    .sort((left, right) => right.amount - left.amount);
}

async function getSingleCorporationIncomeSummary(
  storageRoot,
  corporationId,
  period,
  monthLabel = '',
  options = {}
) {
  const reportPeriod = buildReportPeriod(period, monthLabel, options.now || new Date());
  const [state, policy, profile] = await Promise.all([
    readJournalState(storageRoot, corporationId),
    readFinancePolicy(storageRoot, corporationId),
    readCorporationProfile(storageRoot, corporationId),
  ]);
  const periodEntries = state.entries.filter((entry) => isEntryInReportPeriod(entry, reportPeriod));
  const taxable = new Map();
  const excluded = new Map();
  const outflows = new Map();
  const taxableEntries = new Map();
  let excludedWalletEntriesCount = 0;

  for (const entry of periodEntries) {
    const refType = normalizeText(entry.refType).toLowerCase();
    const amount = Number(entry.amount || 0);
    const category = classifyEntry(entry, policy.taxableRefTypes);
    if (category === 'excluded_wallet_division') {
      excludedWalletEntriesCount += 1;
      continue;
    }
    if (category === 'taxable_income') {
      addGroup(taxable, refType, amount);
      if (!taxableEntries.has(refType)) taxableEntries.set(refType, []);
      taxableEntries.get(refType).push(entry);
    } else if (category === 'excluded_inflow') {
      addGroup(excluded, refType, amount);
    } else if (category === 'outflow') {
      addGroup(outflows, refType, Math.abs(amount));
    }
  }

  const fallbackCorporateTaxRatePercent = positivePercent(
    state.meta.currentCorporationTaxRatePercent,
    profile.taxRatePercent || 0
  );
  const taxableGroups = sortedGroups(taxable).map((group) => {
    let grossBase = 0;
    let allianceTaxDue = 0;
    let corporationRetained = 0;
    for (const entry of taxableEntries.get(group.refType) || []) {
      const received = Number(entry.amount || 0);
      const corporateTaxRate = positivePercent(
        entry.corporationTaxRatePercent,
        fallbackCorporateTaxRatePercent
      );
      const allianceTaxRate = nonNegativePercent(
        entry.allianceTaxRatePercent,
        policy.allianceTaxRatePercent
      );
      if (corporateTaxRate > 0) {
        const gross = received * 100 / corporateTaxRate;
        const allianceDue = gross * allianceTaxRate / 100;
        grossBase += gross;
        allianceTaxDue += allianceDue;
        corporationRetained += received - allianceDue;
      } else {
        corporationRetained += received;
      }
    }
    return {
      ...group,
      grossBase,
      grossBaseFormatted: formatIsk(grossBase),
      allianceTaxDue,
      allianceTaxDueFormatted: formatIsk(allianceTaxDue),
      corporationRetained,
      corporationRetainedFormatted: formatIsk(corporationRetained),
    };
  });
  const excludedGroups = sortedGroups(excluded);
  const outflowGroups = sortedGroups(outflows);
  const sum = (items, field) => items.reduce((total, item) => total + Number(item[field] || 0), 0);
  const taxableReceived = sum(taxableGroups, 'amount');
  const grossTaxableBase = sum(taxableGroups, 'grossBase');
  const allianceTaxDue = sum(taxableGroups, 'allianceTaxDue');
  const corporationRetained = sum(taxableGroups, 'corporationRetained');
  const excludedInflows = sum(excludedGroups, 'amount');
  const outflowAmount = sum(outflowGroups, 'amount');

  return {
    corporationId: String(corporationId),
    corporationName: state.meta.corporationName || profile.name || String(corporationId),
    authorizedCharacterName: state.meta.authorizedCharacterName,
    period: reportPeriod.period,
    periodLabel: reportPeriod.periodLabel,
    month: reportPeriod.month,
    lastRefreshedAt: state.meta.lastRefreshedAt,
    historyEntriesCount: state.entries.length,
    periodEntriesCount: periodEntries.length,
    includedPeriodEntriesCount: periodEntries.length - excludedWalletEntriesCount,
    excludedWalletEntriesCount,
    currentCorporateTaxRatePercent: fallbackCorporateTaxRatePercent,
    currentCorporateTaxRatePercentFormatted: formatPercent(fallbackCorporateTaxRatePercent),
    allianceTaxRatePercent: policy.allianceTaxRatePercent,
    allianceTaxRatePercentFormatted: formatPercent(policy.allianceTaxRatePercent),
    taxableReceived,
    taxableReceivedFormatted: formatIsk(taxableReceived),
    grossTaxableBase,
    grossTaxableBaseFormatted: formatIsk(grossTaxableBase),
    allianceTaxDue,
    allianceTaxDueFormatted: formatIsk(allianceTaxDue),
    corporationRetained,
    corporationRetainedFormatted: formatIsk(corporationRetained),
    excludedInflows,
    excludedInflowsFormatted: formatIsk(excludedInflows),
    outflows: outflowAmount,
    outflowsFormatted: formatIsk(outflowAmount),
    taxableGroups,
    excludedGroups,
    outflowGroups,
  };
}

function combineIncomeSummaries(summaries) {
  const list = Array.isArray(summaries) ? summaries : [];
  const sum = (field) => list.reduce((total, item) => total + Number(item[field] || 0), 0);
  const decorate = (field) => list.flatMap((summary) =>
    summary[field].map((group) => ({
      ...group,
      corporationId: summary.corporationId,
      corporationName: summary.corporationName,
    }))
  );
  const taxableReceived = sum('taxableReceived');
  const grossTaxableBase = sum('grossTaxableBase');
  const allianceTaxDue = sum('allianceTaxDue');
  const corporationRetained = sum('corporationRetained');
  const excludedInflows = sum('excludedInflows');
  const outflows = sum('outflows');

  return {
    corporationId: 'all',
    corporationName: 'All corporations',
    authorizedCharacterName: '',
    period: list[0]?.period || '',
    periodLabel: list[0]?.periodLabel || '',
    month: list[0]?.month || '',
    lastRefreshedAt: list.map((item) => item.lastRefreshedAt).filter(Boolean).sort().at(-1) || '',
    historyEntriesCount: sum('historyEntriesCount'),
    periodEntriesCount: sum('periodEntriesCount'),
    includedPeriodEntriesCount: sum('includedPeriodEntriesCount'),
    excludedWalletEntriesCount: sum('excludedWalletEntriesCount'),
    currentCorporateTaxRatePercent: 0,
    currentCorporateTaxRatePercentFormatted: 'varies',
    allianceTaxRatePercent: 0,
    allianceTaxRatePercentFormatted: 'varies',
    taxableReceived,
    taxableReceivedFormatted: formatIsk(taxableReceived),
    grossTaxableBase,
    grossTaxableBaseFormatted: formatIsk(grossTaxableBase),
    allianceTaxDue,
    allianceTaxDueFormatted: formatIsk(allianceTaxDue),
    corporationRetained,
    corporationRetainedFormatted: formatIsk(corporationRetained),
    excludedInflows,
    excludedInflowsFormatted: formatIsk(excludedInflows),
    outflows,
    outflowsFormatted: formatIsk(outflows),
    taxableGroups: decorate('taxableGroups'),
    excludedGroups: decorate('excludedGroups'),
    outflowGroups: decorate('outflowGroups'),
    summaries: list,
  };
}

async function getCorporationIncomeSummary(
  storageRoot,
  requestedCorporation,
  period,
  monthLabel = '',
  options = {}
) {
  const corporationIds = await resolveFinanceCorporationIds(
    storageRoot,
    requestedCorporation,
    { allowAll: true }
  );
  const summaries = [];
  for (const corporationId of corporationIds) {
    summaries.push(await getSingleCorporationIncomeSummary(
      storageRoot,
      corporationId,
      period,
      monthLabel,
      options
    ));
  }
  return summaries.length === 1 ? summaries[0] : combineIncomeSummaries(summaries);
}

function donationGroupLabel(division) {
  const number = Number(division || 0);
  return number > 0 ? `Division ${number}` : 'Unknown division';
}

async function getSinglePlayerDonationsSummary(
  storageRoot,
  corporationId,
  period,
  monthLabel = '',
  options = {}
) {
  const reportPeriod = buildReportPeriod(period, monthLabel, options.now || new Date());
  const [state, profile] = await Promise.all([
    readJournalState(storageRoot, corporationId),
    readCorporationProfile(storageRoot, corporationId),
  ]);
  const donations = state.entries.filter((entry) =>
    normalizeText(entry.refType).toLowerCase() === 'player_donation'
    && Number(entry.amount || 0) > 0
    && isEntryInReportPeriod(entry, reportPeriod)
  );
  const groups = new Map();
  for (const entry of donations) {
    const division = Number(entry.division || 0);
    if (!groups.has(division)) groups.set(division, { division, amount: 0, entryCount: 0 });
    const group = groups.get(division);
    group.amount += Number(entry.amount || 0);
    group.entryCount += 1;
  }
  const donationGroups = [...groups.values()]
    .map((group) => ({
      ...group,
      label: donationGroupLabel(group.division),
      amountFormatted: formatIsk(group.amount),
    }))
    .sort((left, right) => right.amount - left.amount);
  const recentDonations = [...donations]
    .sort((left, right) => (Date.parse(right.date) || 0) - (Date.parse(left.date) || 0))
    .map((entry) => ({
      id: entry.id,
      date: entry.date,
      amount: Number(entry.amount || 0),
      amountFormatted: formatIsk(entry.amount),
      division: Number(entry.division || 0),
      divisionLabel: donationGroupLabel(entry.division),
      description: normalizeText(entry.description),
      reason: normalizeText(entry.reason),
      corporationId: String(corporationId),
      corporationName: state.meta.corporationName || profile.name || String(corporationId),
    }));
  const totalAmount = recentDonations.reduce((sum, entry) => sum + entry.amount, 0);

  return {
    corporationId: String(corporationId),
    corporationName: state.meta.corporationName || profile.name || String(corporationId),
    authorizedCharacterName: state.meta.authorizedCharacterName,
    period: reportPeriod.period,
    periodLabel: reportPeriod.periodLabel,
    month: reportPeriod.month,
    lastRefreshedAt: state.meta.lastRefreshedAt,
    historyEntriesCount: state.entries.length,
    periodEntriesCount: donations.length,
    donationEntryCount: donations.length,
    totalAmount,
    totalAmountFormatted: formatIsk(totalAmount),
    donationGroups,
    recentDonations,
  };
}

function combineDonationSummaries(summaries) {
  const list = Array.isArray(summaries) ? summaries : [];
  const totalAmount = list.reduce((sum, item) => sum + item.totalAmount, 0);
  const recentDonations = list.flatMap((item) => item.recentDonations)
    .sort((left, right) => (Date.parse(right.date) || 0) - (Date.parse(left.date) || 0));
  return {
    corporationId: 'all',
    corporationName: 'All corporations',
    authorizedCharacterName: '',
    period: list[0]?.period || '',
    periodLabel: list[0]?.periodLabel || '',
    month: list[0]?.month || '',
    lastRefreshedAt: list.map((item) => item.lastRefreshedAt).filter(Boolean).sort().at(-1) || '',
    historyEntriesCount: list.reduce((sum, item) => sum + item.historyEntriesCount, 0),
    periodEntriesCount: recentDonations.length,
    donationEntryCount: recentDonations.length,
    totalAmount,
    totalAmountFormatted: formatIsk(totalAmount),
    donationGroups: list.flatMap((item) => item.donationGroups.map((group) => ({
      ...group,
      corporationId: item.corporationId,
      corporationName: item.corporationName,
    }))),
    recentDonations,
    summaries: list,
  };
}

async function getPlayerDonationsSummary(
  storageRoot,
  requestedCorporation,
  period,
  monthLabel = '',
  options = {}
) {
  const corporationIds = await resolveFinanceCorporationIds(
    storageRoot,
    requestedCorporation,
    { allowAll: true }
  );
  const summaries = [];
  for (const corporationId of corporationIds) {
    summaries.push(await getSinglePlayerDonationsSummary(
      storageRoot,
      corporationId,
      period,
      monthLabel,
      options
    ));
  }
  return summaries.length === 1 ? summaries[0] : combineDonationSummaries(summaries);
}

module.exports = {
  isEntryIncludedInFinance,
  isEntryTaxable,
  classifyEntry,
  getSingleCorporationIncomeSummary,
  combineIncomeSummaries,
  getCorporationIncomeSummary,
  getSinglePlayerDonationsSummary,
  combineDonationSummaries,
  getPlayerDonationsSummary,
};
