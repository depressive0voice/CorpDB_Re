const { AuditLogEvent } = require('discord.js');
const { readDiscordGuildBinding } = require('../discord/discordGuildBindingRepository');
const { MODULE_KEYS } = require('../modules/moduleRegistry');
const { isModuleEnabled } = require('../modules/moduleConfigRepository');
const {
  readRoleExpiryConfig,
  isRoleExpiryConfigured,
} = require('./roleExpiryConfigRepository');
const {
  readRoleExpiryState,
  updateRoleExpiryState,
} = require('./roleExpiryStateRepository');

const DAY_MS = 24 * 60 * 60 * 1000;
const AUDIT_PAGE_LIMIT = 100;
const AUDIT_MAX_PAGES = 5;

function collectionValues(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.values === 'function') return [...value.values()];
  if (typeof value === 'object') return Object.values(value);
  return [];
}

function memberHasRole(member, roleId) {
  if (!roleId || !member?.roles?.cache) return false;
  if (typeof member.roles.cache.has === 'function') return member.roles.cache.has(String(roleId));
  return false;
}

function memberHasQualifyingRole(member, config) {
  return (config.qualifyingRoleIds || []).some((roleId) => memberHasRole(member, roleId));
}

function isExpiryCandidate(member, config) {
  if (!member || member.user?.bot) return false;
  return memberHasRole(member, config.triggerRoleId) && !memberHasQualifyingRole(member, config);
}

function auditAddedRoleIds(entry) {
  const ids = [];
  for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
    if (change?.key !== '$add') continue;
    const added = change.new ?? change.newValue ?? [];
    for (const role of Array.isArray(added) ? added : []) {
      const id = String(role?.id || role?.roleId || '').trim();
      if (id) ids.push(id);
    }
  }
  return ids;
}

function auditEntryTimestamp(entry) {
  if (entry?.createdAt instanceof Date && Number.isFinite(entry.createdAt.getTime())) {
    return entry.createdAt.toISOString();
  }
  if (Number.isFinite(Number(entry?.createdTimestamp))) {
    return new Date(Number(entry.createdTimestamp)).toISOString();
  }
  return '';
}

async function findTriggerRoleAssignmentsInAuditLog(guild, triggerRoleId, userIds, options = {}) {
  const targets = new Set((userIds || []).map((id) => String(id || '').trim()).filter(Boolean));
  const assignments = new Map();
  if (!guild || typeof guild.fetchAuditLogs !== 'function' || !triggerRoleId || targets.size === 0) {
    return { assignments, available: false, error: null };
  }

  const maxPages = Math.max(1, Math.min(AUDIT_MAX_PAGES, Number(options.maxPages) || AUDIT_MAX_PAGES));
  let before;
  try {
    for (let page = 0; page < maxPages && assignments.size < targets.size; page += 1) {
      const logs = await guild.fetchAuditLogs({
        type: AuditLogEvent.MemberRoleUpdate,
        limit: AUDIT_PAGE_LIMIT,
        ...(before ? { before } : {}),
      });
      const entries = collectionValues(logs?.entries);
      if (entries.length === 0) break;
      for (const entry of entries) {
        const targetId = String(entry?.targetId || entry?.target?.id || '').trim();
        if (!targets.has(targetId) || assignments.has(targetId)) continue;
        if (!auditAddedRoleIds(entry).includes(String(triggerRoleId))) continue;
        const assignedAt = auditEntryTimestamp(entry);
        if (assignedAt) assignments.set(targetId, assignedAt);
      }
      before = String(entries[entries.length - 1]?.id || '').trim();
      if (!before || entries.length < AUDIT_PAGE_LIMIT) break;
    }
    return { assignments, available: true, error: null };
  } catch (error) {
    return { assignments, available: false, error };
  }
}

async function fetchAllGuildMembers(guild) {
  const result = await guild.members.fetch();
  return collectionValues(result);
}

async function synchronizeRoleExpiryCandidates(storageRoot, guild, config, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const nowIso = now.toISOString();
  const members = await fetchAllGuildMembers(guild);
  const liveCandidates = new Map(
    members.filter((member) => isExpiryCandidate(member, config)).map((member) => [String(member.id), member])
  );
  const snapshot = await readRoleExpiryState(storageRoot);
  const missingIds = [...liveCandidates.keys()].filter((userId) => !snapshot.candidates[userId]);
  const audit = options.auditBackfill === false
    ? { assignments: new Map(), available: false, error: null }
    : await findTriggerRoleAssignmentsInAuditLog(guild, config.triggerRoleId, missingIds, options);

  let backfilledCount = 0;
  let initializedCount = 0;
  const state = await updateRoleExpiryState(storageRoot, (current) => {
    const candidates = {};
    for (const userId of liveCandidates.keys()) {
      const existing = current.candidates[userId] || snapshot.candidates[userId];
      if (existing?.triggerRoleId === config.triggerRoleId) {
        candidates[userId] = { ...existing, lastSeenAt: nowIso };
        continue;
      }
      const auditAssignedAt = audit.assignments.get(userId);
      if (auditAssignedAt) {
        candidates[userId] = {
          assignedAt: auditAssignedAt,
          triggerRoleId: config.triggerRoleId,
          source: 'audit-log',
          lastSeenAt: nowIso,
        };
        backfilledCount += 1;
      } else {
        candidates[userId] = {
          assignedAt: nowIso,
          triggerRoleId: config.triggerRoleId,
          source: 'fallback-now',
          lastSeenAt: nowIso,
        };
        initializedCount += 1;
      }
    }
    return { version: 1, candidates };
  });

  return {
    state,
    memberCount: members.length,
    candidateCount: liveCandidates.size,
    backfilledCount,
    initializedCount,
    auditAvailable: audit.available,
    auditError: audit.error || null,
  };
}

