const { createStoragePaths } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

const DEFAULT_TIMEOUT_DAYS = 7;
const DEFAULT_CHECK_INTERVAL_MINUTES = 60;

function normalizeRoleId(value) {
  return String(value || '').trim();
}

function uniqueRoleIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(normalizeRoleId).filter(Boolean))];
}

function normalizeInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function createDefaultRoleExpiryConfig() {
  return {
    version: 1,
    triggerRoleId: '',
    qualifyingRoleIds: [],
    timeoutDays: DEFAULT_TIMEOUT_DAYS,
    checkIntervalMinutes: DEFAULT_CHECK_INTERVAL_MINUTES,
    logChannelId: '',
  };
}

function normalizeRoleExpiryConfig(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const triggerRoleId = normalizeRoleId(source.triggerRoleId);
  return {
    version: 1,
    triggerRoleId,
    qualifyingRoleIds: uniqueRoleIds(source.qualifyingRoleIds).filter((roleId) => roleId !== triggerRoleId),
    timeoutDays: normalizeInteger(source.timeoutDays, DEFAULT_TIMEOUT_DAYS, 1, 3650),
    checkIntervalMinutes: normalizeInteger(
      source.checkIntervalMinutes,
      DEFAULT_CHECK_INTERVAL_MINUTES,
      5,
      1440
    ),
    logChannelId: normalizeRoleId(source.logChannelId),
  };
}

async function readRoleExpiryConfig(storageRoot) {
  const paths = createStoragePaths(storageRoot);
  const raw = await readJson(paths.roleExpiryConfigFile, { defaultFactory: createDefaultRoleExpiryConfig });
  return normalizeRoleExpiryConfig(raw);
}

async function writeRoleExpiryConfig(storageRoot, value) {
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeRoleExpiryConfig(value);
  await writeJsonAtomic(paths.roleExpiryConfigFile, normalized);
  return normalized;
}

async function updateRoleExpiryConfig(storageRoot, patch = {}) {
  const current = await readRoleExpiryConfig(storageRoot);
  return writeRoleExpiryConfig(storageRoot, { ...current, ...patch });
}

async function addQualifyingRole(storageRoot, roleId) {
  const current = await readRoleExpiryConfig(storageRoot);
  const normalizedRoleId = normalizeRoleId(roleId);
  if (!normalizedRoleId) throw new Error('Qualifying role is required.');
  if (normalizedRoleId === current.triggerRoleId) {
    const error = new Error('The trigger role cannot also be a qualifying role.');
    error.code = 'role_expiry_role_conflict';
    throw error;
  }
  return writeRoleExpiryConfig(storageRoot, {
    ...current,
    qualifyingRoleIds: [...current.qualifyingRoleIds, normalizedRoleId],
  });
}

async function removeQualifyingRole(storageRoot, roleId) {
  const current = await readRoleExpiryConfig(storageRoot);
  const normalizedRoleId = normalizeRoleId(roleId);
  return writeRoleExpiryConfig(storageRoot, {
    ...current,
    qualifyingRoleIds: current.qualifyingRoleIds.filter((candidate) => candidate !== normalizedRoleId),
  });
}

function isRoleExpiryConfigured(config) {
  return Boolean(config?.triggerRoleId && Array.isArray(config?.qualifyingRoleIds) && config.qualifyingRoleIds.length > 0);
}

module.exports = {
  DEFAULT_TIMEOUT_DAYS,
  DEFAULT_CHECK_INTERVAL_MINUTES,
  createDefaultRoleExpiryConfig,
  normalizeRoleExpiryConfig,
  readRoleExpiryConfig,
  writeRoleExpiryConfig,
  updateRoleExpiryConfig,
  addQualifyingRole,
  removeQualifyingRole,
  isRoleExpiryConfigured,
};
