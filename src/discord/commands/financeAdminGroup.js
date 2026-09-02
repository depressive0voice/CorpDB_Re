const {
  readFinancePolicy,
  updateFinancePolicy,
} = require('../../finance/financePolicyRepository');
const {
  resolveFinanceCorporationIds,
  autocompleteFinanceCorporations,
} = require('../../finance/financeCorporationService');
const { readCorporationProfile } = require('../../corporations/corporationProfileRepository');

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

function configureFinanceGroup(group) {
  return group
    .setName('finance')
    .setDescription('Finance policy for new wallet journal entries')
    .setDescriptionLocalizations({
      ru: 'Finance policy для новых wallet journal записей',
    })
    .addSubcommand((subcommand) => addCorporationOption(subcommand
      .setName('show')
      .setDescription('Show current finance policy')
      .setDescriptionLocalizations({ ru: 'Показать текущую finance policy'})))
    .addSubcommand((subcommand) => addCorporationOption(subcommand
      .setName('set-alliance-tax')
      .setDescription('Set alliance tax rate for new journal entries')
      .setDescriptionLocalizations({
        ru: 'Задать альянсовый налог для новых journal-записей',
      })
      .addNumberOption((option) => option
        .setName('rate')
        .setDescription('Percent, from 0 to 100')
        .setDescriptionLocalizations({ ru: 'Процент от 0 до 100'})
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(true))))
    .addSubcommand((subcommand) => addCorporationOption(subcommand
      .setName('taxable-add')
      .setDescription('Add an EVE wallet ref_type to taxable income')
      .setDescriptionLocalizations({
        ru: 'Добавить EVE wallet ref_type в налоговую базу',
      })
      .addStringOption((option) => option
        .setName('ref-type')
        .setDescription('EVE wallet journal ref_type')
        .setDescriptionLocalizations({ ru: 'EVE wallet journal ref_type'})
        .setRequired(true))))
    .addSubcommand((subcommand) => addCorporationOption(subcommand
      .setName('taxable-remove')
      .setDescription('Remove an EVE wallet ref_type from taxable income')
      .setDescriptionLocalizations({
        ru: 'Убрать EVE wallet ref_type из налоговой базы',
      })
      .addStringOption((option) => option
        .setName('ref-type')
        .setDescription('EVE wallet journal ref_type')
        .setDescriptionLocalizations({ ru: 'EVE wallet journal ref_type'})
        .setRequired(true))))
    .addSubcommand((subcommand) => addCorporationOption(subcommand
      .setName('wallet-exclude')
      .setDescription('Exclude a wallet division from new finance calculations')
      .setDescriptionLocalizations({
        ru: 'Исключить wallet division из новых финансовых расчётов',
      })
      .addIntegerOption((option) => option
        .setName('division')
        .setDescription('Wallet division 1-7')
        .setDescriptionLocalizations({ ru: 'Wallet division 1–7'})
        .setMinValue(1)
        .setMaxValue(7)
        .setRequired(true))))
    .addSubcommand((subcommand) => addCorporationOption(subcommand
      .setName('wallet-include')
      .setDescription('Include a wallet division in new finance calculations')
      .setDescriptionLocalizations({
        ru: 'Вернуть wallet division в новые финансовые расчёты',
      })
      .addIntegerOption((option) => option
        .setName('division')
        .setDescription('Wallet division 1-7')
        .setDescriptionLocalizations({ ru: 'Wallet division 1–7'})
        .setMinValue(1)
        .setMaxValue(7)
        .setRequired(true))))
    .addSubcommand((subcommand) => addCorporationOption(subcommand
      .setName('donation-alert-set')
      .setDescription('Send player donation alerts to a Discord user')
      .setDescriptionLocalizations({
        ru: 'Отправлять уведомления о player_donation пользователю Discord',
      })
      .addUserOption((option) => option
        .setName('user')
        .setDescription('Discord user who receives alerts')
        .setDescriptionLocalizations({ ru: 'Получатель уведомлений'})
        .setRequired(true))
      .addIntegerOption((option) => option
        .setName('division')
        .setDescription('Wallet division 1-7')
        .setDescriptionLocalizations({ ru: 'Wallet division 1–7'})
        .setMinValue(1)
        .setMaxValue(7)
        .setRequired(true))))
    .addSubcommand((subcommand) => addCorporationOption(subcommand
      .setName('donation-alert-disable')
      .setDescription('Disable player donation alerts')
      .setDescriptionLocalizations({
        ru: 'Отключить уведомления о player_donation',
      })));
}

async function autocompleteFinanceAdmin(interaction, context) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'corporation') {
    await interaction.respond([]);
    return;
  }
  const choices = await autocompleteFinanceCorporations(
    context.config.storage.rootDir,
    focused.value,
    { allowAll: false }
  );
  await interaction.respond(choices);
}

