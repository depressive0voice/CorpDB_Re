const { findAllAuthCharacters } = require('../auth/authCharacterRepository');
const {
  getMainBindingConfig,
  findApprovedBindingByDiscordUserId,
  findApprovedBindingByMainName,
  findPendingRequestByDiscordUserId,
  findPendingRequestByMainName,
  findRequestById,
  updateRequestById,
  upsertApprovedBinding,
  listApprovedBindings,
  listPendingRequests,
  removeApprovedBindingByDiscordUserId,
  removeApprovedBindingByMainName,
} = require('./mainBindingRepository');
const {
  getAuthFamilyByMainName,
  buildRequestActionRow,
  buildRequestEmbed,
} = require('./mainBindingService');
const { resolveOnboardingProfileForAuthFamily } = require('../onboarding/onboardingProfileService');
const { getManagedRoleBinding } = require('../roles/managedRolePolicyRepository');
const { grantManagedRole, removeManagedRole } = require('../roles/managedRoleService');
const { syncGuildMemberNicknameToMain } = require('./discordNicknameService');
const { resolveUserLanguage, createTranslator } = require('../localization/localizationService');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function createError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function getMainBindingAdminSummary(storageRoot) {
  const [config, approvedBindings, pendingRequests] = await Promise.all([
    getMainBindingConfig(storageRoot),
    listApprovedBindings(storageRoot),
    listPendingRequests(storageRoot),
  ]);
  return {
    config,
    approvedBindingsCount: approvedBindings.length,
    pendingRequestsCount: pendingRequests.length,
  };
}

async function getBindingByDiscordUserId(storageRoot, discordUserId) {
  return findApprovedBindingByDiscordUserId(storageRoot, discordUserId);
}

async function getBindingByMainName(storageRoot, mainName) {
  return findApprovedBindingByMainName(storageRoot, mainName);
}

async function getMainBindingRequestById(storageRoot, requestId) {
  return findRequestById(storageRoot, requestId);
}

async function getPendingMainBindingRequests(storageRoot) {
  return listPendingRequests(storageRoot);
}

async function getApprovedMainBindings(storageRoot) {
  return listApprovedBindings(storageRoot);
}

async function getTranslatorForUser(context, discordUserId, preferredLanguage = '') {
  const language = normalizeText(preferredLanguage)
    || await resolveUserLanguage(
      context.config.storage.rootDir,
      context.config,
      discordUserId
    ).catch(() => context.config.localization.defaultLanguage || 'en');
  return createTranslator(language, context.config);
}

async function sendDecisionDirectMessage(client, discordUserId, content) {
  const user = await client?.users?.fetch(discordUserId).catch(() => null);
  if (!user) return false;
  return user.send({ content }).then(() => true).catch(() => false);
}

async function repostMainBindingRequest(interaction, context, requestId) {
  const storageRoot = context.config.storage.rootDir;
  const request = await findRequestById(storageRoot, requestId);
  if (!request) {
    throw createError(context.t('bindingAdmin.error.requestNotFound'), 'binding_request_not_found');
  }
  if (normalizeText(request.status) !== 'pending') {
    throw createError(
      context.t('bindingAdmin.error.requestNotPending', { status: request.status }),
      'binding_request_not_pending'
    );
  }

  const family = getAuthFamilyByMainName(
    await findAllAuthCharacters(storageRoot),
    request.mainName
  );
  if (!family.length) {
    throw createError(
      context.t('bindingAdmin.error.mainNotFound', { mainName: request.mainName }),
      'binding_main_not_found_in_auth'
    );
  }

  const config = await getMainBindingConfig(storageRoot);
  const channelId = normalizeText(request.approvalChannelId || config.approvalChannelId);
  if (!channelId) {
    throw createError(context.t('bindingAdmin.error.channelMissing'), 'binding_approval_channel_missing');
  }
  const channel = await interaction.guild?.channels?.fetch(channelId).catch(() => null);
  if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
    throw createError(context.t('bindingAdmin.error.channelInvalid'), 'binding_approval_channel_invalid');
  }

  const applicantT = await getTranslatorForUser(context, request.discordUserId, request.language);
  const message = await channel.send({
    content: applicantT('binding.approval.message', { userId: request.discordUserId }),
    embeds: [buildRequestEmbed(request, family, applicantT)],
    components: [buildRequestActionRow(request.id, applicantT)],
  });
  const updatedRequest = await updateRequestById(storageRoot, request.id, {
    approvalChannelId: channel.id,
    approvalMessageId: message.id,
  });

  return {
    request: updatedRequest,
    family,
    channelId: channel.id,
    messageId: message.id,
  };
}

