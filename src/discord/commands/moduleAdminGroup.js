const { MessageFlags } = require('discord.js');
const {
  MODULE_KEYS,
  listModuleStates,
  setModuleEnabled,
} = require('../../modules/moduleConfigRepository');
const { MODULE_ORDER, MODULE_DEFINITIONS } = require('../../modules/moduleRegistry');
const {
  readRoleExpiryConfig,
  updateRoleExpiryConfig,
  addQualifyingRole,
  removeQualifyingRole,
  isRoleExpiryConfigured,
} = require('../../roleExpiry/roleExpiryConfigRepository');
const { readRoleExpiryState } = require('../../roleExpiry/roleExpiryStateRepository');
const { buildRoleExpiryPreview } = require('../../roleExpiry/roleExpiryService');

function moduleChoices() {
  return MODULE_ORDER.map((key) => ({
    name: MODULE_DEFINITIONS[key].label.slice(0, 100),
    value: key,
  }));
}

function configureModuleAdminGroup(group) {
  return group
    .setName('modules')
    .setDescription('Enable, disable and configure optional CorpDB modules')
    .setDescriptionLocalizations({
      ru: 'Включение, отключение и настройка опциональных модулей CorpDB',
    })
    .addSubcommand((subcommand) => subcommand
      .setName('list')
      .setDescription('Show optional module states')
      .setDescriptionLocalizations({ ru: 'Показать состояние опциональных модулей'}))
    .addSubcommand((subcommand) => subcommand
      .setName('set')
      .setDescription('Enable or disable an optional module')
      .setDescriptionLocalizations({ ru: 'Включить или отключить опциональный модуль'})
      .addStringOption((option) => option
        .setName('module')
        .setDescription('Optional module')
        .setDescriptionLocalizations({ ru: 'Опциональный модуль'})
        .setRequired(true)
        .addChoices(...moduleChoices()))
      .addBooleanOption((option) => option
        .setName('enabled')
        .setDescription('Whether this module is enabled')
        .setDescriptionLocalizations({ ru: 'Включён ли этот модуль'})
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('fat-rewards')
      .setDescription('Enable or disable the FAT Rewards module (legacy alias)')
      .setDescriptionLocalizations({ ru: 'Включить или отключить FAT Rewards (старый alias)'})
      .addBooleanOption((option) => option
        .setName('enabled')
        .setDescription('Whether FAT Rewards is enabled')
        .setDescriptionLocalizations({ ru: 'Включён ли FAT Rewards'})
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('role-expiry-status')
      .setDescription('Show Role Expiry policy and tracked state')
      .setDescriptionLocalizations({ ru: 'Показать настройки Role Expiry и состояние таймеров'}))
    .addSubcommand((subcommand) => subcommand
      .setName('role-expiry-configure')
      .setDescription('Configure the Role Expiry trigger and timeout')
      .setDescriptionLocalizations({ ru: 'Настроить trigger-роль и таймаут Role Expiry'})
      .addRoleOption((option) => option
        .setName('trigger-role')
        .setDescription('Role whose members are subject to expiry')
        .setDescriptionLocalizations({ ru: 'Роль, для которой действует таймер'})
        .setRequired(true))
      .addIntegerOption((option) => option
        .setName('timeout-days')
        .setDescription('Days allowed without a qualifying role')
        .setDescriptionLocalizations({ ru: 'Сколько дней можно оставаться без qualifying-роли'})
        .setMinValue(1)
        .setMaxValue(3650)
        .setRequired(true))
      .addIntegerOption((option) => option
        .setName('check-interval-minutes')
        .setDescription('Background check interval in minutes')
        .setDescriptionLocalizations({ ru: 'Интервал фоновой проверки в минутах'})
        .setMinValue(5)
        .setMaxValue(1440)
        .setRequired(false))
      .addChannelOption((option) => option
        .setName('log-channel')
        .setDescription('Optional channel for automatic-kick logs')
        .setDescriptionLocalizations({ ru: 'Необязательный канал для логов автокика'})
        .setRequired(false)))
    .addSubcommand((subcommand) => subcommand
      .setName('role-expiry-safe-add')
      .setDescription('Add a role that cancels Role Expiry')
      .setDescriptionLocalizations({ ru: 'Добавить роль, которая отменяет автокик'})
      .addRoleOption((option) => option
        .setName('role')
        .setDescription('Qualifying role')
        .setDescriptionLocalizations({ ru: 'Qualifying-роль'})
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('role-expiry-safe-remove')
      .setDescription('Remove a Role Expiry qualifying role')
      .setDescriptionLocalizations({ ru: 'Удалить qualifying-роль Role Expiry'})
      .addRoleOption((option) => option
        .setName('role')
        .setDescription('Qualifying role')
        .setDescriptionLocalizations({ ru: 'Qualifying-роль'})
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('role-expiry-clear-log')
      .setDescription('Disable Role Expiry channel logging')
      .setDescriptionLocalizations({ ru: 'Отключить логирование автокика в канал'}))
    .addSubcommand((subcommand) => subcommand
      .setName('role-expiry-candidates')
      .setDescription('Read-only view of current Role Expiry candidates')
      .setDescriptionLocalizations({ ru: 'Только чтение: кандидаты Role Expiry'}));
}

async function reply(interaction, content) {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function refreshRuntime(context) {
  if (context.moduleRuntimeManager?.restartModule) {
    await context.moduleRuntimeManager.restartModule(MODULE_KEYS.ROLE_EXPIRY);
  }
}

function formatRoleExpiryPolicy(policy, trackedCount) {
  return [
    '**Role Expiry / Autokick**',
    `Ready for enforcement: **${isRoleExpiryConfigured(policy) ? 'yes' : 'no'}**`,
    `Trigger role: ${policy.triggerRoleId ? `<@&${policy.triggerRoleId}>` : 'not configured'}`,
    `Qualifying roles: ${policy.qualifyingRoleIds.length ? policy.qualifyingRoleIds.map((id) => `<@&${id}>`).join(', ') : 'none'}`,
    `Timeout: **${policy.timeoutDays} day(s)**`,
    `Check interval: **${policy.checkIntervalMinutes} minute(s)**`,
    `Log channel: ${policy.logChannelId ? `<#${policy.logChannelId}>` : 'disabled'}`,
    `Tracked candidates: **${trackedCount}**`,
  ].join('\n');
}

async function applyModuleState(interaction, context, moduleKey, enabled) {
  const storageRoot = context.config.storage.rootDir;
  await setModuleEnabled(storageRoot, moduleKey, enabled);
  if (context.moduleRuntimeManager) {
    await context.moduleRuntimeManager.setModuleEnabled(moduleKey, enabled);
  }
  if (interaction.guild) {
    const { registerGuildCommands } = require('../commandRegistrationService');
    await registerGuildCommands(interaction.guild, storageRoot);
  }
  await reply(interaction, context.t('fatRewards.admin.updated', {
    module: moduleKey,
    state: context.t(enabled ? 'common.enabled' : 'common.disabled'),
  }));
}

async function executeModuleAdmin(interaction, context) {
  const storageRoot = context.config.storage.rootDir;
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'list') {
    const states = await listModuleStates(storageRoot);
    await reply(interaction, [
      context.t('fatRewards.admin.listTitle'),
      ...states.map((item) => context.t('fatRewards.admin.moduleLine', {
        module: item.key,
        state: context.t(item.enabled ? 'common.enabled' : 'common.disabled'),
      })),
    ].join('\n'));
    return;
  }

  if (subcommand === 'set') {
    const moduleKey = interaction.options.getString('module', true);
    const enabled = interaction.options.getBoolean('enabled', true);
    await applyModuleState(interaction, context, moduleKey, enabled);
    return;
  }

  if (subcommand === 'fat-rewards') {
    const enabled = interaction.options.getBoolean('enabled', true);
    await applyModuleState(interaction, context, MODULE_KEYS.FAT_REWARDS, enabled);
    return;
  }

  if (subcommand === 'role-expiry-status') {
    const [policy, state] = await Promise.all([
      readRoleExpiryConfig(storageRoot),
      readRoleExpiryState(storageRoot),
    ]);
    await reply(interaction, formatRoleExpiryPolicy(policy, Object.keys(state.candidates).length));
    return;
  }

  if (subcommand === 'role-expiry-configure') {
    const triggerRole = interaction.options.getRole('trigger-role', true);
    const timeoutDays = interaction.options.getInteger('timeout-days', true);
    const checkIntervalMinutes = interaction.options.getInteger('check-interval-minutes');
    const logChannel = interaction.options.getChannel('log-channel');
    const current = await readRoleExpiryConfig(storageRoot);
    if (current.qualifyingRoleIds.includes(triggerRole.id)) {
      const error = new Error('Remove the trigger role from qualifying roles before using it as the trigger.');
      error.code = 'role_expiry_role_conflict';
      throw error;
    }
    if (logChannel && !logChannel.isTextBased?.()) {
      const error = new Error('Role Expiry log channel must be text-based.');
      error.code = 'role_expiry_log_channel_invalid';
      throw error;
    }
    const policy = await updateRoleExpiryConfig(storageRoot, {
      triggerRoleId: triggerRole.id,
      timeoutDays,
      ...(checkIntervalMinutes ? { checkIntervalMinutes } : {}),
      ...(logChannel ? { logChannelId: logChannel.id } : {}),
    });
    await refreshRuntime(context);
    const state = await readRoleExpiryState(storageRoot);
    await reply(interaction, formatRoleExpiryPolicy(policy, Object.keys(state.candidates).length));
    return;
  }

  if (subcommand === 'role-expiry-safe-add') {
    const role = interaction.options.getRole('role', true);
    const policy = await addQualifyingRole(storageRoot, role.id);
    await refreshRuntime(context);
    await reply(interaction, `Qualifying role added: <@&${role.id}>\nReady for enforcement: **${isRoleExpiryConfigured(policy) ? 'yes' : 'no'}**`);
    return;
  }

  if (subcommand === 'role-expiry-safe-remove') {
    const role = interaction.options.getRole('role', true);
    const policy = await removeQualifyingRole(storageRoot, role.id);
    await refreshRuntime(context);
    await reply(interaction, `Qualifying role removed: <@&${role.id}>\nReady for enforcement: **${isRoleExpiryConfigured(policy) ? 'yes' : 'no'}**`);
    return;
  }

  if (subcommand === 'role-expiry-clear-log') {
    await updateRoleExpiryConfig(storageRoot, { logChannelId: '' });
    await reply(interaction, 'Role Expiry channel logging disabled.');
    return;
  }

  if (subcommand === 'role-expiry-candidates') {
    const preview = await buildRoleExpiryPreview(storageRoot, interaction.guild);
    const lines = [
      '**Role Expiry candidates — read only**',
      `Live candidates: **${preview.candidates.length}**; tracked state: **${preview.trackedCount}**`,
    ];
    for (const candidate of preview.candidates.slice(0, 25)) {
      const assigned = candidate.assignedAt
        ? `<t:${Math.floor(Date.parse(candidate.assignedAt) / 1000)}:F>`
        : 'untracked';
      const expires = candidate.expiresAt
        ? `<t:${Math.floor(Date.parse(candidate.expiresAt) / 1000)}:R>`
        : 'unknown until tracked/backfilled';
      lines.push(`<@${candidate.userId}> — assigned ${assigned}; expires ${expires}; source=${candidate.source}${candidate.overdue ? ' **OVERDUE**' : ''}`);
    }
    if (preview.candidates.length > 25) lines.push(`…and ${preview.candidates.length - 25} more.`);
    await reply(interaction, lines.join('\n'));
    return;
  }

  throw new Error(`Unsupported /admin modules subcommand: ${subcommand}`);
}

module.exports = {
  configureModuleAdminGroup,
  executeModuleAdmin,
  formatRoleExpiryPolicy,
};
