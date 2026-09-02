const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { ACCESS_LEVELS, getBaseAccessLevel } = require('../../access/accessService');
const { readCorporationProfile } = require('../../corporations/corporationProfileRepository');
const {
  autocompleteApplicationCorporations,
  resolveApplicationCorporationIds,
} = require('../../applications/applicationCorporationService');
const {
  readApplicationConfig,
} = require('../../applications/applicationConfigRepository');
const {
  NOTIFICATIONS_SCOPE,
  formatDiscordDateTime,
  processCorporationApplications,
  setApplicationAlertChannel,
  clearApplicationAlertChannel,
  resetCorporationApplicationCache,
} = require('../../applications/applicationAlertService');

function normalizeText(value) {
  return String(value || '').trim();
}

function addCorporationOption(subcommand) {
  return subcommand.addStringOption((option) => option
    .setName('corporation')
    .setDescription('Select a linked corporation')
    .setDescriptionLocalizations({
      ru: 'Выбрать подвязанную корпорацию',
    })
    .setAutocomplete(true)
    .setRequired(false));
}

const data = new SlashCommandBuilder()
  .setName('applications')
  .setDescription('Corporation application alerts and checks')
  .setDescriptionLocalizations({
    ru: 'Уведомления и проверки заявок в корпорацию',
  })
  .addSubcommand((subcommand) => addCorporationOption(subcommand
    .setName('show-config')
    .setDescription('Show corporation application alert configuration')
    .setDescriptionLocalizations({
      ru: 'Показать настройки уведомлений о заявках',
    })))
  .addSubcommand((subcommand) => addCorporationOption(subcommand
    .setName('set-alert-channel')
    .setDescription('Set the channel for corporation application cards')
    .setDescriptionLocalizations({
      ru: 'Задать канал для карточек заявок',
    })
    .addChannelOption((option) => option
      .setName('channel')
      .setDescription('Discord channel')
      .setDescriptionLocalizations({ ru: 'Discord-канал'})
      .setRequired(true))))
  .addSubcommand((subcommand) => addCorporationOption(subcommand
    .setName('clear-alert-channel')
    .setDescription('Clear the corporation application alert channel')
    .setDescriptionLocalizations({
      ru: 'Очистить канал уведомлений о заявках',
    })))
  .addSubcommand((subcommand) => addCorporationOption(subcommand
    .setName('reset-cache')
    .setDescription('Reset tracked corporation application state')
    .setDescriptionLocalizations({
      ru: 'Сбросить сохранённое состояние заявок',
    })))
  .addSubcommand((subcommand) => addCorporationOption(subcommand
    .setName('check')
    .setDescription('Run corporation application check now')
    .setDescriptionLocalizations({
      ru: 'Запустить проверку заявок сейчас',
    })));

async function isMasterAdmin(interaction, context) {
  const access = await getBaseAccessLevel(
    context.config,
    context.config.storage.rootDir,
    interaction.member
  );
  return access.level === ACCESS_LEVELS.MASTER_ADMIN;
}

