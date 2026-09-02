const { createStoragePaths, normalizeCorporationId } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

const DEFAULT_PROFILE_ID = 'default';

const DEFAULT_WELCOME_TEXT =
  'Welcome to **{server_name}**!\n\n' +
  'Hi {member}.\n\n' +
  'To request access and bind your EVE main, use **{request_main_command}**.\n\n' +
  'Your starting role is {guest_role}.\n' +
  'If you have questions, contact {recruiter_role}.';

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeRoleId(value) {
  const roleId = normalizeText(value);
  if (roleId && !/^\d{5,25}$/.test(roleId)) {
    throw new Error(`Invalid Discord role ID: ${roleId}.`);
  }
  return roleId;
}

function normalizeChannelId(value) {
  const channelId = normalizeText(value);
  if (channelId && !/^\d{5,25}$/.test(channelId)) {
    throw new Error(`Invalid Discord channel ID: ${channelId}.`);
  }
  return channelId;
}

function normalizeProfileId(value) {
  const profileId = normalizeText(value).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profileId)) {
    throw new Error('Onboarding profile ID must contain lowercase letters, numbers, hyphens, or underscores (1-64 characters).');
  }
  return profileId;
}

function normalizeProbationMonths(value) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric) || numeric < 1) return 3;
  return Math.min(24, numeric);
}

function createDefaultOnboardingProfile() {
  return {
    probationRoleId: '',
    mainRoleId: '',
    rookieRoleId: '',
    recruiterRoleId: '',
    promotionChannelId: '',
    probationMonths: 3,
  };
}

function normalizeOnboardingProfile(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rookieRoleId = normalizeRoleId(source.rookieRoleId);
  const legacyProbationRoleId = normalizeRoleId(source.probationRoleId);
  return {
    // Rookie is the canonical probationary-member role. Keep a legacy probation role
    // only when an existing profile explicitly contains one, so upgrades do not
    // silently remap live Discord roles. New profiles naturally alias probation to Rookie.
    probationRoleId: legacyProbationRoleId || rookieRoleId,
    mainRoleId: normalizeRoleId(source.mainRoleId),
    rookieRoleId,
    recruiterRoleId: normalizeRoleId(source.recruiterRoleId),
    promotionChannelId: normalizeChannelId(source.promotionChannelId),
    probationMonths: normalizeProbationMonths(source.probationMonths),
  };
}

function createDefaultOnboardingConfig() {
  return {
    version: 1,
    welcome: {
      enabled: true,
      channelId: '',
      recruiterRoleId: '',
      text: DEFAULT_WELCOME_TEXT,
    },
    profiles: {
      [DEFAULT_PROFILE_ID]: createDefaultOnboardingProfile(),
    },
    corporationProfiles: {},
  };
}

function normalizeOnboardingConfig(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : createDefaultOnboardingConfig();
  const defaults = createDefaultOnboardingConfig();
  const welcomeSource = source.welcome && typeof source.welcome === 'object' && !Array.isArray(source.welcome)
    ? source.welcome
    : {};
  const profiles = {};

  for (const [rawProfileId, rawProfile] of Object.entries(source.profiles || {})) {
    profiles[normalizeProfileId(rawProfileId)] = normalizeOnboardingProfile(rawProfile);
  }
  if (!profiles[DEFAULT_PROFILE_ID]) {
    profiles[DEFAULT_PROFILE_ID] = createDefaultOnboardingProfile();
  }

  const corporationProfiles = {};
  const sourceMappings = source.corporationProfiles && typeof source.corporationProfiles === 'object' && !Array.isArray(source.corporationProfiles)
    ? source.corporationProfiles
    : {};
  for (const [rawCorporationId, rawProfileId] of Object.entries(sourceMappings)) {
    const corporationId = normalizeCorporationId(rawCorporationId);
    const profileId = normalizeProfileId(rawProfileId);
    if (profiles[profileId]) corporationProfiles[corporationId] = profileId;
  }

  return {
    version: 1,
    welcome: {
      enabled: welcomeSource.enabled !== false,
      channelId: normalizeChannelId(welcomeSource.channelId),
      recruiterRoleId: normalizeRoleId(welcomeSource.recruiterRoleId),
      text: String(welcomeSource.text ?? defaults.welcome.text).trim() || defaults.welcome.text,
    },
    profiles,
    corporationProfiles,
  };
}

