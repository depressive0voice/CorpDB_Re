const { createStoragePaths } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

const ACCESS_LEVELS = Object.freeze({
  USER: 'user',
  ADMIN: 'admin',
  MAIN_ADMIN: 'main-admin',
  // Backward-compatible code alias. Persisted/user-facing value is main-admin.
  MASTER_ADMIN: 'main-admin',
});

const COMMAND_ACCESS_DEFAULTS = Object.freeze({
  settings: ACCESS_LEVELS.USER,
  access: ACCESS_LEVELS.USER,
  'request-main': ACCESS_LEVELS.USER,
  members: ACCESS_LEVELS.USER,

  track: ACCESS_LEVELS.ADMIN,
  'fat-rewards': ACCESS_LEVELS.ADMIN,
  blacklist: ACCESS_LEVELS.ADMIN,
  auth: ACCESS_LEVELS.ADMIN,
  finance: ACCESS_LEVELS.ADMIN,
  applications: ACCESS_LEVELS.ADMIN,
  'structure-fuel': ACCESS_LEVELS.ADMIN,
  'binding-admin': ACCESS_LEVELS.ADMIN,
  promote: ACCESS_LEVELS.ADMIN,
  admin: ACCESS_LEVELS.ADMIN,

  system: ACCESS_LEVELS.MAIN_ADMIN,
});

const SETTABLE_COMMAND_NAMES = Object.freeze(
  Object.keys(COMMAND_ACCESS_DEFAULTS).filter((commandName) => commandName !== 'access')
);

const ACCESS_LEVEL_ALIASES = Object.freeze({
  [ACCESS_LEVELS.USER]: ACCESS_LEVELS.USER,
  [ACCESS_LEVELS.ADMIN]: ACCESS_LEVELS.ADMIN,
  [ACCESS_LEVELS.MAIN_ADMIN]: ACCESS_LEVELS.MAIN_ADMIN,
  'master-admin': ACCESS_LEVELS.MAIN_ADMIN,
  member: ACCESS_LEVELS.USER,
  owner: ACCESS_LEVELS.MAIN_ADMIN,
});

function createDefaultAccessConfig() {
  return {
    version: 1,
    adminRoleIds: [],
    adminUserIds: [],
    commandLevels: { ...COMMAND_ACCESS_DEFAULTS },
    userCommandAllow: {},
    userCommandDeny: {},
    defaultCommandLevel: ACCESS_LEVELS.USER,
  };
}

function normalizeCommandName(value) {
  return String(value || '').trim().replace(/^\//, '').toLowerCase();
}

function normalizeAccessLevel(value) {
  return ACCESS_LEVEL_ALIASES[String(value || '').trim().toLowerCase()] || '';
}

function normalizeIdArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

function normalizeCommandMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};

  for (const [rawUserId, commands] of Object.entries(value)) {
    const userId = String(rawUserId || '').trim();
    if (!userId) continue;
    const normalized = normalizeIdArray(commands)
      .map(normalizeCommandName)
      .filter((commandName) => Object.prototype.hasOwnProperty.call(COMMAND_ACCESS_DEFAULTS, commandName));
    if (normalized.length > 0) result[userId] = [...new Set(normalized)];
  }

  return result;
}

function normalizeCommandLevels(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};

  for (const [rawCommandName, rawLevel] of Object.entries(source)) {
    const commandName = normalizeCommandName(rawCommandName);
    const level = normalizeAccessLevel(rawLevel);
    if (!Object.prototype.hasOwnProperty.call(COMMAND_ACCESS_DEFAULTS, commandName)) continue;
    if (!level) continue;
    result[commandName] = level;
  }

  for (const [commandName, level] of Object.entries(COMMAND_ACCESS_DEFAULTS)) {
    if (!result[commandName]) result[commandName] = level;
  }

  return result;
}

function normalizeAccessConfig(value) {
  const defaults = createDefaultAccessConfig();
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    version: 1,
    adminRoleIds: normalizeIdArray(source.adminRoleIds),
    adminUserIds: normalizeIdArray(source.adminUserIds),
    commandLevels: normalizeCommandLevels(source.commandLevels),
    userCommandAllow: normalizeCommandMap(source.userCommandAllow),
    userCommandDeny: normalizeCommandMap(source.userCommandDeny),
    defaultCommandLevel: normalizeAccessLevel(source.defaultCommandLevel) || defaults.defaultCommandLevel,
  };
}

async function readAccessConfig(storageRoot) {
  const paths = createStoragePaths(storageRoot);
  const raw = await readJson(paths.accessFile, { defaultFactory: createDefaultAccessConfig });
  return normalizeAccessConfig(raw);
}

async function writeAccessConfig(storageRoot, value) {
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeAccessConfig(value);
  await writeJsonAtomic(paths.accessFile, normalized);
  return normalized;
}

async function resetAccessConfig(storageRoot) {
  return writeAccessConfig(storageRoot, createDefaultAccessConfig());
}

module.exports = {
  ACCESS_LEVELS,
  COMMAND_ACCESS_DEFAULTS,
  SETTABLE_COMMAND_NAMES,
  createDefaultAccessConfig,
  normalizeCommandName,
  normalizeAccessLevel,
  normalizeAccessConfig,
  readAccessConfig,
  writeAccessConfig,
  resetAccessConfig,
};
