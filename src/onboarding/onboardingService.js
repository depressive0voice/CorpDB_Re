const { EmbedBuilder } = require('discord.js');
const { getManagedRoleBinding } = require('../roles/managedRolePolicyRepository');
const { translate } = require('../localization/localizationService');
const {
  DEFAULT_WELCOME_TEXT,
  readOnboardingConfig,
  updateWelcomeConfig,
} = require('./onboardingConfigRepository');
const { listEnabledOnboardingCorporationIds } = require('./onboardingProfileService');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeWelcomeTextInput(text) {
  return String(text || '').replace(/\\n/g, '\n').trim();
}

function replaceAll(text, search, replacement) {
  return String(text || '').split(search).join(replacement);
}

function commonProfileValue(config, field) {
  const values = [...new Set(
    Object.values(config.profiles || {})
      .map((profile) => normalizeText(profile?.[field]))
      .filter(Boolean)
  )];
  return values.length === 1 ? values[0] : '';
}

async function renderWelcomeText(storageRoot, member) {
  const config = await readOnboardingConfig(storageRoot);
  const guestRoleId = await getManagedRoleBinding(storageRoot, 'guest').catch(() => '');
  const enabledCorporationIds = await listEnabledOnboardingCorporationIds(storageRoot);

  let profile = null;
  if (enabledCorporationIds.length === 1) {
    const mapped = config.corporationProfiles[enabledCorporationIds[0]] || 'default';
    profile = config.profiles[mapped] || config.profiles.default;
  }

  const resolveRole = (field) => normalizeText(profile?.[field]) || commonProfileValue(config, field);
  const recruiterRoleId = normalizeText(config.welcome.recruiterRoleId) || resolveRole('recruiterRoleId');
  const guildName = normalizeText(member?.guild?.name) || 'server';
  let text = String(config.welcome.text || DEFAULT_WELCOME_TEXT);

  const rookieRoleId = resolveRole('rookieRoleId') || resolveRole('probationRoleId');
  const placeholders = {
    '{member}': member?.id ? `<@${member.id}>` : 'member',
    '{server_name}': guildName,
    '{request_main_command}': '/request-main',
    '{guest_role}': guestRoleId ? `<@&${guestRoleId}>` : 'not configured',
    // Legacy placeholder stays supported, but Rookie is the canonical probation role.
    '{probation_role}': rookieRoleId ? `<@&${rookieRoleId}>` : 'depends on corporation',
    '{rookie_role}': rookieRoleId ? `<@&${rookieRoleId}>` : 'depends on corporation',
    '{main_role}': resolveRole('mainRoleId') ? `<@&${resolveRole('mainRoleId')}>` : 'depends on corporation',
    '{recruiter_role}': recruiterRoleId ? `<@&${recruiterRoleId}>` : 'not configured',
  };

  for (const [placeholder, replacement] of Object.entries(placeholders)) {
    text = replaceAll(text, placeholder, replacement);
  }

  return { config, text, recruiterRoleId };
}

async function buildWelcomePayload(storageRoot, member, options = {}) {
  const rendered = await renderWelcomeText(storageRoot, member);
  const mentions = [`<@${member.id}>`];
  if (options.mentionRecruiter && rendered.recruiterRoleId) {
    mentions.push(`<@&${rendered.recruiterRoleId}>`);
  }
  const t = typeof options.t === 'function'
    ? options.t
    : (key) => translate('en', key);

  return {
    config: rendered.config,
    payload: {
      content: mentions.join(' '),
      embeds: [new EmbedBuilder()
        .setTitle(t('onboarding.welcome.title'))
        .setDescription(rendered.text)
        .setColor(0x5865f2)
        .setTimestamp()],
    },
  };
}

async function resolveTextChannel(guild, channelId) {
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  return channel && typeof channel.isTextBased === 'function' && channel.isTextBased()
    ? channel
    : null;
}

async function handleGuildMemberJoin(storageRoot, member, options = {}) {
  if (member?.user?.bot) {
    return { welcomeSentTo: 'ignored-bot', welcomeChannelId: '', dmSent: false };
  }

  const config = await readOnboardingConfig(storageRoot);
  if (config.welcome.enabled === false) {
    return { welcomeSentTo: 'disabled', welcomeChannelId: '', dmSent: false };
  }

  const welcome = await buildWelcomePayload(storageRoot, member, {
    mentionRecruiter: true,
    t: options.t,
  });
  const channel = await resolveTextChannel(member.guild, config.welcome.channelId);

  if (channel) {
    await channel.send(welcome.payload);
    return { welcomeSentTo: 'channel', welcomeChannelId: channel.id, dmSent: false };
  }

  const dmSent = await member.send({ embeds: welcome.payload.embeds }).then(() => true).catch(() => false);
  return { welcomeSentTo: dmSent ? 'dm' : 'none', welcomeChannelId: '', dmSent };
}

async function setWelcomeEnabled(storageRoot, enabled) {
  return updateWelcomeConfig(storageRoot, { enabled: Boolean(enabled) });
}

async function setWelcomeChannel(storageRoot, channelId) {
  return updateWelcomeConfig(storageRoot, { channelId: normalizeText(channelId) });
}

async function setWelcomeRecruiterRole(storageRoot, roleId) {
  return updateWelcomeConfig(storageRoot, { recruiterRoleId: normalizeText(roleId) });
}

async function setWelcomeText(storageRoot, text) {
  return updateWelcomeConfig(storageRoot, { text: normalizeWelcomeTextInput(text) });
}

async function resetWelcomeText(storageRoot) {
  return updateWelcomeConfig(storageRoot, { text: DEFAULT_WELCOME_TEXT });
}

async function buildWelcomePreview(storageRoot, member, options = {}) {
  return buildWelcomePayload(storageRoot, member, { mentionRecruiter: false, t: options.t });
}

async function sendWelcomeTest(storageRoot, channel, member, options = {}) {
  if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
    throw new Error('Selected channel does not support text messages.');
  }
  const welcome = await buildWelcomePayload(storageRoot, member, {
    mentionRecruiter: false,
    t: options.t,
  });
  await channel.send(welcome.payload);
  return { channelId: channel.id, memberId: member.id };
}

module.exports = {
  normalizeWelcomeTextInput,
  renderWelcomeText,
  buildWelcomePayload,
  handleGuildMemberJoin,
  setWelcomeEnabled,
  setWelcomeChannel,
  setWelcomeRecruiterRole,
  setWelcomeText,
  resetWelcomeText,
  buildWelcomePreview,
  sendWelcomeTest,
};
