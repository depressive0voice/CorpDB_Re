const ExcelJS = require('exceljs');

const MAX_FAT_SUMMARY_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_HEADER_SCAN_ROWS = 10;
const HEADERLESS_PROBE_ROWS = 25;
const CHARACTER_HEADER_CANDIDATES = [
  'character',
  'персонаж',
  'main',
  'главный персонаж',
  'main character',
];
const FAT_HEADER_CANDIDATES = ['fat', 'fat count', 'сумма fat', 'fat total'];

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeHeader(value) {
  return normalizeText(value).toLowerCase();
}

function getCellText(cell) {
  if (!cell) return '';
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value.text) return normalizeText(value.text);
    if (value.result !== undefined && value.result !== null) return normalizeText(value.result);
    if (Array.isArray(value.richText)) return normalizeText(value.richText.map((part) => part.text || '').join(''));
    if (value.hyperlink) return normalizeText(value.text || value.hyperlink);
  }
  return normalizeText(value);
}

function parseFatNumber(value) {
  const clean = normalizeText(value).replace(/\s+/g, '').replace(',', '.');
  if (!clean) return null;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function findColumnByCandidates(headerCells, candidates) {
  const candidateSet = new Set(candidates.map(normalizeHeader));
  for (const [columnNumber, header] of headerCells.entries()) {
    if (candidateSet.has(normalizeHeader(header))) return columnNumber;
  }
  return 0;
}

function findHeaderTableOnWorksheet(worksheet) {
  if (!worksheet || worksheet.rowCount === 0) return null;
  const maxHeaderRow = Math.min(worksheet.rowCount, MAX_HEADER_SCAN_ROWS);
  for (let rowNumber = 1; rowNumber <= maxHeaderRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const headers = new Map();
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      headers.set(columnNumber, getCellText(cell));
    });
    const characterColumn = findColumnByCandidates(headers, CHARACTER_HEADER_CANDIDATES);
    const fatColumn = findColumnByCandidates(headers, FAT_HEADER_CANDIDATES);
    if (characterColumn && fatColumn) {
      return {
        worksheet,
        firstDataRowNumber: rowNumber + 1,
        characterColumn,
        fatColumn,
        hasHeader: true,
      };
    }
  }
  return null;
}

function hasHeaderlessFatRows(worksheet) {
  if (!worksheet || worksheet.rowCount === 0) return false;
  const maxRow = Math.min(worksheet.rowCount, HEADERLESS_PROBE_ROWS);
  for (let rowNumber = 1; rowNumber <= maxRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const character = getCellText(row.getCell(1));
    const fat = parseFatNumber(getCellText(row.getCell(2)));
    if (character && fat !== null) return true;
  }
  return false;
}

function findFatTables(workbook) {
  const headerTables = workbook.worksheets.map(findHeaderTableOnWorksheet).filter(Boolean);
  if (headerTables.length > 0) return headerTables;
  const headerlessTables = workbook.worksheets
    .filter(hasHeaderlessFatRows)
    .map((worksheet) => ({
      worksheet,
      firstDataRowNumber: 1,
      characterColumn: 1,
      fatColumn: 2,
      hasHeader: false,
    }));
  if (headerlessTables.length > 0) return headerlessTables;
  throw codedError('FAT Summary XLSX has no Character/FAT table.', 'fat_summary_empty');
}

async function parseFatSummaryBuffer(buffer) {
  const safeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (safeBuffer.length === 0) throw codedError('FAT Summary file is empty.', 'fat_summary_empty');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(safeBuffer);
  } catch (error) {
    throw codedError(`Failed to read FAT Summary XLSX: ${error.message || error}`, 'fat_summary_parse_failed');
  }
  const tables = findFatTables(workbook);
  const rows = [];
  const characterCounts = new Map();
  const sheetSummaries = [];
  for (const table of tables) {
    const sheetRows = [];
    for (let rowNumber = table.firstDataRowNumber; rowNumber <= table.worksheet.rowCount; rowNumber += 1) {
      const row = table.worksheet.getRow(rowNumber);
      const character = getCellText(row.getCell(table.characterColumn));
      const fat = parseFatNumber(getCellText(row.getCell(table.fatColumn)));
      if (!character || fat === null) continue;
      const parsedRow = {
        character,
        fat,
        rowNumber,
        worksheetName: table.worksheet.name,
      };
      rows.push(parsedRow);
      sheetRows.push(parsedRow);
      const key = character.toLowerCase();
      const current = characterCounts.get(key) || { character, count: 0, locations: [] };
      current.count += 1;
      current.locations.push(`${table.worksheet.name}!${rowNumber}`);
      characterCounts.set(key, current);
    }
    sheetSummaries.push({
      worksheetName: table.worksheet.name,
      hasHeader: table.hasHeader,
      rowsCount: sheetRows.length,
      totalFat: sheetRows.reduce((sum, row) => sum + row.fat, 0),
    });
  }
  if (rows.length === 0) throw codedError('No valid Character/FAT rows were found.', 'fat_summary_rows_missing');
  const duplicateCharacters = [...characterCounts.values()]
    .filter((item) => item.count > 1)
    .sort((left, right) => left.character.localeCompare(right.character));
  const worksheetNames = sheetSummaries.map((item) => item.worksheetName);
  return {
    worksheetName: worksheetNames[0] || '',
    worksheetNames,
    sheetsCount: worksheetNames.length,
    sheetSummaries,
    hasHeader: sheetSummaries.every((item) => item.hasHeader),
    rows,
    rowsCount: rows.length,
    totalFat: rows.reduce((sum, row) => sum + row.fat, 0),
    duplicateCharacters,
  };
}

async function downloadAttachmentBuffer(attachment, options = {}) {
  const url = normalizeText(attachment?.url);
  if (!url) throw codedError('FAT Summary attachment is missing.', 'fat_summary_attachment_missing');
  const declaredSize = Number(attachment?.size || 0);
  if (declaredSize > MAX_FAT_SUMMARY_FILE_SIZE_BYTES) {
    throw codedError('FAT Summary file exceeds 25 MB.', 'fat_summary_attachment_too_large');
  }
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw codedError(`Failed to download FAT Summary: HTTP ${response.status}.`, 'fat_summary_attachment_download_failed');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_FAT_SUMMARY_FILE_SIZE_BYTES) {
    throw codedError('FAT Summary file exceeds 25 MB.', 'fat_summary_attachment_too_large');
  }
  return buffer;
}

module.exports = {
  MAX_FAT_SUMMARY_FILE_SIZE_BYTES,
  getCellText,
  parseFatNumber,
  findFatTables,
  parseFatSummaryBuffer,
  downloadAttachmentBuffer,
};
