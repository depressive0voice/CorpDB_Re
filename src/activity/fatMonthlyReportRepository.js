const { createStoragePaths, normalizeCorporationId } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');
const { parseMonthLabel } = require('../finance/reportPeriod');

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeMonth(value) {
  const clean = normalizeText(value);
  const direct = parseMonthLabel(clean);
  if (direct) return direct.label;
  const match = clean.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  return match ? `${match[2]}-${match[1]}` : '';
}

function monthToIndex(value) {
  const month = normalizeMonth(value);
  if (!month) return Number.NEGATIVE_INFINITY;
  const [monthNumber, year] = month.split('-').map(Number);
  return year * 12 + monthNumber - 1;
}

function normalizeFatCount(value) {
  const numeric = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function normalizeRecord(corporationId, value = {}) {
  const month = normalizeMonth(value.month);
  const mainName = normalizeText(value.mainName || value.main);
  const fatCount = normalizeFatCount(value.fatCount);
  if (!month || !mainName || fatCount === null) return null;
  return {
    corporationId: normalizeCorporationId(corporationId),
    month,
    mainName,
    fatCount,
    importedAt: normalizeText(value.importedAt),
    sourceFileName: normalizeText(value.sourceFileName),
  };
}

function recordKey(record) {
  return `${record.month}::${normalizeKey(record.mainName)}`;
}

function sortRecords(records) {
  return [...records].sort((left, right) => {
    const monthCompare = monthToIndex(left.month) - monthToIndex(right.month);
    if (monthCompare !== 0) return monthCompare;
    return left.mainName.localeCompare(right.mainName);
  });
}

function createDefaultFatMonthlyReportState(corporationId) {
  return {
    version: 1,
    corporationId: normalizeCorporationId(corporationId),
    records: [],
  };
}

function normalizeFatMonthlyReportState(corporationId, value = {}) {
  const normalizedId = normalizeCorporationId(corporationId);
  const source = Array.isArray(value) ? { records: value } : value;
  const unique = new Map();
  for (const raw of Array.isArray(source?.records) ? source.records : []) {
    const record = normalizeRecord(normalizedId, raw);
    if (record) unique.set(recordKey(record), record);
  }
  return {
    version: 1,
    corporationId: normalizedId,
    records: sortRecords([...unique.values()]),
  };
}

async function readFatMonthlyReportState(storageRoot, corporationId) {
  const normalizedId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const raw = await readJson(paths.activityMonthlyReportsFile(normalizedId), {
    defaultFactory: () => createDefaultFatMonthlyReportState(normalizedId),
  });
  return normalizeFatMonthlyReportState(normalizedId, raw);
}

async function writeFatMonthlyReportState(storageRoot, corporationId, value) {
  const normalizedId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeFatMonthlyReportState(normalizedId, value);
  await writeJsonAtomic(paths.activityMonthlyReportsFile(normalizedId), normalized);
  return normalized;
}

function isClosedMonth(month, now = new Date()) {
  const range = parseMonthLabel(normalizeMonth(month));
  if (!range) return false;
  return range.end.getTime() <= now.getTime();
}

async function replaceClosedFatMonthReports(storageRoot, corporationId, month, rows, options = {}) {
  const normalizedId = normalizeCorporationId(corporationId);
  const normalizedMonth = normalizeMonth(month);
  const now = options.now instanceof Date ? options.now : new Date();
  if (!normalizedMonth) throw new Error('FAT month must use MM-YYYY.');
  if (!isClosedMonth(normalizedMonth, now)) {
    const error = new Error('Only closed FAT months may be persisted. Current-month data is preview-only.');
    error.code = 'activity_month_not_closed';
    throw error;
  }

  const current = await readFatMonthlyReportState(storageRoot, normalizedId);
  const importedAt = normalizeText(options.importedAt) || now.toISOString();
  const sourceFileName = normalizeText(options.sourceFileName);
  const incoming = (Array.isArray(rows) ? rows : [])
    .map((row) => normalizeRecord(normalizedId, {
      month: normalizedMonth,
      mainName: row?.mainName || row?.main,
      fatCount: row?.fatCount,
      importedAt,
      sourceFileName,
    }))
    .filter(Boolean);
  const nextRecords = [
    ...current.records.filter((record) => record.month !== normalizedMonth),
    ...incoming,
  ];
  const saved = await writeFatMonthlyReportState(storageRoot, normalizedId, {
    ...current,
    records: nextRecords,
  });
  return saved.records.filter((record) => record.month === normalizedMonth);
}

async function findFatCountByMainAndMonth(storageRoot, corporationId, mainName, month) {
  const targetMonth = normalizeMonth(month);
  const targetMain = normalizeKey(mainName);
  if (!targetMonth || !targetMain) return null;
  const state = await readFatMonthlyReportState(storageRoot, corporationId);
  return state.records.find((record) =>
    record.month === targetMonth && normalizeKey(record.mainName) === targetMain
  ) || null;
}

async function getAvailableFatReportMonths(storageRoot, corporationId) {
  const state = await readFatMonthlyReportState(storageRoot, corporationId);
  return [...new Set(state.records.map((record) => record.month))]
    .sort((left, right) => monthToIndex(right) - monthToIndex(left));
}

async function getFatMonthSummary(storageRoot, corporationId) {
  const state = await readFatMonthlyReportState(storageRoot, corporationId);
  const summaries = new Map();
  for (const record of state.records) {
    const summary = summaries.get(record.month) || {
      month: record.month,
      mainsCount: 0,
      totalFat: 0,
    };
    summary.mainsCount += 1;
    summary.totalFat += record.fatCount;
    summaries.set(record.month, summary);
  }
  return [...summaries.values()].sort((left, right) => monthToIndex(right.month) - monthToIndex(left.month));
}

module.exports = {
  normalizeMonth,
  monthToIndex,
  normalizeFatCount,
  normalizeRecord,
  createDefaultFatMonthlyReportState,
  normalizeFatMonthlyReportState,
  readFatMonthlyReportState,
  writeFatMonthlyReportState,
  isClosedMonth,
  replaceClosedFatMonthReports,
  findFatCountByMainAndMonth,
  getAvailableFatReportMonths,
  getFatMonthSummary,
};
