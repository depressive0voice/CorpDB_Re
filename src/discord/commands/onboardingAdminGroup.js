const { MessageFlags } = require('discord.js');
const { getCorporationRegistration } = require('../../corporations/corporationRegistryRepository');
const {
  DEFAULT_PROFILE_ID,
  readOnboardingConfig,
  upsertOnboardingProfile,
  assignCorporationProfile,
  unassignCorporationProfile,
} = require('../../onboarding/onboardingConfigRepository');
const { listEnabledOnboardingCorporationIds } = require('../../onboarding/onboardingProfileService');
const {
  setWelcomeChannel,
  setWelcomeRecruiterRole,
  setWelcomeText,
  resetWelcomeText,
  buildWelcomePreview,
  sendWelcomeTest,
} = require('../../onboarding/onboardingService');
const {
  processProbationExpirations,
  getPromotionSummary,
} = require('../../onboarding/promotionService');

function addProfileOption(subcommand) {
  return subcommand.addStringOption((option) => option
    .setName('profile')
    .setDescription('Onboarding profile ID; default when omitted')
    .setDescriptionLocalizations({
      ru: 'ID onboarding-профиля; по умолчанию default',
    })
    .setMaxLength(64)
    .setRequired(false));
}

function addRolePair(group, kind, description, localizations) {
  group.addSubcommand((subcommand) => addProfileOption(subcommand
    .setName(`set-${kind}-role`)
    .setDescription(`Set ${description} role`)
    .setDescriptionLocalizations(localizations)
    .addRoleOption((option) => option
      .setName('role')
      .setDescription(description)
      .setRequired(true))));
  group.addSubcommand((subcommand) => addProfileOption(subcommand
    .setName(`clear-${kind}-role`)
    .setDescription(`Clear ${description} role`)
    .setDescriptionLocalizations({
      ru: `Очистить роль: ${description}`,
    })));
}

