const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { ACCESS_LEVELS, getBaseAccessLevel } = require('../../access/accessService');
const { readCorporationProfile } = require('../../corporations/corporationProfileRepository');
const {
  autocompleteStructureCorporations,
  resolveStructureCorporationIds,
} = require('../../structures/structureCorporationService');
const {
  CRITICAL_THRESHOLD_HOURS,
  getStructureFuelReport,
  readStructureConfig,
  setStructureFuelAlertChannel,
  clearStructureFuelAlertChannel,
  setStructureFuelAlertRole,
  clearStructureFuelAlertRole,
} = require('../../structures/structureFuelService');
const {
  loadStructureSelectorCatalog,
  buildSelectorCatalogFromFuelItems,
  canonicalizeSelectorFromCatalog,
  decorateFuelItemsWithCatalog,
  filterFuelItemsBySelector,
  formatSelectorLabel,
  metadataForSelector,
  normalizeSelector,
  selectorHasValue,
  selectorAutocompleteChoices,
} = require('../../structures/structureSelectorService');
const {
  addDisabledAlertFilter,
  removeDisabledAlertFilter,
  findStoredFilter,
  processStructureFuelAlertsWithFilters,
} = require('../../structures/structureAlertFilterService');
const {
  buildStructureFuelEmbeds,
  splitEmbedsForDiscord,
  buildStructureFuelShowContent,
  buildJobSummaryEmbed,
  createStructureAlertSender,
} = require('../../structures/structurePresentation');

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

function addSelectorOptions(subcommand) {
  return subcommand
    .addStringOption((option) => option
      .setName('class')
      .setDescription('Structure class: Upwell or POS')
      .setDescriptionLocalizations({
        ru: 'Класс структуры: Upwell или POS',
      })
      .setAutocomplete(true)
      .setRequired(false))
    .addStringOption((option) => option
      .setName('group')
      .setDescription('EVE structure group, generated from current structures')
      .setDescriptionLocalizations({
        ru: 'Группа EVE, сгенерированная по текущим структурам',
      })
      .setAutocomplete(true)
      .setRequired(false))
    .addStringOption((option) => option
      .setName('type')
      .setDescription('EVE structure type, generated from current structures')
      .setDescriptionLocalizations({
        ru: 'Тип EVE, сгенерированный по текущим структурам',
      })
      .setAutocomplete(true)
      .setRequired(false))
    .addStringOption((option) => option
      .setName('structure')
      .setDescription('Specific corporation structure')
      .setDescriptionLocalizations({
        ru: 'Конкретная структура корпорации',
      })
      .setAutocomplete(true)
      .setRequired(false));
}

function addCorporationAndSelectorOptions(subcommand) {
  return addSelectorOptions(addCorporationOption(subcommand));
}

