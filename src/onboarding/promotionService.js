const { EmbedBuilder } = require('discord.js');
const { findAllAuthCharacters } = require('../auth/authCharacterRepository');
const {
  findApprovedBindingByDiscordUserId,
  findApprovedBindingByMainName,
  listApprovedBindings,
} = require('../mainBinding/mainBindingRepository');
const { getManagedRoleBinding } = require('../roles/managedRolePolicyRepository');
const { grantManagedRole, removeManagedRole } = require('../roles/managedRoleService');
const { createTranslator, resolveUserLanguage } = require('../localization/localizationService');
const {
  readOnboardingConfig,
  resolveOnboardingProfileForCorporation,
} = require('./onboardingConfigRepository');
const { listEnabledOnboardingCorporationIds } = require('./onboardingProfileService');
const {
  listPromotionRequests,
  findPromotionRequestByMainName,
  createPromotionRequest,
  updatePromotionRequestById,
} = require('./promotionStateRepository');

const FINAL_ROLE_MAIN = 'main';
// Kept only for reading historical state written before Rookie became the probation role.
const FINAL_ROLE_ROOKIE = 'rookie';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addUtcMonths(value, months) {
  const source = parseDate(value);
  if (!source) return null;

  const result = new Date(source.getTime());
  const sourceDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + Number(months || 0));
  const lastDay = new Date(Date.UTC(
    result.getUTCFullYear(),
    result.getUTCMonth() + 1,
    0
  )).getUTCDate();
  result.setUTCDate(Math.min(sourceDay, lastDay));
  return result;
}

function normalizeFinalRole(value) {
  const role = normalizeKey(value || FINAL_ROLE_MAIN).replace(/[_\s]+/g, '-');
  return role === FINAL_ROLE_MAIN ? FINAL_ROLE_MAIN : '';
}

function resolveProbationRoleId(profile = {}) {
  return normalizeText(profile.probationRoleId || profile.rookieRoleId);
}

function generateRequestId(now = Date.now()) {
  return `${now}-${Math.random().toString(36).slice(2, 9)}`;
}

function discordTime(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? `<t:${Math.floor(time / 1000)}:F>` : '—';
}

async function resolveProfileForBinding(storageRoot, binding) {
  const config = await readOnboardingConfig(storageRoot);
  const explicitProfileId = normalizeKey(binding?.onboardingProfileId);
  if (explicitProfileId && config.profiles[explicitProfileId]) {
    return {
      profileId: explicitProfileId,
      profile: config.profiles[explicitProfileId],
      corporationIds: Array.isArray(binding.corporationIds) ? binding.corporationIds : [],
    };
  }

  const enabledCorporationIds = await listEnabledOnboardingCorporationIds(storageRoot);
  if (enabledCorporationIds.length === 1) {
    const resolved = resolveOnboardingProfileForCorporation(
      config,
      enabledCorporationIds[0],
      enabledCorporationIds
    );
    return { ...resolved, corporationIds: [enabledCorporationIds[0]] };
  }

  const error = new Error('The binding has no usable onboarding profile.');
  error.code = 'promotion_profile_missing';
  throw error;
}

async function resolveApprovedBinding(storageRoot, selector = {}) {
  const discordUserId = normalizeText(selector.discordUserId);
  const characterName = normalizeText(selector.characterName);
  if (Boolean(discordUserId) === Boolean(characterName)) {
    const error = new Error('Specify exactly one target: Discord user or EVE character name.');
    error.code = 'promotion_selector_invalid';
    throw error;
  }

  if (discordUserId) {
    const binding = await findApprovedBindingByDiscordUserId(storageRoot, discordUserId);
    if (binding) return binding;
  } else {
    const auth = await findAllAuthCharacters(storageRoot);
    const record = auth.find((entry) =>
      normalizeKey(entry.alt) === normalizeKey(characterName)
      || normalizeKey(entry.main) === normalizeKey(characterName)
    );
    const mainName = record?.main || characterName;
    const binding = await findApprovedBindingByMainName(storageRoot, mainName);
    if (binding) return binding;
  }

  const error = new Error('No approved main binding was found for the selected target.');
  error.code = 'promotion_binding_missing';
  throw error;
}

