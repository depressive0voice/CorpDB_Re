const path = require('path');

function normalizeCorporationId(value) {
  const corporationId = String(value ?? '').trim();
  if (!/^\d+$/.test(corporationId)) {
    throw new Error(`Invalid EVE corporationId: ${corporationId || '<empty>'}`);
  }
  return corporationId;
}

function createStoragePaths(rootDir) {
  const storageRoot = path.resolve(rootDir);
  const instanceDir = path.join(storageRoot, 'instance');
  const corporationsDir = path.join(storageRoot, 'corporations');
  const secretsDir = path.join(storageRoot, 'secrets');

  function corporationDir(corporationId) {
    return path.join(corporationsDir, normalizeCorporationId(corporationId));
  }

  return {
    rootDir: storageRoot,
    instanceDir,
    corporationsDir,
    secretsDir,

    accessFile: path.join(instanceDir, 'access.json'),
    modulesFile: path.join(instanceDir, 'modules.json'),
    userPreferencesFile: path.join(instanceDir, 'userPreferences.json'),
    mainBindingsFile: path.join(instanceDir, 'mainBindings.json'),
    authCharactersFile: path.join(instanceDir, 'authCharacters.json'),
    authMainAltStateFile: path.join(instanceDir, 'authMainAlt.json'),
    identityProviderFile: path.join(instanceDir, 'identityProvider.json'),
    discordGuildBindingFile: path.join(instanceDir, 'discord.json'),
    managedRolePolicyFile: path.join(instanceDir, 'managedRoles.json'),
    accessGroupsFile: path.join(instanceDir, 'accessGroups.json'),
    accessGroupRequestsFile: path.join(instanceDir, 'accessGroupRequests.json'),
    onboardingInstanceConfigFile: path.join(instanceDir, 'onboarding.json'),
    promotionStateInstanceFile: path.join(instanceDir, 'promotionState.json'),
    roleExpiryConfigFile: path.join(instanceDir, 'roleExpiry.json'),
    roleExpiryStateFile: path.join(instanceDir, 'roleExpiryState.json'),
    integrationsDir: path.join(instanceDir, 'integrations'),
    blacklistIntegrationFile: path.join(instanceDir, 'integrations', 'blacklist.json'),

    corporationRegistryFile: path.join(corporationsDir, 'registry.json'),
    eveOAuthSecretsFile: path.join(secretsDir, 'eveOAuth.json'),
    eveOAuthPendingFile: path.join(secretsDir, 'eveOAuthPending.json'),

    corporationDir,
    corporationProfileFile: (corporationId) => path.join(corporationDir(corporationId), 'profile.json'),
    corporationMembersFile: (corporationId) => path.join(corporationDir(corporationId), 'members.json'),
    corporationCommentsFile: (corporationId) => path.join(corporationDir(corporationId), 'comments.json'),

    financeDir: (corporationId) => path.join(corporationDir(corporationId), 'finance'),
    financeWalletSnapshotFile: (corporationId) => path.join(corporationDir(corporationId), 'finance', 'walletSnapshot.json'),
    financeJournalFile: (corporationId) => path.join(corporationDir(corporationId), 'finance', 'journal.json'),
    financePolicyFile: (corporationId) => path.join(corporationDir(corporationId), 'finance', 'policy.json'),
    donationAlertStateFile: (corporationId) => path.join(corporationDir(corporationId), 'finance', 'donationAlertState.json'),

    applicationsDir: (corporationId) => path.join(corporationDir(corporationId), 'applications'),
    applicationsConfigFile: (corporationId) => path.join(corporationDir(corporationId), 'applications', 'config.json'),
    applicationsStateFile: (corporationId) => path.join(corporationDir(corporationId), 'applications', 'state.json'),

    structuresDir: (corporationId) => path.join(corporationDir(corporationId), 'structures'),
    structuresConfigFile: (corporationId) => path.join(corporationDir(corporationId), 'structures', 'config.json'),
    structuresAlertStateFile: (corporationId) => path.join(corporationDir(corporationId), 'structures', 'alertState.json'),
    structuresMetenoxGuardFile: (corporationId) => path.join(corporationDir(corporationId), 'structures', 'metenoxGuard.json'),

    activityDir: (corporationId) => path.join(corporationDir(corporationId), 'activity'),
    activityPolicyFile: (corporationId) => path.join(corporationDir(corporationId), 'activity', 'policy.json'),
    activityMonthlyReportsFile: (corporationId) => path.join(corporationDir(corporationId), 'activity', 'monthlyReports.json'),
    activityModerationFile: (corporationId) => path.join(corporationDir(corporationId), 'activity', 'moderation.json'),
    fatSummaryStateFile: (corporationId) => path.join(corporationDir(corporationId), 'activity', 'fatSummaryState.json'),
    fatSummaryDir: (corporationId) => path.join(corporationDir(corporationId), 'activity', 'fat-summary'),

    onboardingDir: (corporationId) => path.join(corporationDir(corporationId), 'onboarding'),
    onboardingConfigFile: (corporationId) => path.join(corporationDir(corporationId), 'onboarding', 'config.json'),
    promotionStateFile: (corporationId) => path.join(corporationDir(corporationId), 'onboarding', 'promotionState.json'),
  };
}

module.exports = {
  normalizeCorporationId,
  createStoragePaths,
};
