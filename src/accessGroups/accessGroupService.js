const {
  listAccessGroups,
  getAccessGroup,
} = require('./accessGroupRepository');
const {
  listAccessGroupRequests,
  getAccessGroupRequest,
  createAccessGroupRequest,
  updateAccessGroupRequest,
} = require('./accessGroupRequestRepository');
const {
  grantManagedRole,
  removeManagedRole,
} = require('../roles/managedRoleService');

function getMemberRoleIds(member) {
  if (!member?.roles?.cache) return [];
  const everyoneRoleId = member.guild?.id;
  return [...member.roles.cache.keys()].filter((roleId) => roleId !== everyoneRoleId);
}

function evaluateEligibility(group, memberOrRoleIds) {
  const roleIds = Array.isArray(memberOrRoleIds)
    ? memberOrRoleIds.map(String)
    : getMemberRoleIds(memberOrRoleIds);
  const roleSet = new Set(roleIds);
  const requireAll = group?.eligibility?.requireAllRoleIds || [];
  const requireAny = group?.eligibility?.requireAnyRoleIds || [];
  const forbidden = group?.eligibility?.forbiddenRoleIds || [];

  const missingAllRoleIds = requireAll.filter((roleId) => !roleSet.has(roleId));
  const hasAnyRequiredRole = requireAny.length === 0 || requireAny.some((roleId) => roleSet.has(roleId));
  const presentForbiddenRoleIds = forbidden.filter((roleId) => roleSet.has(roleId));

  return {
    eligible:
      missingAllRoleIds.length === 0 &&
      hasAnyRequiredRole &&
      presentForbiddenRoleIds.length === 0,
    roleIds,
    missingAllRoleIds,
    missingAnyRoleIds: hasAnyRequiredRole ? [] : [...requireAny],
    presentForbiddenRoleIds,
  };
}

function isOwner(config, discordUserId) {
  return (config?.discord?.ownerIds || []).includes(String(discordUserId));
}

function canApproveGroup(config, member, group) {
  if (isOwner(config, member?.id || member?.user?.id)) return true;
  const roleSet = new Set(getMemberRoleIds(member));
  return (group?.approval?.approverRoleIds || []).some((roleId) => roleSet.has(roleId));
}

async function listGroupAvailability(storageRoot, member) {
  const groups = await listAccessGroups(storageRoot, { enabledOnly: true });
  return groups.map((group) => ({
    group,
    eligibility: evaluateEligibility(group, member),
  }));
}

async function requestAccessGroup(storageRoot, member, groupId) {
  const group = await getAccessGroup(storageRoot, groupId);
  if (!group || !group.enabled) throw new Error(`Access group ${groupId} is not available.`);
  if (!group.grantRoleIds.length) throw new Error(`Access group ${group.id} has no grant roles configured.`);

  const eligibility = evaluateEligibility(group, member);
  if (!eligibility.eligible) {
    const reasons = [];
    if (eligibility.missingAllRoleIds.length) {
      reasons.push(`missing required roles: ${eligibility.missingAllRoleIds.join(', ')}`);
    }
    if (eligibility.missingAnyRoleIds.length) {
      reasons.push(`requires at least one role from: ${eligibility.missingAnyRoleIds.join(', ')}`);
    }
    if (eligibility.presentForbiddenRoleIds.length) {
      reasons.push(`has forbidden roles: ${eligibility.presentForbiddenRoleIds.join(', ')}`);
    }
    throw new Error(`You are not eligible for access group ${group.name}: ${reasons.join('; ')}.`);
  }

  const alreadyHasAllGrantedRoles = group.grantRoleIds.every((roleId) => member.roles.cache.has(roleId));
  if (alreadyHasAllGrantedRoles) {
    throw new Error(`You already have all Discord roles granted by access group ${group.name}.`);
  }

  const existingPending = await listAccessGroupRequests(storageRoot, {
    groupId: group.id,
    discordUserId: member.id,
    status: 'pending',
  });
  if (existingPending.length > 0) {
    throw new Error(`You already have a pending request for access group ${group.name}: ${existingPending[0].id}.`);
  }

  return createAccessGroupRequest(storageRoot, {
    groupId: group.id,
    corporationId: group.corporationId || '',
    discordUserId: member.id,
    discordTag: member.user?.tag || member.user?.username || member.displayName || member.id,
    eligibilityRoleIds: eligibility.roleIds,
  });
}

async function listPendingRequestsForApprover(storageRoot, config, member) {
  const pending = await listAccessGroupRequests(storageRoot, { status: 'pending' });
  const result = [];

  for (const request of pending) {
    const group = await getAccessGroup(storageRoot, request.groupId);
    if (!group) continue;
    if (!canApproveGroup(config, member, group)) continue;
    result.push({ request, group });
  }

  return result;
}

