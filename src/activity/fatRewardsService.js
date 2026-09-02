const ExcelJS = require('exceljs');
const { parseMonthLabel } = require('../finance/reportPeriod');
const {
  saveFatSummaryBuffer,
  readLatestFatSummaryBuffer,
  readFatSummaryState,
  updateFatSummaryReminderConfig,
  DEFAULT_REMINDER_AFTER_DAYS,
} = require('./fatSummaryRepository');
const { downloadAttachmentBuffer, parseFatSummaryBuffer } = require('./fatWorkbookService');
const { buildCorporationFatAggregation } = require('./fatImportService');
const { replaceClosedFatMonthReports, normalizeMonth } = require('./fatMonthlyReportRepository');

const PAYOUT_RULES = Object.freeze({
  soloMultiplier: 1.0,
  multiboxMultiplier: 1.5,
  allianceMinimumFat: 3,
  payoutMinimumFat: 10,
  fullRateUntilFat: 50,
  secondRateUntilFat: 60,
  thirdRateUntilFat: 70,
  fullRate: 1.0,
  secondRate: 0.8,
  thirdRate: 0.6,
  overflowRate: 0.4,
});

const REPORT_LABELS = Object.freeze({
  multiSheet: 'Мультибокс',
  soloSheet: 'Соло',
  badSheet: 'FAT < 3 (проблемные)',
  main: 'Главный персонаж',
  fatSum: 'Сумма FAT',
  weight: 'Вес',
  share: 'Доля',
  payout: 'Выплата',
  total: 'Итого',
  solo: 'Соло',
  multi: 'Мультибокс',
});

const ISK_FORMAT = '#,##0 "ISK"';
const WEIGHT_FORMAT = '0.00';
const PCT_FORMAT = '0.00%';
const TEMPLATE_WIDTHS_5 = [22.71, 16.71, 18.71, 9.71, 22.71];
const TEMPLATE_WIDTHS_2 = [22.71, 16.71];

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeRules(value = PAYOUT_RULES) {
  const fields = Object.keys(PAYOUT_RULES);
  const result = {};
  for (const field of fields) {
    const number = Number(value?.[field]);
    if (!Number.isFinite(number)) throw codedError(`Invalid payout rule: ${field}.`, 'fat_payout_rules_invalid');
    result[field] = number;
  }
  return result;
}

function basePointsRegressive(fatValue, rawRules = PAYOUT_RULES) {
  const rules = normalizeRules(rawRules);
  const fat = Math.max(Number(fatValue) || 0, 0);
  if (fat < rules.payoutMinimumFat) return 0;
  return (
    Math.min(fat, rules.fullRateUntilFat) * rules.fullRate
    + Math.max(Math.min(fat - rules.fullRateUntilFat, rules.secondRateUntilFat - rules.fullRateUntilFat), 0) * rules.secondRate
    + Math.max(Math.min(fat - rules.secondRateUntilFat, rules.thirdRateUntilFat - rules.secondRateUntilFat), 0) * rules.thirdRate
    + Math.max(fat - rules.thirdRateUntilFat, 0) * rules.overflowRate
  );
}

function buildPayoutRows(aggregation, rawRules, budgetValue) {
  const rules = normalizeRules(rawRules);
  const budget = Number(budgetValue);
  if (!Number.isFinite(budget) || budget <= 0) {
    throw codedError('FAT payout budget must be greater than zero.', 'fat_payout_budget_invalid');
  }
  const summary = aggregation.rows.map((row) => {
    const mainKey = normalizeText(row.mainName).toLowerCase();
    const type = aggregation.familyContext.hasAlts.get(mainKey) && Number(row.altsFat || 0) > 0
      ? REPORT_LABELS.multi
      : REPORT_LABELS.solo;
    const multiplier = type === REPORT_LABELS.multi ? rules.multiboxMultiplier : rules.soloMultiplier;
    return {
      main: row.mainName,
      fat: Number(row.fatCount || 0),
      altsFat: Number(row.altsFat || 0),
      type,
      weight: basePointsRegressive(row.fatCount, rules) * multiplier,
      share: 0,
      payout: 0,
    };
  });
  const eligibleForAlliance = summary.filter((row) => row.fat >= rules.allianceMinimumFat);
  const totalPoints = eligibleForAlliance.reduce((sum, row) => sum + row.weight, 0);
  if (totalPoints > 0) {
    for (const row of eligibleForAlliance) {
      row.share = row.weight / totalPoints;
      row.payout = budget * row.share;
    }
  }
  summary.sort((left, right) => right.payout - left.payout || left.main.localeCompare(right.main));
  return {
    multiRows: summary.filter((row) => row.type === REPORT_LABELS.multi && row.fat >= rules.allianceMinimumFat),
    soloRows: summary.filter((row) => row.type === REPORT_LABELS.solo && row.fat >= rules.allianceMinimumFat),
    badRows: summary.filter((row) => row.fat < rules.allianceMinimumFat),
    totalPoints,
    distributedAmount: summary.reduce((sum, row) => sum + row.payout, 0),
    recipientsCount: summary.filter((row) => row.payout > 0).length,
  };
}