async function resolveCorporation(storageRoot, interaction) {
  const requested = normalizeText(interaction.options.getString('corporation'));
  const [corporationId] = await resolveFinanceCorporationIds(storageRoot, requested, {
    allowAll: false,
  });
  return corporationId;
}

async function executeFinanceAdmin(interaction, context) {
  const storageRoot = context.config.storage.rootDir;
  const subcommand = interaction.options.getSubcommand();
  const corporationId = await resolveCorporation(storageRoot, interaction);

  if (subcommand === 'show') {
    const [policy, profile] = await Promise.all([
      readFinancePolicy(storageRoot, corporationId),
      readCorporationProfile(storageRoot, corporationId),
    ]);
    const corporation = `${profile.name || corporationId} (\`${corporationId}\`)`;
    const taxable = policy.taxableRefTypes.length > 0
      ? policy.taxableRefTypes.map((value) => `\`${value}\``).join(', ')
      : '—';
    const excluded = policy.excludedWalletDivisions.length > 0
      ? policy.excludedWalletDivisions.join(', ')
      : '—';
    const alertValue = policy.donationAlert.discordUserId
      ? context.t('finance.admin.alertOn', {
        userId: policy.donationAlert.discordUserId,
        division: policy.donationAlert.division,
      })
      : context.t('finance.admin.alertOff');
    await interaction.reply({
      content: [
        context.t('finance.admin.show.title', { corporation }),
        context.t('finance.admin.show.tax', {
          rate: Number(policy.allianceTaxRatePercent).toFixed(2),
        }),
        context.t('finance.admin.show.taxable', { values: taxable }),
        context.t('finance.admin.show.excluded', { values: excluded }),
        context.t('finance.admin.show.alert', { value: alertValue }),
      ].join('\n'),
      ephemeral: true,
    });
    return;
  }

  const current = await readFinancePolicy(storageRoot, corporationId);

  if (subcommand === 'set-alliance-tax') {
    const rate = interaction.options.getNumber('rate', true);
    await updateFinancePolicy(storageRoot, corporationId, { allianceTaxRatePercent: rate });
    await interaction.reply({
      content: context.t('finance.admin.updatedTax', { rate: Number(rate).toFixed(2) }),
      ephemeral: true,
    });
    return;
  }

  if (subcommand === 'taxable-add' || subcommand === 'taxable-remove') {
    const refType = normalizeText(interaction.options.getString('ref-type', true)).toLowerCase();
    if (!refType) throw new Error('ref_type cannot be empty.');
    const next = new Set(current.taxableRefTypes);
    if (subcommand === 'taxable-add') next.add(refType);
    else next.delete(refType);
    await updateFinancePolicy(storageRoot, corporationId, {
      taxableRefTypes: [...next].sort(),
    });
    await interaction.reply({
      content: context.t(
        subcommand === 'taxable-add'
          ? 'finance.admin.taxableAdded'
          : 'finance.admin.taxableRemoved',
        { refType }
      ),
      ephemeral: true,
    });
    return;
  }

  if (subcommand === 'wallet-exclude' || subcommand === 'wallet-include') {
    const division = interaction.options.getInteger('division', true);
    const next = new Set(current.excludedWalletDivisions);
    if (subcommand === 'wallet-exclude') next.add(division);
    else next.delete(division);
    await updateFinancePolicy(storageRoot, corporationId, {
      excludedWalletDivisions: [...next].sort((left, right) => left - right),
    });
    await interaction.reply({
      content: context.t(
        subcommand === 'wallet-exclude'
          ? 'finance.admin.walletExcluded'
          : 'finance.admin.walletIncluded',
        { division }
      ),
      ephemeral: true,
    });
    return;
  }

  if (subcommand === 'donation-alert-set') {
    const user = interaction.options.getUser('user', true);
    const division = interaction.options.getInteger('division', true);
    await updateFinancePolicy(storageRoot, corporationId, {
      donationAlert: { discordUserId: user.id, division },
    });
    await interaction.reply({
      content: context.t('finance.admin.alertSet', { userId: user.id, division }),
      ephemeral: true,
    });
    return;
  }

  if (subcommand === 'donation-alert-disable') {
    await updateFinancePolicy(storageRoot, corporationId, {
      donationAlert: { discordUserId: '' },
    });
    await interaction.reply({
      content: context.t('finance.admin.alertDisabled'),
      ephemeral: true,
    });
    return;
  }

  throw new Error(`Unsupported /admin finance subcommand: ${subcommand}`);
}

module.exports = {
  configureFinanceGroup,
  autocompleteFinanceAdmin,
  executeFinanceAdmin,
  resolveCorporation,
};
