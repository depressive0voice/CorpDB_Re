const { randomUUID } = require('crypto');
const { createStoragePaths } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');
const { normalizeGroupId } = require('./accessGroupRepository');

const REQUEST_STATUSES = Object.freeze(['pending', 'approved', 'rejected', 'revoked', 'cancelled']);

function createDefaultAccessGroupRequestsState() {
  return {
    version: 1,
    requests: [],
  };
}

function normalizeApproval(value) {
  return {
    discordUserId: String(value?.discordUserId ?? '').trim(),
    discordTag: String(value?.discordTag ?? '').trim(),
    approvedAt: String(value?.approvedAt ?? '').trim(),
  };
}

function normalizeEvent(value) {
  return {
    type: String(value?.type ?? '').trim(),
    at: String(value?.at ?? '').trim(),
    discordUserId: String(value?.discordUserId ?? '').trim(),
    discordTag: String(value?.discordTag ?? '').trim(),
    note: String(value?.note ?? '').trim(),
  };
}

function normalizeRequest(value) {
  const status = REQUEST_STATUSES.includes(value?.status) ? value.status : 'pending';
  return {
    id: String(value?.id ?? '').trim(),
    groupId: normalizeGroupId(value?.groupId),
    discordUserId: String(value?.discordUserId ?? '').trim(),
    discordTag: String(value?.discordTag ?? '').trim(),
    corporationId: String(value?.corporationId ?? '').trim(),
    status,
    requestedAt: String(value?.requestedAt ?? '').trim(),
    reviewedAt: String(value?.reviewedAt ?? '').trim(),
    approvedAt: String(value?.approvedAt ?? '').trim(),
    rejectedAt: String(value?.rejectedAt ?? '').trim(),
    revokedAt: String(value?.revokedAt ?? '').trim(),
    approvals: (Array.isArray(value?.approvals) ? value.approvals : []).map(normalizeApproval),
    eligibilityRoleIds: [...new Set((Array.isArray(value?.eligibilityRoleIds) ? value.eligibilityRoleIds : []).map(String))],
    events: (Array.isArray(value?.events) ? value.events : []).map(normalizeEvent),
  };
}

function normalizeState(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : createDefaultAccessGroupRequestsState();
  return {
    version: 1,
    requests: (Array.isArray(source.requests) ? source.requests : []).map(normalizeRequest),
  };
}

async function readAccessGroupRequestsState(storageRoot) {
  const paths = createStoragePaths(storageRoot);
  const raw = await readJson(paths.accessGroupRequestsFile, {
    defaultFactory: createDefaultAccessGroupRequestsState,
  });
  return normalizeState(raw);
}

async function writeAccessGroupRequestsState(storageRoot, value) {
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeState(value);
  await writeJsonAtomic(paths.accessGroupRequestsFile, normalized);
  return normalized;
}

async function listAccessGroupRequests(storageRoot, options = {}) {
  const state = await readAccessGroupRequestsState(storageRoot);
  return state.requests.filter((request) => {
    if (options.status && request.status !== options.status) return false;
    if (options.groupId && request.groupId !== normalizeGroupId(options.groupId)) return false;
    if (options.discordUserId && request.discordUserId !== String(options.discordUserId)) return false;
    return true;
  });
}

async function getAccessGroupRequest(storageRoot, requestId) {
  const id = String(requestId ?? '').trim();
  if (!id) throw new Error('Access group request ID is required.');
  const state = await readAccessGroupRequestsState(storageRoot);
  return state.requests.find((request) => request.id === id) || null;
}

async function createAccessGroupRequest(storageRoot, value) {
  const state = await readAccessGroupRequestsState(storageRoot);
  const now = new Date().toISOString();
  const request = normalizeRequest({
    ...value,
    id: value?.id || randomUUID(),
    status: 'pending',
    requestedAt: value?.requestedAt || now,
    events: [
      ...(Array.isArray(value?.events) ? value.events : []),
      {
        type: 'requested',
        at: now,
        discordUserId: String(value?.discordUserId ?? '').trim(),
        discordTag: String(value?.discordTag ?? '').trim(),
        note: '',
      },
    ],
  });
  state.requests.push(request);
  await writeAccessGroupRequestsState(storageRoot, state);
  return request;
}

async function updateAccessGroupRequest(storageRoot, requestId, updater) {
  const id = String(requestId ?? '').trim();
  const state = await readAccessGroupRequestsState(storageRoot);
  const index = state.requests.findIndex((request) => request.id === id);
  if (index < 0) throw new Error(`Access group request ${id} does not exist.`);

  const previous = state.requests[index];
  const patch = typeof updater === 'function' ? updater({ ...previous }) : updater;
  const next = normalizeRequest({ ...previous, ...(patch || {}), id: previous.id });
  state.requests[index] = next;
  await writeAccessGroupRequestsState(storageRoot, state);
  return next;
}

async function deleteAccessGroupRequests(storageRoot, groupId) {
  const id = normalizeGroupId(groupId);
  const state = await readAccessGroupRequestsState(storageRoot);
  const before = state.requests.length;
  state.requests = state.requests.filter((request) => request.groupId !== id);
  const deletedCount = before - state.requests.length;
  await writeAccessGroupRequestsState(storageRoot, state);
  return deletedCount;
}

module.exports = {
  REQUEST_STATUSES,
  createDefaultAccessGroupRequestsState,
  readAccessGroupRequestsState,
  writeAccessGroupRequestsState,
  listAccessGroupRequests,
  getAccessGroupRequest,
  createAccessGroupRequest,
  updateAccessGroupRequest,
  deleteAccessGroupRequests,
};