async function approveAccessGroupRequest(storageRoot, config, guild, approverMember, requestId) {
  const request = await getAccessGroupRequest(storageRoot, requestId);
  if (!request) throw new Error(`Access group request ${requestId} does not exist.`);
  if (request.status !== 'pending') throw new Error(`Access group request ${request.id} is already ${request.status}.`);

  const group = await getAccessGroup(storageRoot, request.groupId);
  if (!group) throw new Error(`Access group ${request.groupId} no longer exists.`);
  if (!canApproveGroup(config, approverMember, group)) {
    throw new Error(`You are not allowed to approve access group ${group.name}.`);
  }

  const approverId = String(approverMember.id || approverMember.user?.id || '');
  if (request.approvals.some((approval) => approval.discordUserId === approverId)) {
    throw new Error(`You have already approved request ${request.id}.`);
  }

  const targetMember = await guild.members.fetch(request.discordUserId).catch(() => null);
  if (!targetMember) throw new Error(`Discord member ${request.discordUserId} is no longer on this server.`);

  const eligibility = evaluateEligibility(group, targetMember);
  if (!eligibility.eligible) {
    throw new Error(`Request ${request.id} can no longer be approved because the member is no longer eligible for ${group.name}.`);
  }

  const now = new Date().toISOString();
  const approval = {
    discordUserId: approverId,
    discordTag: approverMember.user?.tag || approverMember.user?.username || approverId,
    approvedAt: now,
  };
  const approvals = [...request.approvals, approval];
  const reachesThreshold = approvals.length >= group.approval.requiredApprovals;

  if (reachesThreshold) {
    for (const roleId of group.grantRoleIds) {
      await grantManagedRole(targetMember, roleId, {
        reason: `CorpDB access group ${group.id} approved via request ${request.id}`,
      });
    }
  }

  const updated = await updateAccessGroupRequest(storageRoot, request.id, {
    approvals,
    status: reachesThreshold ? 'approved' : 'pending',
    approvedAt: reachesThreshold ? now : '',
    reviewedAt: reachesThreshold ? now : request.reviewedAt,
    events: [
      ...request.events,
      {
        type: reachesThreshold ? 'approved-final' : 'approved-partial',
        at: now,
        discordUserId: approverId,
        discordTag: approval.discordTag,
        note: `${approvals.length}/${group.approval.requiredApprovals}`,
      },
    ],
  });

  return {
    request: updated,
    group,
    targetMember,
    approvalsCount: approvals.length,
    requiredApprovals: group.approval.requiredApprovals,
    finalized: reachesThreshold,
  };
}

async function rejectAccessGroupRequest(storageRoot, config, approverMember, requestId, note = '') {
  const request = await getAccessGroupRequest(storageRoot, requestId);
  if (!request) throw new Error(`Access group request ${requestId} does not exist.`);
  if (request.status !== 'pending') throw new Error(`Access group request ${request.id} is already ${request.status}.`);

  const group = await getAccessGroup(storageRoot, request.groupId);
  if (!group) throw new Error(`Access group ${request.groupId} no longer exists.`);
  if (!canApproveGroup(config, approverMember, group)) {
    throw new Error(`You are not allowed to reject access group ${group.name}.`);
  }

  const now = new Date().toISOString();
  const reviewerId = String(approverMember.id || approverMember.user?.id || '');
  const reviewerTag = approverMember.user?.tag || approverMember.user?.username || reviewerId;
  const updated = await updateAccessGroupRequest(storageRoot, request.id, {
    status: 'rejected',
    rejectedAt: now,
    reviewedAt: now,
    events: [
      ...request.events,
      {
        type: 'rejected',
        at: now,
        discordUserId: reviewerId,
        discordTag: reviewerTag,
        note: String(note || '').trim(),
      },
    ],
  });

  return { request: updated, group };
}

async function revokeAccessGroup(storageRoot, config, guild, reviewerMember, groupId, discordUserId, note = '') {
  const group = await getAccessGroup(storageRoot, groupId);
  if (!group) throw new Error(`Access group ${groupId} does not exist.`);
  if (!canApproveGroup(config, reviewerMember, group)) {
    throw new Error(`You are not allowed to revoke access group ${group.name}.`);
  }

  const targetMember = await guild.members.fetch(String(discordUserId)).catch(() => null);
  if (!targetMember) throw new Error(`Discord member ${discordUserId} is no longer on this server.`);

  for (const roleId of group.grantRoleIds) {
    await removeManagedRole(targetMember, roleId, {
      reason: `CorpDB access group ${group.id} revoked`,
    });
  }

  const approved = await listAccessGroupRequests(storageRoot, {
    groupId: group.id,
    discordUserId: targetMember.id,
    status: 'approved',
  });
  const latest = approved.sort((a, b) => Date.parse(b.approvedAt || 0) - Date.parse(a.approvedAt || 0))[0];
  if (!latest) return { group, targetMember, request: null };

  const now = new Date().toISOString();
  const reviewerId = String(reviewerMember.id || reviewerMember.user?.id || '');
  const reviewerTag = reviewerMember.user?.tag || reviewerMember.user?.username || reviewerId;
  const updated = await updateAccessGroupRequest(storageRoot, latest.id, {
    status: 'revoked',
    revokedAt: now,
    reviewedAt: now,
    events: [
      ...latest.events,
      {
        type: 'revoked',
        at: now,
        discordUserId: reviewerId,
        discordTag: reviewerTag,
        note: String(note || '').trim(),
      },
    ],
  });

  return { group, targetMember, request: updated };
}

module.exports = {
  getMemberRoleIds,
  evaluateEligibility,
  canApproveGroup,
  listGroupAvailability,
  requestAccessGroup,
  listPendingRequestsForApprover,
  approveAccessGroupRequest,
  rejectAccessGroupRequest,
  revokeAccessGroup,
};
