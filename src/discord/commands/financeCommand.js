const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { getWalletSummary } = require('../../finance/walletService');
const {
  getCorporationIncomeSummary,
  getPlayerDonationsSummary,
} = require('../../finance/financeReportService');
const { readFinancePolicy } = require('../../finance/financePolicyRepository');
const { autocompleteFinanceCorporations } = require('../../finance/financeCorporationService');
const { REPORT_PERIODS } = require('../../finance/reportPeriod');
const { extractDonorName } = require('../../finance/donationAlertService');

function normalizeText(value) {
  return String(value || '').trim();
}

function formatDiscordTimestamp(value, style = 'f') {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) return '—';
  return `<t:${Math.floor(timestamp / 1000)}:${style}>`;
}

function resolvePeriod(interaction) {
  const month = normalizeText(interaction.options.getString('month'));
  if (month) return { period: REPORT_PERIODS.MONTH, month };
  return {
    period: interaction.options.getString('period') || REPORT_PERIODS.CURRENT_MONTH,
    month: '',
  };
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

function addPeriodOptions(subcommand) {
  subcommand
    .addStringOption((option) => option
      .setName('period')
      .setDescription('Report period')
      .setDescriptionLocalizations({ ru: 'Период отчёта'})
      .setRequired(false)
      .addChoices(
        { name: 'Current month', value: REPORT_PERIODS.CURRENT_MONTH },
        { name: 'Previous month', value: REPORT_PERIODS.PREVIOUS_MONTH },
        { name: 'Specified month', value: REPORT_PERIODS.MONTH },
        { name: 'All history', value: REPORT_PERIODS.ALL }
      ))
    .addStringOption((option) => option
      .setName('month')
      .setDescription('Month in MM-YYYY format; overrides period')
      .setDescriptionLocalizations({
        ru: 'Месяц в формате ММ-ГГГГ; имеет приоритет над period',
      })
      .setRequired(false));
  return addCorporationOption(subcommand);
}

const data = new SlashCommandBuilder()
  .setName('finance')
  .setDescription('Corporation wallet, income and donations')
  .setDescriptionLocalizations({
    ru: 'Кошелёк, доходы и пожертвования корпорации',
  })
  .addSubcommand((subcommand) => addCorporationOption(subcommand
    .setName('wallet')
    .setDescription('Show corporation wallet balances')
    .setDescriptionLocalizations({
      ru: 'Показать балансы корпоративных кошельков',
    })))
  .addSubcommand((subcommand) => addPeriodOptions(subcommand
    .setName('income')
    .setDescription('Show corporation tax income report')
    .setDescriptionLocalizations({
      ru: 'Показать налоговый отчёт корпорации',
    })))
  .addSubcommand((subcommand) => addPeriodOptions(subcommand
    .setName('donations')
    .setDescription('Show player donations')
    .setDescriptionLocalizations({
      ru: 'Показать пожертвования игроков',
    })));

function chunkLines(lines, maxLength = 1850) {
  const chunks = [];
  let current = '';
  for (const rawLine of lines) {
    const line = String(rawLine ?? '');
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    current = line.length <= maxLength ? line : `${line.slice(0, maxLength - 1)}…`;
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : ['—'];
}

async function sendLines(interaction, lines) {
  const chunks = chunkLines(lines);
  await interaction.editReply({ content: chunks[0] });
  for (const chunk of chunks.slice(1)) {
    await interaction.followUp({ content: chunk, flags: MessageFlags.Ephemeral });
  }
}

function formatRate(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function refLabel(context, refType) {
  const key = `finance.ref.${normalizeText(refType).toLowerCase()}`;
  const translated = context.t(key);
  return translated === key ? refType : translated;
}

async function buildWalletLines(context, result, storageRoot) {
  const lines = [
    `**${context.t('finance.wallet.title', { corporation: result.corporationName })}**`,
    context.t('finance.wallet.balance', { amount: result.totals.balanceFormatted }),
    context.t('finance.wallet.retrieved', { time: formatDiscordTimestamp(result.retrievedAt) }),
  ];

  if (result.corporationId !== 'all') {
    lines.splice(2, 0, context.t('finance.wallet.tax', {
      rate: formatRate(result.corporationTaxRatePercent),
    }));
  }
  lines.push('');

  const summaries = Array.isArray(result.summaries) ? result.summaries : [result];
  for (const summary of summaries) {
    const policy = await readFinancePolicy(storageRoot, summary.corporationId);
    if (summaries.length > 1) {
      lines.push(`**${summary.corporationName}** (\`${summary.corporationId}\`)`);
    }
    for (const division of summary.divisionBalances) {
      const marker = policy.excludedWalletDivisions.includes(division.division)
        ? context.t('finance.wallet.excludedMarker')
        : '';
      lines.push(`${context.t('finance.wallet.divisionLine', {
        division: division.division,
        amount: division.balanceFormatted,
      })}${marker}`);
    }
    if (summaries.length > 1) lines.push('');
  }
  return lines;
}

function buildIncomeLines(context, result) {
  const lines = [
    `**${context.t('finance.income.title', { corporation: result.corporationName })}**`,
    context.t('finance.income.period', { period: result.periodLabel }),
    context.t('finance.income.history', {
      history: result.historyEntriesCount,
      periodEntries: result.periodEntriesCount,
    }),
    context.t('finance.income.excludedWalletEntries', {
      count: result.excludedWalletEntriesCount || 0,
    }),
    context.t('finance.income.refreshed', { time: formatDiscordTimestamp(result.lastRefreshedAt) }),
    '',
    context.t('finance.income.gross', { amount: result.grossTaxableBaseFormatted }),
    context.t('finance.income.received', { amount: result.taxableReceivedFormatted }),
    context.t('finance.income.allianceDue', { amount: result.allianceTaxDueFormatted }),
    context.t('finance.income.retained', { amount: result.corporationRetainedFormatted }),
    context.t('finance.income.otherInflows', { amount: result.excludedInflowsFormatted }),
    context.t('finance.income.outflows', { amount: result.outflowsFormatted }),
    '',
    context.t('finance.income.corporationTax', {
      rate: result.currentCorporateTaxRatePercentFormatted,
    }),
    context.t('finance.income.allianceTax', {
      rate: result.allianceTaxRatePercentFormatted,
    }),
  ];

  if (result.taxableGroups.length > 0) {
    lines.push('', context.t('finance.income.taxableTitle', { count: result.taxableGroups.length }));
    for (const group of result.taxableGroups) {
      const corp = group.corporationName ? `${group.corporationName} / ` : '';
      lines.push(context.t('finance.income.taxableGroup', {
        label: `${corp}${refLabel(context, group.refType)}`,
        amount: group.amountFormatted,
        gross: group.grossBaseFormatted,
        alliance: group.allianceTaxDueFormatted,
        retained: group.corporationRetainedFormatted,
      }));
    }
  }

  if (result.excludedGroups.length > 0) {
    lines.push('', context.t('finance.income.otherTitle', { count: result.excludedGroups.length }));
    for (const group of result.excludedGroups) {
      const corp = group.corporationName ? `${group.corporationName} / ` : '';
      lines.push(context.t('finance.income.simpleGroup', {
        label: `${corp}${refLabel(context, group.refType)}`,
        amount: group.amountFormatted,
      }));
    }
  }

  if (result.outflowGroups.length > 0) {
    lines.push('', context.t('finance.income.outflowTitle', { count: result.outflowGroups.length }));
    for (const group of result.outflowGroups) {
      const corp = group.corporationName ? `${group.corporationName} / ` : '';
      lines.push(context.t('finance.income.simpleGroup', {
        label: `${corp}${refLabel(context, group.refType)}`,
        amount: group.amountFormatted,
      }));
    }
  }
  return lines;
}

function buildDonationLines(context, result) {
  const lines = [
    `**${context.t('finance.donations.title', { corporation: result.corporationName })}**`,
    context.t('finance.income.period', { period: result.periodLabel }),
    context.t('finance.income.refreshed', { time: formatDiscordTimestamp(result.lastRefreshedAt) }),
    context.t('finance.donations.total', { amount: result.totalAmountFormatted }),
    context.t('finance.donations.count', { count: result.donationEntryCount }),
  ];

  for (const group of result.donationGroups) {
    const corp = group.corporationName ? `${group.corporationName} / ` : '';
    lines.push(context.t('finance.donations.group', {
      division: `${corp}${group.division}`,
      amount: group.amountFormatted,
      count: group.entryCount,
    }));
  }

  if (result.recentDonations.length === 0) {
    lines.push('', context.t('finance.donations.none'));
    return lines;
  }

  lines.push('');
  for (const entry of result.recentDonations) {
    const corp = result.corporationId === 'all' ? `${entry.corporationName} / ` : '';
    lines.push(context.t('finance.donations.entry', {
      donor: `${corp}${extractDonorName(entry.description) || '—'}`,
      amount: entry.amountFormatted,
      division: entry.division,
      date: formatDiscordTimestamp(entry.date),
    }));
    if (entry.reason) lines.push(context.t('finance.donations.reason', { reason: entry.reason }));
  }
  return lines;
}

async function autocomplete(interaction, context) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'corporation') {
    await interaction.respond([]);
    return;
  }
  const choices = await autocompleteFinanceCorporations(
    context.config.storage.rootDir,
    focused.value,
    { allowAll: true }
  );
  await interaction.respond(choices);
}

async function execute(interaction, context) {
  const subcommand = interaction.options.getSubcommand();
  const requestedCorporation = normalizeText(interaction.options.getString('corporation'));
  const storageRoot = context.config.storage.rootDir;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (subcommand === 'wallet') {
    const result = await getWalletSummary(context.config, storageRoot, requestedCorporation);
    await sendLines(interaction, await buildWalletLines(context, result, storageRoot));
    return;
  }

  const { period, month } = resolvePeriod(interaction);
  if (subcommand === 'income') {
    const result = await getCorporationIncomeSummary(
      storageRoot,
      requestedCorporation,
      period,
      month
    );
    if (!result.lastRefreshedAt) {
      await sendLines(interaction, [context.t('finance.history.empty')]);
      return;
    }
    await sendLines(interaction, buildIncomeLines(context, result));
    return;
  }

  if (subcommand === 'donations') {
    const result = await getPlayerDonationsSummary(
      storageRoot,
      requestedCorporation,
      period,
      month
    );
    if (!result.lastRefreshedAt) {
      await sendLines(interaction, [context.t('finance.history.empty')]);
      return;
    }
    await sendLines(interaction, buildDonationLines(context, result));
    return;
  }

  throw new Error(context.t('finance.error.unsupportedSubcommand', { subcommand }));
}

module.exports = {
  data,
  execute,
  autocomplete,
  chunkLines,
  formatDiscordTimestamp,
  resolvePeriod,
  buildWalletLines,
  buildIncomeLines,
  buildDonationLines,
};