async function handleRoleExpiryMemberUpdate(storageRoot, oldMember, newMember, options = {}) {
  if (!(await isModuleEnabled(storageRoot, MODULE_KEYS.ROLE_EXPIRY))) {
    return { enabled: false, action: 'module-disabled' };
  }
  const config = await readRoleExpiryConfig(storageRoot);
  if (!config.triggerRoleId) return { enabled: true, action: 'not-configured' };

  const wasCandidate = isExpiryCandidate(oldMember, config);
  const isCandidate = isExpiryCandidate(newMember, config);
  const userId = String(newMember?.id || oldMember?.id || '').trim();
  if (!userId) return { enabled: true, action: 'ignored' };
  const now = options.now instanceof Date ? options.now : new Date();
  const nowIso = now.toISOString();

  if (isCandidate) {
    const state = await updateRoleExpiryState(storageRoot, (current) => ({
      ...current,
      candidates: {
        ...current.candidates,
        [userId]: current.candidates[userId]?.triggerRoleId === config.triggerRoleId
          ? { ...current.candidates[userId], lastSeenAt: nowIso }
          : {
            assignedAt: nowIso,
            triggerRoleId: config.triggerRoleId,
            source: 'guild-member-update',
            lastSeenAt: nowIso,
          },
      },
    }));
    return {
      enabled: true,
      action: wasCandidate ? 'candidate-kept' : 'candidate-added',
      candidate: state.candidates[userId],
    };
  }

  if (wasCandidate || (await readRoleExpiryState(storageRoot)).candidates[userId]) {
    await updateRoleExpiryState(storageRoot, (current) => {
      const candidates = { ...current.candidates };
      delete candidates[userId];
      return { ...current, candidates };
    });
    return { enabled: true, action: 'candidate-removed' };
  }
  return { enabled: true, action: 'ignored' };
}

async function handleRoleExpiryMemberRemove(storageRoot, member) {
  if (!(await isModuleEnabled(storageRoot, MODULE_KEYS.ROLE_EXPIRY))) return { enabled: false };
  const userId = String(member?.id || '').trim();
  if (!userId) return { enabled: true, changed: false };
  let changed = false;
  await updateRoleExpiryState(storageRoot, (current) => {
    if (!current.candidates[userId]) return current;
    const candidates = { ...current.candidates };
    delete candidates[userId];
    changed = true;
    return { ...current, candidates };
  });
  return { enabled: true, changed };
}

async function resolveConfiguredGuild(storageRoot, client, explicitGuild) {
  if (explicitGuild) return explicitGuild;
  const binding = await readDiscordGuildBinding(storageRoot);
  if (!binding.guildId) return null;
  const cached = client?.guilds?.cache?.get?.(binding.guildId);
  if (cached) return cached;
  if (typeof client?.guilds?.fetch === 'function') {
    return client.guilds.fetch(binding.guildId).catch(() => null);
  }
  return null;
}

async function resolveGuildRole(guild, roleId) {
  const cached = guild?.roles?.cache?.get?.(String(roleId));
  if (cached) return cached;
  if (typeof guild?.roles?.fetch === 'function') {
    return guild.roles.fetch(String(roleId)).catch(() => null);
  }
  return null;
}

async function sendExpiryLog(guild, channelId, content) {
  if (!channelId || typeof guild?.channels?.fetch !== 'function') return false;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased?.()) return false;
  await channel.send({ content }).catch(() => null);
  return true;
}

async function removeCandidate(storageRoot, userId) {
  await updateRoleExpiryState(storageRoot, (current) => {
    const candidates = { ...current.candidates };
    delete candidates[String(userId)];
    return { ...current, candidates };
  });
}

