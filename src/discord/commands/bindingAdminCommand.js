const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { ACCESS_LEVELS, getBaseAccessLevel } = require('../../access/accessService');
const {
  approveMainBindingRequest,
  rejectMainBindingRequest,
} = require('../../mainBinding/mainBindingService');
const {
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
} = require('../../mainBinding/mainBindingAdminService');
const { formatNicknameSyncLine } = require('../../mainBinding/discordNicknameService');

const MESSAGE_MAX_LENGTH = 1800;

function localizedDescription(option, en, ru) {
  return option.setDescription(en).setDescriptionLocalizations({ ru});
}

const data = new SlashCommandBuilder()
  .setName('binding-admin')
  .setDescription('Inspect and manage main character bindings')
  .setDescriptionLocalizations({
    ru: 'Проверить и управлять привязками мейнов',
  })
  .addSubcommand((subcommand) => localizedDescription(
    subcommand.setName('status'),
    'Show main binding process status',
    'Показать состояние процесса привязки'))
  .addSubcommand((subcommand) => localizedDescription(
    subcommand.setName('show-user'),
    'Show binding for a Discord user',
    'Показать привязку по Discord-пользователю').addUserOption((option) => localizedDescription(
    option.setName('user').setRequired(true),
    'Discord user',
    'Discord-пользователь')))
  .addSubcommand((subcommand) => localizedDescription(
    subcommand.setName('show-main'),
    'Show binding by main character name',
    'Показать привязку по имени мейна').addStringOption((option) => localizedDescription(
    option.setName('main').setRequired(true).setMaxLength(100),
    'Main character name',
    'Имя мейна')))
  .addSubcommand((subcommand) => localizedDescription(
    subcommand.setName('show-request'),
    'Show a binding request by ID',
    'Показать заявку на привязку по ID').addStringOption((option) => localizedDescription(
    option.setName('request-id').setRequired(true).setMaxLength(100),
    'Binding request ID',
    'ID заявки')))
  .addSubcommand((subcommand) => localizedDescription(
    subcommand.setName('list-pending'),
    'List pending binding requests',
    'Показать ожидающие заявки на привязку'))
  .addSubcommand((subcommand) => localizedDescription(
    subcommand.setName('approve'),
    'Approve a pending binding request',
    'Одобрить ожидающую заявку по ID').addStringOption((option) => localizedDescription(
    option.setName('request-id').setRequired(true).setMaxLength(100),
    'Binding request ID',
    'ID заявки')))
  .addSubcommand((subcommand) => localizedDescription(
    subcommand.setName('bind-user'),
    'Manually bind a Discord user to a main',
    'Вручную привязать Discord-пользователя к мейну').addUserOption((option) => localizedDescription(
    option.setName('user').setRequired(true),
    'Discord user',
    'Discord-пользователь')).addStringOption((option) => localizedDescription(
    option.setName('main').setRequired(true).setMaxLength(100),
    'Main character name',
    'Имя мейна')).addBooleanOption((option) => localizedDescription(
    option.setName('manage-roles').setRequired(false),
    'Grant Probation and remove Guest when possible',
    'Выдать Probation и снять Guest, если возможно')))
  .addSubcommand((subcommand) => localizedDescription(
    subcommand.setName('reject'),
    'Reject a pending binding request',
    'Отклонить ожидающую заявку по ID').addStringOption((option) => localizedDescription(
    option.setName('request-id').setRequired(true).setMaxLength(100),
    'Binding request ID',
    'ID заявки')))
  .addSubcommand((subcommand) => localizedDescription(
    subcommand.setName('repost-request'),
    'Repost a pending request to the approval channel',
    'Перепостить ожидающую заявку в approval channel').addStringOption((option) => localizedDescription(
    option.setName('request-id').setRequired(true).setMaxLength(100),
    'Binding request ID',
    'ID заявки')))
  .addSubcommand((subcommand) => localizedDescription(
    subcommand.setName('list-approved'),
    'List approved main bindings',
    'Показать одобренные привязки'))
  .addSubcommand((subcommand) => localizedDescription(
    subcommand.setName('unlink-user'),
    'Remove a binding by Discord user',
    'Удалить привязку по Discord-пользователю').addUserOption((option) => localizedDescription(
    option.setName('user').setRequired(true),
    'Discord user',
    'Discord-пользователь')))
  .addSubcommand((subcommand) => localizedDescription(
    subcommand.setName('unlink-main'),
    'Remove a binding by main character name',
    'Удалить привязку по имени мейна').addStringOption((option) => localizedDescription(
    option.setName('main').setRequired(true).setMaxLength(100),
    'Main character name',
    'Имя мейна')));

