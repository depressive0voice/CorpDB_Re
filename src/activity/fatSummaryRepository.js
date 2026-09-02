const fs = require('fs/promises');
const path = require('path');
const { createStoragePaths, normalizeCorporationId } = require('../storage/paths');
const { readJson, writeJsonAtomic, ensureParentDir } = require('../storage/jsonFileStore');
const { normalizeMonth } = require('./fatMonthlyReportRepository');

const DEFAULT_REMINDER_AFTER_DAYS = 31;

function normalizeText(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createDefaultFatSummaryState(corporationId) {
  return {
    version: 1,
    corporationId: normalizeCorporationId(corporationId),
    latestFileName: '',
    latestFilePath: '',
    sourceFileName: '',
    reportMonth: '',
    uploadedAt: '',
    uploadedByUserId: '',
    uploadedByTag: '',
    reminderChannelId: '',
    reminderAfterDays: DEFAULT_REMINDER_AFTER_DAYS,
    lastReminderAt: '',
    lastReminderForUploadedAt: '',
  };
}

function normalizeFatSummaryState(corporationId, value = {}) {
  const normalizedId = normalizeCorporationId(corporationId);
  const defaults = createDefaultFatSummaryState(normalizedId);
  return {
    version: 1,
    corporationId: normalizedId,
    latestFileName: normalizeText(value.latestFileName),
    latestFilePath: normalizeText(value.latestFilePath),
    sourceFileName: normalizeText(value.sourceFileName),
    reportMonth: normalizeMonth(value.reportMonth),
    uploadedAt: normalizeText(value.uploadedAt),
    uploadedByUserId: normalizeText(value.uploadedByUserId),
    uploadedByTag: normalizeText(value.uploadedByTag),
    reminderChannelId: normalizeText(value.reminderChannelId),
    reminderAfterDays: positiveInteger(value.reminderAfterDays, defaults.reminderAfterDays),
    lastReminderAt: normalizeText(value.lastReminderAt),
    lastReminderForUploadedAt: normalizeText(value.lastReminderForUploadedAt),
  };
}

async function readFatSummaryState(storageRoot, corporationId) {
  const normalizedId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const raw = await readJson(paths.fatSummaryStateFile(normalizedId), {
    defaultFactory: () => createDefaultFatSummaryState(normalizedId),
  });
  return normalizeFatSummaryState(normalizedId, raw);
}

async function writeFatSummaryState(storageRoot, corporationId, value) {
  const normalizedId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeFatSummaryState(normalizedId, value);
  await writeJsonAtomic(paths.fatSummaryStateFile(normalizedId), normalized);
  return normalized;
}

async function writeBufferAtomic(filePath, buffer) {
  await ensureParentDir(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tempPath, buffer);
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => null);
    throw error;
  }
}

function buildFatSummaryFileName(month) {
  const normalized = normalizeMonth(month);
  if (!normalized) throw new Error('FAT Summary month must use MM-YYYY.');
  return `${normalized}.xlsx`;
}

function resolveFatSummaryPath(storageRoot, corporationId, relativePath) {
  const normalizedId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const activityRoot = path.resolve(paths.activityDir(normalizedId));
  const resolved = path.resolve(activityRoot, normalizeText(relativePath));
  if (resolved !== activityRoot && !resolved.startsWith(`${activityRoot}${path.sep}`)) {
    const error = new Error('Invalid FAT Summary storage path.');
    error.code = 'fat_summary_path_invalid';
    throw error;
  }
  return resolved;
}

async function saveFatSummaryBuffer(storageRoot, corporationId, options = {}) {
  const normalizedId = normalizeCorporationId(corporationId);
  const buffer = Buffer.isBuffer(options.buffer) ? options.buffer : Buffer.from(options.buffer || []);
  if (buffer.length === 0) throw new Error('FAT Summary buffer is empty.');
  const reportMonth = normalizeMonth(options.reportMonth);
  if (!reportMonth) throw new Error('FAT Summary month must use MM-YYYY.');
  const paths = createStoragePaths(storageRoot);
  const fileName = buildFatSummaryFileName(reportMonth);
  const absolutePath = path.join(paths.fatSummaryDir(normalizedId), fileName);
  const relativePath = path.relative(paths.activityDir(normalizedId), absolutePath).replace(/\\/g, '/');
  const previous = await readFatSummaryState(storageRoot, normalizedId);
  const now = options.now instanceof Date ? options.now : new Date();
  await writeBufferAtomic(absolutePath, buffer);
  const state = await writeFatSummaryState(storageRoot, normalizedId, {
    ...previous,
    latestFileName: fileName,
    latestFilePath: relativePath,
    sourceFileName: normalizeText(options.sourceFileName),
    reportMonth,
    uploadedAt: now.toISOString(),
    uploadedByUserId: normalizeText(options.uploadedByUserId),
    uploadedByTag: normalizeText(options.uploadedByTag),
    reminderChannelId: previous.reminderChannelId || normalizeText(options.reminderChannelId),
    reminderAfterDays: previous.uploadedAt
      ? previous.reminderAfterDays
      : positiveInteger(options.reminderAfterDays, DEFAULT_REMINDER_AFTER_DAYS),
    lastReminderAt: '',
    lastReminderForUploadedAt: '',
  });
  return { state, fileName, relativePath, absolutePath, size: buffer.length };
}

async function readLatestFatSummaryBuffer(storageRoot, corporationId) {
  const state = await readFatSummaryState(storageRoot, corporationId);
  if (!state.latestFilePath) return { state, buffer: null, absolutePath: '' };
  const absolutePath = resolveFatSummaryPath(storageRoot, corporationId, state.latestFilePath);
  const buffer = await fs.readFile(absolutePath);
  return { state, buffer, absolutePath };
}

async function updateFatSummaryReminderConfig(storageRoot, corporationId, options = {}) {
  const state = await readFatSummaryState(storageRoot, corporationId);
  return writeFatSummaryState(storageRoot, corporationId, {
    ...state,
    reminderChannelId: Object.prototype.hasOwnProperty.call(options, 'channelId')
      ? normalizeText(options.channelId)
      : state.reminderChannelId,
    reminderAfterDays: Object.prototype.hasOwnProperty.call(options, 'reminderAfterDays')
      ? positiveInteger(options.reminderAfterDays, state.reminderAfterDays || DEFAULT_REMINDER_AFTER_DAYS)
      : state.reminderAfterDays,
  });
}

async function markFatSummaryReminderSent(storageRoot, corporationId, uploadedAt, sentAt) {
  const state = await readFatSummaryState(storageRoot, corporationId);
  return writeFatSummaryState(storageRoot, corporationId, {
    ...state,
    lastReminderAt: normalizeText(sentAt) || new Date().toISOString(),
    lastReminderForUploadedAt: normalizeText(uploadedAt),
  });
}

module.exports = {
  DEFAULT_REMINDER_AFTER_DAYS,
  createDefaultFatSummaryState,
  normalizeFatSummaryState,
  readFatSummaryState,
  writeFatSummaryState,
  buildFatSummaryFileName,
  saveFatSummaryBuffer,
  readLatestFatSummaryBuffer,
  updateFatSummaryReminderConfig,
  markFatSummaryReminderSent,
};
