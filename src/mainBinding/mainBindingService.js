const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const { findAllAuthCharacters } = require('../auth/authCharacterRepository');
const {
  getMainBindingConfig,
  updateMainBindingConfig,
  findApprovedBindingByDiscordUserId,
  findApprovedBindingByMainName,
  findPendingRequestByDiscordUserId,
  findPendingRequestByMainName,
  findRequestById,
  createPendingRequest,
  updateRequestById,
  upsertApprovedBinding,
} = require('./mainBindingRepository');
const { getManagedRoleBinding } = require('../roles/managedRolePolicyRepository');
const { grantManagedRole, removeManagedRole } = require('../roles/managedRoleService');
const { ACCESS_LEVELS, getBaseAccessLevel } = require('../access/accessService');
const { resolveOnboardingProfileForAuthFamily } = require('../onboarding/onboardingProfileService');
const { syncGuildMemberNicknameToMain, formatNicknameSyncLine } = require('./discordNicknameService');
const { resolveUserLanguage, createTranslator } = require('../localization/localizationService');

const BUTTON_PREFIX = 'mainbinding';
const ACTION_APPROVE = 'approve';
const ACTION_REJECT = 'reject';

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

function generateRequestId(now = Date.now()) {
  return `${now}-${Math.random().toString(36).slice(2, 10)}`;
}

function getAuthFamilyByMainName(authRecords, mainName) {
  const target = normalizeKey(mainName);
  return (Array.isArray(authRecords) ? authRecords : [])
    .filter((record) => normalizeKey(record.main) === target)
    .sort((left, right) => normalizeText(left.alt).localeCompare(normalizeText(right.alt)));
}

function ensureMainExists(authRecords, mainName, t) {
  const family = getAuthFamilyByMainName(authRecords, mainName);
  if (family.length === 0) {
    throw createError(
      t('binding.error.mainNotFound', { mainName }),
      'binding_main_not_found_in_auth'
    );
  }
  return family;
}

function buildRequestCustomId(action, requestId) {
  return `${BUTTON_PREFIX}:${action}:${requestId}`;
}

function parseRequestCustomId(customId) {
  const parts = String(customId || '').split(':');
  if (parts.length !== 3 || parts[0] !== BUTTON_PREFIX) return null;
  return { prefix: parts[0], action: parts[1], requestId: parts[2] };
}

function isMainBindingButton(customId) {
  return String(customId || '').startsWith(`${BUTTON_PREFIX}:`);
}

function buildRequestActionRow(requestId, t, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildRequestCustomId(ACTION_APPROVE, requestId))
      .setLabel(t('binding.button.approve'))
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(buildRequestCustomId(ACTION_REJECT, requestId))
      .setLabel(t('binding.button.reject'))
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

function buildLimitedListValue(items, emptyValue) {
  const values = (Array.isArray(items) ? items : []).map(normalizeText).filter(Boolean);
  if (!values.length) return emptyValue;

  const output = [];
  let length = 0;
  for (const value of values.slice(0, 50)) {
    const candidateLength = length + (output.length ? 2 : 0) + value.length;
    if (candidateLength > 950) break;
    output.push(value);
    length = candidateLength;
  }

  const hidden = values.length - output.length;
  return `${output.join(', ')}${hidden > 0 ? ` … +${hidden}` : ''}`;
}

function statusLabel(status, t) {
  const normalized = normalizeText(status).toLowerCase();
  if (normalized === 'approved') return t('binding.status.approved');
  if (normalized === 'rejected') return t('binding.status.rejected');
  return t('binding.status.pending');
}