function applyCellBaseStyle(cell) {
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  cell.border = {
    left: { style: 'thin', color: { argb: 'FF000000' } },
    right: { style: 'thin', color: { argb: 'FF000000' } },
    top: { style: 'thin', color: { argb: 'FF000000' } },
    bottom: { style: 'thin', color: { argb: 'FF000000' } },
  };
}

function styleWorksheetRange(worksheet, minRow, maxRow, minColumn, maxColumn) {
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      applyCellBaseStyle(worksheet.getCell(row, column));
    }
  }
}

function applyTemplateLayout(worksheet, widths, dataLastRow, totalRow = 0) {
  widths.forEach((width, index) => { worksheet.getColumn(index + 1).width = width; });
  styleWorksheetRange(worksheet, 1, worksheet.rowCount, 1, widths.length);
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(dataLastRow, 1), column: widths.length },
  };
  if (totalRow) {
    for (let column = 1; column <= widths.length; column += 1) {
      worksheet.getCell(totalRow, column).font = { name: 'Calibri', size: 11, bold: false };
    }
  }
}

function addValueColoring(worksheet, dataLastRow, fatColumn, lastColumn) {
  for (let rowNumber = 2; rowNumber <= dataLastRow; rowNumber += 1) {
    const fat = Number(worksheet.getCell(rowNumber, fatColumn).value);
    const color = fat < 3 ? 'FFF4CCCC' : fat < 10 ? 'FFFFF2CC' : '';
    if (!color) continue;
    for (let column = 1; column <= lastColumn; column += 1) {
      worksheet.getCell(rowNumber, column).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: color },
      };
    }
  }
}

function fillPayoutSheet(worksheet, rows) {
  worksheet.addRow([REPORT_LABELS.main, REPORT_LABELS.fatSum, REPORT_LABELS.weight, REPORT_LABELS.share, REPORT_LABELS.payout]);
  for (const row of rows) worksheet.addRow([row.main, row.fat, row.weight, row.share, row.payout]);
  const dataLastRow = worksheet.rowCount;
  for (let row = 2; row <= dataLastRow; row += 1) {
    worksheet.getCell(row, 2).numFmt = '0';
    worksheet.getCell(row, 3).numFmt = WEIGHT_FORMAT;
    worksheet.getCell(row, 4).numFmt = PCT_FORMAT;
    worksheet.getCell(row, 5).numFmt = ISK_FORMAT;
  }
  const totalRow = worksheet.rowCount + 1;
  worksheet.getCell(totalRow, 4).value = REPORT_LABELS.total;
  worksheet.getCell(totalRow, 5).value = { formula: `SUM(E2:E${totalRow - 1})` };
  worksheet.getCell(totalRow, 5).numFmt = ISK_FORMAT;
  applyTemplateLayout(worksheet, TEMPLATE_WIDTHS_5, dataLastRow, totalRow);
  addValueColoring(worksheet, dataLastRow, 2, 5);
}

function fillBadSheet(worksheet, rows) {
  worksheet.addRow([REPORT_LABELS.main, REPORT_LABELS.fatSum]);
  for (const row of rows) worksheet.addRow([row.main, row.fat]);
  const dataLastRow = worksheet.rowCount;
  for (let row = 2; row <= dataLastRow; row += 1) worksheet.getCell(row, 2).numFmt = '0';
  applyTemplateLayout(worksheet, TEMPLATE_WIDTHS_2, dataLastRow);
  addValueColoring(worksheet, dataLastRow, 2, 2);
}

