const { EmbedBuilder } = require('discord.js');
const { createTranslator } = require('../localization/localizationService');

const MAX_EMBEDS_PER_MESSAGE = 10;
const MAX_EMBEDS_TOTAL_LENGTH = 5500;

function normalizeText(value) {
  return String(value || '').trim();
}

function formatDiscordDateTime(value) {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) return '—';
  const seconds = Math.floor(timestamp / 1000);
  return `<t:${seconds}:f> (<t:${seconds}:R>)`;
}

function getObjectTypeLabel(item) {
  if (item?.isPos) return 'POS / Control Tower';
  if (item?.isMetenox) return 'Metenox Moon Drill';
  return 'Upwell structure';
}

function getEmbedColor(item, mode = 'show') {
  if (mode === 'recovered') return 0x57f287;
  if (item?.isCritical) {
    if (item.isPos) return 0xe67e22;
    if (item.isMetenox) return 0x9b59b6;
    return 0xed4245;
  }
  if (item?.hoursRemaining === null && item?.isAlertTrackable) return 0x747f8d;
  if (item?.isPos) return 0x3498db;
  if (item?.isMetenox) return 0x1abc9c;
  return 0x57f287;
}

function getStatusLabel(t, item, mode = 'show') {
  if (mode === 'recovered') return t('structures.status.ok');
  if (item?.isCritical) return t('structures.status.critical');
  if (item?.hoursRemaining === null && item?.isAlertTrackable) {
    if (item?.alertStatusLabel && item.alertStatusLabel !== 'NO DATA') return item.alertStatusLabel;
    return t('structures.status.noFuelData');
  }
  return normalizeText(item?.alertStatusLabel) || t('structures.status.ok');
}

function addField(embed, name, value, inline = false) {
  const text = normalizeText(value);
  if (!text) return;
  embed.addFields({ name: String(name).slice(0, 256), value: text.slice(0, 1024), inline });
}

function buildStructureFuelEmbed(t, item, options = {}) {
  const mode = options.mode || 'show';
  const prefix = Number.isInteger(options.index) ? `${options.index + 1}. ` : '';
  const description = [
    t('structures.card.system', { system: item.systemName || '—' }),
    t('structures.card.objectType', { type: getObjectTypeLabel(item) }),
  ];
  if (item.moonName) description.push(t('structures.card.moon', { moon: item.moonName }));

  const embed = new EmbedBuilder()
    .setTitle(`${prefix}${item.name || 'Unnamed structure'}`.slice(0, 256))
    .setDescription(description.join('\n').slice(0, 4096))
    .setColor(getEmbedColor(item, mode));

  addField(embed, t('structures.card.fuelStatus'), `**${getStatusLabel(t, item, mode)}**`);
  addField(embed, t('structures.card.remaining'), `**${item.timeRemainingLabel || '—'}**`);
  addField(embed, t('structures.card.state'), item.structureStateLabel || 'Unknown');
  addField(embed, t('structures.card.type'), item.typeName || getObjectTypeLabel(item));

  if (item.isPos) {
    if (item.starbaseDetailError) {
      addField(embed, t('structures.card.posDetail'), `error: ${item.starbaseDetailError}`);
    } else if (!item.starbaseDetailAvailable) {
      addField(embed, t('structures.card.posDetail'), t('structures.common.noData'));
    }
    addField(
      embed,
      t('structures.card.fuelBlock'),
      `**${item.posFuelBlockName || t('structures.common.none')}** — ${item.posFuelBlockQuantityFormatted || '0'}${item.timeRemainingLabel ? ` / ~${item.timeRemainingLabel}` : ''}`
    );
    addField(
      embed,
      t('structures.card.strontium'),
      `${item.posStrontiumQuantityFormatted || '0'}${item.posStrontiumTimeRemainingLabel ? ` / ~${item.posStrontiumTimeRemainingLabel}` : ''}`
    );
  } else if (item.isMetenox) {
    addField(embed, t('structures.card.moonService'), item.moonDrillingServiceSummary || t('structures.common.noData'));
    addField(
      embed,
      t('structures.card.fuelBlock'),
      `**${item.metenoxFuelBlockDisplayName || t('structures.common.none')}** — ${item.metenoxFuelBlockQuantityFormatted || '0'}${item.metenoxFuelBlockTimeRemainingLabel ? ` / ~${item.metenoxFuelBlockTimeRemainingLabel}` : ''}`
    );
    addField(
      embed,
      t('structures.card.magmaticGas'),
      `${item.metenoxMagmaticGasQuantityFormatted || '0'}${item.metenoxMagmaticGasTimeRemainingLabel ? ` / ~${item.metenoxMagmaticGasTimeRemainingLabel}` : ''}`
    );
  } else {
    addField(
      embed,
      t('structures.card.fuelUntil'),
      item.fuelExpires ? formatDiscordDateTime(item.fuelExpires) : t('structures.status.noFuelData')
    );
    if (Array.isArray(item.activeServices) && item.activeServices.length > 0) {
      addField(embed, t('structures.card.activeServices'), item.activeServices.map((service) => `• ${service}`).join('\n'));
    }
  }
  return embed;
}

