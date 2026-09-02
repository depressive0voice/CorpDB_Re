const { listEnabledFinanceCorporationIds } = require('../finance/financeCorporationService');
const { readJournalState } = require('../finance/journalRepository');
const { buildReportPeriod, isEntryInReportPeriod } = require('../finance/reportPeriod');

const FARM_REF_TYPES = Object.freeze(['bounty_prizes', 'ess_escrow_transfer']);

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function formatIsk(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
    .format(Math.round(Number(value || 0)));
}

function getEntryCharacterName(entry) {
  const description = normalizeText(entry?.description);
  const refType = normalizeKey(entry?.refType);
  if (!description) return '';
  if (refType === 'bounty_prizes') {
    return normalizeText(description.match(/^(.+?) got bounty prizes\b/i)?.[1]);
  }
  if (refType === 'ess_escrow_transfer') {
    return normalizeText(description.match(/\btransferred funds to (.+)$/i)?.[1]);
  }
  return '';
}

function buildFamilyIdentity(familyMembers, familyNames = []) {
  const characterIds = new Set();
  const characterNames = new Set((Array.isArray(familyNames) ? familyNames : [])
    .map(normalizeKey).filter(Boolean));
  for (const member of Array.isArray(familyMembers) ? familyMembers : []) {
    const id = normalizeText(member?.characterId);
    const name = normalizeKey(member?.name);
    if (id) characterIds.add(id);
    if (name) characterNames.add(name);
  }
  return { characterIds, characterNames };
}

function entryMatchesFamily(entry, identity) {
  const secondPartyId = normalizeText(entry?.secondPartyId);
  if (secondPartyId && identity.characterIds.has(secondPartyId)) return true;
  const name = normalizeKey(getEntryCharacterName(entry));
  return Boolean(name && identity.characterNames.has(name));
}

function calculateGrossBase(received, corporationTaxRatePercent) {
  const amount = Number(received || 0);
  const rate = Number(corporationTaxRatePercent || 0);
  if (!Number.isFinite(rate) || rate <= 0) return amount;
  return amount * 100 / rate;
}

function createGroup(refType) {
  return {
    refType,
    entriesCount: 0,
    taxReceived: 0,
    taxReceivedFormatted: '0',
    grossBase: 0,
    grossBaseFormatted: '0',
  };
}

async function getTrackFarmSummary(options = {}) {
  const storageRoot = options.storageRoot;
  const reportPeriod = buildReportPeriod(options.period || 'current-month', options.monthLabel || '', options.now || new Date());
  const corporationIds = await listEnabledFinanceCorporationIds(storageRoot);
  const identity = buildFamilyIdentity(options.familyMembers, options.familyNames);
  const groups = new Map(FARM_REF_TYPES.map((refType) => [refType, createGroup(refType)]));
  let historyEntriesCount = 0;
  let periodEntriesCount = 0;
  let matchedEntriesCount = 0;

  for (const corporationId of corporationIds) {
    const state = await readJournalState(storageRoot, corporationId);
    historyEntriesCount += state.entries.length;
    const fallbackRate = Number(state.meta.currentCorporationTaxRatePercent || 0);
    for (const entry of state.entries) {
      if (!isEntryInReportPeriod(entry, reportPeriod)) continue;
      periodEntriesCount += 1;
      const refType = normalizeKey(entry.refType);
      if (!FARM_REF_TYPES.includes(refType)) continue;
      if (entry.includedInFinanceAtIngest === false) continue;
      if (!entryMatchesFamily(entry, identity)) continue;
      const taxReceived = Number(entry.amount || 0);
      if (!Number.isFinite(taxReceived) || taxReceived <= 0) continue;
      const entryRate = Number(entry.corporationTaxRatePercent);
      const corporationTaxRatePercent = Number.isFinite(entryRate) && entryRate > 0
        ? entryRate
        : fallbackRate;
      const grossBase = calculateGrossBase(taxReceived, corporationTaxRatePercent);
      const group = groups.get(refType);
      group.entriesCount += 1;
      group.taxReceived += taxReceived;
      group.grossBase += grossBase;
      matchedEntriesCount += 1;
    }
  }

  const finalized = FARM_REF_TYPES.map((refType) => {
    const group = groups.get(refType);
    return {
      ...group,
      taxReceivedFormatted: formatIsk(group.taxReceived),
      grossBaseFormatted: formatIsk(group.grossBase),
    };
  });
  const totalTaxReceived = finalized.reduce((sum, group) => sum + group.taxReceived, 0);
  const totalGrossBase = finalized.reduce((sum, group) => sum + group.grossBase, 0);
  return {
    ok: true,
    period: reportPeriod.period,
    periodLabel: reportPeriod.periodLabel,
    month: reportPeriod.month,
    corporationsCount: corporationIds.length,
    historyEntriesCount,
    periodEntriesCount,
    entriesCount: matchedEntriesCount,
    totalTaxReceived,
    totalTaxReceivedFormatted: formatIsk(totalTaxReceived),
    totalGrossBase,
    totalGrossBaseFormatted: formatIsk(totalGrossBase),
    groups: finalized,
  };
}

module.exports = {
  FARM_REF_TYPES,
  getEntryCharacterName,
  buildFamilyIdentity,
  entryMatchesFamily,
  calculateGrossBase,
  getTrackFarmSummary,
};
