const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const {
  trackMemberByName,
  trackMemberByDiscordUserId,
} = require('../../activity/trackService');
const {
  buildActivityReport,
} = require('../../activity/activityReportService');
const {
  getFatMonthSummary,
} = require('../../activity/fatMonthlyReportRepository');
const {
  importFatActivityFromAttachment,
} = require('../../activity/fatImportService');
const {
  resolveActivityCorporationId,
  autocompleteActivityCorporations,
  listEnabledActivityCorporationIds,
} = require('../../activity/activityCorporationService');
const { readCorporationProfile } = require('../../corporations/corporationProfileRepository');
const { readOnboardingConfig } = require('../../onboarding/onboardingConfigRepository');
const { listApprovedBindings } = require('../../mainBinding/mainBindingRepository');

const COLORS = Object.freeze({
  default: 0x5865f2,
  main: 0x57f287,
  alt: 0x3498db,
  warning: 0xfee75c,
  inactive: 0x747f8d,
  chronic: 0x992d22,
});

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

function addMonthAndCorporation(subcommand) {
  subcommand.addStringOption((option) => option
    .setName('month')
    .setDescription('Closed FAT month in MM-YYYY format')
    .setDescriptionLocalizations({
      ru: 'Закрытый FAT-месяц в формате ММ-ГГГГ',
    })
    .setRequired(false)
    .setMaxLength(7));
  return addCorporationOption(subcommand);
}

function addImportOptionsAndCorporation(subcommand) {
  subcommand
    .addStringOption((option) => option
      .setName('month')
      .setDescription('FAT month in MM-YYYY; current month is preview-only')
      .setDescriptionLocalizations({
        ru: 'FAT-месяц ММ-ГГГГ; текущий месяц будет только preview',
      })
      .setRequired(true)
      .setMaxLength(7))
    .addAttachmentOption((option) => option
      .setName('file')
      .setDescription('XLSX with Character and FAT columns')
      .setDescriptionLocalizations({
        ru: 'XLSX с колонками Character и FAT',
      })
      .setRequired(true));
  return addCorporationOption(subcommand);
}