async function ensurePromotionRequest(storageRoot, binding, resolvedProfile, now = new Date()) {
  const existing = await findPromotionRequestByMainName(storageRoot, binding.mainName);
  if (existing) return existing;
  const probationStartedAt = normalizeText(binding.approvedAt);
  const eligibleAt = addUtcMonths(probationStartedAt, resolvedProfile.profile.probationMonths);
  return createPromotionRequest(storageRoot, {
    id: generateRequestId(now.getTime()),
    mainName: binding.mainName,
    discordUserId: binding.discordUserId,
    discordTag: binding.discordTag,
    onboardingProfileId: resolvedProfile.profileId,
    corporationIds: resolvedProfile.corporationIds,
    probationStartedAt,
    eligibleAt: eligibleAt?.toISOString() || '',
    status: 'pending',
    requestedAt: now.toISOString(),
  });
}

async function sendPromotionDirectMessage(config, storageRoot, client, binding, roleId, reviewer) {
  const user = await client?.users?.fetch(binding.discordUserId).catch(() => null);
  if (!user) return false;
  const language = await resolveUserLanguage(storageRoot, config, binding.discordUserId).catch(
    () => config.localization.defaultLanguage
  );
  const t = createTranslator(language, config);
  return user.send({
    content: [
      t('promotion.dm.title'),
      t('promotion.dm.main', { mainName: binding.mainName }),
      t('promotion.dm.role', { role: `<@&${roleId}>` }),
      t('promotion.dm.reviewer', { reviewer }),
    ].join('\n'),
  }).then(() => true).catch(() => false);
}

async function promoteMember(context) {
  const {
    config,
    storageRoot,
    guild,
    client,
    discordUserId = '',
    characterName = '',
    role = FINAL_ROLE_MAIN,
    reviewedByUser,
    t,
  } = context;
  const finalRole = normalizeFinalRole(role);
  if (!finalRole) {
    const error = new Error(t('promotion.error.invalidRole'));
    error.code = 'promotion_role_invalid';
    throw error;
  }

  let binding;
  try {
    binding = await resolveApprovedBinding(storageRoot, { discordUserId, characterName });
  } catch (error) {
    if (error.code === 'promotion_selector_invalid') error.message = t('promotion.error.selector');
    else if (error.code === 'promotion_binding_missing') error.message = t('promotion.error.bindingMissing');
    throw error;
  }

  let resolvedProfile;
  try {
    resolvedProfile = await resolveProfileForBinding(storageRoot, binding);
  } catch (error) {
    error.message = t('promotion.error.profileMissing');
    throw error;
  }

  const member = await guild.members.fetch(binding.discordUserId).catch(() => null);
  if (!member) {
    const error = new Error(t('promotion.error.memberMissing'));
    error.code = 'promotion_member_missing';
    throw error;
  }

  const profile = resolvedProfile.profile;
  const targetRoleId = normalizeText(profile.mainRoleId);
  if (!targetRoleId) {
    const error = new Error(t('promotion.error.targetRoleMissing', { profile: resolvedProfile.profileId }));
    error.code = 'promotion_target_role_missing';
    throw error;
  }

  await grantManagedRole(member, targetRoleId, {
    reason: `Probation completed for ${binding.mainName}`,
  });

  const guestRoleId = await getManagedRoleBinding(storageRoot, 'guest').catch(() => '');
  const probationRoleId = resolveProbationRoleId(profile);
  const removeRoleIds = [probationRoleId, profile.rookieRoleId, guestRoleId]
    .filter((roleId) => roleId && roleId !== targetRoleId);
  const removedRoleIds = [];
  for (const roleId of [...new Set(removeRoleIds)]) {
    if (!member.roles.cache.has(roleId)) continue;
    const result = await removeManagedRole(member, roleId, {
      reason: `Probation completed for ${binding.mainName}`,
    });
    if (result.changed) removedRoleIds.push(roleId);
  }

  const now = new Date();
  const request = await ensurePromotionRequest(storageRoot, binding, resolvedProfile, now);
  const updatedRequest = await updatePromotionRequestById(storageRoot, request.id, {
    status: 'approved-main',
    reviewedAt: now.toISOString(),
    reviewedByUserId: reviewedByUser?.id || '',
    reviewedByTag: reviewedByUser?.tag || reviewedByUser?.username || reviewedByUser?.id || '',
    assignedRoleId: targetRoleId,
  });

  const reviewer = reviewedByUser?.tag || reviewedByUser?.username || reviewedByUser?.id || 'unknown';
  const dmSent = await sendPromotionDirectMessage(
    config,
    storageRoot,
    client,
    binding,
    targetRoleId,
    reviewer
  );

  return {
    binding,
    finalRole: FINAL_ROLE_MAIN,
    roleLabel: t('promotion.role.main'),
    targetRoleId,
    removedRoleIds,
    resolvedProfile,
    updatedRequest,
    dmSent,
  };
}