async function runRoleExpirySweep(config, client, options = {}) {
  const storageRoot = config.storage.rootDir;
  if (!(await isModuleEnabled(storageRoot, MODULE_KEYS.ROLE_EXPIRY))) {
    return { enabled: false, reason: 'module-disabled', configured: false, results: [] };
  }
  const policy = await readRoleExpiryConfig(storageRoot);
  if (!isRoleExpiryConfigured(policy)) {
    return { enabled: true, configured: false, reason: 'policy-incomplete', results: [] };
  }
  const guild = await resolveConfiguredGuild(storageRoot, client, options.guild);
  if (!guild) {
    return { enabled: true, configured: true, reason: 'guild-unavailable', results: [], failedCount: 1 };
  }

  const triggerRole = await resolveGuildRole(guild, policy.triggerRoleId);
  if (!triggerRole) {
    return { enabled: true, configured: true, reason: 'trigger-role-unavailable', results: [], failedCount: 1 };
  }
  for (const roleId of policy.qualifyingRoleIds) {
    if (!(await resolveGuildRole(guild, roleId))) {
      return {
        enabled: true,
        configured: true,
        reason: 'qualifying-role-unavailable',
        missingRoleId: roleId,
        results: [],
        failedCount: 1,
      };
    }
  }

  const now = options.now instanceof Date ? options.now : new Date();
  const sync = await synchronizeRoleExpiryCandidates(storageRoot, guild, policy, {
    ...options,
    now,
  });
  const results = [];
  let overdueCount = 0;
  let kickedCount = 0;
  let cancelledCount = 0;
  let failedCount = 0;

  for (const [userId, candidate] of Object.entries(sync.state.candidates)) {
    const assignedAtMs = Date.parse(candidate.assignedAt);
    const expiresAtMs = assignedAtMs + policy.timeoutDays * DAY_MS;
    if (!Number.isFinite(expiresAtMs) || now.getTime() < expiresAtMs) continue;
    overdueCount += 1;

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      await removeCandidate(storageRoot, userId);
      cancelledCount += 1;
      results.push({ userId, action: 'removed-missing-member' });
      continue;
    }
    if (!isExpiryCandidate(member, policy)) {
      await removeCandidate(storageRoot, userId);
      cancelledCount += 1;
      results.push({ userId, action: 'cancelled-role-change' });
      continue;
    }
    if (member.kickable === false) {
      failedCount += 1;
      results.push({ userId, action: 'failed', code: 'member-not-kickable' });
      continue;
    }

    const reason = `CorpDB role expiry: role ${policy.triggerRoleId} without qualifying role for ${policy.timeoutDays} day(s)`;
    try {
      if (typeof member.kick === 'function') await member.kick(reason);
      else if (typeof guild.members.kick === 'function') await guild.members.kick(userId, reason);
      else throw new Error('Discord member kick API is unavailable.');
      await removeCandidate(storageRoot, userId);
      kickedCount += 1;
      results.push({ userId, action: 'kicked', assignedAt: candidate.assignedAt });
      await sendExpiryLog(
        guild,
        policy.logChannelId,
        `CorpDB role expiry kicked <@${userId}> after ${policy.timeoutDays} day(s) in <@&${policy.triggerRoleId}> without a qualifying role.`
      );
    } catch (error) {
      failedCount += 1;
      results.push({ userId, action: 'failed', code: error?.code || 'kick-failed', error: error?.message || String(error) });
    }
  }

  return {
    enabled: true,
    configured: true,
    reason: '',
    checkedMembers: sync.memberCount,
    checkedCorporations: sync.memberCount,
    candidateCount: sync.candidateCount,
    overdueCount,
    kickedCount,
    cancelledCount,
    failedCount,
    succeeded: kickedCount + cancelledCount,
    failed: failedCount,
    backfilledCount: sync.backfilledCount,
    initializedCount: sync.initializedCount,
    auditAvailable: sync.auditAvailable,
    results,
  };
}

async function buildRoleExpiryPreview(storageRoot, guild, options = {}) {
  const policy = await readRoleExpiryConfig(storageRoot);
  const state = await readRoleExpiryState(storageRoot);
  const now = options.now instanceof Date ? options.now : new Date();
  const members = await fetchAllGuildMembers(guild);
  const candidates = [];
  for (const member of members) {
    if (!isExpiryCandidate(member, policy)) continue;
    const rawTracked = state.candidates[String(member.id)] || null;
    const tracked = rawTracked?.triggerRoleId === policy.triggerRoleId ? rawTracked : null;
    const assignedAtMs = tracked ? Date.parse(tracked.assignedAt) : NaN;
    const expiresAtMs = Number.isFinite(assignedAtMs) ? assignedAtMs + policy.timeoutDays * DAY_MS : NaN;
    candidates.push({
      userId: String(member.id),
      displayName: member.displayName || member.user?.tag || member.user?.username || String(member.id),
      assignedAt: tracked?.assignedAt || '',
      source: tracked?.source || 'untracked',
      expiresAt: Number.isFinite(expiresAtMs) ? new Date(expiresAtMs).toISOString() : '',
      overdue: Number.isFinite(expiresAtMs) ? now.getTime() >= expiresAtMs : false,
    });
  }
  candidates.sort((a, b) => String(a.expiresAt || '9999').localeCompare(String(b.expiresAt || '9999')));
  return { policy, trackedCount: Object.keys(state.candidates).length, candidates };
}

module.exports = {
  DAY_MS,
  AUDIT_PAGE_LIMIT,
  AUDIT_MAX_PAGES,
  memberHasRole,
  memberHasQualifyingRole,
  isExpiryCandidate,
  auditAddedRoleIds,
  findTriggerRoleAssignmentsInAuditLog,
  synchronizeRoleExpiryCandidates,
  handleRoleExpiryMemberUpdate,
  handleRoleExpiryMemberRemove,
  runRoleExpirySweep,
  buildRoleExpiryPreview,
};
