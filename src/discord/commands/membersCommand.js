const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { readRegistry } = require('../../corporations/corporationRegistryRepository');
const {
  syncCorporationMembers,
  getMemberSummary,
} = require('../../members/memberSyncService');
const { readCorporationProfile } = require('../../corporations/corporationProfileRepository');

const data = new SlashCommandBuilder()
  .setName('members')
  .setDescription('Manage corporation member synchronization')
  .setDescriptionLocalizations({
    ru: 'Управление синхронизацией состава корпорации',
  })
  .addSubcommand((subcommand) => subcommand
    .setName('sync')
    .setDescription('Synchronize corporation members from ESI')
    .setDescriptionLocalizations({
      ru: 'Синхронизировать состав корпорации из ESI',
    })
    .addStringOption((option) => option
      .setName('corporation')
      .setDescription('Corporation ID; omit to use the default corporation')
      .setRequired(false)))
  .addSubcommand((subcommand) => subcommand
    .setName('status')
    .setDescription('Show local corporation member synchronization status')
    .setDescriptionLocalizations({
      ru: 'Показать состояние локальной базы состава корпорации',
    })
    .addStringOption((option) => option
      .setName('corporation')
      .setDescription('Corporation ID; omit to use the default corporation')
      .setRequired(false)));

function isOwner(config, userId) {
  return config.discord.ownerIds.includes(String(userId));
}

async function ensureOwner(interaction, context) {
  if (isOwner(context.config, interaction.user.id)) return true;
  await interaction.reply({
    content: context.t('common.ownerOnly'),
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

async function resolveCorporationId(storageRoot, requestedCorporationId, t = null) {
  const registry = await readRegistry(storageRoot);
  const requested = String(requestedCorporationId || '').trim();

  if (requested) {
    if (!registry.corporations.some((entry) => entry.corporationId === requested)) {
      throw new Error(t
        ? t('members.error.notRegistered', { corporationId: requested })
        : `Corporation ${requested} is not registered in this CorpDB instance.`);
    }
    return requested;
  }

  if (registry.defaultCorporationId) return registry.defaultCorporationId;
  if (registry.corporations.length === 1) return registry.corporations[0].corporationId;
  throw new Error(t ? t('members.error.noDefault') : 'No default corporation is configured.');
}

function formatCorporation(profile, corporationId) {
  if (!profile?.name) return corporationId;
  return `${profile.name}${profile.ticker ? ` [${profile.ticker}]` : ''}`;
}

async function handleSync(interaction, context) {
  const corporationId = await resolveCorporationId(
    context.config.storage.rootDir,
    interaction.options.getString('corporation'),
    context.t
  );

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await syncCorporationMembers(
    context.config,
    context.config.storage.rootDir,
    corporationId
  );
  const corporation = `${result.corporationName || corporationId}${result.corporationTicker ? ` [${result.corporationTicker}]` : ''}`;

  await interaction.editReply({
    content: [
      context.t('members.sync.title', { corporation, corporationId }),
      context.t('members.sync.activeStored', {
        active: result.activeCount,
        total: result.totalCount,
      }),
      context.t('members.sync.changes', {
        added: result.addedCount,
        updated: result.updatedCount,
        unchanged: result.unchangedCount,
        left: result.leftCount,
      }),
      context.t('members.sync.tracking', {
        tracking: result.trackingCount,
        unresolved: result.unresolvedNameCount,
      }),
      context.t('members.sync.authorized', {
        character: result.authorizedCharacterName || result.authorizedCharacterId,
      }),
    ].join('\n'),
  });
}

async function handleStatus(interaction, context) {
  const corporationId = await resolveCorporationId(
    context.config.storage.rootDir,
    interaction.options.getString('corporation'),
    context.t
  );
  const [summary, profile] = await Promise.all([
    getMemberSummary(context.config.storage.rootDir, corporationId),
    readCorporationProfile(context.config.storage.rootDir, corporationId, {
      createIfMissing: false,
    }).catch(() => null),
  ]);
  const time = summary.lastUpdatedAt
    ? `<t:${Math.floor(Date.parse(summary.lastUpdatedAt) / 1000)}:R>`
    : context.t('common.never');

  await interaction.reply({
    content: [
      `**${formatCorporation(profile, corporationId)}** (\`${corporationId}\`)`,
      context.t('members.status.active', { count: summary.activeCount }),
      context.t('members.status.former', { count: summary.leftCount }),
      context.t('members.status.total', { count: summary.totalCount }),
      context.t('members.status.lastUpdate', { time }),
    ].join('\n'),
    flags: MessageFlags.Ephemeral,
  });
}

async function execute(interaction, context) {
  if (!(await ensureOwner(interaction, context))) return;

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'sync') {
    await handleSync(interaction, context);
    return;
  }
  if (subcommand === 'status') {
    await handleStatus(interaction, context);
    return;
  }

  throw new Error(context.t('members.error.unsupportedSubcommand', { subcommand }));
}

module.exports = {
  data,
  execute,
  resolveCorporationId,
};