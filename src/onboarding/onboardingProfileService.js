const { listCorporations } = require('../corporations/corporationRegistryRepository');
const { readMembers } = require('../members/memberRepository');
const {
  readOnboardingConfig,
  resolveOnboardingProfileForCorporation,
} = require('./onboardingConfigRepository');

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

async function listEnabledOnboardingCorporationIds(storageRoot) {
  const registrations = await listCorporations(storageRoot, { enabledOnly: true });
  return registrations
    .filter((entry) => entry.features?.onboarding !== false)
    .map((entry) => entry.corporationId);
}

async function findCorporationsForCharacterNames(storageRoot, characterNames) {
  const targets = new Set((characterNames || []).map(normalizeKey).filter(Boolean));
  if (targets.size === 0) return [];

  const corporationIds = await listEnabledOnboardingCorporationIds(storageRoot);
  const matched = [];

  for (const corporationId of corporationIds) {
    const members = await readMembers(storageRoot, corporationId);
    if (members.some((member) => member.isCorporationMember && targets.has(normalizeKey(member.name)))) {
      matched.push(corporationId);
    }
  }

  return matched;
}

async function resolveOnboardingProfileForAuthFamily(storageRoot, family) {
  const enabledCorporationIds = await listEnabledOnboardingCorporationIds(storageRoot);
  if (enabledCorporationIds.length === 0) {
    const error = new Error('No corporation is enabled for onboarding.');
    error.code = 'onboarding_no_corporation';
    throw error;
  }

  const config = await readOnboardingConfig(storageRoot);

  if (enabledCorporationIds.length === 1) {
    const corporationId = enabledCorporationIds[0];
    const resolved = resolveOnboardingProfileForCorporation(
      config,
      corporationId,
      enabledCorporationIds
    );
    return { ...resolved, corporationIds: [corporationId] };
  }

  const names = (Array.isArray(family) ? family : [])
    .map((record) => record?.alt)
    .filter(Boolean);
  const matchedCorporationIds = await findCorporationsForCharacterNames(storageRoot, names);

  if (matchedCorporationIds.length === 0) {
    const error = new Error(
      'The auth family could not be matched to any enabled CorpDB corporation. Synchronize members or configure the corporations before approving the binding.'
    );
    error.code = 'onboarding_corporation_unresolved';
    throw error;
  }

  const resolvedProfiles = matchedCorporationIds.map((corporationId) => ({
    corporationId,
    ...resolveOnboardingProfileForCorporation(config, corporationId, enabledCorporationIds),
  }));
  const profileIds = [...new Set(resolvedProfiles.map((entry) => entry.profileId))];

  if (profileIds.length !== 1) {
    const error = new Error(
      `The auth family belongs to corporations mapped to different onboarding profiles: ${profileIds.join(', ')}.`
    );
    error.code = 'onboarding_profile_ambiguous';
    throw error;
  }

  return {
    profileId: profileIds[0],
    profile: resolvedProfiles[0].profile,
    corporationIds: matchedCorporationIds,
    implicit: false,
  };
}

module.exports = {
  listEnabledOnboardingCorporationIds,
  findCorporationsForCharacterNames,
  resolveOnboardingProfileForAuthFamily,
};
