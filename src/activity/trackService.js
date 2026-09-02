const {
  findManagedMemberByName,
  buildTrackFamily,
  normalizeKey,
} = require('./memberFamilyService');
const {
  findApprovedBindingByMainName,
  findApprovedBindingByDiscordUserId,
} = require('../mainBinding/mainBindingRepository');
const { listEnabledActivityCorporationIds } = require('./activityCorporationService');
const {
  getAvailableFatReportMonths,
  findFatCountByMainAndMonth,
  monthToIndex,
  normalizeMonth,
} = require('./fatMonthlyReportRepository');
const { getTrackFarmSummary } = require('./trackFarmService');

function normalizeText(value) {
  return String(value ?? '').trim();
}

async function getSafeFarmSummary(storageRoot, family, options) {
  try {
    return await getTrackFarmSummary({
      storageRoot,
      familyMembers: family.familyMembers,
      familyNames: family.familyNames,
      period: options.farmPeriod,
      monthLabel: options.farmMonth,
      now: options.now,
    });
  } catch (error) {
    return {
      ok: false,
      errorMessage: normalizeText(error?.message) || 'unknown error',
    };
  }
}

async function getTrackActivitySummary(storageRoot, mainName, requestedMonth = '') {
  try {
    const corporationIds = await listEnabledActivityCorporationIds(storageRoot);
    const availableByCorporation = new Map();
    const allMonths = new Set();
    for (const corporationId of corporationIds) {
      const months = await getAvailableFatReportMonths(storageRoot, corporationId);
      availableByCorporation.set(corporationId, months);
      months.forEach((month) => allMonths.add(month));
    }
    const availableMonths = [...allMonths].sort((left, right) => monthToIndex(right) - monthToIndex(left));
    const requested = normalizeText(requestedMonth);
    const month = requested ? normalizeMonth(requested) : (availableMonths[0] || '');
    if (requested && !month) throw new Error('FAT month must use MM-YYYY.');
    if (requested && !availableMonths.includes(month)) {
      throw new Error(`FAT report ${month} is not stored.`);
    }
    if (!month) {
      return { ok: true, month: '', fatCount: null, sources: [] };
    }

    let fatCount = 0;
    const sources = [];
    for (const corporationId of corporationIds) {
      if (!availableByCorporation.get(corporationId)?.includes(month)) continue;
      const record = await findFatCountByMainAndMonth(storageRoot, corporationId, mainName, month);
      if (!record) continue;
      fatCount += Number(record.fatCount) || 0;
      sources.push({ corporationId, fatCount: Number(record.fatCount) || 0 });
    }
    return { ok: true, month, fatCount, sources };
  } catch (error) {
    return {
      ok: false,
      month: normalizeText(requestedMonth),
      fatCount: null,
      sources: [],
      errorMessage: normalizeText(error?.message) || 'unknown error',
    };
  }
}

async function buildTrackResult(storageRoot, member, context = {}) {
  const family = await buildTrackFamily(storageRoot, member);
  const discordBinding = context.discordBinding
    || await findApprovedBindingByMainName(storageRoot, family.mainName);
  const [farm, activity] = await Promise.all([
    getSafeFarmSummary(storageRoot, family, context),
    getTrackActivitySummary(storageRoot, family.mainName, context.activityMonth),
  ]);
  return {
    found: true,
    query: context.query || member.name,
    searchMode: context.searchMode || 'name',
    member,
    mainName: family.mainName,
    mainMember: family.mainMember,
    alts: family.alts,
    familyMembers: family.familyMembers,
    familyNames: family.familyNames,
    corporationIds: family.corporationIds,
    farm,
    activity,
    discordBinding,
  };
}

async function trackMemberByName(storageRoot, name, options = {}) {
  const cleanName = normalizeText(name);
  if (!cleanName) throw new Error('Member name is required.');
  const member = await findManagedMemberByName(storageRoot, cleanName);
  if (!member) {
    return { found: false, query: cleanName, searchMode: 'name', reason: 'member_not_found' };
  }
  return buildTrackResult(storageRoot, member, {
    query: cleanName,
    searchMode: 'name',
    farmPeriod: options.farmPeriod,
    farmMonth: options.farmMonth,
    activityMonth: options.activityMonth,
    now: options.now,
  });
}

async function trackMemberByDiscordUserId(storageRoot, discordUserId, options = {}) {
  const userId = normalizeText(discordUserId);
  if (!userId) throw new Error('Discord user ID is required.');
  const binding = await findApprovedBindingByDiscordUserId(storageRoot, userId);
  if (!binding) {
    return { found: false, query: userId, searchMode: 'discord', reason: 'binding_not_found' };
  }
  const member = await findManagedMemberByName(storageRoot, binding.mainName);
  if (!member) {
    return {
      found: false,
      query: userId,
      searchMode: 'discord',
      reason: 'member_not_found_for_binding',
      discordBinding: binding,
    };
  }
  const result = await buildTrackResult(storageRoot, member, {
    query: userId,
    searchMode: 'discord',
    discordBinding: binding,
    farmPeriod: options.farmPeriod,
    farmMonth: options.farmMonth,
    activityMonth: options.activityMonth,
    now: options.now,
  });
  if (normalizeKey(result.mainName) !== normalizeKey(binding.mainName)) {
    result.mainName = binding.mainName;
  }
  return result;
}

module.exports = {
  getTrackActivitySummary,
  buildTrackResult,
  trackMemberByName,
  trackMemberByDiscordUserId,
};
