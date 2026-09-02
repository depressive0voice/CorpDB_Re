const fs = require('fs/promises');
const { createStoragePaths, normalizeCorporationId } = require('./paths');
const { readJson } = require('./jsonFileStore');
const {
  createDefaultRegistry,
} = require('../corporations/corporationRegistryRepository');
const {
  createEmptyCorporationProfile,
} = require('../corporations/corporationProfileRepository');
const {
  createEmptyDiscordGuildBinding,
} = require('../discord/discordGuildBindingRepository');
const {
  createDefaultManagedRolePolicy,
} = require('../roles/managedRolePolicyRepository');
const {
  createDefaultAccessGroupsState,
} = require('../accessGroups/accessGroupRepository');
const {
  createDefaultAccessGroupRequestsState,
} = require('../accessGroups/accessGroupRequestRepository');
const {
  createDefaultUserPreferences,
} = require('../localization/userLanguageRepository');
const {
  createDefaultMainBindingState,
} = require('../mainBinding/mainBindingRepository');
const {
  createDefaultAuthMainAltState,
} = require('../auth/authMainAltRepository');
const {
  createDefaultOnboardingConfig,
} = require('../onboarding/onboardingConfigRepository');
const {
  createDefaultPromotionState,
} = require('../onboarding/promotionStateRepository');
const {
  createDefaultApplicationConfig,
} = require('../applications/applicationConfigRepository');
const {
  createDefaultApplicationState,
} = require('../applications/applicationStateRepository');
const {
  createDefaultStructureConfig,
} = require('../structures/structureConfigRepository');
const {
  createDefaultStructureAlertState,
} = require('../structures/structureAlertStateRepository');
const {
  createDefaultMetenoxGuardState,
} = require('../structures/metenoxGuardRepository');
const {
  createDefaultActivityPolicy,
} = require('../activity/activityPolicyRepository');
const {
  createDefaultFatMonthlyReportState,
} = require('../activity/fatMonthlyReportRepository');
const {
  createDefaultFatSummaryState,
} = require('../activity/fatSummaryRepository');
const {
  createDefaultModuleConfig,
} = require('../modules/moduleConfigRepository');

async function initializeBaseStorage(storageRoot) {
  const paths = createStoragePaths(storageRoot);

  await Promise.all([
    fs.mkdir(paths.instanceDir, { recursive: true }),
    fs.mkdir(paths.integrationsDir, { recursive: true }),
    fs.mkdir(paths.corporationsDir, { recursive: true }),
    fs.mkdir(paths.secretsDir, { recursive: true, mode: 0o700 }),
  ]);

  await Promise.all([
    readJson(paths.corporationRegistryFile, {
      defaultFactory: createDefaultRegistry,
    }),
    readJson(paths.discordGuildBindingFile, {
      defaultFactory: createEmptyDiscordGuildBinding,
    }),
    readJson(paths.managedRolePolicyFile, {
      defaultFactory: createDefaultManagedRolePolicy,
    }),
    readJson(paths.accessGroupsFile, {
      defaultFactory: createDefaultAccessGroupsState,
    }),
    readJson(paths.accessGroupRequestsFile, {
      defaultFactory: createDefaultAccessGroupRequestsState,
    }),
    readJson(paths.modulesFile, {
      defaultFactory: createDefaultModuleConfig,
    }),
    readJson(paths.userPreferencesFile, {
      defaultFactory: createDefaultUserPreferences,
    }),
    readJson(paths.authCharactersFile, {
      defaultFactory: () => [],
    }),
    readJson(paths.authMainAltStateFile, {
      defaultFactory: createDefaultAuthMainAltState,
    }),
    readJson(paths.mainBindingsFile, {
      defaultFactory: createDefaultMainBindingState,
    }),
    readJson(paths.onboardingInstanceConfigFile, {
      defaultFactory: createDefaultOnboardingConfig,
    }),
    readJson(paths.promotionStateInstanceFile, {
      defaultFactory: createDefaultPromotionState,
    }),
  ]);

  return paths;
}

async function initializeCorporationStorage(storageRoot, corporationId) {
  const normalizedId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);

  await Promise.all([
    fs.mkdir(paths.corporationDir(normalizedId), { recursive: true }),
    fs.mkdir(paths.financeDir(normalizedId), { recursive: true }),
    fs.mkdir(paths.applicationsDir(normalizedId), { recursive: true }),
    fs.mkdir(paths.structuresDir(normalizedId), { recursive: true }),
    fs.mkdir(paths.activityDir(normalizedId), { recursive: true }),
    fs.mkdir(paths.fatSummaryDir(normalizedId), { recursive: true }),
    fs.mkdir(paths.onboardingDir(normalizedId), { recursive: true }),
  ]);

  await Promise.all([
    readJson(paths.corporationProfileFile(normalizedId), {
      defaultFactory: () => createEmptyCorporationProfile(normalizedId),
    }),
    readJson(paths.corporationMembersFile(normalizedId), {
      defaultFactory: () => [],
    }),
    readJson(paths.corporationCommentsFile(normalizedId), {
      defaultFactory: () => [],
    }),
    readJson(paths.applicationsConfigFile(normalizedId), {
      defaultFactory: () => createDefaultApplicationConfig(normalizedId),
    }),
    readJson(paths.applicationsStateFile(normalizedId), {
      defaultFactory: () => createDefaultApplicationState(normalizedId),
    }),
    readJson(paths.structuresConfigFile(normalizedId), {
      defaultFactory: createDefaultStructureConfig,
    }),
    readJson(paths.structuresAlertStateFile(normalizedId), {
      defaultFactory: createDefaultStructureAlertState,
    }),
    readJson(paths.structuresMetenoxGuardFile(normalizedId), {
      defaultFactory: createDefaultMetenoxGuardState,
    }),
    readJson(paths.activityPolicyFile(normalizedId), {
      defaultFactory: () => createDefaultActivityPolicy(normalizedId),
    }),
    readJson(paths.activityMonthlyReportsFile(normalizedId), {
      defaultFactory: () => createDefaultFatMonthlyReportState(normalizedId),
    }),
    readJson(paths.fatSummaryStateFile(normalizedId), {
      defaultFactory: () => createDefaultFatSummaryState(normalizedId),
    }),
  ]);

  return paths.corporationDir(normalizedId);
}

module.exports = {
  initializeBaseStorage,
  initializeCorporationStorage,
};