const data = new SlashCommandBuilder()
  .setName('structure-fuel')
  .setDescription('Show structure fuel status and configure alerts')
  .setDescriptionLocalizations({
    ru: 'Показать топливо структур и настроить алерты',
  })
  .addSubcommand((subcommand) => addCorporationAndSelectorOptions(subcommand
    .setName('show')
    .setDescription('Show structures and remaining fuel')
    .setDescriptionLocalizations({ ru: 'Показать структуры и остаток топлива'}))
    .addBooleanOption((option) => option
      .setName('only-critical')
      .setDescription('Show only critical structures')
      .setDescriptionLocalizations({ ru: 'Показать только критичные структуры'})
      .setRequired(false)))
  .addSubcommand((subcommand) => addCorporationOption(subcommand
    .setName('show-config')
    .setDescription('Show automatic fuel alert settings')
    .setDescriptionLocalizations({ ru: 'Показать настройки автоалертов по топливу'})))
  .addSubcommand((subcommand) => addCorporationAndSelectorOptions(subcommand
    .setName('alert-disable')
    .setDescription('Disable fuel alerts by class, group, type, or structure')
    .setDescriptionLocalizations({
      ru: 'Отключить fuel-алерты по классу, группе, типу или структуре',
    })))
  .addSubcommand((subcommand) => addCorporationAndSelectorOptions(subcommand
    .setName('alert-enable')
    .setDescription('Remove a disabled fuel alert filter')
    .setDescriptionLocalizations({
      ru: 'Удалить фильтр отключения fuel-алертов',
    })))
  .addSubcommand((subcommand) => addCorporationOption(subcommand
    .setName('alert-filters')
    .setDescription('Show disabled fuel alert filters')
    .setDescriptionLocalizations({
      ru: 'Показать фильтры отключённых fuel-алертов',
    })))
  .addSubcommand((subcommand) => addCorporationOption(subcommand
    .setName('set-alert-channel')
    .setDescription('Set the fuel alert channel')
    .setDescriptionLocalizations({ ru: 'Задать канал для fuel-алертов'})
    .addChannelOption((option) => option
      .setName('channel')
      .setDescription('Alert channel')
      .setDescriptionLocalizations({ ru: 'Канал для алертов'})
      .setRequired(true))))
  .addSubcommand((subcommand) => addCorporationOption(subcommand
    .setName('clear-alert-channel')
    .setDescription('Clear the fuel alert channel')
    .setDescriptionLocalizations({ ru: 'Очистить канал для fuel-алертов'})))
  .addSubcommand((subcommand) => addCorporationOption(subcommand
    .setName('set-alert-role')
    .setDescription('Set the role mentioned in fuel alerts')
    .setDescriptionLocalizations({ ru: 'Задать роль для пинга в fuel-алертах'})
    .addRoleOption((option) => option
      .setName('role')
      .setDescription('Role to mention')
      .setDescriptionLocalizations({ ru: 'Роль для пинга'})
      .setRequired(true))))
  .addSubcommand((subcommand) => addCorporationOption(subcommand
    .setName('clear-alert-role')
    .setDescription('Clear the role mentioned in fuel alerts')
    .setDescriptionLocalizations({ ru: 'Очистить роль для пинга в fuel-алертах'})))
  .addSubcommand((subcommand) => addCorporationOption(subcommand
    .setName('check-alerts')
    .setDescription('Check structures now and send current fuel alerts')
    .setDescriptionLocalizations({ ru: 'Проверить структуры сейчас и отправить fuel-алерты'})));

