const { findAllAuthCharacters } = require('../auth/authCharacterRepository');
const { listCorporations } = require('../corporations/corporationRegistryRepository');
const { readOnboardingConfig } = require('../onboarding/onboardingConfigRepository');
const {
  listApprovedBindings,
  listPendingRequests,
} = require('./mainBindingRepository');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function toValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return [];
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeText(value))
    .filter(Boolean))];
}

function buildBindingAuditData({
  guildMembers,
  approvedBindings,
  pendingRequests,
  authCharacters,
  corporations,
  onboardingConfig,
}) {
  const members = toValues(guildMembers)
    .filter((member) => member && !member.user?.bot)
    .map((member) => ({
      discordUserId: normalizeText(member.user?.id || member.id),
      displayName: normalizeText(
        member.displayName || member.user?.globalName || member.user?.username || member.user?.tag
      ),
      username: normalizeText(member.user?.username || member.user?.tag),
    }))
    .filter((member) => member.discordUserId)
    .sort((left, right) => (
      left.displayName || left.username || left.discordUserId
    ).localeCompare(right.displayName || right.username || right.discordUserId));

  const bindings = Array.isArray(approvedBindings) ? approvedBindings : [];
  const pending = Array.isArray(pendingRequests) ? pendingRequests : [];
  const auth = Array.isArray(authCharacters) ? authCharacters : [];
  const registry = Array.isArray(corporations) ? corporations : [];
  const profiles = onboardingConfig?.profiles && typeof onboardingConfig.profiles === 'object'
    ? onboardingConfig.profiles
    : {};

  const bindingByDiscordUserId = new Map(
    bindings.map((binding) => [normalizeText(binding.discordUserId), binding])
  );
  const pendingByDiscordUserId = new Map(
    pending.map((request) => [normalizeText(request.discordUserId), request])
  );
  const guildUserIds = new Set(members.map((member) => member.discordUserId));
  const authMains = new Set(auth.map((record) => normalizeKey(record.main)).filter(Boolean));
  const corporationById = new Map(
    registry.map((entry) => [normalizeText(entry.corporationId), entry])
  );

  const unboundUsers = [];
  let boundUsersCount = 0;
  let healthyBoundUsersCount = 0;
  let boundUsersWithIssuesCount = 0;

  const issues = {
    staleBindings: [],
    mainMissingAuth: [],
    emptyCorporationIds: [],
    unregisteredCorporations: [],
    disabledCorporations: [],
    onboardingProfileMissing: [],
  };

  const issueCodesByBinding = new Map();

  function addIssue(binding, code, details = {}) {
    const key = `${normalizeText(binding.discordUserId)}::${normalizeKey(binding.mainName)}`;
    if (!issueCodesByBinding.has(key)) issueCodesByBinding.set(key, new Set());
    issueCodesByBinding.get(key).add(code);
    issues[code].push({ binding, ...details });
  }

  for (const binding of bindings) {
    const discordUserId = normalizeText(binding.discordUserId);
    const mainName = normalizeText(binding.mainName);

    if (!guildUserIds.has(discordUserId)) {
      addIssue(binding, 'staleBindings');
    }

    if (!mainName || !authMains.has(normalizeKey(mainName))) {
      addIssue(binding, 'mainMissingAuth');
    }

    const corporationIds = uniqueStrings(binding.corporationIds);
    if (corporationIds.length === 0) {
      addIssue(binding, 'emptyCorporationIds');
    } else {
      const unregisteredIds = corporationIds.filter((corporationId) => !corporationById.has(corporationId));
      if (unregisteredIds.length > 0) {
        addIssue(binding, 'unregisteredCorporations', { corporationIds: unregisteredIds });
      }

      const disabledIds = corporationIds.filter((corporationId) => {
        const registration = corporationById.get(corporationId);
        return registration && !registration.enabled;
      });
      if (disabledIds.length > 0) {
        addIssue(binding, 'disabledCorporations', { corporationIds: disabledIds });
      }
    }

    const onboardingProfileId = normalizeKey(binding.onboardingProfileId);
    if (!onboardingProfileId || !profiles[onboardingProfileId]) {
      addIssue(binding, 'onboardingProfileMissing', {
        onboardingProfileId: normalizeText(binding.onboardingProfileId),
      });
    }
  }

  for (const member of members) {
    const binding = bindingByDiscordUserId.get(member.discordUserId) || null;
    const pendingRequest = pendingByDiscordUserId.get(member.discordUserId) || null;

    if (!binding) {
      unboundUsers.push({ ...member, pendingRequest });
      continue;
    }

    boundUsersCount += 1;
    const bindingKey = `${normalizeText(binding.discordUserId)}::${normalizeKey(binding.mainName)}`;
    const bindingIssues = issueCodesByBinding.get(bindingKey);
    if (bindingIssues?.size) {
      boundUsersWithIssuesCount += 1;
    } else {
      healthyBoundUsersCount += 1;
    }
  }

  const pendingUnboundCount = unboundUsers.filter((entry) => entry.pendingRequest).length;

  return {
    totalDiscordUsers: members.length,
    approvedBindingsCount: bindings.length,
    pendingRequestsCount: pending.length,
    boundUsersCount,
    healthyBoundUsersCount,
    boundUsersWithIssuesCount,
    unboundUsersCount: unboundUsers.length,
    pendingUnboundCount,
    unboundUsers,
    issues,
  };
}

async function runBindingAudit(storageRoot, guild) {
  const [guildMembers, approvedBindings, pendingRequests, authCharacters, corporations, onboardingConfig] = await Promise.all([
    guild.members.fetch(),
    listApprovedBindings(storageRoot),
    listPendingRequests(storageRoot),
    findAllAuthCharacters(storageRoot),
    listCorporations(storageRoot),
    readOnboardingConfig(storageRoot),
  ]);

  return buildBindingAuditData({
    guildMembers,
    approvedBindings,
    pendingRequests,
    authCharacters,
    corporations,
    onboardingConfig,
  });
}

module.exports = {
  buildBindingAuditData,
  runBindingAudit,
};
