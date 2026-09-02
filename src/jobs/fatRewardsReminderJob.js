const { listEnabledActivityCorporationIds } = require('../activity/activityCorporationService');
const {
  readFatSummaryState,
  markFatSummaryReminderSent,
} = require('../activity/fatSummaryRepository');
const { readCorporationProfile } = require('../corporations/corporationProfileRepository');
const { MODULE_KEYS, isModuleEnabled } = require('../modules/moduleConfigRepository');
const { filterCorporationIds } = require('./jobCorporationSelection');

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_COOLDOWN_MS = DAY_MS;

function parseDate(value) {
  const parsed = Date.parse(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

async function executeCorporationReminder(config, client, corporationId, now = new Date()) {
  const storageRoot = config.storage.rootDir;
  const state = await readFatSummaryState(storageRoot, corporationId);
  const uploadedAtMs = parseDate(state.uploadedAt);
  if (!uploadedAtMs || !state.latestFileName) return { action: 'skipped', code: 'fat_summary_missing' };
  if (!state.reminderChannelId) return { action: 'skipped', code: 'reminder_channel_missing' };
  const reminderAfterDays = Math.max(1, Number(state.reminderAfterDays) || 31);
  const ageMs = now.getTime() - uploadedAtMs;
  if (ageMs < reminderAfterDays * DAY_MS) {
    return { action: 'skipped', code: 'fat_summary_fresh', ageDays: ageMs / DAY_MS, reminderAfterDays };
  }
  const lastReminderAtMs = parseDate(state.lastReminderAt);
  if (lastReminderAtMs && now.getTime() - lastReminderAtMs < REMINDER_COOLDOWN_MS) {
    return { action: 'skipped', code: 'reminder_cooldown' };
  }
  const channel = await client.channels.fetch(state.reminderChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return { action: 'failed', code: 'reminder_channel_unavailable' };
  const profile = await readCorporationProfile(storageRoot, corporationId, { createIfMissing: false }).catch(() => null);
  const corporation = profile?.name
    ? `${profile.name}${profile.ticker ? ` [${profile.ticker}]` : ''}`
    : corporationId;
  const ageDays = Math.floor(ageMs / DAY_MS);
  const uploadedTimestamp = Math.floor(uploadedAtMs / 1000);
  const message = await channel.send({
    content: [
      `**FAT Summary needs an update — ${corporation}**`,
      `Last file: **${state.latestFileName}**`,
      `Uploaded: <t:${uploadedTimestamp}:F> (<t:${uploadedTimestamp}:R>)`,
      `Age: **${ageDays} days**; reminder threshold: **${reminderAfterDays} days**.`,
      'Upload the next closed-month file with `/fat-rewards import` or `/fat-rewards calculate`.',
    ].join('\n'),
  });
  await markFatSummaryReminderSent(storageRoot, corporationId, state.uploadedAt, now.toISOString());
  return {
    action: 'sent',
    code: '',
    corporationId,
    messageId: message.id,
    channelId: channel.id,
    ageDays,
    reminderAfterDays,
  };
}

async function runFatRewardsReminderJob(config, client, options = {}) {
  const storageRoot = config.storage.rootDir;
  if (!(await isModuleEnabled(storageRoot, MODULE_KEYS.FAT_REWARDS))) {
    return { enabled: false, reason: 'module-disabled', results: [] };
  }
  const corporationIds = filterCorporationIds(
    await listEnabledActivityCorporationIds(storageRoot),
    options.corporationId
  );
  const results = [];
  for (const corporationId of corporationIds) {
    try {
      results.push({ corporationId, ...(await executeCorporationReminder(config, client, corporationId, options.now || new Date())) });
    } catch (error) {
      console.error(`[jobs:fat-rewards] corporation=${corporationId} failed:`, error?.stack || error);
      results.push({ corporationId, action: 'failed', code: error?.code || 'error', error: error?.message || String(error) });
    }
  }
  return { enabled: true, results };
}

function startFatRewardsReminderJob(config, client) {
  if (!config.jobs.enabled || !config.jobs.fatRewardsReminderEnabled) {
    console.log('[jobs:fat-rewards] reminder job disabled');
    return null;
  }
  const intervalMs = config.jobs.fatRewardsReminderIntervalMinutes * 60 * 1000;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runFatRewardsReminderJob(config, client);
      if (!result.enabled) {
        console.log('[jobs:fat-rewards] skipped module-disabled');
        return;
      }
      const sent = result.results.filter((item) => item.action === 'sent').length;
      console.log(`[jobs:fat-rewards] corporations=${result.results.length} reminders=${sent}`);
    } finally {
      running = false;
    }
  };
  tick().catch((error) => console.error('[jobs:fat-rewards] initial run failed:', error?.stack || error));
  const timer = setInterval(() => {
    tick().catch((error) => console.error('[jobs:fat-rewards] timer failed:', error?.stack || error));
  }, intervalMs);
  console.log(`[jobs:fat-rewards] enabled interval=${config.jobs.fatRewardsReminderIntervalMinutes}m`);
  return { stop: () => clearInterval(timer), runNow: tick };
}

module.exports = {
  executeCorporationReminder,
  runFatRewardsReminderJob,
  startFatRewardsReminderJob,
};