async function requireMasterAdmin(interaction, context) {
  if (await isMasterAdmin(interaction, context)) return true;
  await interaction.reply({
    content: context.t('applications.error.masterAdmin'),
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

function applicationCheckEmbed(context, result) {
  const yes = context.t('applications.common.yes');
  const no = context.t('applications.common.no');
  const embed = new EmbedBuilder()
    .setTitle(context.t('applications.check.title'))
    .setDescription([
      context.t('applications.check.corporation', { corporation: result.corporationName }),
      context.t('applications.check.character', {
        character: result.serviceCharacterName || context.t('applications.common.unknownCharacter'),
      }),
      context.t('applications.check.checked', {
        time: formatDiscordDateTime(result.checkedAt),
      }),
    ].join('\n'))
    .addFields(
      {
        name: context.t('applications.check.sourceTitle'),
        value: context.t('applications.check.source', {
          notifications: result.notificationsScannedCount || 0,
          applications: result.applicationNotificationsCount || 0,
          memberLookup: result.memberLookupAvailable ? yes : no,
        }),
        inline: false,
      },
      {
        name: context.t('applications.check.applicationsTitle'),
        value: context.t('applications.check.applications', {
          tracked: result.trackedApplicationsCount || 0,
          pending: result.pendingApplicationsCount || 0,
          accepted: result.acceptedApplicationsCount || 0,
          authMatched: result.authMatchedApplicationsCount || 0,
        }),
        inline: false,
      },
      {
        name: context.t('applications.check.discordTitle'),
        value: context.t('applications.check.discord', {
          channelConfigured: result.alertChannelConfigured ? yes : no,
          queued: result.deliveryQueueCount || 0,
          sent: result.sentCount || 0,
          edited: result.editedCount || 0,
          failed: result.failedDeliveryCount || 0,
        }),
        inline: false,
      }
    );

  if (result.memberLookupError) {
    embed.addFields({
      name: context.t('applications.check.memberLookupErrorTitle'),
      value: String(result.memberLookupError).slice(0, 1024),
      inline: false,
    });
  }
  return embed;
}

async function resolveSingleCorporation(storageRoot, interaction) {
  const requested = normalizeText(interaction.options.getString('corporation'));
  const [corporationId] = await resolveApplicationCorporationIds(storageRoot, requested, {
    allowAll: false,
  });
  return corporationId;
}

async function autocomplete(interaction, context) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'corporation') {
    await interaction.respond([]);
    return;
  }

  const subcommand = interaction.options.getSubcommand(false);
  const allowAll = subcommand === 'check' || subcommand === 'reset-cache';
  const choices = await autocompleteApplicationCorporations(
    context.config.storage.rootDir,
    focused.value,
    { allowAll }
  );
  await interaction.respond(choices);
}

async function execute(interaction, context) {
  const subcommand = interaction.options.getSubcommand();
  const storageRoot = context.config.storage.rootDir;

  if (subcommand === 'show-config') {
    const corporationId = await resolveSingleCorporation(storageRoot, interaction);
    const [appConfig, profile] = await Promise.all([
      readApplicationConfig(storageRoot, corporationId),
      readCorporationProfile(storageRoot, corporationId),
    ]);
    const channel = appConfig.alertChannelId
      ? `<#${appConfig.alertChannelId}>`
      : context.t('applications.common.notSet');
    await interaction.reply({
      content: [
        context.t('applications.config.title'),
        context.t('applications.config.corporation', {
          corporation: profile.name || corporationId,
          corporationId,
        }),
        context.t('applications.config.channel', { channel }),
        context.t('applications.config.source'),
        context.t('applications.config.scope', { scope: NOTIFICATIONS_SCOPE }),
        context.t('applications.config.behavior'),
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!(await requireMasterAdmin(interaction, context))) return;

  if (subcommand === 'set-alert-channel') {
    const corporationId = await resolveSingleCorporation(storageRoot, interaction);
    const channel = interaction.options.getChannel('channel', true);
    if (!channel.isTextBased()) {
      throw new Error('Application alert channel must be text-based.');
    }
    const profile = await readCorporationProfile(storageRoot, corporationId);
    await setApplicationAlertChannel(storageRoot, corporationId, channel.id);
    await interaction.reply({
      content: context.t('applications.channel.updated', {
        corporation: profile.name || corporationId,
        channel: `<#${channel.id}>`,
      }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'clear-alert-channel') {
    const corporationId = await resolveSingleCorporation(storageRoot, interaction);
    const profile = await readCorporationProfile(storageRoot, corporationId);
    await clearApplicationAlertChannel(storageRoot, corporationId);
    await interaction.reply({
      content: context.t('applications.channel.cleared', {
        corporation: profile.name || corporationId,
      }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'reset-cache') {
    const requested = normalizeText(interaction.options.getString('corporation')) || 'all';
    const corporationIds = await resolveApplicationCorporationIds(storageRoot, requested, {
      allowAll: true,
    });
    const lines = [];
    for (const corporationId of corporationIds) {
      const profile = await readCorporationProfile(storageRoot, corporationId);
      const result = await resetCorporationApplicationCache(storageRoot, corporationId);
      lines.push(context.t('applications.cache.reset', {
        corporation: profile.name || corporationId,
        time: formatDiscordDateTime(result.resetAt),
      }));
    }
    await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === 'check') {
    const requested = normalizeText(interaction.options.getString('corporation'));
    const corporationIds = await resolveApplicationCorporationIds(storageRoot, requested, {
      allowAll: true,
    });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const embeds = [];
    for (const corporationId of corporationIds) {
      const result = await processCorporationApplications(
        context.config,
        storageRoot,
        corporationId,
        interaction.client
      );
      embeds.push(applicationCheckEmbed(context, result));
    }
    await interaction.editReply({ embeds: embeds.slice(0, 10) });
    for (let offset = 10; offset < embeds.length; offset += 10) {
      await interaction.followUp({
        embeds: embeds.slice(offset, offset + 10),
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  throw new Error(context.t('applications.error.unsupportedSubcommand', { subcommand }));
}

module.exports = {
  data,
  execute,
  autocomplete,
  applicationCheckEmbed,
};