async function buildPayoutWorkbook(report) {
  const workbook = new ExcelJS.Workbook();
  fillPayoutSheet(workbook.addWorksheet(REPORT_LABELS.multiSheet), report.multiRows);
  fillPayoutSheet(workbook.addWorksheet(REPORT_LABELS.soloSheet), report.soloRows);
  fillBadSheet(workbook.addWorksheet(REPORT_LABELS.badSheet), report.badRows);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function validateClosedFatMonth(monthValue, sourceUploadedAt, now = new Date()) {
  const month = normalizeMonth(monthValue);
  const range = parseMonthLabel(month);
  if (!range) throw codedError('FAT month must use MM-YYYY.', 'fat_month_invalid');
  if (now.getTime() < range.end.getTime()) {
    throw codedError(`FAT month ${range.label} is not closed yet in EVE Time (UTC).`, 'fat_month_not_closed');
  }
  const uploadedAt = Date.parse(normalizeText(sourceUploadedAt));
  if (!Number.isFinite(uploadedAt)) {
    throw codedError('FAT Summary upload timestamp is missing.', 'fat_summary_upload_date_missing');
  }
  if (uploadedAt < range.end.getTime()) {
    throw codedError(
      `FAT Summary for ${range.label} was uploaded before that month closed. Upload the final file again.`,
      'fat_summary_uploaded_before_month_end'
    );
  }
  return { month: range.label, monthClosedAt: range.end.toISOString(), checkedAt: now.toISOString() };
}

async function importFatSummaryFromAttachment(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const closure = validateClosedFatMonth(options.month, now.toISOString(), now);
  const buffer = await downloadAttachmentBuffer(options.attachment, { fetchImpl: options.fetchImpl });
  const parsed = await parseFatSummaryBuffer(buffer);
  const saved = await saveFatSummaryBuffer(options.storageRoot, options.corporationId, {
    buffer,
    reportMonth: closure.month,
    sourceFileName: options.attachment?.name || '',
    uploadedByUserId: options.uploadedByUserId,
    uploadedByTag: options.uploadedByTag,
    reminderChannelId: options.reminderChannelId,
    now,
  });
  return { ...parsed, ...saved, reportMonth: closure.month, monthClosedAt: closure.monthClosedAt };
}

async function calculateFatPayoutReport(options = {}) {
  const storageRoot = options.storageRoot;
  const corporationId = String(options.corporationId || '').trim();
  const now = options.now instanceof Date ? options.now : new Date();
  const latest = await readLatestFatSummaryBuffer(storageRoot, corporationId);
  if (!latest.buffer) {
    throw codedError('FAT Summary has not been imported yet. Use /fat-rewards import.', 'fat_summary_not_imported');
  }
  const closure = validateClosedFatMonth(options.month, latest.state.uploadedAt, now);
  if (!latest.state.reportMonth) {
    throw codedError('Stored FAT Summary has no report month. Import it again.', 'fat_summary_report_month_missing');
  }
  if (latest.state.reportMonth !== closure.month) {
    throw codedError(
      `Stored FAT Summary is for ${latest.state.reportMonth}, but calculation requested ${closure.month}.`,
      'fat_summary_report_month_mismatch'
    );
  }
  const parsed = await parseFatSummaryBuffer(latest.buffer);
  const aggregation = await buildCorporationFatAggregation(storageRoot, corporationId, parsed);
  const report = buildPayoutRows(aggregation, options.rules || PAYOUT_RULES, options.budget);
  const content = await buildPayoutWorkbook(report);
  const savedActivityRows = await replaceClosedFatMonthReports(
    storageRoot,
    corporationId,
    closure.month,
    aggregation.rows,
    {
      now,
      importedAt: closure.checkedAt,
      sourceFileName: latest.state.sourceFileName || latest.state.latestFileName,
    }
  );
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return {
    ok: true,
    corporationId,
    fileName: `fat-payout-${timestamp}.xlsx`,
    content,
    budget: Number(options.budget),
    month: closure.month,
    monthClosedAt: closure.monthClosedAt,
    activityImportedAt: closure.checkedAt,
    activityRowsCount: savedActivityRows.length,
    activityTotalFat: aggregation.activityTotalFat,
    sourceRowsCount: parsed.rowsCount,
    sourceTotalFat: aggregation.sourceTotalFat,
    sourceState: latest.state,
    worksheetNames: parsed.worksheetNames,
    sheetsCount: parsed.sheetsCount,
    sheetSummaries: parsed.sheetSummaries,
    duplicateCharacters: parsed.duplicateCharacters,
    currentFamiliesCount: aggregation.families.length,
    multiCount: report.multiRows.length,
    soloCount: report.soloRows.length,
    badCount: report.badRows.length,
    zeroFatMainsCount: aggregation.rows.filter((row) => row.fatCount === 0).length,
    recipientsCount: report.recipientsCount,
    totalPoints: report.totalPoints,
    distributedAmount: report.distributedAmount,
  };
}

function getAgeDays(dateValue, now = new Date()) {
  const timestamp = Date.parse(normalizeText(dateValue));
  return Number.isFinite(timestamp) ? Math.max(0, (now.getTime() - timestamp) / 86400000) : null;
}

async function getFatSummaryStatus(storageRoot, corporationId, now = new Date()) {
  const state = await readFatSummaryState(storageRoot, corporationId);
  return {
    ...state,
    ageDays: getAgeDays(state.uploadedAt, now),
    reminderAfterDays: state.reminderAfterDays || DEFAULT_REMINDER_AFTER_DAYS,
  };
}

async function configureFatSummaryReminder(storageRoot, corporationId, options) {
  return updateFatSummaryReminderConfig(storageRoot, corporationId, options);
}

module.exports = {
  PAYOUT_RULES,
  REPORT_LABELS,
  normalizeRules,
  basePointsRegressive,
  buildPayoutRows,
  buildPayoutWorkbook,
  validateClosedFatMonth,
  importFatSummaryFromAttachment,
  calculateFatPayoutReport,
  getAgeDays,
  getFatSummaryStatus,
  configureFatSummaryReminder,
};