function configureOnboardingGroup(group) {
  group
    .setName('onboarding')
    .setDescription('Welcome, probation and final role configuration')
    .setDescriptionLocalizations({
      ru: 'Приветствие, испытательный срок и итоговые роли',
    })
    .addSubcommand((subcommand) => subcommand
      .setName('show')
      .setDescription('Show onboarding configuration')
      .setDescriptionLocalizations({ ru: 'Показать конфигурацию онбординга'}))
    .addSubcommand((subcommand) => subcommand
      .setName('profile-create')
      .setDescription('Create an onboarding profile')
      .setDescriptionLocalizations({ ru: 'Создать onboarding-профиль'})
      .addStringOption((option) => option
        .setName('profile')
        .setDescription('Profile ID')
        .setRequired(true)
        .setMaxLength(64)))
    .addSubcommand((subcommand) => subcommand
      .setName('map-corporation')
      .setDescription('Map a corporation to an onboarding profile')
      .setDescriptionLocalizations({
        ru: 'Назначить корпорации onboarding-профиль',
      })
      .addStringOption((option) => option
        .setName('corporation')
        .setDescription('EVE corporation ID')
        .setRequired(true))
      .addStringOption((option) => option
        .setName('profile')
        .setDescription('Profile ID')
        .setRequired(true)
        .setMaxLength(64)))
    .addSubcommand((subcommand) => subcommand
      .setName('unmap-corporation')
      .setDescription('Remove an explicit corporation onboarding mapping')
      .setDescriptionLocalizations({
        ru: 'Удалить явную привязку onboarding-профиля корпорации',
      })
      .addStringOption((option) => option
        .setName('corporation')
        .setDescription('EVE corporation ID')
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('set-welcome-channel')
      .setDescription('Set the welcome channel')
      .setDescriptionLocalizations({ ru: 'Задать канал приветствия'})
      .addChannelOption((option) => option
        .setName('channel')
        .setDescription('Welcome channel')
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('clear-welcome-channel')
      .setDescription('Clear the welcome channel')
      .setDescriptionLocalizations({ ru: 'Очистить канал приветствия'}))
    .addSubcommand((subcommand) => subcommand
      .setName('set-welcome-recruiter-role')
      .setDescription('Set a recruiter role mentioned in the common welcome')
      .setDescriptionLocalizations({
        ru: 'Задать роль рекрутёра для общего приветствия',
      })
      .addRoleOption((option) => option
        .setName('role')
        .setDescription('Recruiter role')
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('clear-welcome-recruiter-role')
      .setDescription('Clear the common welcome recruiter role')
      .setDescriptionLocalizations({
        ru: 'Очистить роль рекрутёра общего приветствия',
      }));

  addRolePair(group, 'probation', 'Probation', {
    ru: 'Задать роль испытательного срока',
  });
  addRolePair(group, 'main', 'Main', {
    ru: 'Задать итоговую роль MAIN',
  });
  addRolePair(group, 'rookie', 'Rookie', {
    ru: 'Задать итоговую роль ROOKIE',
  });
  addRolePair(group, 'recruiter', 'Recruiter', {
    ru: 'Задать роль рекрутёра профиля',
  });

  group
    .addSubcommand((subcommand) => addProfileOption(subcommand
      .setName('set-promotion-channel')
      .setDescription('Set the probation completion notification channel')
      .setDescriptionLocalizations({
        ru: 'Задать канал уведомлений об окончании испытательного срока',
      })
      .addChannelOption((option) => option
        .setName('channel')
        .setDescription('Promotion channel')
        .setRequired(true))))
    .addSubcommand((subcommand) => addProfileOption(subcommand
      .setName('clear-promotion-channel')
      .setDescription('Clear the promotion channel')
      .setDescriptionLocalizations({ ru: 'Очистить канал повышения'})))
    .addSubcommand((subcommand) => addProfileOption(subcommand
      .setName('set-probation-months')
      .setDescription('Set probation duration in calendar months')
      .setDescriptionLocalizations({
        ru: 'Задать длительность испытательного срока в календарных месяцах',
      })
      .addIntegerOption((option) => option
        .setName('months')
        .setDescription('Months')
        .setMinValue(1)
        .setMaxValue(24)
        .setRequired(true))))
    .addSubcommand((subcommand) => subcommand
      .setName('set-welcome-text')
      .setDescription('Set the welcome text; use \\n for line breaks')
      .setDescriptionLocalizations({
        ru: 'Задать текст приветствия; используй \\n для переносов строк',
      })
      .addStringOption((option) => option
        .setName('text')
        .setDescription('Welcome text template')
        .setMaxLength(1800)
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('reset-welcome-text')
      .setDescription('Reset the welcome text')
      .setDescriptionLocalizations({ ru: 'Сбросить текст приветствия'}))
    .addSubcommand((subcommand) => subcommand
      .setName('preview')
      .setDescription('Preview the welcome message')
      .setDescriptionLocalizations({ ru: 'Показать превью приветствия'})
      .addUserOption((option) => option
        .setName('user')
        .setDescription('Preview for this user')
        .setRequired(false)))
    .addSubcommand((subcommand) => subcommand
      .setName('send-test')
      .setDescription('Send a test welcome message')
      .setDescriptionLocalizations({ ru: 'Отправить тестовое приветствие'})
      .addUserOption((option) => option
        .setName('user')
        .setDescription('User used in placeholders')
        .setRequired(false))
      .addChannelOption((option) => option
        .setName('channel')
        .setDescription('Channel; current channel when omitted')
        .setRequired(false)))
    .addSubcommand((subcommand) => subcommand
      .setName('check-promotions')
      .setDescription('Check completed probation periods now')
      .setDescriptionLocalizations({
        ru: 'Проверить завершившиеся испытательные сроки сейчас',
      }))
    .addSubcommand((subcommand) => subcommand
      .setName('promotion-status')
      .setDescription('Show probation promotion state')
      .setDescriptionLocalizations({
        ru: 'Показать состояние повышений после испытательного срока',
      }));

  return group;
}

function profileIdFromInteraction(interaction) {
  return interaction.options.getString('profile', false) || DEFAULT_PROFILE_ID;
}

async function ensureExistingProfile(storageRoot, profileId, t) {
  const config = await readOnboardingConfig(storageRoot);
  const normalized = String(profileId || '').trim().toLowerCase();
  if (!config.profiles[normalized]) {
    throw new Error(t('onboarding.error.profileMissing', { profile: normalized }));
  }
  return { config, profileId: normalized };
}

function roleMention(roleId, t) {
  return roleId ? `<@&${roleId}>` : t('onboarding.value.notSet');
}

function channelMention(channelId, t) {
  return channelId ? `<#${channelId}>` : t('onboarding.value.notSet');
}

function ensureManageableTechnicalRole(interaction, role, t) {
  if (role.id === interaction.guildId || role.managed || !role.editable) {
    throw new Error(t('onboarding.error.roleUnmanageable', { role: `${role}` }));
  }
}

async function resolvePreviewMember(interaction) {
  const user = interaction.options.getUser('user', false);
  if (!user) return interaction.member;
  return interaction.guild.members.fetch(user.id);
}

async function executeOnboardingAdmin(interaction, context) {
  const storageRoot = context.config.storage.rootDir;
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'show') {
    const [config, corporations] = await Promise.all([
      readOnboardingConfig(storageRoot),
      listEnabledOnboardingCorporationIds(storageRoot),
    ]);
    const lines = [
      context.t('onboarding.show.title'),
      context.t('onboarding.show.welcomeChannel', {
        channel: channelMention(config.welcome.channelId, context.t),
      }),
      context.t('onboarding.show.welcomeRecruiter', {
        role: roleMention(config.welcome.recruiterRoleId, context.t),
      }),
      '',
    ];
    for (const [profileId, profile] of Object.entries(config.profiles)) {
      lines.push(context.t('onboarding.show.profile', {
        profile: profileId,
        probation: roleMention(profile.probationRoleId, context.t),
        main: roleMention(profile.mainRoleId, context.t),
        rookie: roleMention(profile.rookieRoleId, context.t),
        recruiter: roleMention(profile.recruiterRoleId, context.t),
        channel: channelMention(profile.promotionChannelId, context.t),
        months: profile.probationMonths,
      }));
    }
    lines.push('');
    if (corporations.length === 1 && !config.corporationProfiles[corporations[0]]) {
      lines.push(context.t('onboarding.show.singleImplicit', { corporationId: corporations[0] }));
    } else if (corporations.length > 1) {
      lines.push(context.t('onboarding.show.multiWarning'));
    }
    for (const corporationId of corporations) {
      const profile = config.corporationProfiles[corporationId];
      if (profile) lines.push(context.t('onboarding.show.mapping', { corporationId, profile }));
    }
    await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === 'profile-create') {
    const profileId = interaction.options.getString('profile', true);
    const saved = await upsertOnboardingProfile(storageRoot, profileId, {});
    const normalized = String(profileId).trim().toLowerCase();
    await interaction.reply({
      content: context.t('onboarding.profile.created', { profile: normalized }),
      flags: MessageFlags.Ephemeral,
    });
    return saved;
  }

  if (subcommand === 'map-corporation') {
    const corporationId = interaction.options.getString('corporation', true);
    const profileId = interaction.options.getString('profile', true);
    const registration = await getCorporationRegistration(storageRoot, corporationId).catch(() => null);
    if (!registration || !registration.enabled || registration.features?.onboarding === false) {
      throw new Error(context.t('onboarding.error.corporationMissing', { corporationId }));
    }
    await ensureExistingProfile(storageRoot, profileId, context.t);
    await assignCorporationProfile(storageRoot, corporationId, profileId);
    await interaction.reply({
      content: context.t('onboarding.profile.mapped', {
        corporationId,
        profile: String(profileId).trim().toLowerCase(),
      }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'unmap-corporation') {
    const corporationId = interaction.options.getString('corporation', true);
    await unassignCorporationProfile(storageRoot, corporationId);
    await interaction.reply({
      content: context.t('onboarding.profile.unmapped', { corporationId }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'set-welcome-channel' || subcommand === 'clear-welcome-channel') {
    const channel = subcommand.startsWith('set-') ? interaction.options.getChannel('channel', true) : null;
    if (channel && (typeof channel.isTextBased !== 'function' || !channel.isTextBased())) {
      throw new Error(context.t('onboarding.error.channelInvalid'));
    }
    await setWelcomeChannel(storageRoot, channel?.id || '');
    await interaction.reply({
      content: context.t(channel ? 'onboarding.welcome.channelSet' : 'onboarding.welcome.channelCleared', {
        channel: channel ? `${channel}` : '',
      }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'set-welcome-recruiter-role' || subcommand === 'clear-welcome-recruiter-role') {
    const role = subcommand.startsWith('set-') ? interaction.options.getRole('role', true) : null;
    await setWelcomeRecruiterRole(storageRoot, role?.id || '');
    await interaction.reply({
      content: context.t(role ? 'onboarding.welcome.recruiterSet' : 'onboarding.welcome.recruiterCleared', {
        role: role ? `${role}` : '',
      }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const roleMatch = /^(set|clear)-(probation|main|rookie|recruiter)-role$/.exec(subcommand);
  if (roleMatch) {
    const [, action, kind] = roleMatch;
    const profileId = profileIdFromInteraction(interaction);
    await ensureExistingProfile(storageRoot, profileId, context.t);
    const role = action === 'set' ? interaction.options.getRole('role', true) : null;
    if (role && kind !== 'recruiter') {
      ensureManageableTechnicalRole(interaction, role, context.t);
    }
    const field = `${kind}RoleId`;
    await upsertOnboardingProfile(storageRoot, profileId, { [field]: role?.id || '' });
    await interaction.reply({
      content: context.t(role ? 'onboarding.profile.roleSet' : 'onboarding.profile.roleCleared', {
        profile: String(profileId).trim().toLowerCase(),
        kind,
        role: role ? `${role}` : '',
      }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'set-promotion-channel' || subcommand === 'clear-promotion-channel') {
    const profileId = profileIdFromInteraction(interaction);
    await ensureExistingProfile(storageRoot, profileId, context.t);
    const channel = subcommand.startsWith('set-') ? interaction.options.getChannel('channel', true) : null;
    if (channel && (typeof channel.isTextBased !== 'function' || !channel.isTextBased())) {
      throw new Error(context.t('onboarding.error.channelInvalid'));
    }
    await upsertOnboardingProfile(storageRoot, profileId, { promotionChannelId: channel?.id || '' });
    await interaction.reply({
      content: context.t(channel ? 'onboarding.profile.channelSet' : 'onboarding.profile.channelCleared', {
        profile: String(profileId).trim().toLowerCase(),
        channel: channel ? `${channel}` : '',
      }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'set-probation-months') {
    const profileId = profileIdFromInteraction(interaction);
    await ensureExistingProfile(storageRoot, profileId, context.t);
    const months = interaction.options.getInteger('months', true);
    const saved = await upsertOnboardingProfile(storageRoot, profileId, { probationMonths: months });
    await interaction.reply({
      content: context.t('onboarding.profile.monthsSet', {
        profile: String(profileId).trim().toLowerCase(),
        months: saved.profiles[String(profileId).trim().toLowerCase()].probationMonths,
      }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'set-welcome-text') {
    await setWelcomeText(storageRoot, interaction.options.getString('text', true));
    await interaction.reply({ content: context.t('onboarding.welcome.textSet'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === 'reset-welcome-text') {
    await resetWelcomeText(storageRoot);
    await interaction.reply({ content: context.t('onboarding.welcome.textReset'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === 'preview') {
    const member = await resolvePreviewMember(interaction);
    const preview = await buildWelcomePreview(storageRoot, member);
    await interaction.reply({ embeds: preview.payload.embeds, flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === 'send-test') {
    const member = await resolvePreviewMember(interaction);
    const channel = interaction.options.getChannel('channel', false) || interaction.channel;
    const result = await sendWelcomeTest(storageRoot, channel, member);
    await interaction.reply({
      content: context.t('onboarding.welcome.testSent', { channel: `<#${result.channelId}>` }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'check-promotions') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await processProbationExpirations({
      config: context.config,
      storageRoot,
      guild: interaction.guild,
    });
    await interaction.editReply({
      content: context.t('promotion.check.done', {
        enabled: result.enabled ? 'true' : 'false',
        eligible: result.eligibleCount,
        created: result.createdCount,
        skipped: result.skippedCount,
      }),
    });
    return;
  }

  if (subcommand === 'promotion-status') {
    const summary = await getPromotionSummary(storageRoot);
    await interaction.reply({
      content: [
        context.t('promotion.status.title'),
        context.t('promotion.status.counts', {
          total: summary.requestsCount,
          pending: summary.pendingCount,
          main: summary.approvedMainCount,
          rookie: summary.approvedRookieCount,
          rejected: summary.rejectedCount,
        }),
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  throw new Error(context.t('onboarding.error.unsupportedSubcommand', { subcommand }));
}

module.exports = {
  configureOnboardingGroup,
  executeOnboardingAdmin,
};