function buildRequestEmbed(request, family, t) {
  const alts = family.map((record) => record.alt);
  const corporations = [...new Set(family.map((record) => record.corp).filter(Boolean))];
  const fields = [
    { name: t('binding.embed.requestId'), value: request.id || t('binding.value.notSet') },
    { name: t('binding.embed.applicant'), value: `<@${request.discordUserId}>`, inline: true },
    { name: t('binding.embed.discordTag'), value: request.discordTag || t('binding.value.notSet'), inline: true },
    { name: t('binding.embed.main'), value: request.mainName, inline: true },
    { name: t('binding.embed.alts'), value: buildLimitedListValue(alts, t('common.none')) },
    { name: t('binding.embed.corporations'), value: buildLimitedListValue(corporations, t('common.none')) },
    { name: t('binding.embed.status'), value: statusLabel(request.status, t), inline: true },
    {
      name: t('binding.embed.created'),
      value: request.requestedAt
        ? `<t:${Math.floor(Date.parse(request.requestedAt) / 1000)}:F>`
        : t('binding.value.notSet'),
      inline: true,
    },
  ];

  if (request.reviewedByTag || request.reviewedAt || request.approvedRoleId) {
    const reviewLines = [];
    if (request.reviewedByTag) {
      reviewLines.push(t('binding.embed.reviewedBy', { reviewer: request.reviewedByTag }));
    }
    if (request.reviewedAt) {
      reviewLines.push(t('binding.embed.reviewedAt', {
        time: `<t:${Math.floor(Date.parse(request.reviewedAt) / 1000)}:F>`,
      }));
    }
    if (request.approvedRoleId) {
      reviewLines.push(t('binding.embed.roleGranted', { role: `<@&${request.approvedRoleId}>` }));
    }
    fields.push({ name: t('binding.embed.review'), value: reviewLines.join('\n') });
  }

  const embed = new EmbedBuilder()
    .setTitle(t('binding.embed.title'))
    .addFields(...fields)
    .setTimestamp(new Date(request.requestedAt || Date.now()));

  if (request.status === 'approved') embed.setColor(0x57f287);
  else if (request.status === 'rejected') embed.setColor(0xed4245);
  else embed.setColor(0x5865f2);
  return embed;
}

async function resolveApprovalChannel(storageRoot, guild, t) {
  const config = await getMainBindingConfig(storageRoot);
  if (!config.approvalChannelId) {
    throw createError(t('binding.error.channelMissing'), 'binding_approval_channel_missing');
  }
  const channel = await guild.channels.fetch(config.approvalChannelId).catch(() => null);
  if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
    throw createError(t('binding.error.channelInvalid'), 'binding_approval_channel_invalid');
  }
  return channel;
}

async function setApprovalChannel(storageRoot, channelId) {
  return updateMainBindingConfig(storageRoot, {
    approvalChannelId: normalizeText(channelId),
  });
}

async function getBindingConfigSummary(storageRoot) {
  return getMainBindingConfig(storageRoot);
}

async function requestMainBinding(interaction, context, mainName) {
  const storageRoot = context.config.storage.rootDir;
  const cleanMainName = normalizeText(mainName);
  const authRecords = await findAllAuthCharacters(storageRoot);
  const family = ensureMainExists(authRecords, cleanMainName, context.t);

  const existingForUser = await findApprovedBindingByDiscordUserId(storageRoot, interaction.user.id);
  if (existingForUser) {
    throw createError(
      context.t('binding.error.userAlreadyLinked', { mainName: existingForUser.mainName }),
      'binding_user_already_linked'
    );
  }

  const existingForMain = await findApprovedBindingByMainName(storageRoot, cleanMainName);
  if (existingForMain) {
    throw createError(
      context.t('binding.error.mainAlreadyLinked', { mainName: cleanMainName }),
      'binding_main_already_linked'
    );
  }

  if (await findPendingRequestByDiscordUserId(storageRoot, interaction.user.id)) {
    throw createError(context.t('binding.error.pendingUser'), 'binding_request_pending_for_user');
  }
  if (await findPendingRequestByMainName(storageRoot, cleanMainName)) {
    throw createError(
      context.t('binding.error.pendingMain', { mainName: cleanMainName }),
      'binding_request_pending_for_main'
    );
  }

  const request = {
    id: generateRequestId(),
    discordUserId: interaction.user.id,
    discordTag: interaction.user.tag || interaction.user.username || interaction.user.id,
    mainName: family[0].main,
    status: 'pending',
    language: context.language,
    requestedAt: new Date().toISOString(),
    approvalChannelId: '',
    approvalMessageId: '',
    reviewedAt: '',
    reviewedByUserId: '',
    reviewedByTag: '',
    approvedRoleId: '',
    onboardingProfileId: '',
    corporationIds: [],
  };

  const approvalChannel = await resolveApprovalChannel(storageRoot, interaction.guild, context.t);
  const message = await approvalChannel.send({
    content: context.t('binding.approval.message', { userId: request.discordUserId }),
    embeds: [buildRequestEmbed(request, family, context.t)],
    components: [buildRequestActionRow(request.id, context.t)],
  });

  request.approvalChannelId = approvalChannel.id;
  request.approvalMessageId = message.id;
  await createPendingRequest(storageRoot, request);
  return { request, family };
}

