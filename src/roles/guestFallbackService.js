const { readManagedRolePolicy } = require('./managedRolePolicyRepository');
const { listDiscordManageableRoleIds, grantManagedRole } = require('./managedRoleService');

async function ensureGuestFallbackForMember(storageRoot, member, options = {}) {
  if (!member || member.user?.bot) {
    return { status: 'skipped-bot', changed: false };
  }

  const policy = options.policy || await readManagedRolePolicy(storageRoot);
  const guestRoleId = policy.bindings?.guest || '';
  if (!guestRoleId) {
    return { status: 'disabled', changed: false };
  }

  const manageableRoleIds = listDiscordManageableRoleIds(member);
  if (manageableRoleIds.length > 0) {
    return {
      status: 'has-manageable-role',
      changed: false,
      manageableRoleIds,
    };
  }

  const result = await grantManagedRole(member, guestRoleId, {
    reason: options.reason || 'CorpDB guest fallback: member had no bot-manageable Discord roles',
  });

  return {
    status: result.changed ? 'guest-granted' : 'guest-present',
    changed: result.changed,
    roleId: guestRoleId,
  };
}

async function sweepGuestFallback(storageRoot, guild, options = {}) {
  if (!guild) throw new Error('Discord guild is required for guest fallback sweep.');

  const policy = options.policy || await readManagedRolePolicy(storageRoot);
  const guestRoleId = policy.bindings?.guest || '';
  if (!guestRoleId) {
    return { enabled: false, checkedCount: 0, grantedCount: 0, failedCount: 0, failures: [] };
  }

  const members = await guild.members.fetch();
  let checkedCount = 0;
  let grantedCount = 0;
  let failedCount = 0;
  const failures = [];

  for (const member of members.values()) {
    if (member.user?.bot) continue;
    checkedCount += 1;
    try {
      const result = await ensureGuestFallbackForMember(storageRoot, member, { policy });
      if (result.changed) grantedCount += 1;
    } catch (error) {
      failedCount += 1;
      failures.push({
        discordUserId: member.id,
        error: error?.message || String(error),
      });
    }
  }

  return {
    enabled: true,
    checkedCount,
    grantedCount,
    failedCount,
    failures,
  };
}

module.exports = {
  ensureGuestFallbackForMember,
  sweepGuestFallback,
};