function formatDateTime(value, context) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp)
    ? `<t:${Math.floor(timestamp / 1000)}:F>`
    : context.t('bindingAdmin.common.notSet');
}

function formatRole(roleId, context) {
  return roleId ? `<@&${roleId}>` : context.t('bindingAdmin.common.notSet');
}

function formatChannel(channelId, context) {
  return channelId ? `<#${channelId}>` : context.t('bindingAdmin.common.notSet');
}

function formatCorporations(ids, context) {
  return Array.isArray(ids) && ids.length
    ? ids.join(', ')
    : context.t('bindingAdmin.common.none');
}

function splitLongLine(line, maxLength = MESSAGE_MAX_LENGTH) {
  const parts = [];
  let rest = String(line ?? '');
  while (rest.length > maxLength) {
    parts.push(rest.slice(0, maxLength));
    rest = rest.slice(maxLength);
  }
  parts.push(rest);
  return parts;
}

function chunkLines(lines, maxLength = MESSAGE_MAX_LENGTH) {
  const chunks = [];
  let current = '';
  for (const originalLine of lines) {
    for (const line of splitLongLine(originalLine, maxLength)) {
      const candidate = current ? `${current}\n${line}` : line;
      if (candidate.length <= maxLength) {
        current = candidate;
      } else {
        if (current) chunks.push(current);
        current = line;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function replyLines(interaction, lines) {
  const chunks = chunkLines(lines);
  const first = chunks.shift() || '';
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: first });
  } else {
    await interaction.reply({ content: first, flags: MessageFlags.Ephemeral });
  }
  for (const chunk of chunks) {
    await interaction.followUp({ content: chunk, flags: MessageFlags.Ephemeral });
  }
}

async function requireMasterAdmin(interaction, context) {
  const access = await getBaseAccessLevel(
    context.config,
    context.config.storage.rootDir,
    interaction.member
  );
  if (access.level === ACCESS_LEVELS.MASTER_ADMIN) return true;
  await interaction.reply({
    content: context.t('bindingAdmin.error.masterAdmin'),
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

function bindingLines(binding, context, titleKey, userDisplay = '') {
  return [
    context.t(titleKey),
    userDisplay
      ? context.t('bindingAdmin.field.user', { user: userDisplay })
      : context.t('bindingAdmin.field.user', { user: `<@${binding.discordUserId}>` }),
    context.t('bindingAdmin.field.main', { mainName: binding.mainName }),
    context.t('bindingAdmin.field.discordTag', {
      tag: binding.discordTag || context.t('bindingAdmin.common.notSet'),
    }),
    context.t('bindingAdmin.field.approvedAt', { time: formatDateTime(binding.approvedAt, context) }),
    context.t('bindingAdmin.field.approvedBy', {
      reviewer: binding.approvedByTag || context.t('bindingAdmin.common.notSet'),
    }),
    context.t('bindingAdmin.field.approvedRole', { role: formatRole(binding.approvedRoleId, context) }),
    context.t('bindingAdmin.field.profile', {
      profile: binding.onboardingProfileId || context.t('bindingAdmin.common.notSet'),
    }),
    context.t('bindingAdmin.field.corporations', {
      corporations: formatCorporations(binding.corporationIds, context),
    }),
  ];
}

async function execute(interaction, context) {
  const storageRoot = context.config.storage.rootDir;
  const subcommand = interaction.options.getSubcommand();

  try {
    if (subcommand === 'status') {
      const summary = await getMainBindingAdminSummary(storageRoot);
      await replyLines(interaction, [
        context.t('bindingAdmin.status.title'),
        context.t('bindingAdmin.status.channel', {
          channel: formatChannel(summary.config.approvalChannelId, context),
        }),
        context.t('bindingAdmin.status.approved', { count: summary.approvedBindingsCount }),
        context.t('bindingAdmin.status.pending', { count: summary.pendingRequestsCount }),
      ]);
      return;
    }

    if (subcommand === 'show-user') {
      const user = interaction.options.getUser('user', true);
      const binding = await getBindingByDiscordUserId(storageRoot, user.id);
      if (!binding) {
        await replyLines(interaction, [context.t('bindingAdmin.notFound.user', { user: user.tag })]);
        return;
      }
      await replyLines(interaction, bindingLines(binding, context, 'bindingAdmin.showUser.title', user.tag));
      return;
    }

    if (subcommand === 'show-main') {
      const mainName = interaction.options.getString('main', true);
      const binding = await getBindingByMainName(storageRoot, mainName);
      if (!binding) {
        await replyLines(interaction, [context.t('bindingAdmin.notFound.main', { mainName })]);
        return;
      }
      await replyLines(interaction, bindingLines(binding, context, 'bindingAdmin.showMain.title'));
      return;
    }

    if (subcommand === 'show-request') {
      const requestId = interaction.options.getString('request-id', true);
      const request = await getMainBindingRequestById(storageRoot, requestId);
      if (!request) {
        await replyLines(interaction, [context.t('bindingAdmin.notFound.request', { id: requestId })]);
        return;
      }
      await replyLines(interaction, [
        context.t('bindingAdmin.showRequest.title'),
        context.t('bindingAdmin.field.requestId', { id: request.id }),
        context.t('bindingAdmin.field.status', { status: request.status || context.t('bindingAdmin.common.notSet') }),
        context.t('bindingAdmin.field.main', { mainName: request.mainName }),
        context.t('bindingAdmin.field.user', { user: `<@${request.discordUserId}>` }),
        context.t('bindingAdmin.field.discordTag', { tag: request.discordTag || context.t('bindingAdmin.common.notSet') }),
        context.t('bindingAdmin.field.requestedAt', { time: formatDateTime(request.requestedAt, context) }),
        context.t('bindingAdmin.field.approvalChannel', { channel: formatChannel(request.approvalChannelId, context) }),
        context.t('bindingAdmin.field.approvalMessage', { messageId: request.approvalMessageId || context.t('bindingAdmin.common.notSet') }),
        context.t('bindingAdmin.field.reviewedAt', { time: formatDateTime(request.reviewedAt, context) }),
        context.t('bindingAdmin.field.reviewedBy', { reviewer: request.reviewedByTag || context.t('bindingAdmin.common.notSet') }),
        context.t('bindingAdmin.field.approvedRole', { role: formatRole(request.approvedRoleId, context) }),
        context.t('bindingAdmin.field.profile', { profile: request.onboardingProfileId || context.t('bindingAdmin.common.notSet') }),
        context.t('bindingAdmin.field.corporations', { corporations: formatCorporations(request.corporationIds, context) }),
      ]);
      return;
    }

    if (subcommand === 'list-pending') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const requests = await getPendingMainBindingRequests(storageRoot);
      await replyLines(interaction, [
        context.t('bindingAdmin.pending.title'),
        ...(requests.length ? requests.map((request) => (
          `- **${request.id}** | ${request.mainName} ← <@${request.discordUserId}> | ${formatDateTime(request.requestedAt, context)}`
        )) : [context.t('bindingAdmin.list.empty')]),
      ]);
      return;
    }

    if (subcommand === 'approve') {
      const requestId = interaction.options.getString('request-id', true);
      const result = await approveMainBindingRequest(interaction, context, requestId);
      await replyLines(interaction, [
        context.t('bindingAdmin.approve.title'),
        context.t('bindingAdmin.field.requestId', { id: result.request.id }),
        context.t('bindingAdmin.field.main', { mainName: result.request.mainName }),
        context.t('bindingAdmin.field.user', { user: `<@${result.request.discordUserId}>` }),
        result.roleAssigned && result.probationRoleId
          ? context.t('bindingAdmin.bind.roleGranted', { role: `<@&${result.probationRoleId}>` })
          : context.t('bindingAdmin.bind.roleNotGranted'),
        result.guestRemoved
          ? context.t('bindingAdmin.bind.guestRemoved')
          : context.t('bindingAdmin.bind.guestNotRemoved'),
        formatNicknameSyncLine(result.nicknameSync, context.t),
        context.t(result.dmSent ? 'bindingAdmin.result.dmSent' : 'bindingAdmin.result.dmFailed'),
      ]);
      return;
    }

    if (subcommand === 'bind-user') {
      const user = interaction.options.getUser('user', true);
      const mainName = interaction.options.getString('main', true);
      const manageRoles = interaction.options.getBoolean('manage-roles');
      const result = await bindDiscordUserToMain(interaction, context, user, mainName, {
        manageRoles: manageRoles === null ? true : manageRoles,
      });
      await replyLines(interaction, [
        context.t('bindingAdmin.bind.title'),
        context.t('bindingAdmin.field.user', { user: user.tag }),
        context.t('bindingAdmin.field.main', { mainName: result.mainName }),
        result.approvedRoleId
          ? context.t('bindingAdmin.bind.roleGranted', { role: `<@&${result.approvedRoleId}>` })
          : context.t('bindingAdmin.bind.roleNotGranted'),
        result.guestRemoved
          ? context.t('bindingAdmin.bind.guestRemoved')
          : context.t('bindingAdmin.bind.guestNotRemoved'),
        formatNicknameSyncLine(result.nicknameSync, context.t),
        context.t(result.pendingClosed ? 'bindingAdmin.bind.pendingClosed' : 'bindingAdmin.bind.pendingNotClosed'),
        context.t(result.dmSent ? 'bindingAdmin.result.dmSent' : 'bindingAdmin.result.dmFailed'),
      ]);
      return;
    }

    if (subcommand === 'reject') {
      const requestId = interaction.options.getString('request-id', true);
      const result = await rejectMainBindingRequest(interaction, context, requestId);
      await replyLines(interaction, [
        context.t('bindingAdmin.reject.title'),
        context.t('bindingAdmin.field.requestId', { id: result.request.id }),
        context.t('bindingAdmin.field.main', { mainName: result.request.mainName }),
        context.t('bindingAdmin.field.user', { user: `<@${result.request.discordUserId}>` }),
        context.t(result.dmSent ? 'bindingAdmin.result.dmSent' : 'bindingAdmin.result.dmFailed'),
      ]);
      return;
    }

    if (subcommand === 'repost-request') {
      const requestId = interaction.options.getString('request-id', true);
      const result = await repostMainBindingRequest(interaction, context, requestId);
      await replyLines(interaction, [
        context.t('bindingAdmin.repost.title'),
        context.t('bindingAdmin.field.requestId', { id: result.request.id }),
        context.t('bindingAdmin.field.main', { mainName: result.request.mainName }),
        context.t('bindingAdmin.repost.channel', { channel: `<#${result.channelId}>` }),
        context.t('bindingAdmin.repost.message', { messageId: result.messageId }),
      ]);
      return;
    }

    if (subcommand === 'list-approved') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const bindings = await getApprovedMainBindings(storageRoot);
      await replyLines(interaction, [
        context.t('bindingAdmin.approved.title'),
        ...(bindings.length ? bindings.map((binding) => (
          `- ${binding.mainName} ← <@${binding.discordUserId}> | ${formatDateTime(binding.approvedAt, context)}`
        )) : [context.t('bindingAdmin.list.empty')]),
      ]);
      return;
    }

    if (subcommand === 'unlink-user') {
      if (!(await requireMasterAdmin(interaction, context))) return;
      const user = interaction.options.getUser('user', true);
      const result = await unlinkBindingByDiscordUserId(storageRoot, interaction.guild, user.id);
      await replyLines(interaction, [
        context.t('bindingAdmin.unlink.title'),
        context.t('bindingAdmin.field.user', { user: user.tag }),
        context.t('bindingAdmin.field.main', { mainName: result.binding.mainName }),
        context.t(result.approvedRoleRemoved ? 'bindingAdmin.unlink.roleRemoved' : 'bindingAdmin.unlink.roleNotRemoved'),
      ]);
      return;
    }

    if (subcommand === 'unlink-main') {
      if (!(await requireMasterAdmin(interaction, context))) return;
      const mainName = interaction.options.getString('main', true);
      const result = await unlinkBindingByMainName(storageRoot, interaction.guild, mainName);
      await replyLines(interaction, [
        context.t('bindingAdmin.unlink.title'),
        context.t('bindingAdmin.field.main', { mainName: result.binding.mainName }),
        context.t('bindingAdmin.field.user', { user: `<@${result.binding.discordUserId}>` }),
        context.t(result.approvedRoleRemoved ? 'bindingAdmin.unlink.roleRemoved' : 'bindingAdmin.unlink.roleNotRemoved'),
      ]);
    }
  } catch (error) {
    const knownKey = {
      binding_request_not_found: 'bindingAdmin.error.requestNotFound',
      binding_request_not_pending: 'bindingAdmin.error.requestNotPending',
      binding_main_not_found_in_auth: 'bindingAdmin.error.mainNotFound',
      binding_approval_channel_missing: 'bindingAdmin.error.channelMissing',
      binding_approval_channel_invalid: 'bindingAdmin.error.channelInvalid',
      binding_user_required: 'bindingAdmin.error.userRequired',
      binding_main_required: 'bindingAdmin.error.mainRequired',
      binding_member_not_found: 'bindingAdmin.error.memberNotFound',
      binding_not_found: 'bindingAdmin.error.bindingNotFound',
    }[error?.code];
    const content = knownKey
      ? context.t(knownKey, { status: error?.status || '', mainName: error?.mainName || '' })
      : context.t('bindingAdmin.error.failed', { message: error?.message || context.t('common.unknownError') });

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content }).catch(() => null);
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  }
}

module.exports = {
  data,
  execute,
  chunkLines,
};
