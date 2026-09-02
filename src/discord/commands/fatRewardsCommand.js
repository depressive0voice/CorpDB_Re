const {
  AttachmentBuilder,
  ChannelType,
  MessageFlags,
  SlashCommandBuilder,
} = require('discord.js');
const {
  PAYOUT_RULES,
  importFatSummaryFromAttachment,
  calculateFatPayoutReport,
  getFatSummaryStatus,
  configureFatSummaryReminder,
} = require('../../activity/fatRewardsService');
const {
  resolveActivityCorporationId,
  autocompleteActivityCorporations,
} = require('../../activity/activityCorporationService');
const { readCorporationProfile } = require('../../corporations/corporationProfileRepository');
const { MODULE_KEYS, isModuleEnabled } = require('../../modules/moduleConfigRepository');

function addCorporationOption(subcommand) {
  return subcommand.addStringOption((option) => option
    .setName('corporation')
    .setDescription('Corporation; omit to use the default corporation')
    .setDescriptionLocalizations({
      ru: 'Корпорация; не указывай для корпорации по умолчанию',
    })
    .setRequired(false)
    .setAutocomplete(true));
}

const data = new SlashCommandBuilder()
  .setName('fat-rewards')
  .setDescription('Import closed FAT Summary and calculate corporation payouts')
  .setDescriptionLocalizations({
    ru: 'Импорт итогового FAT Summary и расчёт корпоративных выплат',
  })
  .addSubcommand((subcommand) => addCorporationOption(subcommand
    .setName('import')
    .setDescription('Save final FAT Summary for a closed month')
    .setDescriptionLocalizations({ ru: 'Сохранить итоговый FAT Summary закрытого месяца'})
    .addStringOption((option) => option
      .setName('month')
      .setDescription('Closed report month, MM-YYYY')
      .setDescriptionLocalizations({ ru: 'Закрытый месяц отчёта, ММ-ГГГГ'})
      .setRequired(true)
      .setMaxLength(7))
    .addAttachmentOption((option) => option
      .setName('file')
      .setDescription('XLSX with Character and FAT columns')
      .setDescriptionLocalizations({ ru: 'XLSX с колонками Character и FAT'})
      .setRequired(true))))
  .addSubcommand((subcommand) => addCorporationOption(subcommand
    .setName('calculate')
    .setDescription('Calculate payouts and persist the closed month to Activity')
    .setDescriptionLocalizations({ ru: 'Рассчитать выплаты и сохранить закрытый месяц в Activity'})
    .addStringOption((option) => option
      .setName('amount')
      .setDescription('Total payout budget in ISK')
      .setDescriptionLocalizations({ ru: 'Общий фонд выплат в ISK'})
      .setRequired(true)
      .setMaxLength(30))
    .addStringOption((option) => option
      .setName('month')
      .setDescription('Closed report month, MM-YYYY')
      .setDescriptionLocalizations({ ru: 'Закрытый месяц отчёта, ММ-ГГГГ'})
      .setRequired(true)
      .setMaxLength(7))
    .addAttachmentOption((option) => option
      .setName('file')
      .setDescription('Optional final FAT Summary to import before calculation')
      .setDescriptionLocalizations({ ru: 'Необязательно: итоговый FAT Summary для импорта перед расчётом'})
      .setRequired(false))))
  .addSubcommand((subcommand) => addCorporationOption(subcommand
    .setName('status')
    .setDescription('Show stored FAT Summary and payout formula')
    .setDescriptionLocalizations({ ru: 'Показать сохранённый FAT Summary и формулу выплат'})))
  .addSubcommand((subcommand) => addCorporationOption(subcommand
    .setName('set-reminder')
    .setDescription('Configure stale FAT Summary reminder')
    .setDescriptionLocalizations({ ru: 'Настроить напоминание об устаревшем FAT Summary'})
    .addChannelOption((option) => option
      .setName('channel')
      .setDescription('Reminder channel')
      .setDescriptionLocalizations({ ru: 'Канал напоминаний'})
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(true))
    .addIntegerOption((option) => option
      .setName('days')
      .setDescription('Days until the file is considered stale')
      .setDescriptionLocalizations({ ru: 'Через сколько дней файл считается устаревшим'})
      .setMinValue(1)
      .setMaxValue(90)
      .setRequired(false))));

function normalizeText(value) {
  return String(value ?? '').trim();
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(number));
}

function parseBudget(value) {
  const raw = normalizeText(value);
  const normalized = raw.replace(/[\s_,.]/g, '');
  if (!/^\d+$/.test(normalized) || normalized.length > 12) {
    const error = new Error('Payout amount must contain 1 to 12 digits; spaces, dots, commas and underscores may be separators.');
    error.code = 'fat_payout_budget_invalid';
    throw error;
  }
  const budget = Number(normalized);
  if (!Number.isSafeInteger(budget) || budget <= 0) {
    const error = new Error('Payout amount must be a positive integer ISK value.');
    error.code = 'fat_payout_budget_invalid';
    throw error;
  }
  return budget;
}

function formatTimestamp(value, fallback) {
  const timestamp = Date.parse(normalizeText(value));
  if (!Number.isFinite(timestamp)) return fallback;
  const seconds = Math.floor(timestamp / 1000);
  return `<t:${seconds}:f> (<t:${seconds}:R>)`;
}

function formatAge(ageDays, fallback) {
  return ageDays === null || ageDays === undefined ? fallback : `${Math.floor(ageDays)} d`;
}

function corporationLabel(profile, corporationId) {
  const name = normalizeText(profile?.name);
  const ticker = normalizeText(profile?.ticker);
  return name ? `${name}${ticker ? ` [${ticker}]` : ''}` : corporationId;
}