async function bindDiscordUserToMain(interaction, context, user, mainName, options = {}) {
  const storageRoot = context.config.storage.rootDir;
  const discordUserId = normalizeText(user?.id);
  const discordTag = normalizeText(user?.tag || user?.username || user?.id);
  const requestedMainName = normalizeText(mainName);
  const manageRoles = options.manageRoles !== false;

  if (!discordUserId) {
    throw createError(context.t('bindingAdmin.error.userRequired'), 'binding_user_required');
  }
  if (!requestedMainName) {
    throw createError(context.t('bindingAdmin.error.mainRequired'), 'binding_main_required');
  }

  const authRecords = await findAllAuthCharacters(storageRoot);
  const family = getAuthFamilyByMainName(authRecords, requestedMainName);
  if (!family.length) {
    throw createError(
      context.t('bindingAdmin.error.mainNotFound', { mainName: requestedMainName }),
      'binding_main_not_found_in_auth'
    );
  }
  const canonicalMainName = family[0].main;

  const [existingForUser, existingForMain, pendingForUser, pendingForMain] = await Promise.all([
    findApprovedBindingByDiscordUserId(storageRoot, discordUserId),
    findApprovedBindingByMainName(storageRoot, canonicalMainName),
    findPendingRequestByDiscordUserId(storageRoot, discordUserId),
    findPendingRequestByMainName(storageRoot, canonicalMainName),
  ]);

  if (existingForUser && normalizeKey(existingForUser.mainName) !== normalizeKey(canonicalMainName)) {
    throw createError(
      context.t('bindingAdmin.error.userAlreadyLinked', { mainName: existingForUser.mainName }),
      'binding_user_already_linked'
    );
  }
  if (existingForMain && normalizeText(existingForMain.discordUserId) !== discordUserId) {
    throw createError(
      context.t('bindingAdmin.error.mainAlreadyLinked', { mainName: canonicalMainName }),
      'binding_main_already_linked'
    );
  }

  const matchingPending = pendingForUser
    && pendingForMain
    && normalizeText(pendingForUser.id) === normalizeText(pendingForMain.id)
    && normalizeText(pendingForUser.discordUserId) === discordUserId
    && normalizeKey(pendingForUser.mainName) === normalizeKey(canonicalMainName)
    ? pendingForUser
    : null;

  if (pendingForUser && !matchingPending) {
    throw createError(
      context.t('bindingAdmin.error.pendingUser', { mainName: pendingForUser.mainName }),
      'binding_request_pending_for_user'
    );
  }
  if (pendingForMain && !matchingPending) {
    throw createError(
      context.t('bindingAdmin.error.pendingMain', { mainName: canonicalMainName }),
      'binding_request_pending_for_main'
    );
  }

  let onboarding;
  try {
    onboarding = await resolveOnboardingProfileForAuthFamily(storageRoot, family);
  } catch (error) {
    if (error?.code === 'onboarding_corporation_profile_unconfigured') {
      throw createError(context.t('binding.error.onboardingUnconfigured'), error.code);
    }
    if (error?.code === 'onboarding_corporation_unresolved') {
      throw createError(context.t('binding.error.onboardingUnresolved'), error.code);
    }
    if (error?.code === 'onboarding_profile_ambiguous') {
      throw createError(context.t('binding.error.onboardingAmbiguous'), error.code);
    }
    throw error;
  }

  const member = await interaction.guild?.members?.fetch(discordUserId).catch(() => null);
  if (!member) {
    throw createError(context.t('bindingAdmin.error.memberNotFound'), 'binding_member_not_found');
  }

  const probationRoleId = normalizeText(onboarding.profile.probationRoleId);
  const guestRoleId = await getManagedRoleBinding(storageRoot, 'guest').catch(() => '');
  let roleAssigned = false;
  let guestRemoved = false;
  let approvedRoleId = '';

  if (manageRoles && probationRoleId) {
    const grant = await grantManagedRole(member, probationRoleId, {
      reason: `Manual main binding: ${canonicalMainName}`,
    });
    roleAssigned = grant.changed;
    approvedRoleId = probationRoleId;

    if (guestRoleId && member.roles.cache.has(guestRoleId)) {
      const removed = await removeManagedRole(member, guestRoleId, {
        reason: `Manual main binding: ${canonicalMainName}`,
      });
      guestRemoved = removed.changed;
    }
  }

  const approvedAt = new Date().toISOString();
  const reviewerTag = normalizeText(
    interaction.user?.tag || interaction.user?.username || interaction.user?.id
  );
  await upsertApprovedBinding(storageRoot, {
    discordUserId,
    discordTag,
    mainName: canonicalMainName,
    approvedAt,
    approvedByUserId: normalizeText(interaction.user?.id),
    approvedByTag: reviewerTag,
    approvedRoleId,
    onboardingProfileId: onboarding.profileId,
    corporationIds: onboarding.corporationIds,
  });

  const nicknameSync = await syncGuildMemberNicknameToMain({
    guild: interaction.guild,
    discordUserId,
    mainName: canonicalMainName,
  });

  let pendingClosed = false;
  let updatedRequest = null;
  if (matchingPending) {
    updatedRequest = await updateRequestById(storageRoot, matchingPending.id, {
      status: 'approved',
      reviewedAt: approvedAt,
      reviewedByUserId: normalizeText(interaction.user?.id),
      reviewedByTag: reviewerTag,
      approvedRoleId,
      onboardingProfileId: onboarding.profileId,
      corporationIds: onboarding.corporationIds,
    });
    pendingClosed = true;
  }

  const userT = await getTranslatorForUser(context, discordUserId, matchingPending?.language);
  const dmLines = [
    userT('bindingAdmin.dm.manualTitle'),
    userT('bindingAdmin.dm.main', { mainName: canonicalMainName }),
  ];
  if (approvedRoleId) dmLines.push(userT('bindingAdmin.dm.role', { role: `<@&${approvedRoleId}>` }));
  if (guestRemoved) dmLines.push(userT('binding.dm.guestRemoved'));
  if (nicknameSync.status === 'updated') {
    dmLines.push(userT('binding.nickname.updated', { nickname: canonicalMainName }));
  }
  if (reviewerTag) dmLines.push(userT('bindingAdmin.dm.reviewer', { reviewer: reviewerTag }));
  const dmSent = await sendDecisionDirectMessage(
    interaction.client,
    discordUserId,
    dmLines.join('\n')
  );

  return {
    discordUserId,
    discordTag,
    mainName: canonicalMainName,
    onboarding,
    approvedRoleId,
    roleAssigned,
    guestRemoved,
    nicknameSync,
    pendingClosed,
    updatedRequest,
    dmSent,
    alreadyBound: Boolean(existingForUser && existingForMain),
  };
}

