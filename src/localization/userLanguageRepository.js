const { createStoragePaths } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');
const { SUPPORTED_LANGUAGES } = require('../config/env');

function createDefaultUserPreferences() {
  return {
    version: 1,
    users: {},
  };
}

function normalizeDiscordUserId(value) {
  const userId = String(value ?? '').trim();
  if (!/^\d{5,25}$/.test(userId)) {
    throw new Error(`Invalid Discord user ID: ${userId || '<empty>'}.`);
  }
  return userId;
}

function normalizeLanguage(value) {
  const language = String(value ?? '').trim();
  if (!SUPPORTED_LANGUAGES.includes(language)) {
    throw new Error(`Unsupported language: ${language || '<empty>'}.`);
  }
  return language;
}

function normalizeUserPreferences(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : createDefaultUserPreferences();
  const users = {};

  for (const [rawUserId, rawPreference] of Object.entries(source.users || {})) {
    let userId;
    try {
      userId = normalizeDiscordUserId(rawUserId);
    } catch {
      continue;
    }

    const language = String(rawPreference?.language ?? '').trim();
    if (!SUPPORTED_LANGUAGES.includes(language)) continue;

    users[userId] = {
      language,
      updatedAt: String(rawPreference?.updatedAt ?? '').trim(),
    };
  }

  return {
    version: 1,
    users,
  };
}

async function readUserPreferences(storageRoot) {
  const paths = createStoragePaths(storageRoot);
  const raw = await readJson(paths.userPreferencesFile, {
    defaultFactory: createDefaultUserPreferences,
  });
  return normalizeUserPreferences(raw);
}

async function writeUserPreferences(storageRoot, value) {
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeUserPreferences(value);
  await writeJsonAtomic(paths.userPreferencesFile, normalized);
  return normalized;
}

async function getUserLanguage(storageRoot, discordUserId) {
  const userId = normalizeDiscordUserId(discordUserId);
  const preferences = await readUserPreferences(storageRoot);
  return preferences.users[userId]?.language || null;
}

async function setUserLanguage(storageRoot, discordUserId, language, options = {}) {
  const userId = normalizeDiscordUserId(discordUserId);
  const normalizedLanguage = normalizeLanguage(language);
  const preferences = await readUserPreferences(storageRoot);
  const now = options.now || new Date().toISOString();

  preferences.users[userId] = {
    language: normalizedLanguage,
    updatedAt: now,
  };

  await writeUserPreferences(storageRoot, preferences);
  return preferences.users[userId];
}

module.exports = {
  createDefaultUserPreferences,
  normalizeUserPreferences,
  readUserPreferences,
  writeUserPreferences,
  getUserLanguage,
  setUserLanguage,
};