const data = new SlashCommandBuilder()
  .setName('track')
  .setDescription('Track members, farm and FAT activity')
  .setDescriptionLocalizations({
    ru: 'Карточка участника, фарм и FAT-активность',
  })
  .addSubcommand((subcommand) => subcommand
    .setName('member')
    .setDescription('Show a unified member card')
    .setDescriptionLocalizations({ ru: 'Показать единую карточку участника'})
    .addStringOption((option) => option
      .setName('name')
      .setDescription('EVE character name')
      .setDescriptionLocalizations({ ru: 'Имя персонажа EVE'})
      .setRequired(false))
    .addUserOption((option) => option
      .setName('user')
      .setDescription('Discord user with an approved main binding')
      .setDescriptionLocalizations({ ru: 'Discord-пользователь с одобренной main-привязкой'})
      .setRequired(false))
    .addStringOption((option) => option
      .setName('period')
      .setDescription('Farm period')
      .setDescriptionLocalizations({ ru: 'Период расчёта фарма'})
      .setRequired(false)
      .addChoices(
        { name: 'Current month', name_localizations: { ru: 'Текущий месяц'}, value: 'current-month' },
        { name: 'Previous month', name_localizations: { ru: 'Прошлый месяц'}, value: 'previous-month' },
        { name: 'Specific month', name_localizations: { ru: 'Указанный месяц'}, value: 'month' }
      ))
    .addStringOption((option) => option
      .setName('month')
      .setDescription('Farm month for period=month, MM-YYYY')
      .setDescriptionLocalizations({ ru: 'Месяц фарма для period=month, ММ-ГГГГ'})
      .setRequired(false)
      .setMaxLength(7))
    .addStringOption((option) => option
      .setName('fat-month')
      .setDescription('Optional closed FAT month, MM-YYYY')
      .setDescriptionLocalizations({ ru: 'Необязательно: закрытый FAT-месяц, ММ-ГГГГ'})
      .setRequired(false)
      .setMaxLength(7)))
  .addSubcommandGroup((group) => group
    .setName('activity')
    .setDescription('FAT activity reports')
    .setDescriptionLocalizations({ ru: 'FAT-отчёты активности'})
    .addSubcommand((subcommand) => addImportOptionsAndCorporation(subcommand
      .setName('import')
      .setDescription('Import FAT XLSX; current month is preview-only')
      .setDescriptionLocalizations({ ru: 'Импортировать FAT XLSX; текущий месяц только preview'})))
    .addSubcommand((subcommand) => addMonthAndCorporation(subcommand
      .setName('report')
      .setDescription('Show FAT control for a closed month')
      .setDescriptionLocalizations({ ru: 'Показать FAT-контроль закрытого месяца'})))
    .addSubcommand((subcommand) => addMonthAndCorporation(subcommand
      .setName('rookies')
      .setDescription('Show FAT report for the ROOKIE Discord role')
      .setDescriptionLocalizations({ ru: 'Показать FAT-отчёт по Discord-роли ROOKIE'})))
    .addSubcommand((subcommand) => addMonthAndCorporation(subcommand
      .setName('three-months')
      .setDescription('Show members below minimum for three closed months')
      .setDescriptionLocalizations({ ru: 'Показать участников ниже норматива три закрытых месяца подряд'})))
    .addSubcommand((subcommand) => addCorporationOption(subcommand
      .setName('months')
      .setDescription('Show stored closed FAT months')
      .setDescriptionLocalizations({ ru: 'Показать сохранённые закрытые FAT-месяцы'}))));

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function formatFat(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

function formatTimestamp(value, fallback) {
  const timestamp = Date.parse(normalizeText(value));
  if (!Number.isFinite(timestamp)) return fallback;
  const seconds = Math.floor(timestamp / 1000);
  return `<t:${seconds}:f> (<t:${seconds}:R>)`;
}

function corporationLabel(profile, corporationId) {
  const name = normalizeText(profile?.name);
  const ticker = normalizeText(profile?.ticker);
  return name ? `${name}${ticker ? ` [${ticker}]` : ''}` : corporationId;
}

function memberCorporationLabel(member, t) {
  return normalizeText(member?.corporationName) || normalizeText(member?.corporationId) || t('track.value.notSet');
}

function formatDiscordBinding(binding, t) {
  if (!binding) return t('track.value.notBound');
  const userId = normalizeText(binding.discordUserId);
  const tag = normalizeText(binding.discordTag);
  if (userId && tag) return `<@${userId}> (${tag})`;
  if (userId) return `<@${userId}>`;
  return tag || t('track.value.notBound');
}

function findFarmGroup(farm, refType) {
  return farm?.groups?.find((group) => group.refType === refType) || {
    entriesCount: 0,
    grossBaseFormatted: '0',
  };
}

function trackColor(result) {
  const status = normalizeKey(result.member?.status);
  if (status.includes('left') || !result.member?.isCorporationMember) return COLORS.inactive;
  return normalizeKey(result.member?.name) === normalizeKey(result.mainName) ? COLORS.main : COLORS.alt;
}

function buildMemberEmbed(result, t) {
  const member = result.member;
  const mainMember = result.mainMember || member;
  const searchMode = result.searchMode === 'discord'
    ? t('track.member.searchByDiscord')
    : t('track.member.searchByName');
  const profileText = t('track.member.profileText', {
    searchMode,
    name: member.name,
    corporation: memberCorporationLabel(member, t),
    mainName: result.mainName,
    isMain: normalizeKey(member.name) === normalizeKey(result.mainName) ? t('track.value.yes') : t('track.value.no'),
    discord: formatDiscordBinding(result.discordBinding, t),
    status: normalizeText(member.status) || t('track.value.notSet'),
  });
  const activityText = t('track.member.activityText', {
    lastLogon: formatTimestamp(member.lastLogonAt, t('track.value.notSet')),
    mainLastLogon: formatTimestamp(mainMember.lastLogonAt, t('track.value.notSet')),
    joinDate: formatTimestamp(mainMember.corporationJoinDate, t('track.value.notSet')),
  });

  let fatText;
  if (result.activity?.ok === false) {
    fatText = t('track.member.fatError', { message: result.activity.errorMessage || 'unknown error' });
  } else if (!result.activity?.month) {
    fatText = t('track.member.fatNone');
  } else {
    fatText = t('track.member.fatText', {
      month: result.activity.month,
      fat: formatFat(result.activity.fatCount),
      sources: result.activity.sources.length,
    });
  }

  let farmText;
  if (result.farm?.ok === false) {
    farmText = t('track.member.farmError', { message: result.farm.errorMessage || 'unknown error' });
  } else {
    const bounty = findFarmGroup(result.farm, 'bounty_prizes');
    const ess = findFarmGroup(result.farm, 'ess_escrow_transfer');
    farmText = t('track.member.farmText', {
      period: result.farm.periodLabel,
      gross: result.farm.totalGrossBaseFormatted,
      bounty: bounty.grossBaseFormatted,
      bountyEntries: bounty.entriesCount,
      ess: ess.grossBaseFormatted,
      essEntries: ess.entriesCount,
      tax: result.farm.totalTaxReceivedFormatted,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(t('track.member.title', { name: member.name }))
    .setColor(trackColor(result))
    .addFields(
      { name: t('track.member.profile'), value: profileText, inline: false },
      { name: t('track.member.activity'), value: activityText, inline: false },
      { name: t('track.member.fat'), value: fatText, inline: false },
      { name: t('track.member.farm'), value: farmText, inline: false }
    );

  const altLines = result.alts.map((alt) => t('track.member.altLine', {
    name: alt.name,
    corporation: memberCorporationLabel(alt, t),
    lastLogon: formatTimestamp(alt.lastLogonAt, t('track.value.notSet')),
  }));
  embed.addFields({
    name: t('track.member.alts', { count: result.alts.length }),
    value: altLines.length ? altLines.slice(0, 20).join('\n').slice(0, 1024) : t('track.member.noAlts'),
    inline: false,
  });
  return embed;
}

function splitLines(lines, limit = 3800) {
  const chunks = [];
  let current = '';
  for (const raw of lines) {
    const line = normalizeText(raw);
    if (!line) continue;
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= limit) current = candidate;
    else {
      if (current) chunks.push(current);
      current = line.slice(0, limit);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function buildRowsEmbeds(title, color, rows, lineBuilder, emptyText) {
  const lines = rows.length ? rows.map(lineBuilder) : [emptyText];
  return splitLines(lines).map((description, index) => new EmbedBuilder()
    .setTitle(index === 0 ? title : `${title} …`)
    .setColor(color)
    .setDescription(description));
}

async function resolveRookieContext(interaction, storageRoot, corporationId) {
  const [config, enabledCorporations, bindings] = await Promise.all([
    readOnboardingConfig(storageRoot),
    listEnabledActivityCorporationIds(storageRoot),
    listApprovedBindings(storageRoot),
  ]);
  let profileId = config.corporationProfiles[corporationId] || '';
  if (!profileId) {
    if (enabledCorporations.length === 1) profileId = 'default';
    else {
      const error = new Error(`Corporation ${corporationId} has no explicit onboarding profile.`);
      error.code = 'onboarding_corporation_profile_unconfigured';
      throw error;
    }
  }
  const rookieRoleId = normalizeText(config.profiles[profileId]?.rookieRoleId);
  if (!rookieRoleId || !interaction.guild) {
    return { rookieRoleId, mainNames: new Set(), roleMembersCount: 0, unboundCount: 0 };
  }
  await interaction.guild.members.fetch().catch(() => null);
  const bindingByUser = new Map(bindings.map((binding) => [String(binding.discordUserId), binding]));
  const mainNames = new Set();
  let roleMembersCount = 0;
  let unboundCount = 0;
  for (const guildMember of interaction.guild.members.cache.values()) {
    if (!guildMember.roles?.cache?.has(rookieRoleId)) continue;
    roleMembersCount += 1;
    const binding = bindingByUser.get(guildMember.id);
    if (binding?.mainName) mainNames.add(binding.mainName);
    else unboundCount += 1;
  }
  return { rookieRoleId, mainNames, roleMembersCount, unboundCount };
}

async function handleMember(interaction, context) {
  const name = interaction.options.getString('name');
  const user = interaction.options.getUser('user');
  if (!name && !user) {
    await interaction.reply({ content: context.t('track.error.nameOrUser'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (name && user) {
    await interaction.reply({ content: context.t('track.error.oneTarget'), flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const options = {
    farmPeriod: interaction.options.getString('period') || 'current-month',
    farmMonth: interaction.options.getString('month') || '',
    activityMonth: interaction.options.getString('fat-month') || '',
  };
  const result = user
    ? await trackMemberByDiscordUserId(context.config.storage.rootDir, user.id, options)
    : await trackMemberByName(context.config.storage.rootDir, name, options);
  if (!result.found) {
    if (result.reason === 'binding_not_found') {
      await interaction.editReply({ content: context.t('track.error.bindingMissing') });
      return;
    }
    if (result.reason === 'member_not_found_for_binding') {
      await interaction.editReply({
        content: context.t('track.error.bindingMemberMissing', {
          mainName: result.discordBinding?.mainName || context.t('track.value.notSet'),
        }),
      });
      return;
    }
    await interaction.editReply({ content: context.t('track.error.memberMissing', { name: result.query }) });
    return;
  }
  await interaction.editReply({ embeds: [buildMemberEmbed(result, context.t)] });
}

async function sendEmbeds(interaction, embeds) {
  const safe = embeds.filter(Boolean);
  await interaction.editReply({ embeds: safe.slice(0, 10) });
  for (let index = 10; index < safe.length; index += 10) {
    await interaction.followUp({ embeds: safe.slice(index, index + 10), flags: MessageFlags.Ephemeral });
  }
}

async function handleActivity(interaction, context, subcommand) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const storageRoot = context.config.storage.rootDir;
  const corporationId = await resolveActivityCorporationId(
    storageRoot,
    interaction.options.getString('corporation') || ''
  );
  const profile = await readCorporationProfile(storageRoot, corporationId, { createIfMissing: false }).catch(() => null);
  const corporation = corporationLabel(profile, corporationId);

  if (subcommand === 'import') {
    const result = await importFatActivityFromAttachment({
      storageRoot,
      corporationId,
      month: interaction.options.getString('month', true),
      attachment: interaction.options.getAttachment('file', true),
    });
    await interaction.editReply({
      content: [
        context.t(result.mode === 'preview'
          ? 'track.activity.importPreviewTitle'
          : 'track.activity.importSavedTitle'),
        context.t('track.activity.importSummary', {
          corporation,
          month: result.month,
          rows: result.rowsCount,
          fat: formatFat(result.activityTotalFat),
        }),
        context.t(result.mode === 'preview'
          ? 'track.activity.importPreviewNotice'
          : 'track.activity.importSavedNotice', {
          count: result.savedRowsCount,
        }),
      ].join('\n'),
    });
    return;
  }

  if (subcommand === 'months') {
    const summaries = await getFatMonthSummary(storageRoot, corporationId);
    const embeds = buildRowsEmbeds(
      context.t('track.activity.monthsTitle'),
      COLORS.default,
      summaries,
      (row) => context.t('track.activity.monthRow', {
        month: row.month,
        mains: row.mainsCount,
        fat: formatFat(row.totalFat),
      }),
      context.t('track.activity.empty')
    );
    embeds[0].setDescription(`**${corporation}**\n${embeds[0].data.description}`);
    await sendEmbeds(interaction, embeds);
    return;
  }

  const month = interaction.options.getString('month') || '';
  const rookieContext = subcommand === 'rookies'
    ? await resolveRookieContext(interaction, storageRoot, corporationId)
    : { rookieRoleId: '', mainNames: new Set(), roleMembersCount: 0, unboundCount: 0 };
  const report = await buildActivityReport({
    storageRoot,
    corporationId,
    month,
    rookieMainNames: rookieContext.mainNames,
  });
  const overview = new EmbedBuilder()
    .setTitle(subcommand === 'rookies'
      ? context.t('track.activity.rookiesTitle')
      : subcommand === 'three-months'
        ? context.t('track.activity.threeMonthsTitle')
        : context.t('track.activity.overviewTitle'))
    .setColor(subcommand === 'rookies' ? COLORS.alt : COLORS.default)
    .setDescription([
      context.t('track.activity.overview', {
        corporation,
        month: report.targetMonth,
        minimum: report.minimumFat,
        families: report.familiesCount,
        compliant: subcommand === 'rookies' ? report.rookies.compliant.length : report.compliant.length,
        problem: subcommand === 'rookies' ? report.rookies.problem.length : report.problem.length,
      }),
      subcommand !== 'rookies' ? context.t('track.activity.lookback', {
        chronic: report.chronic.length,
        loaded: report.lookbackMonths.length,
        required: report.lookbackCount,
        ineligible: report.lookbackIneligible.length,
      }) : context.t('track.activity.rookieOverview', {
        role: rookieContext.rookieRoleId ? `<@&${rookieContext.rookieRoleId}>` : context.t('track.activity.rookieRoleMissing'),
        roleMembers: rookieContext.roleMembersCount,
        matched: report.rookies.all.length,
        unbound: rookieContext.unboundCount,
      }),
    ].join('\n'));

  const empty = context.t('track.activity.empty');
  if (subcommand === 'three-months') {
    const chronic = buildRowsEmbeds(
      context.t('track.activity.categoryChronic'),
      COLORS.chronic,
      report.chronic,
      (row) => context.t('track.activity.chronicRow', {
        mainName: row.mainName,
        history: row.history.map((item) => `${item.month}: ${formatFat(item.fatCount)}`).join(' · '),
      }),
      report.hasCompleteLookback ? empty : `${report.lookbackMonths.length}/${report.lookbackCount}`
    );
    const ineligible = buildRowsEmbeds(
      context.t('track.activity.categoryIneligible'),
      COLORS.warning,
      report.lookbackIneligible,
      (row) => context.t('track.activity.row', { mainName: row.mainName, fat: formatFat(row.fatCount) }),
      empty
    );
    await sendEmbeds(interaction, [overview, ...chronic, ...ineligible]);
    return;
  }

  const scope = subcommand === 'rookies' ? report.rookies : report;
  const compliant = buildRowsEmbeds(
    context.t('track.activity.categoryCompliant'),
    COLORS.main,
    scope.compliant,
    (row) => context.t('track.activity.row', { mainName: row.mainName, fat: formatFat(row.fatCount) }),
    empty
  );
  const low = buildRowsEmbeds(
    context.t('track.activity.categoryLow'),
    COLORS.warning,
    scope.low,
    (row) => context.t('track.activity.row', { mainName: row.mainName, fat: formatFat(row.fatCount) }),
    empty
  );
  const zero = buildRowsEmbeds(
    context.t('track.activity.categoryZero'),
    COLORS.inactive,
    scope.zero,
    (row) => context.t('track.activity.row', { mainName: row.mainName, fat: formatFat(row.fatCount) }),
    empty
  );
  await sendEmbeds(interaction, [overview, ...compliant, ...low, ...zero]);
}

async function execute(interaction, context) {
  const group = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();
  if (!group && subcommand === 'member') {
    await handleMember(interaction, context);
    return;
  }
  if (group === 'activity') {
    await handleActivity(interaction, context, subcommand);
    return;
  }
  throw new Error(`Unsupported /track action: ${group ? `${group} ` : ''}${subcommand}`);
}

async function autocomplete(interaction, context) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'corporation') {
    await interaction.respond([]);
    return;
  }
  const choices = await autocompleteActivityCorporations(
    context.config.storage.rootDir,
    focused.value
  );
  await interaction.respond(choices);
}

module.exports = {
  data,
  execute,
  autocomplete,
  formatFat,
  buildMemberEmbed,
  resolveRookieContext,
};
