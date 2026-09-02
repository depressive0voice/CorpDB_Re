const { EmbedBuilder } = require('discord.js');
const { getCorporationAccessContext } = require('../eve/eveAuthorizationService');
const {
  getCharacterNotifications,
  getCorporationMemberIds,
  resolveUniverseNames,
} = require('../eve/eveEsiClient');
const { readCorporationProfile } = require('../corporations/corporationProfileRepository');
const { findAllAuthCharacters } = require('../auth/authCharacterRepository');
const {
  readApplicationConfig,
  updateApplicationConfig,
} = require('./applicationConfigRepository');
const {
  readApplicationState,
  writeApplicationState,
  resetApplicationState,
} = require('./applicationStateRepository');
const { createTranslator } = require('../localization/localizationService');

const NOTIFICATIONS_SCOPE = 'esi-characters.read_notifications.v1';
const APPLICATION_NOTIFICATION_MAX_AGE_DAYS = 30;

const STATUS_COLORS = Object.freeze({
  applied: 0xfee75c,
  invited: 0x5865f2,
  accepted: 0x57f287,
  rejected: 0xed4245,
  withdrawn: 0x747f8d,
  unknown: 0x747f8d,
});

function normalizeText(value) {
  return String(value || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeStatus(value) {
  const status = normalizeKey(value);
  return Object.prototype.hasOwnProperty.call(STATUS_COLORS, status) ? status : 'unknown';
}

function isFinalStatus(status) {
  return ['accepted', 'rejected', 'withdrawn'].includes(normalizeStatus(status));
}

function ensureNotificationScope(access) {
  const scopes = new Set(Array.isArray(access?.scopes) ? access.scopes : []);
  if (!scopes.has(NOTIFICATIONS_SCOPE)) {
    const error = new Error(`EVE authorization is missing required scope: ${NOTIFICATIONS_SCOPE}`);
    error.code = 'eve_sso_missing_notifications_scope';
    throw error;
  }
}

function getTextField(text, fieldNames) {
  const source = String(text || '');
  for (const fieldName of fieldNames) {
    const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*:\\s*[\"']?([^\"'\\n]+)`, 'i');
    const match = source.match(regex);
    if (match?.[1]) return normalizeText(match[1]);
  }
  return '';
}

function parseCharacterIdFromNotification(notification) {
  const explicitValue = getTextField(notification?.text, [
    'characterID',
    'characterId',
    'character_id',
    'applicantID',
    'applicantId',
    'applicant_id',
    'senderID',
    'senderId',
    'sender_id',
  ]);
  const explicitNumber = explicitValue.match(/\d+/)?.[0] || '';
  if (explicitNumber) return explicitNumber;
  if (normalizeKey(notification?.sender_type) === 'character') {
    return normalizeText(notification?.sender_id);
  }
  return '';
}

function getNotificationTimestamp(notification) {
  return normalizeText(
    notification?.timestamp || notification?.created_at || notification?.date
  );
}

function isCorpApplicationNotification(notification) {
  const type = normalizeKey(notification?.type);
  const text = normalizeKey(notification?.text);
  if (!type && !text) return false;
  return (
    (type.includes('corp') && type.includes('app')) ||
    type.includes('corporationapplication') ||
    type.includes('corporation_application') ||
    (text.includes('corporation') && text.includes('application')) ||
    (text.includes('corp') && text.includes('application'))
  );
}

function isRecentEnough(timestamp, options = {}) {
  const raw = normalizeText(timestamp);
  if (!raw) return true;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return true;
  const now = options.now instanceof Date ? options.now : new Date();
  const maxAgeMs = APPLICATION_NOTIFICATION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  return now.getTime() - parsed <= maxAgeMs;
}

function inferNotificationStatus(notification, isCurrentMember, previousStatus = '') {
  const combined = `${normalizeKey(notification?.type)} ${normalizeKey(notification?.text)}`;
  if (isCurrentMember || combined.includes('accepted') || combined.includes('accept')) {
    return 'accepted';
  }
  if (combined.includes('rejected') || combined.includes('reject') || combined.includes('denied')) {
    return 'rejected';
  }
  if (combined.includes('withdrawn') || combined.includes('withdraw')) return 'withdrawn';
  if (combined.includes('invited') || combined.includes('invite')) return 'invited';
  if (previousStatus && isFinalStatus(previousStatus)) return normalizeStatus(previousStatus);
  return 'applied';
}

function buildAuthLookup(records) {
  const lookup = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const main = normalizeText(record.main);
    const alt = normalizeText(record.alt);
    const corp = normalizeText(record.corp);
    if (main && !lookup.has(normalizeKey(main))) {
      lookup.set(normalizeKey(main), { found: true, role: 'main', main, corp });
    }
    if (alt && !lookup.has(normalizeKey(alt))) {
      lookup.set(normalizeKey(alt), {
        found: true,
        role: normalizeKey(alt) === normalizeKey(main) ? 'main' : 'alt',
        main: main || alt,
        corp,
      });
    }
  }
  return lookup;
}

function getAuthMatch(authLookup, characterName) {
  return authLookup.get(normalizeKey(characterName)) || {
    found: false,
    role: '',
    main: '',
    corp: '',
  };
}

function buildAuthSnapshot(authMatch) {
  return {
    authFound: Boolean(authMatch?.found),
    authRole: normalizeText(authMatch?.role),
    authMain: normalizeText(authMatch?.main),
    authCorp: normalizeText(authMatch?.corp),
  };
}

function hasAuthStateChanged(previous, snapshot) {
  return (
    Boolean(previous?.authFound) !== Boolean(snapshot.authFound) ||
    normalizeText(previous?.authRole) !== snapshot.authRole ||
    normalizeText(previous?.authMain) !== snapshot.authMain ||
    normalizeText(previous?.authCorp) !== snapshot.authCorp
  );
}

function formatDiscordDateTime(value) {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) return '—';
  const seconds = Math.floor(timestamp / 1000);
  return `<t:${seconds}:f> (<t:${seconds}:R>)`;
}

function buildAuthFieldValue(t, entry) {
  if (!entry.authFound) return t('applications.auth.notFound');
  const lines = [
    t('applications.auth.found'),
    t('applications.auth.role', { role: entry.authRole || '—' }),
  ];
  if (entry.authMain) lines.push(t('applications.auth.main', { main: entry.authMain }));
  if (entry.authCorp) lines.push(t('applications.auth.corporation', { corporation: entry.authCorp }));
  return lines.join('\n');
}

function getStatusLabel(t, status) {
  return t(`applications.status.${normalizeStatus(status)}`);
}

function buildApplicationEmbed(config, entry, corporationName) {
  const t = createTranslator(config.localization.defaultLanguage, config);
  const status = normalizeStatus(entry.status);
  const embed = new EmbedBuilder()
    .setTitle(t('applications.card.title'))
    .setColor(STATUS_COLORS[status])
    .setDescription([
      t('applications.card.character', { character: entry.characterName || `#${entry.characterId}` }),
      t('applications.card.corporation', { corporation: corporationName || entry.corporationId }),
    ].join('\n'))
    .addFields(
      {
        name: t('applications.card.statusTitle'),
        value: `**${getStatusLabel(t, status)}**`,
        inline: false,
      },
      {
        name: t('applications.card.appliedAtTitle'),
        value: formatDiscordDateTime(entry.appliedAt),
        inline: false,
      },
      {
        name: 'Auth',
        value: buildAuthFieldValue(t, entry),
        inline: false,
      }
    );

  if (entry.lastStatusChangeAt) {
    embed.addFields({
      name: t('applications.card.statusUpdatedTitle'),
      value: formatDiscordDateTime(entry.lastStatusChangeAt),
      inline: false,
    });
  }
  if (entry.lastNotificationType) {
    embed.setFooter({ text: `ESI notification: ${entry.lastNotificationType}`.slice(0, 2048) });
  }
  return embed;
}

function buildApplicationEntry({
  previous,
  corporationId,
  characterId,
  characterName,
  status,
  notification,
  authMatch,
  checkedAt,
}) {
  const previousStatus = normalizeStatus(previous?.status);
  const nextStatus = normalizeStatus(status);
  const statusChanged = Boolean(previous?.characterId) && previousStatus !== nextStatus;
  const authSnapshot = buildAuthSnapshot(authMatch);
  const authChanged = Boolean(previous?.characterId) && hasAuthStateChanged(previous, authSnapshot);
  const notificationTimestamp = getNotificationTimestamp(notification);

  return {
    ...(previous || {}),
    applicationKey: characterId,
    corporationId,
    characterId,
    characterName: normalizeText(characterName) || normalizeText(previous?.characterName),
    status: nextStatus,
    appliedAt: normalizeText(previous?.appliedAt) || notificationTimestamp || checkedAt,
    lastNotificationAt: notificationTimestamp || normalizeText(previous?.lastNotificationAt),
    lastNotificationId: normalizeText(notification?.notification_id || previous?.lastNotificationId),
    lastNotificationType: normalizeText(notification?.type || previous?.lastNotificationType),
    ...authSnapshot,
    authUpdatedAt: authChanged ? checkedAt : normalizeText(previous?.authUpdatedAt),
    createdAt: normalizeText(previous?.createdAt) || checkedAt,
    updatedAt: checkedAt,
    lastStatusChangeAt: statusChanged
      ? checkedAt
      : normalizeText(previous?.lastStatusChangeAt),
    updateCount: Number(previous?.updateCount || 0) + (statusChanged ? 1 : 0),
  };
}

function shouldDeliver(previous, nextEntry, desiredAuthValue) {
  if (!nextEntry.messageId) return true;
  if (!previous) return true;
  if (normalizeStatus(previous.status) !== normalizeStatus(nextEntry.status)) return true;
  if (hasAuthStateChanged(previous, nextEntry)) return true;
  return normalizeText(previous.authCardValue) !== normalizeText(desiredAuthValue);
}

async function sendOrUpdateApplicationMessage(
  config,
  client,
  channelId,
  entry,
  corporationName
) {
  if (!client || !channelId) {
    return { ok: false, skipped: true, code: 'channel_not_configured', entry };
  }
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return { ok: false, skipped: false, code: 'channel_not_found', entry };
  }

  const embed = buildApplicationEmbed(config, entry, corporationName);
  if (entry.messageId) {
    const message = await channel.messages.fetch(entry.messageId).catch(() => null);
    if (message) {
      const edited = await message.edit({ embeds: [embed] });
      return {
        ok: true,
        action: 'edited',
        entry: {
          ...entry,
          channelId,
          messageId: edited.id,
          messageUrl: edited.url || entry.messageUrl,
        },
      };
    }
  }

  const sent = await channel.send({ embeds: [embed] });
  return {
    ok: true,
    action: 'sent',
    entry: {
      ...entry,
      channelId,
      messageId: sent.id,
      messageUrl: sent.url || '',
      postedAt: new Date().toISOString(),
    },
  };
}