async function isBindingReviewer(config, storageRoot, member) {
  const access = await getBaseAccessLevel(config, storageRoot, member);
  return access.level === ACCESS_LEVELS.ADMIN
    || access.level === ACCESS_LEVELS.MASTER_ADMIN;
}

async function getRequestTranslator(config, storageRoot, request) {
  const language = request?.language
    || await resolveUserLanguage(storageRoot, config, request.discordUserId).catch(() => 'en');
  return createTranslator(language, config);
}

async function sendDecisionDirectMessage(client, request, content) {
  const user = await client?.users?.fetch(request.discordUserId).catch(() => null);
  if (!user) return false;
  return user.send({ content }).then(() => true).catch(() => false);
}

function localizeOnboardingResolutionError(error, t) {
  if (error?.code === 'onboarding_corporation_profile_unconfigured') {
    return createError(t('binding.error.onboardingUnconfigured'), error.code);
  }
  if (error?.code === 'onboarding_corporation_unresolved') {
    return createError(t('binding.error.onboardingUnresolved'), error.code);
  }
  if (error?.code === 'onboarding_profile_ambiguous') {
    return createError(t('binding.error.onboardingAmbiguous'), error.code);
  }
  return error;
}

async function approveMainBindingRequest(interaction, context, requestId) {
  const storageRoot = context.config.storage.rootDir;
  const request = await findRequestById(storageRoot, requestId);
  if (!request) {
    throw createError(context.t('binding.error.requestNotFound'), 'binding_request_not_found');
  }
  if (request.status !== 'pending') {
    throw createError(
      context.t('binding.error.requestNotPending', { status: request.status }),
      'binding_request_not_pending'
    );
  }
  if (!(await isBindingReviewer(context.config, storageRoot, interaction.member))) {
    throw createError(context.t('binding.error.reviewerAccess'), 'access_denied');
  }

  const authRecords = await findAllAuthCharacters(storageRoot);
  const applicantT = await getRequestTranslator(context.config, storageRoot, request);
  const family = ensureMainExists(authRecords, request.mainName, applicantT);

  const existingForMain = await findApprovedBindingByMainName(storageRoot, request.mainName);
  if (existingForMain && String(existingForMain.discordUserId) !== String(request.discordUserId)) {
    throw createError(
      context.t('binding.error.mainAlreadyLinked', { mainName: request.mainName }),
      'binding_main_already_linked'
    );
  }

  const existingForUser = await findApprovedBindingByDiscordUserId(storageRoot, request.discordUserId);
  if (existingForUser && normalizeKey(existingForUser.mainName) !== normalizeKey(request.mainName)) {
    throw createError(
      context.t('binding.error.userAlreadyLinked', { mainName: existingForUser.mainName }),
      'binding_user_already_linked'
    );
  }

  const targetMember = await interaction.guild.members.fetch(request.discordUserId).catch(() => null);
  if (!targetMember) {
    throw createError(context.t('binding.error.memberNotFound'), 'binding_member_not_found');
  }

  let onboarding;
  try {
    onboarding = await resolveOnboardingProfileForAuthFamily(storageRoot, family);
  } catch (error) {
    throw localizeOnboardingResolutionError(error, context.t);
  }

  const probationRoleId = onboarding.profile.probationRoleId || '';
  const guestRoleId = await getManagedRoleBinding(storageRoot, 'guest').catch(() => '');
  let roleAssigned = false;
  let guestRemoved = false;

  if (probationRoleId) {
    const grantResult = await grantManagedRole(targetMember, probationRoleId, {
      reason: `Main binding approved: ${request.mainName}`,
    });
    roleAssigned = grantResult.changed;

    if (guestRoleId && targetMember.roles.cache.has(guestRoleId)) {
      const removeResult = await removeManagedRole(targetMember, guestRoleId, {
        reason: `Main binding approved: ${request.mainName}`,
      });
      guestRemoved = removeResult.changed;
    }
  }

  const reviewedAt = new Date().toISOString();
  await upsertApprovedBinding(storageRoot, {
    discordUserId: request.discordUserId,
    discordTag: request.discordTag,
    mainName: request.mainName,
    approvedAt: reviewedAt,
    approvedByUserId: interaction.user.id,
    approvedByTag: interaction.user.tag || interaction.user.username || interaction.user.id,
    approvedRoleId: probationRoleId,
    onboardingProfileId: onboarding.profileId,
    corporationIds: onboarding.corporationIds,
  });

  const nicknameSync = await syncGuildMemberNicknameToMain({
    guild: interaction.guild,
    discordUserId: request.discordUserId,
    mainName: request.mainName,
  });

  const updatedRequest = await updateRequestById(storageRoot, request.id, {
    status: 'approved',
    reviewedAt,
    reviewedByUserId: interaction.user.id,
    reviewedByTag: interaction.user.tag || interaction.user.username || interaction.user.id,
    approvedRoleId: probationRoleId,
    onboardingProfileId: onboarding.profileId,
    corporationIds: onboarding.corporationIds,
  });

  const dmLines = [
    applicantT('binding.dm.approvedTitle'),
    applicantT('binding.request.main', { mainName: request.mainName }),
  ];
  if (probationRoleId) {
    dmLines.push(applicantT('binding.dm.roleGranted', { role: `<@&${probationRoleId}>` }));
  }
  if (guestRemoved) dmLines.push(applicantT('binding.dm.guestRemoved'));
  if (nicknameSync.status === 'updated') {
    dmLines.push(applicantT('binding.nickname.updated', { nickname: request.mainName }));
  }
  dmLines.push(applicantT('binding.dm.reviewedBy', { reviewer: updatedRequest.reviewedByTag }));
  const dmSent = await sendDecisionDirectMessage(interaction.client, request, dmLines.join('\n'));

  return {
    request: updatedRequest,
    family,
    targetMember,
    onboarding,
    probationRoleId,
    roleAssigned,
    guestRemoved,
    nicknameSync,
    dmSent,
    applicantT,
  };
}