async function requireMasterAdmin(interaction, context) {
  const access = await getBaseAccessLevel(
    context.config,
    context.config.storage.rootDir,
    interaction.member
  );
  if (access.level === ACCESS_LEVELS.MASTER_ADMIN) return true;
  await interaction.reply({
    content: context.t('structures.error.masterAdmin'),
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

async function resolveSingleCorporation(storageRoot, interaction) {
  const requested = normalizeText(interaction.options.getString('corporation'));
  const [corporationId] = await resolveStructureCorporationIds(storageRoot, requested, {
    allowAll: false,
  });
  return corporationId;
}

function readSelectorOptions(interaction) {
  return normalizeSelector({
    class: interaction.options.getString('class'),
    groupId: interaction.options.getString('group'),
    typeId: interaction.options.getString('type'),
    structureId: interaction.options.getString('structure'),
  });
}

async function replyWithEmbedChunks(interaction, content, embeds, continuationTitle) {
  const chunks = splitEmbedsForDiscord(embeds);
  if (chunks.length === 0) {
    await interaction.editReply({ content, embeds: [] });
    return;
  }
  await interaction.editReply({ content, embeds: chunks[0] });
  for (let index = 1; index < chunks.length; index += 1) {
    await interaction.followUp({
      content: `**${continuationTitle} (${index + 1}/${chunks.length})**`,
      embeds: chunks[index],
      flags: MessageFlags.Ephemeral,
    });
  }
}

function splitTextLines(lines, maxLength = 1900) {
  const chunks = [];
  let current = '';
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length <= maxLength) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    current = line;
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : ['—'];
}

async function autocomplete(interaction, context) {
  const focused = interaction.options.getFocused(true);
  const storageRoot = context.config.storage.rootDir;
  if (focused.name === 'corporation') {
    const choices = await autocompleteStructureCorporations(
      storageRoot,
      focused.value,
      { allowAll: interaction.options.getSubcommand(false) === 'check-alerts' }
    );
    await interaction.respond(choices);
    return;
  }

  if (!['class', 'group', 'type', 'structure'].includes(focused.name)) {
    await interaction.respond([]);
    return;
  }

  let corporationId;
  try {
    corporationId = await resolveSingleCorporation(storageRoot, interaction);
  } catch {
    await interaction.respond([]);
    return;
  }
  const catalog = await loadStructureSelectorCatalog(
    context.config,
    storageRoot,
    corporationId
  );
  const selector = readSelectorOptions(interaction);
  const choices = selectorAutocompleteChoices(
    catalog,
    focused.name,
    selector,
    focused.value
  );
  await interaction.respond(choices);
}

async function execute(interaction, context) {
  const subcommand = interaction.options.getSubcommand();
  const storageRoot = context.config.storage.rootDir;

  if (subcommand === 'show') {
    const corporationId = await resolveSingleCorporation(storageRoot, interaction);
    const onlyCritical = interaction.options.getBoolean('only-critical') || false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const report = await getStructureFuelReport(
      context.config,
      storageRoot,
      corporationId
    );
    const catalog = await buildSelectorCatalogFromFuelItems(context.config, report.items);
    const decorated = decorateFuelItemsWithCatalog(report.items, catalog);
    const rawSelector = readSelectorOptions(interaction);
    const selector = selectorHasValue(rawSelector)
      ? canonicalizeSelectorFromCatalog(catalog, rawSelector)
      : rawSelector;
    let visible = filterFuelItemsBySelector(decorated, selector);
    if (onlyCritical) {
      visible = visible.filter((item) => item.isAlertTrackable && item.isCritical);
    }
    const filterLabel = formatSelectorLabel(selector, metadataForSelector(catalog, selector));
    const content = buildStructureFuelShowContent(
      context.t,
      report,
      filterLabel,
      visible.length,
      onlyCritical
    );
    const embeds = buildStructureFuelEmbeds(context.t, visible, { mode: 'show' });
    await replyWithEmbedChunks(interaction, content, embeds, 'Structure Fuel');
    return;
  }

  if (subcommand === 'show-config') {
    const corporationId = await resolveSingleCorporation(storageRoot, interaction);
    const [fuelConfig, profile] = await Promise.all([
      readStructureConfig(storageRoot, corporationId),
      readCorporationProfile(storageRoot, corporationId),
    ]);
    await interaction.reply({
      content: [
        context.t('structures.config.title'),
        context.t('structures.config.corporation', {
          corporation: profile.name || corporationId,
          corporationId,
        }),
        context.t('structures.config.channel', {
          channel: fuelConfig.alertChannelId ? `<#${fuelConfig.alertChannelId}>` : context.t('structures.common.notSet'),
        }),
        context.t('structures.config.role', {
          role: fuelConfig.alertRoleId ? `<@&${fuelConfig.alertRoleId}>` : context.t('structures.common.notSet'),
        }),
        context.t('structures.config.threshold', { hours: CRITICAL_THRESHOLD_HOURS }),
        context.t('structures.config.disabledTypes', {
          types: fuelConfig.disabledTypeIds.length > 0 ? fuelConfig.disabledTypeIds.join(', ') : context.t('structures.common.none'),
        }),
        context.t('structures.config.alertFilters', { count: fuelConfig.disabledAlertFilters.length }),
        context.t('structures.config.tracks'),
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'alert-filters') {
    const corporationId = await resolveSingleCorporation(storageRoot, interaction);
    const [fuelConfig, profile] = await Promise.all([
      readStructureConfig(storageRoot, corporationId),
      readCorporationProfile(storageRoot, corporationId),
    ]);
    let catalog = [];
    try {
      catalog = await loadStructureSelectorCatalog(context.config, storageRoot, corporationId);
    } catch {
      catalog = [];
    }
    const lines = [context.t('structures.filters.title', { corporation: profile.name || corporationId })];
    if (fuelConfig.disabledAlertFilters.length === 0) {
      lines.push(context.t('structures.filters.empty'));
    } else {
      fuelConfig.disabledAlertFilters.forEach((filter, index) => {
        lines.push(`${index + 1}. ${formatSelectorLabel(filter, metadataForSelector(catalog, filter))}`);
      });
    }
    const chunks = splitTextLines(lines);
    await interaction.reply({ content: chunks[0], flags: MessageFlags.Ephemeral });
    for (let index = 1; index < chunks.length; index += 1) {
      await interaction.followUp({ content: chunks[index], flags: MessageFlags.Ephemeral });
    }
    return;
  }

  if (!(await requireMasterAdmin(interaction, context))) return;

  if (subcommand === 'alert-disable') {
    const corporationId = await resolveSingleCorporation(storageRoot, interaction);
    const catalog = await loadStructureSelectorCatalog(context.config, storageRoot, corporationId);
    const selector = canonicalizeSelectorFromCatalog(catalog, readSelectorOptions(interaction));
    const result = await addDisabledAlertFilter(storageRoot, corporationId, selector);
    const profile = await readCorporationProfile(storageRoot, corporationId);
    await interaction.reply({
      content: context.t(result.changed ? 'structures.filters.disabled' : 'structures.filters.alreadyDisabled', {
        corporation: profile.name || corporationId,
        filter: formatSelectorLabel(selector, metadataForSelector(catalog, selector)),
      }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'alert-enable') {
    const corporationId = await resolveSingleCorporation(storageRoot, interaction);
    const rawSelector = readSelectorOptions(interaction);
    const fuelConfig = await readStructureConfig(storageRoot, corporationId);
    let catalog = [];
    let canonical = null;
    try {
      catalog = await loadStructureSelectorCatalog(context.config, storageRoot, corporationId);
      canonical = canonicalizeSelectorFromCatalog(catalog, rawSelector);
    } catch {
      canonical = null;
    }
    const stored = findStoredFilter(fuelConfig.disabledAlertFilters, canonical || rawSelector);
    if (!stored) throw new Error('No disabled alert filter matches this selector.');
    await removeDisabledAlertFilter(storageRoot, corporationId, stored);
    const profile = await readCorporationProfile(storageRoot, corporationId);
    await interaction.reply({
      content: context.t('structures.filters.enabled', {
        corporation: profile.name || corporationId,
        filter: formatSelectorLabel(stored, metadataForSelector(catalog, stored)),
      }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'set-alert-channel') {
    const corporationId = await resolveSingleCorporation(storageRoot, interaction);
    const channel = interaction.options.getChannel('channel', true);
    if (!channel.isTextBased()) throw new Error('Structure fuel alert channel must be text-based.');
    const profile = await readCorporationProfile(storageRoot, corporationId);
    await setStructureFuelAlertChannel(storageRoot, corporationId, channel.id);
    await interaction.reply({
      content: context.t('structures.channel.updated', {
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
    await clearStructureFuelAlertChannel(storageRoot, corporationId);
    await interaction.reply({
      content: context.t('structures.channel.cleared', { corporation: profile.name || corporationId }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'set-alert-role') {
    const corporationId = await resolveSingleCorporation(storageRoot, interaction);
    const role = interaction.options.getRole('role', true);
    const profile = await readCorporationProfile(storageRoot, corporationId);
    await setStructureFuelAlertRole(storageRoot, corporationId, role.id);
    await interaction.reply({
      content: context.t('structures.role.updated', {
        corporation: profile.name || corporationId,
        role: `<@&${role.id}>`,
      }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'clear-alert-role') {
    const corporationId = await resolveSingleCorporation(storageRoot, interaction);
    const profile = await readCorporationProfile(storageRoot, corporationId);
    await clearStructureFuelAlertRole(storageRoot, corporationId);
    await interaction.reply({
      content: context.t('structures.role.cleared', { corporation: profile.name || corporationId }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'check-alerts') {
    const requested = normalizeText(interaction.options.getString('corporation'));
    const corporationIds = await resolveStructureCorporationIds(storageRoot, requested, {
      allowAll: true,
    });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sender = createStructureAlertSender(context.config);
    const embeds = [];
    for (const corporationId of corporationIds) {
      const result = await processStructureFuelAlertsWithFilters(
        context.config,
        storageRoot,
        corporationId,
        interaction.client,
        {
          forceSendCurrentCritical: true,
          sendAlerts: sender,
        }
      );
      embeds.push(buildJobSummaryEmbed(context.t, result));
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

  throw new Error(context.t('structures.error.unsupportedSubcommand', { subcommand }));
}

module.exports = {
  data,
  execute,
  autocomplete,
  readSelectorOptions,
  replyWithEmbedChunks,
};
