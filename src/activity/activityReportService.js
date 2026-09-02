const { readActivityPolicy } = require('./activityPolicyRepository');
const {
  normalizeMonth,
  monthToIndex,
  readFatMonthlyReportState,
  getAvailableFatReportMonths,
} = require('./fatMonthlyReportRepository');
const { buildCurrentCorporationFamilies, normalizeKey } = require('./memberFamilyService');

function normalizeText(value) {
  return String(value ?? '').trim();
}

function monthStartTimestamp(value) {
  const month = normalizeMonth(value);
  if (!month) return Number.NaN;
  const [monthNumber, year] = month.split('-').map(Number);
  return Date.UTC(year, monthNumber - 1, 1);
}

function sortRows(rows) {
  return [...rows].sort((left, right) => {
    if (left.fatCount !== right.fatCount) return left.fatCount - right.fatCount;
    return left.mainName.localeCompare(right.mainName);
  });
}

function selectLookbackMonths(availableMonths, targetMonth, count) {
  const targetIndex = monthToIndex(targetMonth);
  return availableMonths
    .filter((month) => monthToIndex(month) <= targetIndex)
    .slice(0, count);
}

function buildFatRecordMap(records) {
  const map = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    map.set(`${record.month}::${normalizeKey(record.mainName)}`, Number(record.fatCount) || 0);
  }
  return map;
}

async function buildActivityReport(options = {}) {
  const storageRoot = options.storageRoot;
  const corporationId = String(options.corporationId || '').trim();
  const requestedMonth = normalizeText(options.month);
  const rookieKeys = new Set([...(options.rookieMainNames || [])].map(normalizeKey).filter(Boolean));
  const [policy, state, families] = await Promise.all([
    readActivityPolicy(storageRoot, corporationId),
    readFatMonthlyReportState(storageRoot, corporationId),
    buildCurrentCorporationFamilies(storageRoot, corporationId),
  ]);
  const availableMonths = await getAvailableFatReportMonths(storageRoot, corporationId);
  if (availableMonths.length === 0) {
    const error = new Error('No closed FAT reports are stored for this corporation.');
    error.code = 'activity_reports_missing';
    throw error;
  }
  const targetMonth = requestedMonth ? normalizeMonth(requestedMonth) : availableMonths[0];
  if (!targetMonth) {
    const error = new Error('FAT month must use MM-YYYY.');
    error.code = 'activity_month_invalid';
    throw error;
  }
  if (!availableMonths.includes(targetMonth)) {
    const error = new Error(`FAT report ${targetMonth} is not stored for this corporation.`);
    error.code = 'activity_month_not_loaded';
    throw error;
  }

  const lookbackMonths = selectLookbackMonths(
    availableMonths,
    targetMonth,
    Math.max(1, policy.lookbackMonths)
  );
  const recordMap = buildFatRecordMap(state.records);
  const oldestLookbackMonth = lookbackMonths[lookbackMonths.length - 1] || '';
  const oldestLookbackStart = monthStartTimestamp(oldestLookbackMonth);
  const rows = families.map((family) => {
    const history = lookbackMonths.map((month) => ({
      month,
      fatCount: recordMap.get(`${month}::${normalizeKey(family.mainName)}`) || 0,
    }));
    const fatCount = recordMap.get(`${targetMonth}::${normalizeKey(family.mainName)}`) || 0;
    return {
      mainName: family.mainName,
      fatCount,
      history,
      isRookie: rookieKeys.has(normalizeKey(family.mainName)),
      activeCharacters: family.activeMembers.map((member) => member.name).sort(),
      familySize: family.activeMembers.length,
      corporationJoinDate: family.corporationJoinDate,
      hasFullLookbackTenure: Boolean(family.corporationJoinDate)
        && Number.isFinite(oldestLookbackStart)
        && Date.parse(family.corporationJoinDate) <= oldestLookbackStart,
    };
  });

  const minimumFat = policy.minimumFat;
  const compliant = sortRows(rows.filter((row) => row.fatCount >= minimumFat));
  const low = sortRows(rows.filter((row) => row.fatCount > 0 && row.fatCount < minimumFat));
  const zero = sortRows(rows.filter((row) => row.fatCount <= 0));
  const problem = sortRows(rows.filter((row) => row.fatCount < minimumFat));
  const lookbackIneligible = sortRows(rows.filter((row) => !row.hasFullLookbackTenure));
  const chronic = lookbackMonths.length >= policy.lookbackMonths
    ? sortRows(rows.filter((row) =>
      row.hasFullLookbackTenure
      && row.history.length >= policy.lookbackMonths
      && row.history.every((entry) => entry.fatCount < minimumFat)))
    : [];
  const rookies = rows.filter((row) => row.isRookie);

  return {
    corporationId,
    targetMonth,
    availableMonths,
    lookbackMonths,
    minimumFat,
    lookbackCount: policy.lookbackMonths,
    hasCompleteLookback: lookbackMonths.length >= policy.lookbackMonths,
    familiesCount: rows.length,
    rows: sortRows(rows),
    compliant,
    low,
    zero,
    problem,
    chronic,
    lookbackIneligible,
    rookies: {
      all: sortRows(rookies),
      compliant: sortRows(rookies.filter((row) => row.fatCount >= minimumFat)),
      low: sortRows(rookies.filter((row) => row.fatCount > 0 && row.fatCount < minimumFat)),
      zero: sortRows(rookies.filter((row) => row.fatCount <= 0)),
      problem: sortRows(rookies.filter((row) => row.fatCount < minimumFat)),
    },
  };
}

module.exports = {
  monthStartTimestamp,
  sortRows,
  selectLookbackMonths,
  buildFatRecordMap,
  getAvailableFatReportMonths,
  buildActivityReport,
};