async function rejectMainBindingRequest(interaction, context, requestId) {
  const storageRoot = context.config.storage.rootDir;
  const request = await findRequestById(storageRoot, requestId);
  if (!request) {
    throw createError(context.t('binding.error.requestNotFound'), 'binding_request_not_found');
  }
  if (request.status !== 'pending') {
    throw createError(
      context.t('binding.error.requestNotPending', { status: request.status }),
      'binding_request_not_pending'
    );
  }
  if (!(await isBindingReviewer(context.config, storageRoot, interaction.member))) {
    throw createError(context.t('binding.error.reviewerAccess'), 'access_denied');
  }

  const applicantT = await getRequestTranslator(context.config, storageRoot, request);
  const family = ensureMainExists(
    await findAllAuthCharacters(storageRoot),
    request.mainName,
    applicantT
  );
  const reviewedAt = new Date().toISOString();
  const updatedRequest = await updateRequestById(storageRoot, request.id, {
    status: 'rejected',
    reviewedAt,
    reviewedByUserId: interaction.user.id,
    reviewedByTag: interaction.user.tag || interaction.user.username || interaction.user.id,
    approvedRoleId: '',
  });

  const dmSent = await sendDecisionDirectMessage(interaction.client, request, [
    applicantT('binding.dm.rejectedTitle'),
    applicantT('binding.request.main', { mainName: request.mainName }),
    applicantT('binding.dm.reviewedBy', { reviewer: updatedRequest.reviewedByTag }),
  ].join('\n'));

  return { request: updatedRequest, family, dmSent, applicantT };
}