async function tryRemoveApprovedRole(guild, binding) {
  const roleId = normalizeText(binding?.approvedRoleId);
  if (!roleId) return false;
  const member = await guild?.members?.fetch(binding.discordUserId).catch(() => null);
  if (!member || !member.roles?.cache?.has(roleId)) return false;
  try {
    const result = await removeManagedRole(member, roleId, {
      reason: `Main binding unlinked: ${binding.mainName}`,
    });
    return result.changed;
  } catch (error) {
    console.warn(
      `[binding-admin] failed to remove approved role ${roleId} from ${binding.discordUserId}:`,
      error?.message || error
    );
    return false;
  }
}

async function unlinkBindingByDiscordUserId(storageRoot, guild, discordUserId) {
  const removed = await removeApprovedBindingByDiscordUserId(storageRoot, discordUserId);
  if (!removed) {
    throw createError('Approved binding not found.', 'binding_not_found');
  }
  const approvedRoleRemoved = await tryRemoveApprovedRole(guild, removed);
  return { binding: removed, approvedRoleRemoved };
}

async function unlinkBindingByMainName(storageRoot, guild, mainName) {
  const removed = await removeApprovedBindingByMainName(storageRoot, mainName);
  if (!removed) {
    throw createError('Approved binding not found.', 'binding_not_found');
  }
  const approvedRoleRemoved = await tryRemoveApprovedRole(guild, removed);
  return { binding: removed, approvedRoleRemoved };
}

module.exports = {
  getMainBindingAdminSummary,
  getBindingByDiscordUserId,
  getBindingByMainName,
  getMainBindingRequestById,
  getPendingMainBindingRequests,
  getApprovedMainBindings,
  repostMainBindingRequest,
  bindDiscordUserToMain,
  unlinkBindingByDiscordUserId,
  unlinkBindingByMainName,
};
