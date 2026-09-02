const path = require('path');
require('dotenv').config();

const SUPPORTED_LANGUAGES = Object.freeze(['ru', 'en']);
const DEFAULT_LANGUAGE = 'en';
const DEFAULT_ESI_COMPATIBILITY_DATE = '2026-08-31';

function normalizeText(value) {
  return String(value ?? '').trim();
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseEnabledLanguages(value) {
  const raw = normalizeText(value) || SUPPORTED_LANGUAGES.join(',');
  return [...new Set(raw.split(',').map((item) => item.trim()).filter(Boolean))];
}

function parseDiscordOwnerIds(env = process.env) {
  const plural = normalizeText(env.BOT_OWNER_IDS)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const singular = normalizeText(env.BOT_OWNER_ID);

  return [...new Set([...plural, ...(singular ? [singular] : [])])];
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isDiscordSnowflake(value) {
  return /^\d{5,25}$/.test(normalizeText(value));
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizeText(value));
}

function buildConfig(env = process.env) {
  const storageValue = normalizeText(env.CORPDB_STORAGE_DIR) || 'storage';
  const ownerIds = parseDiscordOwnerIds(env);

  return {
    discord: {
      token: normalizeText(env.DISCORD_TOKEN),
      clientId: normalizeText(env.DISCORD_CLIENT_ID),
      ownerIds,
      ownerId: ownerIds[0] || '',
    },
    eve: {
      clientId: normalizeText(env.EVE_SSO_CLIENT_ID),
      redirectUri: normalizeText(env.EVE_SSO_REDIRECT_URI),
      datasource: normalizeText(env.EVE_ESI_DATASOURCE) || 'tranquility',
      compatibilityDate:
        normalizeText(env.EVE_ESI_COMPATIBILITY_DATE) || DEFAULT_ESI_COMPATIBILITY_DATE,
    },
    blacklist: {
      googleSheetsApiKey: normalizeText(env.GOOGLE_SHEETS_API_KEY),
      spreadsheetId: normalizeText(env.BLACKLIST_SPREADSHEET_ID),
      blackRange: normalizeText(env.BLACKLIST_BLACK_RANGE) || "'The List'!A:J",
      greyRange: normalizeText(env.BLACKLIST_GREY_RANGE) || "'Grey List'!A:J",
      cacheTtlMs: parsePositiveInteger(env.BLACKLIST_CACHE_TTL_MS, 5 * 60 * 1000),
      eveWhoBaseUrl: normalizeText(env.EVEWHO_BASE_URL) || 'https://evewho.com/api',
      eveWhoPageDelayMs: parsePositiveInteger(env.EVEWHO_PAGE_DELAY_MS, 3200),
      eveWhoCacheTtlMs: parsePositiveInteger(env.EVEWHO_CACHE_TTL_MS, 2 * 60 * 1000),
    },
    http: {
      host: normalizeText(env.HTTP_HOST) || '127.0.0.1',
      port: parsePositiveInteger(env.HTTP_PORT, 3000),
    },
    storage: {
      rootDir: path.resolve(process.cwd(), storageValue),
    },
    localization: {
      defaultLanguage: normalizeText(env.DEFAULT_LANGUAGE) || DEFAULT_LANGUAGE,
      enabledLanguages: parseEnabledLanguages(env.ENABLED_LANGUAGES),
    },
    jobs: {
      enabled: parseBoolean(env.ENABLE_BACKGROUND_JOBS, true),
      memberSyncIntervalMinutes: parsePositiveInteger(env.MEMBER_SYNC_INTERVAL_MINUTES, 30),
      promotionEnabled: parseBoolean(env.ENABLE_PROMOTION_JOB, true),
      promotionCheckIntervalMinutes: parsePositiveInteger(env.PROMOTION_CHECK_INTERVAL_MINUTES, 360),
      financeEnabled: parseBoolean(env.ENABLE_FINANCE_JOB, true),
      financeRefreshIntervalMinutes: parsePositiveInteger(env.FINANCE_REFRESH_INTERVAL_MINUTES, 15),
      applicationsEnabled: parseBoolean(env.ENABLE_APPLICATIONS_JOB, true),
      applicationsCheckIntervalMinutes: parsePositiveInteger(env.APPLICATIONS_CHECK_INTERVAL_MINUTES, 15),
      structureFuelEnabled: parseBoolean(env.ENABLE_STRUCTURE_FUEL_JOB, true),
      structureFuelCheckIntervalMinutes: parsePositiveInteger(env.STRUCTURE_FUEL_CHECK_INTERVAL_MINUTES, 60),
      fatRewardsReminderEnabled: parseBoolean(env.ENABLE_FAT_REWARDS_REMINDER_JOB, true),
      fatRewardsReminderIntervalMinutes: parsePositiveInteger(env.FAT_REWARDS_REMINDER_INTERVAL_MINUTES, 360),
    },
  };
}

function validateConfig(config) {
  const errors = [];
  const warnings = [];

  if (!config.discord.token) errors.push('DISCORD_TOKEN is required.');
  if (!isDiscordSnowflake(config.discord.clientId)) {
    errors.push('DISCORD_CLIENT_ID must be a Discord snowflake.');
  }

  if (!Array.isArray(config.discord.ownerIds) || config.discord.ownerIds.length === 0) {
    errors.push('BOT_OWNER_IDS (or legacy BOT_OWNER_ID) must contain at least one Discord user ID.');
  } else {
    for (const ownerId of config.discord.ownerIds) {
      if (!isDiscordSnowflake(ownerId)) {
        errors.push(`Invalid Discord user ID in BOT_OWNER_IDS/BOT_OWNER_ID: ${ownerId}.`);
      }
    }
  }

  if (!config.eve.clientId) errors.push('EVE_SSO_CLIENT_ID is required.');
  if (!isHttpUrl(config.eve.redirectUri)) {
    errors.push('EVE_SSO_REDIRECT_URI must be an http(s) URL.');
  }
  if (!isIsoDate(config.eve.compatibilityDate)) {
    errors.push('EVE_ESI_COMPATIBILITY_DATE must use YYYY-MM-DD format.');
  }

  if (!SUPPORTED_LANGUAGES.includes(config.localization.defaultLanguage)) {
    errors.push(
      `DEFAULT_LANGUAGE must be one of: ${SUPPORTED_LANGUAGES.join(', ')}.`
    );
  }

  for (const language of config.localization.enabledLanguages) {
    if (!SUPPORTED_LANGUAGES.includes(language)) {
      errors.push(
        `Unsupported language in ENABLED_LANGUAGES: ${language}. Supported: ${SUPPORTED_LANGUAGES.join(', ')}.`
      );
    }
  }

  if (!config.localization.enabledLanguages.includes(config.localization.defaultLanguage)) {
    errors.push('DEFAULT_LANGUAGE must also be present in ENABLED_LANGUAGES.');
  }

  if (config.http.port > 65535) {
    errors.push('HTTP_PORT must be between 1 and 65535.');
  }

  if (!config.blacklist.spreadsheetId) {
    warnings.push('BLACKLIST_SPREADSHEET_ID is not configured; /blacklist will be unavailable.');
  }

  if (!isHttpUrl(config.blacklist.eveWhoBaseUrl)) {
    errors.push('EVEWHO_BASE_URL must be an http(s) URL.');
  }

  if (config.jobs.memberSyncIntervalMinutes > 1440) {
    warnings.push(
      `MEMBER_SYNC_INTERVAL_MINUTES is unusually high: ${config.jobs.memberSyncIntervalMinutes}.`
    );
  }

  if (config.jobs.promotionCheckIntervalMinutes > 1440) {
    warnings.push(
      `PROMOTION_CHECK_INTERVAL_MINUTES is unusually high: ${config.jobs.promotionCheckIntervalMinutes}.`
    );
  }

  if (config.jobs.financeRefreshIntervalMinutes > 1440) {
    warnings.push(
      `FINANCE_REFRESH_INTERVAL_MINUTES is unusually high: ${config.jobs.financeRefreshIntervalMinutes}.`
    );
  }

  if (config.jobs.applicationsCheckIntervalMinutes > 1440) {
    warnings.push(
      `APPLICATIONS_CHECK_INTERVAL_MINUTES is unusually high: ${config.jobs.applicationsCheckIntervalMinutes}.`
    );
  }

  if (config.jobs.structureFuelCheckIntervalMinutes > 1440) {
    warnings.push(
      `STRUCTURE_FUEL_CHECK_INTERVAL_MINUTES is unusually high: ${config.jobs.structureFuelCheckIntervalMinutes}.`
    );
  }

  if (config.jobs.fatRewardsReminderIntervalMinutes > 1440) {
    warnings.push(
      `FAT_REWARDS_REMINDER_INTERVAL_MINUTES is unusually high: ${config.jobs.fatRewardsReminderIntervalMinutes}.`
    );
  }

  if (config.eve.datasource !== 'tranquility') {
    warnings.push(`Non-default EVE datasource configured: ${config.eve.datasource}.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

function loadConfig(env = process.env) {
  const config = buildConfig(env);
  const validation = validateConfig(config);

  if (!validation.ok) {
    const error = new Error(`Invalid CorpDB configuration:\n- ${validation.errors.join('\n- ')}`);
    error.code = 'invalid_configuration';
    error.validation = validation;
    throw error;
  }

  return {
    ...config,
    validation,
  };
}

module.exports = {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  DEFAULT_ESI_COMPATIBILITY_DATE,
  parseDiscordOwnerIds,
  buildConfig,
  validateConfig,
  loadConfig,
};