async function handleMainBindingButtonInteraction(interaction, context) {
  const parsed = parseRequestCustomId(interaction.customId);
  if (!parsed) return false;

  await interaction.deferUpdate();

  try {
    if (parsed.action === ACTION_APPROVE) {
      const result = await approveMainBindingRequest(interaction, context, parsed.requestId);
      await interaction.editReply({
        embeds: [buildRequestEmbed(result.request, result.family, result.applicantT)],
        components: [buildRequestActionRow(result.request.id, result.applicantT, true)],
      });

      const lines = [context.t('binding.review.approved', {
        mainName: result.request.mainName,
        userId: result.request.discordUserId,
      })];
      if (result.probationRoleId) {
        lines.push(context.t('binding.review.probation', {
          role: `<@&${result.probationRoleId}>`,
        }));
      }
      if (result.guestRemoved) lines.push(context.t('binding.review.guestRemoved'));
      lines.push(formatNicknameSyncLine(result.nicknameSync, context.t));
      lines.push(context.t(result.dmSent ? 'binding.review.dmSent' : 'binding.review.dmFailed'));
      await interaction.followUp({
        content: lines.join('\n'),
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (parsed.action === ACTION_REJECT) {
      const result = await rejectMainBindingRequest(interaction, context, parsed.requestId);
      await interaction.editReply({
        embeds: [buildRequestEmbed(result.request, result.family, result.applicantT)],
        components: [buildRequestActionRow(result.request.id, result.applicantT, true)],
      });
      await interaction.followUp({
        content: [
          context.t('binding.review.rejected', {
            mainName: result.request.mainName,
            userId: result.request.discordUserId,
          }),
          context.t(result.dmSent ? 'binding.review.dmSent' : 'binding.review.dmFailed'),
        ].join('\n'),
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    await interaction.followUp({
      content: context.t('binding.error.unknownAction'),
      flags: MessageFlags.Ephemeral,
    });
    return true;
  } catch (error) {
    if (error.code === 'binding_request_not_pending') {
      const latest = await findRequestById(context.config.storage.rootDir, parsed.requestId);
      if (latest) {
        const applicantT = await getRequestTranslator(
          context.config,
          context.config.storage.rootDir,
          latest
        );
        const family = getAuthFamilyByMainName(
          await findAllAuthCharacters(context.config.storage.rootDir),
          latest.mainName
        );
        if (family.length) {
          await interaction.editReply({
            embeds: [buildRequestEmbed(latest, family, applicantT)],
            components: [buildRequestActionRow(latest.id, applicantT, true)],
          }).catch(() => null);
        }
      }
    }

    await interaction.followUp({
      content: error?.message || context.t('common.unknownError'),
      flags: MessageFlags.Ephemeral,
    }).catch(() => null);
    return true;
  }
}

module.exports = {
  BUTTON_PREFIX,
  ACTION_APPROVE,
  ACTION_REJECT,
  getAuthFamilyByMainName,
  buildRequestCustomId,
  parseRequestCustomId,
  isMainBindingButton,
  buildRequestActionRow,
  buildRequestEmbed,
  setApprovalChannel,
  getBindingConfigSummary,
  requestMainBinding,
  isBindingReviewer,
  approveMainBindingRequest,
  rejectMainBindingRequest,
  handleMainBindingButtonInteraction,
};
