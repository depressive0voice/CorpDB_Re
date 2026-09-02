const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const {
  getBindingConfigSummary,
  setApprovalChannel,
} = require('../../mainBinding/mainBindingService');
const {
  readOnboardingConfig,
  upsertOnboardingProfile,
} = require('../../onboarding/onboardingConfigRepository');

const data = new SlashCommandBuilder()
  .setName('binding-config')
  .setDescription('Configure the Discord-to-main binding workflow')
  .setDescriptionLocalizations({
    ru: 'Настроить процесс привязки Discord к мейну',
  })
  .addSubcommand((subcommand) => subcommand
    .setName('show')
    .setDescription('Show current main-binding configuration')
    .setDescriptionLocalizations({
      ru: 'Показать текущую конфигурацию привязки',
    }))
  .addSubcommand((subcommand) => subcommand
    .setName('set-approval-channel')
    .setDescription('Set the channel for main-binding requests')
    .setDescriptionLocalizations({
      ru: 'Задать канал для заявок на привязку',
    })
    .addChannelOption((option) => option
      .setName('channel')
      .setDescription('Approval channel')
      .setDescriptionLocalizations({ ru: 'Канал одобрения'})
      .setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName('set-approved-role')
    .setDescription('Set the default probation role granted after approval')
    .setDescriptionLocalizations({
      ru: 'Задать стандартную роль испытательного срока после одобрения',
    })
    .addRoleOption((option) => option
      .setName('role')
      .setDescription('Existing probation role')
      .setDescriptionLocalizations({ ru: 'Существующая роль испытательного срока'})
      .setRequired(true)));

function isOwner(config, userId) {
  return config.discord.ownerIds.includes(String(userId));
}

async function ensureOwner(interaction, context) {
  if (isOwner(context.config, interaction.user.id)) return true;
  await interaction.reply({
    content: context.t('common.ownerOnlyOperation'),
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

async function execute(interaction, context) {
  if (!(await ensureOwner(interaction, context))) return;
  const storageRoot = context.config.storage.rootDir;
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'show') {
    const [bindingConfig, onboardingConfig] = await Promise.all([
      getBindingConfigSummary(storageRoot),
      readOnboardingConfig(storageRoot),
    ]);
    const probationRoleId = onboardingConfig.profiles.default?.probationRoleId || '';
    await interaction.reply({
      content: [
        context.t('binding.config.title'),
        context.t('binding.config.channel', {
          channel: bindingConfig.approvalChannelId ? `<#${bindingConfig.approvalChannelId}>` : context.t('binding.value.notSet'),
        }),
        context.t('binding.config.probation', {
          role: probationRoleId ? `<@&${probationRoleId}>` : context.t('binding.value.notSet'),
        }),
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'set-approval-channel') {
    const channel = interaction.options.getChannel('channel', true);
    if (typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
      throw new Error(context.t('binding.error.channelInvalid'));
    }
    const config = await setApprovalChannel(storageRoot, channel.id);
    await interaction.reply({
      content: [
        context.t('binding.config.channelUpdated'),
        context.t('binding.config.channel', { channel: `<#${config.approvalChannelId}>` }),
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'set-approved-role') {
    const role = interaction.options.getRole('role', true);
    if (role.id === interaction.guildId || role.managed || !role.editable) {
      throw new Error(context.t('roles.error.cannotManage', { roleName: role.name }));
    }
    await upsertOnboardingProfile(storageRoot, 'default', { probationRoleId: role.id });
    await interaction.reply({
      content: [
        context.t('binding.config.probationUpdated'),
        context.t('binding.config.probation', { role: `${role}` }),
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  throw new Error(context.t('binding.error.unsupportedConfigSubcommand', { subcommand }));
}

module.exports = {
  data,
  execute,
};