async function resolveCorporation(interaction, context) {
  const storageRoot = context.config.storage.rootDir;
  const corporationId = await resolveActivityCorporationId(
    storageRoot,
    interaction.options.getString('corporation') || ''
  );
  const profile = await readCorporationProfile(storageRoot, corporationId, { createIfMissing: false }).catch(() => null);
  return { corporationId, corporation: corporationLabel(profile, corporationId) };
}

async function ensureEnabled(interaction, context) {
  const enabled = await isModuleEnabled(context.config.storage.rootDir, MODULE_KEYS.FAT_REWARDS);
  if (enabled) return true;
  await interaction.reply({ content: context.t('fatRewards.module.disabled'), flags: MessageFlags.Ephemeral });
  return false;
}

async function execute(interaction, context) {
  if (!(await ensureEnabled(interaction, context))) return;
  const storageRoot = context.config.storage.rootDir;
  const subcommand = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { corporationId, corporation } = await resolveCorporation(interaction, context);

  if (subcommand === 'import') {
    const month = interaction.options.getString('month', true);
    const file = interaction.options.getAttachment('file', true);
    const result = await importFatSummaryFromAttachment({
      storageRoot,
      corporationId,
      month,
      attachment: file,
      uploadedByUserId: interaction.user.id,
      uploadedByTag: interaction.user.tag,
      reminderChannelId: interaction.channelId,
    });
    await interaction.editReply({
      content: [
        context.t('fatRewards.import.title'),
        `**${corporation}**`,
        context.t('fatRewards.import.month', { month: result.reportMonth }),
        context.t('fatRewards.import.file', { file: result.fileName }),
        context.t('fatRewards.import.sheets', { count: result.sheetsCount }),
        context.t('fatRewards.import.rows', { rows: result.rowsCount, fat: formatNumber(result.totalFat) }),
        context.t('fatRewards.import.duplicates', { count: result.duplicateCharacters.length }),
      ].join('\n'),
    });
    return;
  }

  if (subcommand === 'calculate') {
    const budget = parseBudget(interaction.options.getString('amount', true));
    const month = interaction.options.getString('month', true);
    const file = interaction.options.getAttachment('file', false);
    if (file) {
      await importFatSummaryFromAttachment({
        storageRoot,
        corporationId,
        month,
        attachment: file,
        uploadedByUserId: interaction.user.id,
        uploadedByTag: interaction.user.tag,
        reminderChannelId: interaction.channelId,
      });
    }
    const result = await calculateFatPayoutReport({
      storageRoot,
      corporationId,
      budget,
      month,
      rules: PAYOUT_RULES,
    });
    const attachment = new AttachmentBuilder(result.content, { name: result.fileName });
    await interaction.editReply({
      content: [
        context.t('fatRewards.calculate.title'),
        `**${corporation}**`,
        context.t('fatRewards.calculate.month', { month: result.month }),
        context.t('fatRewards.calculate.budget', { budget: formatNumber(result.budget) }),
        context.t('fatRewards.calculate.distributed', { amount: formatNumber(result.distributedAmount) }),
        context.t('fatRewards.calculate.recipients', {
          count: result.recipientsCount,
          multi: result.multiCount,
          solo: result.soloCount,
          bad: result.badCount,
        }),
        context.t('fatRewards.calculate.activity', {
          rows: result.activityRowsCount,
          source: formatNumber(result.sourceTotalFat),
          activity: formatNumber(result.activityTotalFat),
        }),
      ].join('\n'),
      files: [attachment],
    });
    return;
  }

  if (subcommand === 'status') {
    const status = await getFatSummaryStatus(storageRoot, corporationId);
    await interaction.editReply({
      content: [
        context.t('fatRewards.status.title'),
        `**${corporation}**`,
        context.t('fatRewards.status.file', { file: status.latestFileName || context.t('fatRewards.value.none') }),
        context.t('fatRewards.status.month', { month: status.reportMonth || context.t('fatRewards.value.none') }),
        context.t('fatRewards.status.uploaded', { uploaded: formatTimestamp(status.uploadedAt, context.t('fatRewards.value.none')) }),
        context.t('fatRewards.status.age', { age: formatAge(status.ageDays, context.t('fatRewards.value.unknown')) }),
        context.t('fatRewards.status.reminder', {
          channel: status.reminderChannelId ? `<#${status.reminderChannelId}>` : context.t('fatRewards.value.none'),
          days: status.reminderAfterDays,
        }),
        context.t('fatRewards.status.rules'),
      ].join('\n'),
    });
    return;
  }

  if (subcommand === 'set-reminder') {
    const channel = interaction.options.getChannel('channel', true);
    const days = interaction.options.getInteger('days', false) || 31;
    const state = await configureFatSummaryReminder(storageRoot, corporationId, {
      channelId: channel.id,
      reminderAfterDays: days,
    });
    await interaction.editReply({
      content: [
        `**${corporation}**`,
        context.t('fatRewards.reminder.updated', {
          channel: `<#${state.reminderChannelId}>`,
          days: state.reminderAfterDays,
        }),
      ].join('\n'),
    });
    return;
  }

  throw new Error(`Unsupported /fat-rewards subcommand: ${subcommand}`);
}

async function autocomplete(interaction, context) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'corporation') {
    await interaction.respond([]);
    return;
  }
  const choices = await autocompleteActivityCorporations(context.config.storage.rootDir, focused.value);
  await interaction.respond(choices);
}

module.exports = {
  data,
  execute,
  autocomplete,
  parseBudget,
  formatNumber,
};
