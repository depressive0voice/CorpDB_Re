const { readFinancePolicy } = require('./financePolicyRepository');
const { readJournalState } = require('./journalRepository');
const {
  readDonationAlertState,
  writeDonationAlertState,
} = require('./donationAlertRepository');
const { resolveUserLanguage, createTranslator } = require('../localization/localizationService');
const { formatIsk } = require('./walletService');

function normalizeText(value) {
  return String(value || '').trim();
}

function extractDonorName(description) {
  const text = normalizeText(description);
  if (!text) return '';
  const patterns = [
    /^(.*?)\s+deposited\s+cash\s+into\s+/i,
    /^(.*?)\s+deposited\s+/i,
    /^(.*?)\s+sent\s+/i,
    /^(.*?)\s+paid\s+/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && normalizeText(match[1])) return normalizeText(match[1]);
  }
  return text;
}

function buildEntryKey(entry) {
  return `${Number(entry.division || 0)}:${normalizeText(entry.id)}`;
}

async function processCorporationDonationAlerts(config, storageRoot, corporationId, client) {
  const checkedAt = new Date().toISOString();
  const [policy, history, state] = await Promise.all([
    readFinancePolicy(storageRoot, corporationId),
    readJournalState(storageRoot, corporationId),
    readDonationAlertState(storageRoot, corporationId),
  ]);
  const discordUserId = normalizeText(policy.donationAlert.discordUserId);
  const division = Number(policy.donationAlert.division || 0);

  if (!discordUserId || division <= 0) {
    return {
      enabled: false,
      corporationId: String(corporationId),
      checkedAt,
      alertedCount: 0,
      dmSent: false,
      reason: 'donation_alert_not_configured',
    };
  }

  const donations = history.entries
    .filter((entry) =>
      normalizeText(entry.refType).toLowerCase() === 'player_donation'
      && Number(entry.amount || 0) > 0
      && Number(entry.division || 0) === division
    )
    .sort((left, right) => (Date.parse(left.date) || 0) - (Date.parse(right.date) || 0));
  const newEntries = donations.filter((entry) => !state.alertedEntries[buildEntryKey(entry)]);
  if (newEntries.length === 0) {
    await writeDonationAlertState(storageRoot, corporationId, {
      ...state,
      lastCheckedAt: checkedAt,
    });
    return {
      enabled: true,
      corporationId: String(corporationId),
      checkedAt,
      alertedCount: 0,
      dmSent: false,
      reason: '',
    };
  }

  const user = await client?.users?.fetch(discordUserId).catch(() => null);
  if (!user) {
    return {
      enabled: true,
      corporationId: String(corporationId),
      checkedAt,
      alertedCount: 0,
      dmSent: false,
      reason: 'discord_user_unavailable',
    };
  }

  const language = await resolveUserLanguage(storageRoot, config, discordUserId).catch(
    () => config.localization.defaultLanguage
  );
  const t = createTranslator(language, config);
  const totalAmount = newEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const lines = [
    t('finance.alert.title'),
    t('finance.alert.corporation', {
      corporation: history.meta.corporationName || corporationId,
    }),
    t('finance.alert.count', { count: newEntries.length }),
    t('finance.alert.total', { amount: formatIsk(totalAmount) }),
    '',
  ];
  for (const entry of newEntries) {
    lines.push(t('finance.alert.entry', {
      date: normalizeText(entry.date) || '—',
      amount: formatIsk(entry.amount),
      donor: extractDonorName(entry.description) || '—',
    }));
    if (normalizeText(entry.reason)) {
      lines.push(t('finance.alert.reason', { reason: normalizeText(entry.reason) }));
    }
  }

  const dmSent = await user.send({ content: lines.join('\n') }).then(() => true).catch(() => false);
  if (!dmSent) {
    return {
      enabled: true,
      corporationId: String(corporationId),
      checkedAt,
      alertedCount: 0,
      dmSent: false,
      reason: 'dm_failed',
    };
  }

  const alertedEntries = { ...state.alertedEntries };
  for (const entry of newEntries) {
    const key = buildEntryKey(entry);
    alertedEntries[key] = {
      id: entry.id,
      division: entry.division,
      date: entry.date,
      amount: entry.amount,
      alertedAt: checkedAt,
    };
  }
  await writeDonationAlertState(storageRoot, corporationId, {
    ...state,
    lastCheckedAt: checkedAt,
    alertedEntries,
  });

  return {
    enabled: true,
    corporationId: String(corporationId),
    checkedAt,
    alertedCount: newEntries.length,
    dmSent: true,
    reason: '',
  };
}

module.exports = {
  extractDonorName,
  buildEntryKey,
  processCorporationDonationAlerts,
};