async function readOnboardingConfig(storageRoot) {
  const paths = createStoragePaths(storageRoot);
  const raw = await readJson(paths.onboardingInstanceConfigFile, {
    defaultFactory: createDefaultOnboardingConfig,
  });
  return normalizeOnboardingConfig(raw);
}

async function writeOnboardingConfig(storageRoot, value) {
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeOnboardingConfig(value);
  await writeJsonAtomic(paths.onboardingInstanceConfigFile, normalized);
  return normalized;
}

async function updateWelcomeConfig(storageRoot, patch = {}) {
  const config = await readOnboardingConfig(storageRoot);
  return writeOnboardingConfig(storageRoot, {
    ...config,
    welcome: { ...config.welcome, ...patch },
  });
}

async function upsertOnboardingProfile(storageRoot, profileId, patch = {}) {
  const normalizedProfileId = normalizeProfileId(profileId);
  const config = await readOnboardingConfig(storageRoot);
  const current = config.profiles[normalizedProfileId] || createDefaultOnboardingProfile();
  return writeOnboardingConfig(storageRoot, {
    ...config,
    profiles: {
      ...config.profiles,
      [normalizedProfileId]: { ...current, ...patch },
    },
  });
}

async function assignCorporationProfile(storageRoot, corporationId, profileId) {
  const normalizedCorporationId = normalizeCorporationId(corporationId);
  const normalizedProfileId = normalizeProfileId(profileId);
  const config = await readOnboardingConfig(storageRoot);
  if (!config.profiles[normalizedProfileId]) {
    throw new Error(`Onboarding profile ${normalizedProfileId} does not exist.`);
  }
  return writeOnboardingConfig(storageRoot, {
    ...config,
    corporationProfiles: {
      ...config.corporationProfiles,
      [normalizedCorporationId]: normalizedProfileId,
    },
  });
}

async function unassignCorporationProfile(storageRoot, corporationId) {
  const normalizedCorporationId = normalizeCorporationId(corporationId);
  const config = await readOnboardingConfig(storageRoot);
  const corporationProfiles = { ...config.corporationProfiles };
  delete corporationProfiles[normalizedCorporationId];
  return writeOnboardingConfig(storageRoot, { ...config, corporationProfiles });
}

function resolveOnboardingProfileForCorporation(config, corporationId, enabledOnboardingCorporationIds) {
  const normalizedCorporationId = normalizeCorporationId(corporationId);
  const enabledIds = [...new Set((enabledOnboardingCorporationIds || []).map(normalizeCorporationId))];
  if (!enabledIds.includes(normalizedCorporationId)) {
    throw new Error(`Corporation ${normalizedCorporationId} is not enabled for onboarding.`);
  }

  const mappedProfileId = config.corporationProfiles[normalizedCorporationId];
  if (mappedProfileId) {
    return { profileId: mappedProfileId, profile: config.profiles[mappedProfileId], implicit: false };
  }

  if (enabledIds.length === 1) {
    return {
      profileId: DEFAULT_PROFILE_ID,
      profile: config.profiles[DEFAULT_PROFILE_ID],
      implicit: true,
    };
  }

  const error = new Error(
    `Corporation ${normalizedCorporationId} needs an explicit onboarding profile because multiple corporations are enabled.`
  );
  error.code = 'onboarding_corporation_profile_unconfigured';
  throw error;
}

module.exports = {
  DEFAULT_PROFILE_ID,
  DEFAULT_WELCOME_TEXT,
  createDefaultOnboardingProfile,
  createDefaultOnboardingConfig,
  normalizeOnboardingProfile,
  normalizeOnboardingConfig,
  normalizeProfileId,
  readOnboardingConfig,
  writeOnboardingConfig,
  updateWelcomeConfig,
  upsertOnboardingProfile,
  assignCorporationProfile,
  unassignCorporationProfile,
  resolveOnboardingProfileForCorporation,
};
