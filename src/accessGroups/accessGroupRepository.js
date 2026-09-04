const { createStoragePaths, normalizeCorporationId } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

const GROUP_SCOPES = Object.freeze(['instance', 'corporation']);
const REVOKE_POLICIES = Object.freeze(['manual', 'prerequisite-loss', 'corporation-leave']);

function createDefaultAccessGroupsState() {
  return {
    version: 1,
    groups: [],
  };
}

function normalizeGroupId(value) {
  const id = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) {
    throw new Error('Access group ID must be 1-64 characters using a-z, 0-9, _ or -.');
  }
  return id;
}

function normalizeRoleIds(values) {
  const list = Array.isArray(values) ? values : [];
  const result = [];
  const seen = new Set();
  for (const value of list) {
    const roleId = String(value ?? '').trim();
    if (!roleId) continue;
    if (!/^\d{5,25}$/.test(roleId)) throw new Error(`Invalid Discord role ID: ${roleId}.`);
    if (seen.has(roleId)) continue;
    seen.add(roleId);
    result.push(roleId);
  }
  return result;
}

function normalizeAccessGroup(value) {
  const scope = GROUP_SCOPES.includes(value?.scope) ? value.scope : 'instance';
  const corporationId = scope === 'corporation'
    ? normalizeCorporationId(value?.corporationId)
    : null;
  const requiredApprovals = Number(value?.approval?.requiredApprovals ?? 1);

  if (!Number.isInteger(requiredApprovals) || requiredApprovals < 1 || requiredApprovals > 10) {
    throw new Error('Access group requiredApprovals must be an integer between 1 and 10.');
  }

  const revokePolicy = REVOKE_POLICIES.includes(value?.revokePolicy)
    ? value.revokePolicy
    : 'manual';

  return {
    id: normalizeGroupId(value?.id),
    name: String(value?.name ?? '').trim() || normalizeGroupId(value?.id),
    description: String(value?.description ?? '').trim(),
    enabled: value?.enabled === undefined ? true : Boolean(value.enabled),
    scope,
    corporationId,
    grantRoleIds: normalizeRoleIds(value?.grantRoleIds),
    eligibility: {
      requireAllRoleIds: normalizeRoleIds(value?.eligibility?.requireAllRoleIds),
      requireAnyRoleIds: normalizeRoleIds(value?.eligibility?.requireAnyRoleIds),
      forbiddenRoleIds: normalizeRoleIds(value?.eligibility?.forbiddenRoleIds),
    },
    approval: {
      approverRoleIds: normalizeRoleIds(value?.approval?.approverRoleIds),
      requiredApprovals,
    },
    revokePolicy,
    createdAt: String(value?.createdAt ?? '').trim(),
    updatedAt: String(value?.updatedAt ?? '').trim(),
  };
}

function normalizeState(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : createDefaultAccessGroupsState();
  const groups = [];
  const seen = new Set();

  for (const raw of Array.isArray(source.groups) ? source.groups : []) {
    const group = normalizeAccessGroup(raw);
    if (seen.has(group.id)) continue;
    seen.add(group.id);
    groups.push(group);
  }

  return { version: 1, groups };
}

async function readAccessGroupsState(storageRoot) {
  const paths = createStoragePaths(storageRoot);
  const raw = await readJson(paths.accessGroupsFile, {
    defaultFactory: createDefaultAccessGroupsState,
  });
  return normalizeState(raw);
}

async function writeAccessGroupsState(storageRoot, value) {
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeState(value);
  await writeJsonAtomic(paths.accessGroupsFile, normalized);
  return normalized;
}

async function listAccessGroups(storageRoot, options = {}) {
  const state = await readAccessGroupsState(storageRoot);
  return options.enabledOnly ? state.groups.filter((group) => group.enabled) : state.groups;
}

async function getAccessGroup(storageRoot, groupId) {
  const id = normalizeGroupId(groupId);
  const groups = await listAccessGroups(storageRoot);
  return groups.find((group) => group.id === id) || null;
}

async function createAccessGroup(storageRoot, value) {
  const state = await readAccessGroupsState(storageRoot);
  const now = new Date().toISOString();
  const group = normalizeAccessGroup({ ...value, createdAt: now, updatedAt: now });
  if (state.groups.some((item) => item.id === group.id)) {
    throw new Error(`Access group ${group.id} already exists.`);
  }
  state.groups.push(group);
  await writeAccessGroupsState(storageRoot, state);
  return group;
}

async function updateAccessGroup(storageRoot, groupId, patch) {
  const id = normalizeGroupId(groupId);
  const state = await readAccessGroupsState(storageRoot);
  const index = state.groups.findIndex((group) => group.id === id);
  if (index < 0) throw new Error(`Access group ${id} does not exist.`);

  const previous = state.groups[index];
  const merged = {
    ...previous,
    ...patch,
    eligibility: {
      ...previous.eligibility,
      ...(patch?.eligibility || {}),
    },
    approval: {
      ...previous.approval,
      ...(patch?.approval || {}),
    },
    id: previous.id,
    createdAt: previous.createdAt,
    updatedAt: new Date().toISOString(),
  };
  const next = normalizeAccessGroup(merged);
  state.groups[index] = next;
  await writeAccessGroupsState(storageRoot, state);
  return next;
}

async function deleteAccessGroup(storageRoot, groupId) {
  const id = normalizeGroupId(groupId);
  const state = await readAccessGroupsState(storageRoot);
  const index = state.groups.findIndex((group) => group.id === id);
  if (index < 0) throw new Error(`Access group ${id} does not exist.`);

  const [deleted] = state.groups.splice(index, 1);
  await writeAccessGroupsState(storageRoot, state);
  return deleted;
}

module.exports = {
  GROUP_SCOPES,
  REVOKE_POLICIES,
  createDefaultAccessGroupsState,
  normalizeGroupId,
  normalizeAccessGroup,
  readAccessGroupsState,
  writeAccessGroupsState,
  listAccessGroups,
  getAccessGroup,
  createAccessGroup,
  updateAccessGroup,
  deleteAccessGroup,
};