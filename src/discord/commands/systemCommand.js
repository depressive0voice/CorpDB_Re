const { AttachmentBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { listCorporations } = require('../../corporations/corporationRegistryRepository');
const { readCorporationProfile } = require('../../corporations/corporationProfileRepository');
const { buildSystemStatus } = require('../../system/systemStatusService');
const { buildStorageExport, getStorageStatus } = require('../../system/storageExportService');
const { SYSTEM_JOB_KEYS, runSystemJob } = require('../../system/systemJobService');

const MAX_DISCORD_EXPORT_BYTES = 24 * 1024 * 1024;

function normalizeText(value) {
  return String(value || '').trim();
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let size = bytes / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${units[index]}`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

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

function yesNo(context, value) {
  return context.t(value ? 'system.common.yes' : 'system.common.no');
}

function buildSystemStatusLines(context, status, interaction) {
  const guildLabel = status.discord.guildId
    ? `${interaction.guild?.name || status.discord.guildId} (${status.discord.guildId})`
    : context.t('system.common.none');
  const lines = [
    context.t('system.status.title'),
    context.t('system.status.health', {
      health: status.health,
      errors: status.errorCount,
      warnings: status.warningCount,
    }),
    context.t('system.status.discord', { guild: guildLabel }),
    context.t('system.status.eve', {
      datasource: status.eve.datasource,
      date: status.eve.compatibilityDate,
      count: status.eve.authorizationCount,
    }),
    context.t('system.status.storage', {
      files: status.storage.dataFileCount,
      size: formatBytes(status.storage.dataBytes),
      secrets: status.storage.secretFileCount,
    }),
    '',
    context.t('system.status.corporations', { count: status.corporations.length }),
  ];

  for (const corporation of status.corporations) {
    const name = corporation.name
      ? `${corporation.name}${corporation.ticker ? ` [${corporation.ticker}]` : ''}`
      : corporation.corporationId;
    lines.push(context.t('system.status.corporationLine', {
      defaultMarker: corporation.isDefault ? '★ ' : '',
      name,
      id: corporation.corporationId,
      enabled: yesNo(context, corporation.enabled),
      authorized: yesNo(context, corporation.authorized),
      service: corporation.serviceCharacterName || context.t('system.common.none'),
      roles: corporation.corporationRolesCount,
    }));
  }

  lines.push('', context.t('system.status.modules'));
  for (const module of status.modules) {
    lines.push(context.t('system.status.moduleLine', {
      module: module.key,
      state: yesNo(context, module.enabled),
    }));
  }

  lines.push('', context.t('system.status.jobs'));
  for (const [job, jobStatus] of Object.entries(status.jobs).filter(([key]) => key !== 'enabled')) {
    lines.push(context.t('system.status.jobLine', {
      job,
      state: yesNo(context, jobStatus.enabled),
      interval: jobStatus.intervalMinutes,
    }));
  }

  lines.push('', context.t('system.status.issues'));
  if (status.issues.length === 0) {
    lines.push(context.t('system.status.noIssues'));
  } else {
    for (const issue of status.issues) {
      lines.push(context.t('system.status.issueLine', {
        severity: issue.severity,
        message: issue.message,
      }));
    }
  }
  return lines;
}

function buildManualJobLines(context, response) {
  const { job, corporationId, result } = response;
  const lines = [
    context.t('system.run.title'),
    context.t('system.run.job', { job }),
    context.t('system.run.scope', {
      corporation: corporationId || context.t('system.common.all'),
    }),
  ];

  if (job === SYSTEM_JOB_KEYS.PROMOTION) {
    lines.push(context.t('system.run.promotion', {
      eligible: result?.eligibleCount || 0,
      created: result?.createdCount || 0,
      skipped: result?.skippedCount || 0,
    }));
    if (result?.failed && result?.error) lines.push(result.error);
    return lines;
  }

  if (job === SYSTEM_JOB_KEYS.FAT_REWARDS_REMINDER && result?.enabled === false) {
    lines.push(`**${result.reason || 'disabled'}**`);
    return lines;
  }

  const entries = Array.isArray(result?.results) ? result.results : [];
  lines.push(context.t('system.run.summary', {
    checked: result?.checkedCorporations ?? entries.length,
    succeeded: result?.succeeded ?? entries.filter((entry) => entry.ok !== false && entry.action !== 'failed').length,
    failed: result?.failed ?? entries.filter((entry) => entry.ok === false || entry.action === 'failed').length,
  }));

  for (const entry of entries) {
    if (entry.ok === false) {
      lines.push(context.t('system.run.failed', {
        corporation: entry.corporationId,
        message: entry.error || entry.errorCode || 'unknown error',
      }));
      continue;
    }

    if (job === SYSTEM_JOB_KEYS.MEMBERS) {
      const value = entry.result || {};
      lines.push(context.t('system.run.members', {
        corporation: entry.corporationId,
        active: value.activeCount || 0,
        added: value.addedCount || 0,
        updated: value.updatedCount || 0,
        left: value.leftCount || 0,
      }));
    } else if (job === SYSTEM_JOB_KEYS.FINANCE) {
      lines.push(context.t('system.run.finance', {
        corporation: entry.corporationId,
        balance: entry.refresh?.totalBalanceFormatted || '0',
        history: entry.refresh?.historyAddedCount || 0,
        alerts: entry.alert?.alertedCount || 0,
      }));
    } else if (job === SYSTEM_JOB_KEYS.APPLICATIONS) {
      const value = entry.result || {};
      lines.push(context.t('system.run.applications', {
        corporation: entry.corporationId,
        tracked: value.trackedApplicationsCount || 0,
        pending: value.pendingApplicationsCount || 0,
        sent: value.sentCount || 0,
        edited: value.editedCount || 0,
      }));
    } else if (job === SYSTEM_JOB_KEYS.STRUCTURE_FUEL) {
      const value = entry.result || {};
      lines.push(context.t('system.run.structures', {
        corporation: entry.corporationId,
        total: value.totalCount || 0,
        critical: value.criticalCount || 0,
        alerts: value.newCriticalAlertsCount || 0,
        recovered: value.recoveredAlertsCount || 0,
        suppressed: value.alertSuppressedCount || 0,
      }));
    } else if (job === SYSTEM_JOB_KEYS.FAT_REWARDS_REMINDER) {
      lines.push(context.t('system.run.fatReminder', {
        corporation: entry.corporationId,
        action: entry.action || 'unknown',
        code: entry.code ? ` (${entry.code})` : '',
      }));
    }
  }
  return lines;
}

async function autocompleteCorporations(interaction, context) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'corporation') {
    await interaction.respond([]);
    return;
  }
  const needle = normalizeText(focused.value).toLowerCase();
  const registrations = await listCorporations(context.config.storage.rootDir, { enabledOnly: true });
  const choices = [];
  for (const registration of registrations) {
    const profile = await readCorporationProfile(
      context.config.storage.rootDir,
      registration.corporationId,
      { createIfMissing: false }
    ).catch(() => null);
    const label = profile?.name
      ? `${profile.name}${profile.ticker ? ` [${profile.ticker}]` : ''}`
      : registration.corporationId;
    const haystack = `${label} ${registration.corporationId}`.toLowerCase();
    if (needle && !haystack.includes(needle)) continue;
    choices.push({
      name: `${label} (${registration.corporationId})`.slice(0, 100),
      value: registration.corporationId,
    });
    if (choices.length >= 25) break;
  }
  await interaction.respond(choices);
}

const data = new SlashCommandBuilder()
  .setName('system')
  .setDescription('Diagnostics, manual jobs and safe storage export')
  .setDescriptionLocalizations({
    ru: 'Диагностика, ручные задачи и безопасный экспорт storage',
  })
  .addSubcommand((subcommand) => subcommand
    .setName('ping')
    .setDescription('Check the bot process and Discord gateway')
    .setDescriptionLocalizations({ ru: 'Проверить процесс бота и Discord gateway'}))
  .addSubcommand((subcommand) => subcommand
    .setName('status')
    .setDescription('Show deployment and configuration health')
    .setDescriptionLocalizations({ ru: 'Показать состояние конфигурации и deployment'}))
  .addSubcommand((subcommand) => subcommand
    .setName('run-job')
    .setDescription('Run a background job manually')
    .setDescriptionLocalizations({ ru: 'Вручную запустить фоновую задачу'})
    .addStringOption((option) => option
      .setName('job')
      .setDescription('Background job')
      .setDescriptionLocalizations({ ru: 'Фоновая задача'})
      .setRequired(true)
      .addChoices(
        { name: 'Members sync', value: SYSTEM_JOB_KEYS.MEMBERS },
        { name: 'Finance refresh', value: SYSTEM_JOB_KEYS.FINANCE },
        { name: 'Applications check', value: SYSTEM_JOB_KEYS.APPLICATIONS },
        { name: 'Structure fuel check', value: SYSTEM_JOB_KEYS.STRUCTURE_FUEL },
        { name: 'Promotion check', value: SYSTEM_JOB_KEYS.PROMOTION },
        { name: 'FAT rewards reminder', value: SYSTEM_JOB_KEYS.FAT_REWARDS_REMINDER }
      ))
    .addStringOption((option) => option
      .setName('corporation')
      .setDescription('Optional corporation; empty runs all eligible corporations')
      .setDescriptionLocalizations({
        ru: 'Корпорация; без выбора запускается для всех подходящих корпораций',
      })
      .setRequired(false)
      .setAutocomplete(true))
    .addIntegerOption((option) => option
      .setName('max-journal-pages')
      .setDescription('Finance only: wallet journal pages per division')
      .setDescriptionLocalizations({
        ru: 'Только Finance: страниц wallet journal на дивизион',
      })
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(100)))
  .addSubcommandGroup((group) => group
    .setName('storage')
    .setDescription('Inspect or safely export storage')
    .setDescriptionLocalizations({ ru: 'Проверить или безопасно экспортировать storage'})
    .addSubcommand((subcommand) => subcommand
      .setName('status')
      .setDescription('Show storage size and secret-file count')
      .setDescriptionLocalizations({ ru: 'Показать размер storage и число secret-файлов'}))
    .addSubcommand((subcommand) => subcommand
      .setName('export')
      .setDescription('Export all non-secret storage as compressed JSON')
      .setDescriptionLocalizations({ ru: 'Экспортировать весь storage без secrets в сжатый JSON'})));

async function autocomplete(interaction, context) {
  await autocompleteCorporations(interaction, context);
}

async function execute(interaction, context) {
  const group = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();

  if (!group && subcommand === 'ping') {
    const latency = Math.max(0, Math.round(Number(interaction.client.ws?.ping) || 0));
    await interaction.reply({
      content: [
        context.t('system.ping.title'),
        context.t('system.ping.gateway', { latency }),
        context.t('system.ping.uptime', { uptime: formatDuration(process.uptime()) }),
        context.t('system.ping.node', { version: process.version }),
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!group && subcommand === 'status') {
    const status = await buildSystemStatus(context.config);
    await sendLines(interaction, buildSystemStatusLines(context, status, interaction));
    return;
  }

  if (!group && subcommand === 'run-job') {
    const job = interaction.options.getString('job', true);
    const corporationId = normalizeText(interaction.options.getString('corporation'));
    const maxJournalPages = interaction.options.getInteger('max-journal-pages') || undefined;
    const response = await runSystemJob(context.config, interaction.client, job, {
      corporationId,
      maxJournalPages,
    });
    await sendLines(interaction, buildManualJobLines(context, response));
    return;
  }

  if (group === 'storage' && subcommand === 'status') {
    const status = await getStorageStatus(context.config.storage.rootDir);
    await interaction.editReply({
      content: [
        context.t('system.storage.title'),
        context.t('system.storage.root', { root: status.rootDir }),
        context.t('system.storage.data', {
          files: status.dataFileCount,
          size: formatBytes(status.dataBytes),
        }),
        context.t('system.storage.secrets', { files: status.secretFileCount }),
      ].join('\n'),
    });
    return;
  }

  if (group === 'storage' && subcommand === 'export') {
    const result = await buildStorageExport(context.config.storage.rootDir);
    if (result.compressedBytes > MAX_DISCORD_EXPORT_BYTES) {
      await interaction.editReply({
        content: context.t('system.storage.exportTooLarge', {
          size: formatBytes(result.compressedBytes),
        }),
      });
      return;
    }
    const attachment = new AttachmentBuilder(result.buffer, { name: result.fileName });
    await interaction.editReply({
      content: [
        context.t('system.storage.exportReady'),
        context.t('system.storage.exportStats', {
          files: result.fileCount,
          size: formatBytes(result.compressedBytes),
          sha: result.sha256,
        }),
      ].join('\n'),
      files: [attachment],
    });
    return;
  }

  throw new Error(`Unsupported /system route: ${group ? `${group} ` : ''}${subcommand}.`);
}

module.exports = {
  data,
  execute,
  autocomplete,
  MAX_DISCORD_EXPORT_BYTES,
  formatBytes,
  formatDuration,
  chunkLines,
  buildSystemStatusLines,
  buildManualJobLines,
};
