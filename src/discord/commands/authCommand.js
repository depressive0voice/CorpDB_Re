const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  SlashCommandBuilder,
} = require('discord.js');
const {
  beginCorporationAuthorization,
  getAuthorizationStatus,
} = require('../../eve/eveAuthorizationService');
const { importAuthHtmlFromAttachment } = require('../../auth/authHtmlImportService');
const {
  syncMainAltFromAuth,
  getMainAltRelations,
} = require('../../auth/authMainAltSyncService');
const { reconcileCorpVsAuth } = require('../../auth/authReconciliationService');
const { ACCESS_LEVELS, getBaseAccessLevel } = require('../../access/accessService');

const MESSAGE_LIMIT = 1800;

const data = new SlashCommandBuilder()
  .setName('auth')
  .setDescription('Manage CorpDB EVE authorization and auth data')
  .setDescriptionLocalizations({
    ru: 'Управление авторизацией EVE и auth-данными CorpDB',
  })
  .addSubcommand((subcommand) => subcommand
    .setName('setup')
    .setDescription('Authorize a corporation service character through EVE SSO')
    .setDescriptionLocalizations({
      ru: 'Авторизовать служебного персонажа корпорации через EVE SSO',
    }))
  .addSubcommand((subcommand) => subcommand
    .setName('status')
    .setDescription('Show registered corporation authorizations')
    .setDescriptionLocalizations({
      ru: 'Показать зарегистрированные авторизации корпораций',
    }))
  .addSubcommand((subcommand) => subcommand
    .setName('import-html')
    .setDescription('Import main/alt auth data from an HTML export')
    .setDescriptionLocalizations({
      ru: 'Импортировать main/alt auth-данные из HTML',
    })
    .addAttachmentOption((option) => option
      .setName('file')
      .setDescription('Auth HTML file')
      .setDescriptionLocalizations({ ru: 'HTML-файл auth'})
      .setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName('sync-main-alt')
    .setDescription('Validate or rebuild Main-Alt links from imported auth data')
    .setDescriptionLocalizations({
      ru: 'Проверить или пересобрать связи Main-Alt из импортированного auth',
    })
    .addStringOption((option) => option
      .setName('mode')
      .setDescription('preview only shows changes; apply writes them')
      .setDescriptionLocalizations({
        ru: 'preview только показывает изменения; apply записывает их',
      })
      .setRequired(true)
      .addChoices(
        { name: 'preview', value: 'preview' },
        { name: 'apply', value: 'apply' }
      )))
  .addSubcommand((subcommand) => subcommand
    .setName('reconcile')
    .setDescription('Compare current corporation members with imported auth data')
    .setDescriptionLocalizations({
      ru: 'Сверить текущий состав корпораций с импортированным auth',
    }))
  .addSubcommandGroup((group) => group
    .setName('show')
    .setDescription('Show imported auth relationships')
    .setDescriptionLocalizations({
      ru: 'Показать связи из импортированного auth',
    })
    .addSubcommand((subcommand) => subcommand
      .setName('main-alt')
      .setDescription('Show the complete Main-Alt relationship list')
      .setDescriptionLocalizations({
        ru: 'Показать полный список связей Main-Alt',
      })));

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

async function ensureAdmin(interaction, context) {
  const access = await getBaseAccessLevel(
    context.config,
    context.config.storage.rootDir,
    interaction.member
  );
  if (access.level === ACCESS_LEVELS.ADMIN || access.level === ACCESS_LEVELS.MASTER_ADMIN) {
    return true;
  }
  await interaction.reply({
    content: context.t('access.denied.admin'),
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

function splitLongLine(rawLine, maxLength = MESSAGE_LIMIT) {
  const line = String(rawLine || '');
  if (line.length <= maxLength) return [line];

  const parts = [];
  let rest = line;
  while (rest.length > maxLength) {
    let splitAt = rest.lastIndexOf(', ', maxLength);
    if (splitAt < Math.floor(maxLength * 0.5)) {
      splitAt = rest.lastIndexOf(' ', maxLength);
    }
    if (splitAt < Math.floor(maxLength * 0.5)) splitAt = maxLength;

    parts.push(rest.slice(0, splitAt));
    rest = rest.slice(splitAt);
    if (rest.startsWith(', ')) rest = rest.slice(2);
    else if (rest.startsWith(' ')) rest = rest.slice(1);
  }
  if (rest) parts.push(rest);
  return parts;
}

function chunkLines(lines, maxLength = MESSAGE_LIMIT) {
  const chunks = [];
  let current = '';

  for (const rawLine of Array.isArray(lines) ? lines : []) {
    for (const line of splitLongLine(rawLine, maxLength)) {
      const candidate = current ? `${current}\n${line}` : line;
      if (candidate.length <= maxLength) {
        current = candidate;
        continue;
      }
      if (current) chunks.push(current);
      current = line;
    }
  }

  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : ['—'];
}

async function sendChunkedDeferredReply(interaction, lines) {
  const chunks = chunkLines(lines);
  await interaction.editReply({ content: chunks[0] });
  for (let index = 1; index < chunks.length; index += 1) {
    await interaction.followUp({
      content: chunks[index],
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleSetup(interaction, context) {
  const request = await beginCorporationAuthorization(
    context.config,
    context.config.storage.rootDir,
    {
      discordUserId: interaction.user.id,
      guildId: interaction.guildId,
    }
  );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel(context.t('auth.button.authorize'))
      .setStyle(ButtonStyle.Link)
      .setURL(request.localAuthorizationUrl)
  );

  await interaction.reply({
    content: [
      context.t('auth.setup.openSso'),
      context.t('auth.setup.scopes', { count: request.scopes.length }),
      context.t('auth.setup.expires', {
        time: `<t:${Math.floor(Date.parse(request.expiresAt) / 1000)}:R>`,
      }),
      context.t('auth.setup.detectCorporation'),
    ].join('\n'),
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleStatus(interaction, context) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const entries = await getAuthorizationStatus(context.config.storage.rootDir);
  if (entries.length === 0) {
    await interaction.editReply({ content: context.t('auth.status.none') });
    return;
  }

  const lines = [];
  entries.forEach((entry, index) => {
    const corporation = entry.corporationName
      ? `${entry.corporationName}${entry.corporationTicker ? ` [${entry.corporationTicker}]` : ''}`
      : entry.corporationId;
    const roles = entry.corporationRoles.length > 0
      ? entry.corporationRoles.join(', ')
      : context.t('auth.status.rolesNotDetected');

    if (index > 0) lines.push('');
    lines.push(
      `**${corporation}** (\`${entry.corporationId}\`)`,
      context.t('auth.status.character', {
        character: entry.characterName || entry.characterId,
      }),
      context.t('auth.status.scopesRoles', {
        scopes: entry.scopes.length,
        roles,
      })
    );
  });

  await sendChunkedDeferredReply(interaction, lines);
}

async function handleImportHtml(interaction, context) {
  const file = interaction.options.getAttachment('file', true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await importAuthHtmlFromAttachment(
    context.config.storage.rootDir,
    file.url
  );
  await interaction.editReply({
    content: [
      context.t('auth.import.completed'),
      context.t('auth.import.records', { count: result.recordsCount }),
      context.t('auth.import.mains', { count: result.mainsCount }),
      context.t('auth.import.corps', { count: result.corpsCount }),
      context.t('auth.import.relations', { count: result.mainAltSync.relationsCount }),
    ].join('\n'),
  });
}

async function handleSyncMainAlt(interaction, context) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await syncMainAltFromAuth(
    context.config.storage.rootDir,
    interaction.options.getString('mode', true)
  );
  const lines = [
    context.t('auth.sync.title'),
    context.t('auth.sync.mode', { mode: result.mode }),
    context.t('auth.sync.records', { count: result.recordsCount }),
    context.t('auth.sync.families', { count: result.familiesCount }),
    context.t('auth.sync.relations', { count: result.relationsCount }),
    context.t('auth.sync.linked', { count: result.linkedAltCount }),
    context.t('auth.sync.already', { count: result.alreadyLinkedCount }),
    context.t('auth.sync.removed', { count: result.removedRelationsCount }),
    context.t('auth.sync.conflicts', { count: result.conflictsCount }),
  ];

  if (result.linkedAlts.length > 0) {
    lines.push('', context.t('auth.sync.changedLinks'));
    lines.push(...result.linkedAlts.map((value) => `• ${value}`));
  }
  if (result.removedRelations.length > 0) {
    lines.push('', context.t('auth.sync.removedLinks'));
    lines.push(...result.removedRelations.map((value) => `• ${value}`));
  }
  if (result.conflicts.length > 0) {
    lines.push('', context.t('auth.sync.conflictDetails'));
    lines.push(...result.conflicts.map((value) => `• ${value}`));
  }

  await sendChunkedDeferredReply(interaction, lines);
}

async function handleShowMainAlt(interaction, context) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const state = await getMainAltRelations(context.config.storage.rootDir);
  const lines = [
    context.t('auth.showMainAlt.title'),
    context.t('auth.showMainAlt.summary', {
      families: state.familiesCount,
      relations: state.relations.length,
    }),
    '',
    ...(state.relations.length > 0
      ? state.relations.map((relation) => `• ${relation.alt} → ${relation.main}`)
      : [context.t('auth.showMainAlt.none')]),
  ];
  await sendChunkedDeferredReply(interaction, lines);
}

async function handleReconcile(interaction, context) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await reconcileCorpVsAuth(context.config.storage.rootDir);
  const lines = [
    context.t('auth.reconcile.title'),
    context.t('auth.reconcile.current', { count: result.currentCorpCount }),
    context.t('auth.reconcile.auth', { count: result.authRecordsCount }),
    context.t('auth.reconcile.matched', { count: result.inCorpAndInAuthCount }),
    context.t('auth.reconcile.missingAuth', { count: result.inCorpNotInAuthCount }),
    context.t('auth.reconcile.outside', { count: result.inAuthNotInCorpCount }),
    context.t('auth.reconcile.corpMismatch', { count: result.corpMismatchCount }),
  ];

  if (result.inCorpNotInAuth.length > 0) {
    lines.push('', context.t('auth.reconcile.missingAuthDetails'));
    lines.push(...result.inCorpNotInAuth.map((item) => `• ${item.name}`));
  }
  if (result.inAuthNotInCorp.length > 0) {
    lines.push('', context.t('auth.reconcile.outsideDetails'));
    lines.push(...result.inAuthNotInCorp.map((item) => `• ${item.alt} ← ${item.main}`));
  }
  if (result.corpMismatch.length > 0) {
    lines.push('', context.t('auth.reconcile.corpMismatchDetails'));
    lines.push(...result.corpMismatch.map((item) =>
      `• ${item.name}: ${item.corporationName || '—'} ≠ ${item.authCorp || '—'}`
    ));
  }

  await sendChunkedDeferredReply(interaction, lines);
}

async function execute(interaction, context) {
  const subcommand = interaction.options.getSubcommand();
  const group = interaction.options.getSubcommandGroup(false);

  if (subcommand === 'setup') {
    if (!(await ensureOwner(interaction, context))) return;
    await handleSetup(interaction, context);
    return;
  }

  if (subcommand === 'status') {
    if (!(await ensureOwner(interaction, context))) return;
    await handleStatus(interaction, context);
    return;
  }

  if (!(await ensureAdmin(interaction, context))) return;

  if (subcommand === 'import-html') {
    await handleImportHtml(interaction, context);
    return;
  }
  if (subcommand === 'sync-main-alt') {
    await handleSyncMainAlt(interaction, context);
    return;
  }
  if (subcommand === 'reconcile') {
    await handleReconcile(interaction, context);
    return;
  }
  if (group === 'show' && subcommand === 'main-alt') {
    await handleShowMainAlt(interaction, context);
    return;
  }

  throw new Error(context.t('auth.error.unsupportedSubcommand', { subcommand }));
}

module.exports = {
  data,
  execute,
  isOwner,
  chunkLines,
  splitLongLine,
};
