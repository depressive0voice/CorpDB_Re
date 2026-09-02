const { readRoleExpiryConfig } = require('../roleExpiry/roleExpiryConfigRepository');
const {
  handleRoleExpiryMemberUpdate,
  handleRoleExpiryMemberRemove,
  runRoleExpirySweep,
} = require('../roleExpiry/roleExpiryService');

async function runRoleExpiryJob(config, client, options = {}) {
  return runRoleExpirySweep(config, client, options);
}

async function startRoleExpiryJob(config, client) {
  if (!config.jobs?.enabled) {
    console.log('[jobs:role-expiry] disabled because background jobs are disabled');
    return null;
  }
  const storageRoot = config.storage.rootDir;
  const policy = await readRoleExpiryConfig(storageRoot);
  const intervalMinutes = policy.checkIntervalMinutes;
  const intervalMs = intervalMinutes * 60 * 1000;
  let running = false;

  const onMemberUpdate = (oldMember, newMember) => {
    handleRoleExpiryMemberUpdate(storageRoot, oldMember, newMember).catch((error) => {
      console.error(`[role-expiry] member update failed for ${newMember?.id || oldMember?.id || 'unknown'}:`, error?.stack || error);
    });
  };
  const onMemberRemove = (member) => {
    handleRoleExpiryMemberRemove(storageRoot, member).catch((error) => {
      console.error(`[role-expiry] member remove failed for ${member?.id || 'unknown'}:`, error?.stack || error);
    });
  };
  client?.on?.('guildMemberUpdate', onMemberUpdate);
  client?.on?.('guildMemberRemove', onMemberRemove);

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runRoleExpiryJob(config, client);
      if (!result.enabled) {
        console.log(`[jobs:role-expiry] skipped ${result.reason || 'disabled'}`);
      } else if (!result.configured) {
        console.log('[jobs:role-expiry] policy incomplete; no enforcement');
      } else {
        console.log(
          `[jobs:role-expiry] candidates=${result.candidateCount || 0} overdue=${result.overdueCount || 0} kicked=${result.kickedCount || 0} failed=${result.failedCount || 0}`
        );
      }
    } finally {
      running = false;
    }
  };

  tick().catch((error) => console.error('[jobs:role-expiry] initial run failed:', error?.stack || error));
  const timer = setInterval(() => {
    tick().catch((error) => console.error('[jobs:role-expiry] timer failed:', error?.stack || error));
  }, intervalMs);
  console.log(`[jobs:role-expiry] enabled interval=${intervalMinutes}m`);
  return {
    enabled: true,
    intervalMinutes,
    stop: () => {
      clearInterval(timer);
      client?.off?.('guildMemberUpdate', onMemberUpdate);
      client?.off?.('guildMemberRemove', onMemberRemove);
    },
    runNow: tick,
  };
}

module.exports = {
  runRoleExpiryJob,
  startRoleExpiryJob,
};