function buildExpirationEmbed(request, t) {
  return new EmbedBuilder()
    .setTitle(t('promotion.embed.title'))
    .setColor(0xfee75c)
    .setDescription([
      `<@${request.discordUserId}>`,
      t('promotion.embed.main', { mainName: request.mainName }),
      t('promotion.embed.started', { time: discordTime(request.probationStartedAt) }),
      t('promotion.embed.eligible', { time: discordTime(request.eligibleAt) }),
      '',
      t('promotion.embed.instruction'),
      t('promotion.embed.mainCommand', { discordTag: request.discordTag || request.discordUserId }),
    ].join('\n'))
    .setTimestamp();
}

async function processProbationExpirations(options) {
  const { config, storageRoot, guild } = options;
  const now = options.now instanceof Date ? options.now : new Date();
  const t = createTranslator(config.localization.defaultLanguage, config);
  const bindings = await listApprovedBindings(storageRoot);
  const existingRequests = await listPromotionRequests(storageRoot);
  const existingMains = new Set(existingRequests.map((request) => normalizeKey(request.mainName)));

  await guild.members.fetch().catch(() => null);

  let eligibleCount = 0;
  let createdCount = 0;
  let skippedCount = 0;
  const created = [];

  for (const binding of bindings) {
    let resolvedProfile;
    try {
      resolvedProfile = await resolveProfileForBinding(storageRoot, binding);
    } catch {
      skippedCount += 1;
      continue;
    }

    const profile = resolvedProfile.profile;
    const probationRoleId = resolveProbationRoleId(profile);
    if (!profile.promotionChannelId || !probationRoleId || !profile.mainRoleId) {
      skippedCount += 1;
      continue;
    }

    const member = guild.members.cache.get(binding.discordUserId)
      || await guild.members.fetch(binding.discordUserId).catch(() => null);
    const eligibleAt = addUtcMonths(binding.approvedAt, profile.probationMonths);
    if (!member || !eligibleAt || eligibleAt > now) {
      skippedCount += 1;
      continue;
    }
    if (!member.roles.cache.has(probationRoleId)) {
      skippedCount += 1;
      continue;
    }
    if (member.roles.cache.has(profile.mainRoleId)) {
      skippedCount += 1;
      continue;
    }

    eligibleCount += 1;
    if (existingMains.has(normalizeKey(binding.mainName))) {
      skippedCount += 1;
      continue;
    }

    const channel = await guild.channels.fetch(profile.promotionChannelId).catch(() => null);
    if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
      skippedCount += 1;
      continue;
    }

    const request = {
      id: generateRequestId(now.getTime() + createdCount),
      mainName: binding.mainName,
      discordUserId: binding.discordUserId,
      discordTag: binding.discordTag,
      onboardingProfileId: resolvedProfile.profileId,
      corporationIds: resolvedProfile.corporationIds,
      probationStartedAt: binding.approvedAt,
      eligibleAt: eligibleAt.toISOString(),
      status: 'pending',
      requestedAt: now.toISOString(),
      channelId: channel.id,
      messageId: '',
    };
    const recruiter = profile.recruiterRoleId ? `<@&${profile.recruiterRoleId}> ` : '';
    const message = await channel.send({
      content: t('promotion.notification.content', {
        recruiter,
        userId: binding.discordUserId,
      }),
      embeds: [buildExpirationEmbed(request, t)],
    });
    request.messageId = message.id;
    await createPromotionRequest(storageRoot, request);
    existingMains.add(normalizeKey(binding.mainName));
    createdCount += 1;
    created.push(request);
  }

  return {
    enabled: true,
    checkedBindingsCount: bindings.length,
    eligibleCount,
    createdCount,
    skippedCount,
    created,
  };
}

async function getPromotionSummary(storageRoot) {
  const requests = await listPromotionRequests(storageRoot);
  return {
    requestsCount: requests.length,
    pendingCount: requests.filter((request) => request.status === 'pending').length,
    approvedMainCount: requests.filter((request) => request.status === 'approved-main').length,
    // Historical compatibility only; new promotion decisions no longer write this state.
    approvedRookieCount: requests.filter((request) => request.status === 'approved-rookie').length,
    rejectedCount: requests.filter((request) => request.status === 'rejected').length,
  };
}

module.exports = {
  FINAL_ROLE_MAIN,
  FINAL_ROLE_ROOKIE,
  addUtcMonths,
  normalizeFinalRole,
  resolveProbationRoleId,
  resolveProfileForBinding,
  resolveApprovedBinding,
  promoteMember,
  buildExpirationEmbed,
  processProbationExpirations,
  getPromotionSummary,
};
