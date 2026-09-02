const { formatMonthLabelFromDate } = require('../finance/reportPeriod');
const {
  normalizeMonth,
  isClosedMonth,
  replaceClosedFatMonthReports,
} = require('./fatMonthlyReportRepository');
const { buildCurrentCorporationFamilies, normalizeKey } = require('./memberFamilyService');
const { downloadAttachmentBuffer, parseFatSummaryBuffer } = require('./fatWorkbookService');

const TOTAL_EPSILON = 1e-9;
const ERROR_PREVIEW_LIMIT = 10;

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function formatPreview(items) {
  const safe = Array.isArray(items) ? items : [];
  const preview = safe.slice(0, ERROR_PREVIEW_LIMIT).join(', ');
  return safe.length > ERROR_PREVIEW_LIMIT
    ? `${preview} and ${safe.length - ERROR_PREVIEW_LIMIT} more`
    : preview;
}

function validateParsedFatRows(parsed) {
  const duplicates = Array.isArray(parsed?.duplicateCharacters) ? parsed.duplicateCharacters : [];
  if (duplicates.length > 0) {
    throw codedError(
      `FAT Summary contains duplicate characters: ${formatPreview(duplicates.map((item) => `${item.character} x${item.count}`))}.`,
      'fat_summary_duplicates_detected'
    );
  }
  const invalid = (Array.isArray(parsed?.rows) ? parsed.rows : [])
    .filter((row) => !Number.isInteger(Number(row?.fat)) || Number(row?.fat) < 0)
    .map((row) => `${normalizeText(row?.character) || '<unnamed>'}=${row?.fat}`);
  if (invalid.length > 0) {
    throw codedError(
      `FAT Summary contains negative or non-integer FAT values: ${formatPreview(invalid)}.`,
      'fat_summary_invalid_fat_values'
    );
  }
}

function buildFamilyContext(families) {
  const mapping = new Map();
  const hasAlts = new Map();
  const mainNames = new Map();
  for (const family of Array.isArray(families) ? families : []) {
    const mainName = normalizeText(family?.mainName);
    if (!mainName) continue;
    const mainKey = normalizeKey(mainName);
    mainNames.set(mainKey, mainName);
    const members = Array.isArray(family?.activeMembers) ? family.activeMembers : [];
    hasAlts.set(mainKey, members.some((member) => normalizeKey(member?.name) !== mainKey));
    mapping.set(mainKey, mainName);
    for (const member of members) {
      const key = normalizeKey(member?.name);
      if (key) mapping.set(key, mainName);
    }
  }
  return { mapping, hasAlts, mainNames };
}

function aggregateFatByMain(parsed, familyContext) {
  validateParsedFatRows(parsed);
  const unmatched = [];
  const summary = new Map();
  for (const row of Array.isArray(parsed?.rows) ? parsed.rows : []) {
    const character = normalizeText(row?.character);
    const key = normalizeKey(character);
    const mainName = familyContext.mapping.get(key);
    if (!mainName) {
      unmatched.push(character);
      continue;
    }
    const mainKey = normalizeKey(mainName);
    const current = summary.get(mainKey) || {
      mainName,
      fatCount: 0,
      altsFat: 0,
    };
    const fat = Number(row.fat);
    current.fatCount += fat;
    if (key !== mainKey) current.altsFat += fat;
    summary.set(mainKey, current);
  }
  if (unmatched.length > 0) {
    throw codedError(
      `Not all FAT Summary characters are active members of the selected corporation: ${formatPreview([...new Set(unmatched)].sort())}.`,
      'fat_activity_unmatched_characters'
    );
  }
  for (const [mainKey, mainName] of familyContext.mainNames.entries()) {
    if (!summary.has(mainKey)) {
      summary.set(mainKey, { mainName, fatCount: 0, altsFat: 0 });
    }
  }
  const rows = [...summary.values()].sort((left, right) => left.mainName.localeCompare(right.mainName));
  const sourceTotalFat = (parsed.rows || []).reduce((sum, row) => sum + Number(row.fat || 0), 0);
  const activityTotalFat = rows.reduce((sum, row) => sum + row.fatCount, 0);
  if (Math.abs(sourceTotalFat - activityTotalFat) > TOTAL_EPSILON) {
    throw codedError(
      `FAT checksum mismatch: source=${sourceTotalFat}, Activity=${activityTotalFat}.`,
      'fat_activity_total_mismatch'
    );
  }
  return { rows, sourceTotalFat, activityTotalFat };
}

async function buildCorporationFatAggregation(storageRoot, corporationId, parsed) {
  const families = await buildCurrentCorporationFamilies(storageRoot, corporationId);
  const familyContext = buildFamilyContext(families);
  const aggregate = aggregateFatByMain(parsed, familyContext);
  return { families, familyContext, ...aggregate };
}

function resolveImportMode(month, now = new Date()) {
  const normalizedMonth = normalizeMonth(month);
  if (!normalizedMonth) throw codedError('FAT month must use MM-YYYY.', 'fat_month_invalid');
  if (isClosedMonth(normalizedMonth, now)) return { month: normalizedMonth, mode: 'persisted' };
  const currentMonth = formatMonthLabelFromDate(now);
  if (normalizedMonth === currentMonth) return { month: normalizedMonth, mode: 'preview' };
  throw codedError(
    `FAT month ${normalizedMonth} is in the future. Only a closed month or the current month can be imported.`,
    'fat_month_future'
  );
}

async function importFatActivityBuffer(options = {}) {
  const storageRoot = options.storageRoot;
  const corporationId = String(options.corporationId || '').trim();
  const now = options.now instanceof Date ? options.now : new Date();
  const { month, mode } = resolveImportMode(options.month, now);
  const parsed = await parseFatSummaryBuffer(options.buffer);
  const aggregation = await buildCorporationFatAggregation(storageRoot, corporationId, parsed);
  let savedRows = [];
  if (mode === 'persisted') {
    savedRows = await replaceClosedFatMonthReports(
      storageRoot,
      corporationId,
      month,
      aggregation.rows,
      {
        now,
        importedAt: now.toISOString(),
        sourceFileName: normalizeText(options.sourceFileName),
      }
    );
  }
  return {
    corporationId,
    month,
    mode,
    parsed,
    rows: aggregation.rows,
    rowsCount: aggregation.rows.length,
    sourceTotalFat: aggregation.sourceTotalFat,
    activityTotalFat: aggregation.activityTotalFat,
    savedRowsCount: savedRows.length,
    currentFamiliesCount: aggregation.families.length,
  };
}

async function importFatActivityFromAttachment(options = {}) {
  const buffer = await downloadAttachmentBuffer(options.attachment, { fetchImpl: options.fetchImpl });
  return importFatActivityBuffer({
    ...options,
    buffer,
    sourceFileName: options.attachment?.name || '',
  });
}

module.exports = {
  validateParsedFatRows,
  buildFamilyContext,
  aggregateFatByMain,
  buildCorporationFatAggregation,
  resolveImportMode,
  importFatActivityBuffer,
  importFatActivityFromAttachment,
};