function buildStructureFuelEmbeds(t, items, options = {}) {
  return (Array.isArray(items) ? items : []).map((item, index) =>
    buildStructureFuelEmbed(t, item, { ...options, index })
  );
}

function getEmbedLength(embed) {
  const data = typeof embed?.toJSON === 'function' ? embed.toJSON() : embed;
  return [
    data?.title,
    data?.description,
    data?.footer?.text,
    ...(Array.isArray(data?.fields) ? data.fields.flatMap((field) => [field.name, field.value]) : []),
  ].reduce((sum, value) => sum + normalizeText(value).length, 0);
}

function splitEmbedsForDiscord(embeds) {
  const chunks = [];
  let current = [];
  let length = 0;
  for (const embed of Array.isArray(embeds) ? embeds : []) {
    const nextLength = getEmbedLength(embed);
    if (current.length >= MAX_EMBEDS_PER_MESSAGE || (current.length > 0 && length + nextLength > MAX_EMBEDS_TOTAL_LENGTH)) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(embed);
    length += nextLength;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function buildStructureFuelShowContent(t, report, reportTypeLabel, visibleCount, onlyCritical) {
  return [
    t('structures.show.title'),
    t('structures.show.corporation', { corporation: report.corporationName }),
    t('structures.show.checked', { time: formatDiscordDateTime(report.checkedAt) }),
    t('structures.show.threshold', { hours: report.criticalThresholdHours }),
    '',
    t('structures.show.summary'),
    t('structures.show.total', { count: report.totalCount }),
    t('structures.show.upwell', { count: report.regularUpwellCount }),
    t('structures.show.metenox', { count: report.metenoxCount }),
    t('structures.show.pos', { count: report.posCount }),
    t('structures.show.disabled', { count: report.disabledStructureCount || 0 }),
    t('structures.show.critical', { count: report.criticalCount }),
    t('structures.show.noFuel', { count: report.noFuelDataCount }),
    '',
    t('structures.show.filter', { filter: reportTypeLabel }),
    t('structures.show.mode', {
      mode: t(onlyCritical ? 'structures.show.modeCritical' : 'structures.show.modeAll'),
    }),
    t('structures.show.visible', { count: visibleCount }),
  ].join('\n');
}

function buildJobSummaryEmbed(t, result) {
  const yes = t('structures.common.yes');
  const no = t('structures.common.no');
  return new EmbedBuilder()
    .setTitle(t('structures.check.title'))
    .setColor(result.criticalCount > 0 ? 0xed4245 : 0x57f287)
    .setDescription([
      t('structures.check.corporation', { corporation: result.corporationName }),
      t('structures.show.checked', { time: formatDiscordDateTime(result.checkedAt) }),
    ].join('\n'))
    .addFields(
      {
        name: t('structures.show.summary'),
        value: t('structures.check.total', {
          total: result.totalCount || 0,
          critical: result.criticalCount || 0,
          upwell: result.criticalUpwellCount || 0,
          metenox: result.criticalMetenoxCount || 0,
          pos: result.criticalPosCount || 0,
        }),
      },
      {
        name: t('structures.card.fuelStatus'),
        value: t('structures.check.alerts', {
          newCritical: result.newCriticalAlertsCount || 0,
          criticalSent: result.criticalAlertsCount || 0,
          recovered: result.recoveredAlertsCount || 0,
        }),
      },
      {
        name: 'Discord',
        value: t('structures.check.discord', {
          channel: result.alertChannelConfigured ? yes : no,
          role: result.alertRoleConfigured ? yes : no,
          criticalMessage: result.criticalMessageSent ? yes : no,
          recoveredMessage: result.recoveredMessageSent ? yes : no,
        }),
      }
    );
}

function createStructureAlertSender(config) {
  const t = createTranslator(config.localization.defaultLanguage, config);
  return async (client, channelId, items, meta = {}) => {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return false;
    const mode = meta.mode === 'recovered' ? 'recovered' : 'critical';
    const embeds = buildStructureFuelEmbeds(t, items, { mode });
    const chunks = splitEmbedsForDiscord(embeds);
    if (chunks.length === 0) return false;
    const title = t(mode === 'recovered' ? 'structures.alert.recoveredTitle' : 'structures.alert.criticalTitle');
    for (let index = 0; index < chunks.length; index += 1) {
      const contentLines = [];
      if (index === 0 && mode === 'critical' && meta.roleId) contentLines.push(`<@&${meta.roleId}>`);
      contentLines.push(`**${title}**`);
      if (meta.corporationName) contentLines.push(t('structures.show.corporation', { corporation: meta.corporationName }));
      contentLines.push(t('structures.alert.threshold', { hours: meta.thresholdHours || 72 }));
      if (meta.forceSendCurrentCritical && index === 0) contentLines.push(t('structures.alert.manual'));
      await channel.send({ content: contentLines.join('\n'), embeds: chunks[index] });
    }
    return true;
  };
}

module.exports = {
  MAX_EMBEDS_PER_MESSAGE,
  MAX_EMBEDS_TOTAL_LENGTH,
  formatDiscordDateTime,
  getObjectTypeLabel,
  buildStructureFuelEmbed,
  buildStructureFuelEmbeds,
  splitEmbedsForDiscord,
  buildStructureFuelShowContent,
  buildJobSummaryEmbed,
  createStructureAlertSender,
};
