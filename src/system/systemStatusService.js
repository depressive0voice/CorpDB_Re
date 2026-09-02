const { validateConfig } = require('../config/env');
const { readDiscordGuildBinding } = require('../discord/discordGuildBindingRepository');
const { readRegistry } = require('../corporations/corporationRegistryRepository');
const { readCorporationProfile } = require('../corporations/corporationProfileRepository');
const { getAuthorizationStatus } = require('../eve/eveAuthorizationService');
const { listModuleStates } = require('../modules/moduleConfigRepository');
const { MODULE_KEYS } = require('../modules/moduleRegistry');
const {
  readRoleExpiryConfig,
  isRoleExpiryConfigured,
} = require('../roleExpiry/roleExpiryConfigRepository');
const { getStorageStatus } = require('./storageExportService');

function normalizeText(value) {
  return String(value || '').trim();
}

function createIssue(severity, code, message, details = {}) {
  return { severity, code, message, ...details };
}

async function buildSystemStatus(config) {
  const storageRoot = config.storage.rootDir;
  const validation = validateConfig(config);
  const [guildBinding, registry, authorizations, modules, storage, roleExpiryPolicy] = await Promise.all([
    readDiscordGuildBinding(storageRoot),
    readRegistry(storageRoot),
    getAuthorizationStatus(storageRoot),
    listModuleStates(storageRoot),
    getStorageStatus(storageRoot),
    readRoleExpiryConfig(storageRoot),
  ]);
  const moduleStates = Object.fromEntries(modules.map((module) => [module.key, module.enabled]));
  const moduleEnabled = (key) => moduleStates[key] !== false;

  const authorizationByCorporationId = new Map(
    authorizations.map((authorization) => [normalizeText(authorization.corporationId), authorization])
  );
  const corporations = [];
  const issues = [];

  if (!guildBinding.guildId) {
    issues.push(createIssue('error', 'guild_binding_missing', 'Discord guild binding is missing.'));
  }
  if (registry.corporations.length === 0) {
    issues.push(createIssue('warning', 'corporations_missing', 'No corporations are registered.'));
  }
  for (const message of validation.errors) {
    issues.push(createIssue('error', 'configuration_error', message));
  }
  for (const message of validation.warnings) {
    issues.push(createIssue('warning', 'configuration_warning', message));
  }

  for (const registration of registry.corporations) {
    const corporationId = registration.corporationId;
    const profile = await readCorporationProfile(storageRoot, corporationId, {
      createIfMissing: false,
    }).catch(() => null);
    const authorization = authorizationByCorporationId.get(corporationId) || null;

    if (registration.enabled && !authorization) {
      issues.push(createIssue(
        'error',
        'corporation_authorization_missing',
        `Enabled corporation ${corporationId} has no EVE authorization.`,
        { corporationId }
      ));
    }
    if (!profile?.name) {
      issues.push(createIssue(
        'warning',
        'corporation_profile_incomplete',
        `Corporation ${corporationId} has no populated profile name.`,
        { corporationId }
      ));
    }

    corporations.push({
      corporationId,
      enabled: registration.enabled,
      features: { ...(registration.features || {}) },
      isDefault: registry.defaultCorporationId === corporationId,
      name: profile?.name || '',
      ticker: profile?.ticker || '',
      allianceId: profile?.allianceId || '',
      allianceName: profile?.allianceName || '',
      authorized: Boolean(authorization),
      serviceCharacterId: authorization?.characterId || '',
      serviceCharacterName: authorization?.characterName || '',
      scopesCount: authorization?.scopes?.length || 0,
      corporationRolesCount: authorization?.corporationRoles?.length || 0,
      authorizationUpdatedAt: authorization?.updatedAt || '',
    });
  }

  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;

  return {
    health: errorCount > 0 ? 'error' : warningCount > 0 ? 'warning' : 'ok',
    errorCount,
    warningCount,
    issues,
    process: {
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
      pid: process.pid,
    },
    discord: {
      guildId: guildBinding.guildId || '',
      boundAt: guildBinding.boundAt || '',
    },
    eve: {
      datasource: config.eve.datasource,
      compatibilityDate: config.eve.compatibilityDate,
      authorizationCount: authorizations.length,
    },
    corporations,
    defaultCorporationId: registry.defaultCorporationId || '',
    modules,
    jobs: {
      enabled: config.jobs.enabled,
      members: {
        enabled: config.jobs.enabled,
        intervalMinutes: config.jobs.memberSyncIntervalMinutes,
      },
      promotion: {
        enabled: config.jobs.enabled && config.jobs.promotionEnabled,
        intervalMinutes: config.jobs.promotionCheckIntervalMinutes,
      },
      finance: {
        enabled: config.jobs.enabled && config.jobs.financeEnabled && moduleEnabled(MODULE_KEYS.FINANCE),
        moduleEnabled: moduleEnabled(MODULE_KEYS.FINANCE),
        intervalMinutes: config.jobs.financeRefreshIntervalMinutes,
      },
      applications: {
        enabled: config.jobs.enabled && config.jobs.applicationsEnabled,
        intervalMinutes: config.jobs.applicationsCheckIntervalMinutes,
      },
      structureFuel: {
        enabled: config.jobs.enabled && config.jobs.structureFuelEnabled && moduleEnabled(MODULE_KEYS.STRUCTURE_FUEL),
        moduleEnabled: moduleEnabled(MODULE_KEYS.STRUCTURE_FUEL),
        intervalMinutes: config.jobs.structureFuelCheckIntervalMinutes,
      },
      fatRewardsReminder: {
        enabled: config.jobs.enabled && config.jobs.fatRewardsReminderEnabled && moduleEnabled(MODULE_KEYS.FAT_REWARDS),
        moduleEnabled: moduleEnabled(MODULE_KEYS.FAT_REWARDS),
        intervalMinutes: config.jobs.fatRewardsReminderIntervalMinutes,
      },
      roleExpiry: {
        enabled: config.jobs.enabled && moduleEnabled(MODULE_KEYS.ROLE_EXPIRY),
        moduleEnabled: moduleEnabled(MODULE_KEYS.ROLE_EXPIRY),
        configured: isRoleExpiryConfigured(roleExpiryPolicy),
        intervalMinutes: roleExpiryPolicy.checkIntervalMinutes,
      },
    },
    storage,
  };
}

module.exports = {
  buildSystemStatus,
};
