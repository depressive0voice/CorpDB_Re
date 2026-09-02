const { MessageFlags } = require('discord.js');
const { runBindingAudit } = require('../../mainBinding/bindingAuditService');

const MESSAGE_MAX_LENGTH = 1800;

function configureBindingAuditSubcommand(subcommand) {
  return subcommand
    .setName('binding-audit')
    .setDescription('Audit Discord to main bindings without changing data')
    .setDescriptionLocalizations({
      ru: 'Проверить целостность Discord ↔ main-привязок без изменений данных',
    });
}

function normalizeText(value) {
  return String(value || '').trim();
}

function formatBinding(binding) {
  const userId = normalizeText(binding?.discordUserId);
  const mainName = normalizeText(binding?.mainName) || '?';
  return `**${mainName}** ← ${userId ? `<@${userId}>` : '?'}`;
}

function chunkLines(lines, maxLength = MESSAGE_MAX_LENGTH) {
  const chunks = [];
  let current = '';

  for (const original of lines) {
    let line = String(original ?? '');
    while (line.length > maxLength) {
      const head = line.slice(0, maxLength);
      if (current) {
        chunks.push(current);
        current = '';
      }
      chunks.push(head);
      line = line.slice(maxLength);
    }

    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= maxLength) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = line;
    }
  }

  if (current) chunks.push(current);
  return chunks.length ? chunks : [''];
}

function pushSection(lines, title, rows) {
  if (!rows.length) return;
  lines.push('', title, ...rows);
}

function buildBindingAuditLines(audit, context) {
  const { t } = context;
  const issues = audit.issues;
  const lines = [
    t('bindingAudit.title'),
    t('bindingAudit.summary.discordUsers', { count: audit.totalDiscordUsers }),
    t('bindingAudit.summary.approved', { count: audit.approvedBindingsCount }),
    t('bindingAudit.summary.pending', { count: audit.pendingRequestsCount }),
    t('bindingAudit.summary.bound', { count: audit.boundUsersCount }),
    t('bindingAudit.summary.healthy', { count: audit.healthyBoundUsersCount }),
    t('bindingAudit.summary.withIssues', { count: audit.boundUsersWithIssuesCount }),
    t('bindingAudit.summary.unbound', { count: audit.unboundUsersCount }),
    t('bindingAudit.summary.pendingUnbound', { count: audit.pendingUnboundCount }),
    t('bindingAudit.summary.stale', { count: issues.staleBindings.length }),
    '',
    t('bindingAudit.problems.title'),
    t('bindingAudit.problems.mainMissingAuth', { count: issues.mainMissingAuth.length }),
    t('bindingAudit.problems.emptyCorporations', { count: issues.emptyCorporationIds.length }),
    t('bindingAudit.problems.unregisteredCorporations', { count: issues.unregisteredCorporations.length }),
    t('bindingAudit.problems.disabledCorporations', { count: issues.disabledCorporations.length }),
    t('bindingAudit.problems.profileMissing', { count: issues.onboardingProfileMissing.length }),
  ];

  pushSection(
    lines,
    t('bindingAudit.section.unbound'),
    audit.unboundUsers.map((entry) => {
      const name = entry.displayName || entry.username || entry.discordUserId;
      const pending = entry.pendingRequest
        ? ` — ${t('bindingAudit.label.pending', { mainName: entry.pendingRequest.mainName || '?' })}`
        : '';
      return `- <@${entry.discordUserId}> — **${name}**${pending}`;
    })
  );

  pushSection(
    lines,
    t('bindingAudit.section.stale'),
    issues.staleBindings.map((entry) => `- ${formatBinding(entry.binding)}`)
  );
  pushSection(
    lines,
    t('bindingAudit.section.mainMissingAuth'),
    issues.mainMissingAuth.map((entry) => `- ${formatBinding(entry.binding)}`)
  );
  pushSection(
    lines,
    t('bindingAudit.section.emptyCorporations'),
    issues.emptyCorporationIds.map((entry) => `- ${formatBinding(entry.binding)}`)
  );
  pushSection(
    lines,
    t('bindingAudit.section.unregisteredCorporations'),
    issues.unregisteredCorporations.map((entry) => (
      `- ${formatBinding(entry.binding)} — ${t('bindingAudit.label.corporations', {
        corporations: entry.corporationIds.join(', ') || t('bindingAudit.common.none'),
      })}`
    ))
  );
  pushSection(
    lines,
    t('bindingAudit.section.disabledCorporations'),
    issues.disabledCorporations.map((entry) => (
      `- ${formatBinding(entry.binding)} — ${t('bindingAudit.label.corporations', {
        corporations: entry.corporationIds.join(', ') || t('bindingAudit.common.none'),
      })}`
    ))
  );
  pushSection(
    lines,
    t('bindingAudit.section.profileMissing'),
    issues.onboardingProfileMissing.map((entry) => (
      `- ${formatBinding(entry.binding)} — ${t('bindingAudit.label.profile', {
        profile: entry.onboardingProfileId || t('bindingAudit.common.notSet'),
      })}`
    ))
  );

  return lines;
}

async function executeBindingAuditAdmin(interaction, context) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const audit = await runBindingAudit(context.config.storage.rootDir, interaction.guild);
  const chunks = chunkLines(buildBindingAuditLines(audit, context));
  await interaction.editReply({ content: chunks[0] });
  for (const chunk of chunks.slice(1)) {
    await interaction.followUp({ content: chunk, flags: MessageFlags.Ephemeral });
  }
  return audit;
}

module.exports = {
  configureBindingAuditSubcommand,
  buildBindingAuditLines,
  executeBindingAuditAdmin,
};
