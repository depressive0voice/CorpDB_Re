const { createStoragePaths } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function createDefaultMainBindingState() {
  return {
    version: 1,
    config: {
      approvalChannelId: '',
    },
    bindings: [],
    requests: [],
  };
}

function normalizeMainBindingState(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};

  return {
    version: 1,
    config: {
      approvalChannelId: normalizeText(source.config?.approvalChannelId),
    },
    bindings: Array.isArray(source.bindings) ? source.bindings : [],
    requests: Array.isArray(source.requests) ? source.requests : [],
  };
}

async function readMainBindingState(storageRoot) {
  const paths = createStoragePaths(storageRoot);
  const value = await readJson(paths.mainBindingsFile, {
    defaultFactory: createDefaultMainBindingState,
  });
  return normalizeMainBindingState(value);
}

async function writeMainBindingState(storageRoot, state) {
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeMainBindingState(state);
  await writeJsonAtomic(paths.mainBindingsFile, normalized);
  return normalized;
}

async function getMainBindingConfig(storageRoot) {
  return (await readMainBindingState(storageRoot)).config;
}

async function updateMainBindingConfig(storageRoot, patch = {}) {
  const state = await readMainBindingState(storageRoot);
  state.config = {
    ...state.config,
    approvalChannelId: Object.prototype.hasOwnProperty.call(patch, 'approvalChannelId')
      ? normalizeText(patch.approvalChannelId)
      : state.config.approvalChannelId,
  };
  return (await writeMainBindingState(storageRoot, state)).config;
}

async function findApprovedBindingByDiscordUserId(storageRoot, discordUserId) {
  const userId = normalizeText(discordUserId);
  const state = await readMainBindingState(storageRoot);
  return state.bindings.find((binding) => normalizeText(binding.discordUserId) === userId) || null;
}

async function findApprovedBindingByMainName(storageRoot, mainName) {
  const key = normalizeKey(mainName);
  const state = await readMainBindingState(storageRoot);
  return state.bindings.find((binding) => normalizeKey(binding.mainName) === key) || null;
}

async function findPendingRequestByDiscordUserId(storageRoot, discordUserId) {
  const userId = normalizeText(discordUserId);
  const state = await readMainBindingState(storageRoot);
  return state.requests.find((request) =>
    normalizeText(request.discordUserId) === userId && normalizeText(request.status) === 'pending'
  ) || null;
}

async function findPendingRequestByMainName(storageRoot, mainName) {
  const key = normalizeKey(mainName);
  const state = await readMainBindingState(storageRoot);
  return state.requests.find((request) =>
    normalizeKey(request.mainName) === key && normalizeText(request.status) === 'pending'
  ) || null;
}

async function findRequestById(storageRoot, requestId) {
  const id = normalizeText(requestId);
  const state = await readMainBindingState(storageRoot);
  return state.requests.find((request) => normalizeText(request.id) === id) || null;
}

async function createPendingRequest(storageRoot, request) {
  const state = await readMainBindingState(storageRoot);
  state.requests.push({ ...request });
  await writeMainBindingState(storageRoot, state);
  return request;
}

async function updateRequestById(storageRoot, requestId, patch) {
  const state = await readMainBindingState(storageRoot);
  const request = state.requests.find((entry) => normalizeText(entry.id) === normalizeText(requestId));
  if (!request) return null;
  Object.assign(request, patch);
  await writeMainBindingState(storageRoot, state);
  return request;
}

async function upsertApprovedBinding(storageRoot, binding) {
  const state = await readMainBindingState(storageRoot);
  const userId = normalizeText(binding.discordUserId);
  const mainKey = normalizeKey(binding.mainName);
  const existing = state.bindings.find((entry) =>
    normalizeText(entry.discordUserId) === userId || normalizeKey(entry.mainName) === mainKey
  );

  if (existing) {
    Object.assign(existing, binding);
    await writeMainBindingState(storageRoot, state);
    return existing;
  }

  const next = { ...binding };
  state.bindings.push(next);
  await writeMainBindingState(storageRoot, state);
  return next;
}

async function listApprovedBindings(storageRoot) {
  const state = await readMainBindingState(storageRoot);
  return [...state.bindings].sort((left, right) =>
    normalizeText(left.mainName).localeCompare(normalizeText(right.mainName))
  );
}

async function listPendingRequests(storageRoot) {
  const state = await readMainBindingState(storageRoot);
  return state.requests
    .filter((request) => normalizeText(request.status) === 'pending')
    .sort((left, right) => normalizeText(left.mainName).localeCompare(normalizeText(right.mainName)));
}

async function removeApprovedBindingByDiscordUserId(storageRoot, discordUserId) {
  const state = await readMainBindingState(storageRoot);
  const index = state.bindings.findIndex((binding) =>
    normalizeText(binding.discordUserId) === normalizeText(discordUserId)
  );
  if (index < 0) return null;
  const [removed] = state.bindings.splice(index, 1);
  await writeMainBindingState(storageRoot, state);
  return removed;
}

async function removeApprovedBindingByMainName(storageRoot, mainName) {
  const state = await readMainBindingState(storageRoot);
  const index = state.bindings.findIndex((binding) => normalizeKey(binding.mainName) === normalizeKey(mainName));
  if (index < 0) return null;
  const [removed] = state.bindings.splice(index, 1);
  await writeMainBindingState(storageRoot, state);
  return removed;
}

module.exports = {
  createDefaultMainBindingState,
  normalizeMainBindingState,
  readMainBindingState,
  writeMainBindingState,
  getMainBindingConfig,
  updateMainBindingConfig,
  findApprovedBindingByDiscordUserId,
  findApprovedBindingByMainName,
  findPendingRequestByDiscordUserId,
  findPendingRequestByMainName,
  findRequestById,
  createPendingRequest,
  updateRequestById,
  upsertApprovedBinding,
  listApprovedBindings,
  listPendingRequests,
  removeApprovedBindingByDiscordUserId,
  removeApprovedBindingByMainName,
};