async function processCorporationApplications(config, storageRoot, corporationId, client, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const checkedAt = now.toISOString();
  const accessImpl = options.accessImpl || getCorporationAccessContext;
  const notificationsImpl = options.notificationsImpl || getCharacterNotifications;
  const membersImpl = options.membersImpl || getCorporationMemberIds;
  const namesImpl = options.namesImpl || resolveUniverseNames;
  const authImpl = options.authImpl || findAllAuthCharacters;
  const deliveryImpl = options.deliveryImpl || sendOrUpdateApplicationMessage;

  const access = await accessImpl(config, storageRoot, corporationId, options);
  ensureNotificationScope(access);
  const [profile, appConfig, previousState, notifications, authRecords] = await Promise.all([
    readCorporationProfile(storageRoot, corporationId),
    readApplicationConfig(storageRoot, corporationId),
    readApplicationState(storageRoot, corporationId),
    notificationsImpl(config, access.characterId, access.accessToken, options),
    authImpl(storageRoot),
  ]);

  let currentMemberIds = new Set();
  let memberLookupAvailable = true;
  let memberLookupError = '';
  try {
    const memberIds = await membersImpl(
      config,
      corporationId,
      access.accessToken,
      options
    );
    currentMemberIds = new Set((memberIds || []).map((value) => String(value).trim()).filter(Boolean));
  } catch (error) {
    memberLookupAvailable = false;
    memberLookupError = error?.message || String(error);
  }

  const allNotifications = Array.isArray(notifications) ? notifications : [];
  const relevantNotifications = allNotifications
    .filter(isCorpApplicationNotification)
    .filter((notification) => isRecentEnough(getNotificationTimestamp(notification), { now }))
    .sort((left, right) => {
      const leftTime = Date.parse(getNotificationTimestamp(left)) || 0;
      const rightTime = Date.parse(getNotificationTimestamp(right)) || 0;
      return leftTime - rightTime;
    });

  const characterIds = [...new Set([
    ...relevantNotifications.map(parseCharacterIdFromNotification),
    ...Object.values(previousState.applications || {}).map((entry) => entry.characterId),
  ].map((value) => String(value || '').trim()).filter((value) => /^\d+$/.test(value)))];
  const resolvedNames = characterIds.length > 0
    ? await namesImpl(config, characterIds, options)
    : [];
  const nameMap = new Map(
    (Array.isArray(resolvedNames) ? resolvedNames : [])
      .map((entry) => [String(entry?.id || '').trim(), normalizeText(entry?.name)])
      .filter(([id]) => id)
  );
  const authLookup = buildAuthLookup(authRecords);
  const nextApplications = { ...(previousState.applications || {}) };
  const touched = new Set();

  for (const notification of relevantNotifications) {
    const characterId = parseCharacterIdFromNotification(notification);
    if (!characterId) continue;
    const previous = nextApplications[characterId] || null;
    const characterName = nameMap.get(characterId) || previous?.characterName || '';
    const status = inferNotificationStatus(
      notification,
      currentMemberIds.has(characterId),
      previous?.status
    );
    nextApplications[characterId] = buildApplicationEntry({
      previous,
      corporationId,
      characterId,
      characterName,
      status,
      notification,
      authMatch: getAuthMatch(authLookup, characterName),
      checkedAt,
    });
    touched.add(characterId);
  }

  for (const [characterId, previous] of Object.entries(nextApplications)) {
    const characterName = nameMap.get(characterId) || previous.characterName || '';
    const acceptedByMembership = memberLookupAvailable && currentMemberIds.has(characterId);
    const status = acceptedByMembership ? 'accepted' : previous.status;
    const notification = touched.has(characterId) ? null : {};
    nextApplications[characterId] = buildApplicationEntry({
      previous,
      corporationId,
      characterId,
      characterName,
      status,
      notification,
      authMatch: getAuthMatch(authLookup, characterName),
      checkedAt,
    });
  }

  const t = createTranslator(config.localization.defaultLanguage, config);
  const deliveryQueue = [];
  for (const [characterId, entry] of Object.entries(nextApplications)) {
    const previous = previousState.applications?.[characterId] || null;
    const desiredAuthValue = buildAuthFieldValue(t, entry);
    if (shouldDeliver(previous, entry, desiredAuthValue)) {
      deliveryQueue.push({ characterId, desiredAuthValue });
    }
  }

  let sentCount = 0;
  let editedCount = 0;
  let failedDeliveryCount = 0;
  let skippedDeliveryCount = 0;
  const deliveredApplications = [];

  for (const queued of deliveryQueue) {
    const entry = nextApplications[queued.characterId];
    const delivery = await deliveryImpl(
      config,
      client,
      appConfig.alertChannelId,
      entry,
      profile.name || corporationId
    ).catch((error) => ({
      ok: false,
      skipped: false,
      code: error?.message || 'application_delivery_failed',
      entry,
    }));

    if (delivery.ok) {
      if (delivery.action === 'sent') sentCount += 1;
      if (delivery.action === 'edited') editedCount += 1;
      deliveredApplications.push(entry.characterName || entry.characterId);
      nextApplications[queued.characterId] = {
        ...delivery.entry,
        authCardValue: queued.desiredAuthValue,
        authCardSyncedAt: checkedAt,
        authCardSyncError: '',
      };
    } else if (delivery.skipped) {
      skippedDeliveryCount += 1;
      nextApplications[queued.characterId] = {
        ...entry,
        authCardSyncError: delivery.code || 'application_delivery_skipped',
      };
    } else {
      failedDeliveryCount += 1;
      nextApplications[queued.characterId] = {
        ...entry,
        authCardSyncError: delivery.code || 'application_delivery_failed',
      };
    }
  }

  const savedState = await writeApplicationState(storageRoot, corporationId, {
    ...previousState,
    lastCheckedAt: checkedAt,
    applications: nextApplications,
  });
  const applications = Object.values(savedState.applications);

  return {
    ok: true,
    corporationId: String(corporationId),
    corporationName: profile.name || String(corporationId),
    serviceCharacterId: access.characterId,
    serviceCharacterName: access.characterName,
    checkedAt,
    alertChannelId: appConfig.alertChannelId,
    alertChannelConfigured: Boolean(appConfig.alertChannelId),
    notificationsScannedCount: allNotifications.length,
    applicationNotificationsCount: relevantNotifications.length,
    trackedApplicationsCount: applications.length,
    pendingApplicationsCount: applications.filter((entry) => ['applied', 'invited'].includes(entry.status)).length,
    acceptedApplicationsCount: applications.filter((entry) => entry.status === 'accepted').length,
    authMatchedApplicationsCount: applications.filter((entry) => entry.authFound).length,
    deliveryQueueCount: deliveryQueue.length,
    sentCount,
    editedCount,
    failedDeliveryCount,
    skippedDeliveryCount,
    deliveredApplications,
    memberLookupAvailable,
    memberLookupError,
  };
}

