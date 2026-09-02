const { readDiscordGuildBinding } = require('../discord/discordGuildBindingRepository');
const { processProbationExpirations } = require('../onboarding/promotionService');

async function runPromotionJob(config, client) {
  const binding = await readDiscordGuildBinding(config.storage.rootDir);
  if (!binding.guildId) {
    return { enabled: false, reason: 'guild_binding_missing', createdCount: 0 };
  }

  const guild = client.guilds.cache.get(binding.guildId)
    || await client.guilds.fetch(binding.guildId).catch(() => null);
  if (!guild) {
    return { enabled: false, reason: 'guild_unavailable', createdCount: 0 };
  }

  return processProbationExpirations({
    config,
    storageRoot: config.storage.rootDir,
    guild,
  });
}

function startPromotionJob(config, client, options = {}) {
  if (!config.jobs.enabled || !config.jobs.promotionEnabled) {
    return { enabled: false, stop() {}, run: async () => ({ enabled: false }) };
  }

  const intervalMinutes = config.jobs.promotionCheckIntervalMinutes;
  const intervalMs = intervalMinutes * 60_000;
  let running = false;
  let stopped = false;

  async function run() {
    if (running || stopped) return null;
    running = true;
    try {
      const result = await runPromotionJob(config, client);
      if (result?.enabled && result.createdCount > 0) {
        console.log(`[jobs:promotion] created=${result.createdCount} eligible=${result.eligibleCount} skipped=${result.skippedCount}`);
      }
      return result;
    } catch (error) {
      console.error('[jobs:promotion] failed:', error?.stack || error);
      return { enabled: true, failed: true, error: error?.message || String(error) };
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => void run(), intervalMs);
  timer.unref?.();
  console.log(`[jobs:promotion] enabled interval=${intervalMinutes}m`);

  if (options.runImmediately !== false) {
    setImmediate(() => void run());
  }

  return {
    enabled: true,
    run,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

module.exports = {
  runPromotionJob,
  startPromotionJob,
};