async function setApplicationAlertChannel(storageRoot, corporationId, channelId) {
  return updateApplicationConfig(storageRoot, corporationId, {
    alertChannelId: normalizeText(channelId),
  });
}

async function clearApplicationAlertChannel(storageRoot, corporationId) {
  return updateApplicationConfig(storageRoot, corporationId, { alertChannelId: '' });
}

async function resetCorporationApplicationCache(storageRoot, corporationId, options = {}) {
  const state = await resetApplicationState(storageRoot, corporationId, options);
  return {
    corporationId: String(corporationId),
    resetAt: state.lastResetAt,
  };
}

module.exports = {
  NOTIFICATIONS_SCOPE,
  APPLICATION_NOTIFICATION_MAX_AGE_DAYS,
  STATUS_COLORS,
  normalizeStatus,
  isFinalStatus,
  ensureNotificationScope,
  parseCharacterIdFromNotification,
  getNotificationTimestamp,
  isCorpApplicationNotification,
  isRecentEnough,
  inferNotificationStatus,
  buildAuthLookup,
  getAuthMatch,
  buildAuthSnapshot,
  hasAuthStateChanged,
  formatDiscordDateTime,
  buildAuthFieldValue,
  buildApplicationEmbed,
  buildApplicationEntry,
  shouldDeliver,
  sendOrUpdateApplicationMessage,
  processCorporationApplications,
  setApplicationAlertChannel,
  clearApplicationAlertChannel,
  resetCorporationApplicationCache,
};
