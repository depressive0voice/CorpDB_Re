const { createStoragePaths } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

function normalizeText(value) {
  return String(value ?? '').trim();
}

function createDefaultPromotionState() {
  return {
    version: 1,
    requests: [],
  };
}

function normalizePromotionRequest(value = {}) {
  return {
    id: normalizeText(value.id),
    mainName: normalizeText(value.mainName),
    discordUserId: normalizeText(value.discordUserId),
    discordTag: normalizeText(value.discordTag),
    onboardingProfileId: normalizeText(value.onboardingProfileId).toLowerCase(),
    corporationIds: [...new Set((Array.isArray(value.corporationIds) ? value.corporationIds : [])
      .map((item) => normalizeText(item))
      .filter(Boolean))],
    probationStartedAt: normalizeText(value.probationStartedAt),
    eligibleAt: normalizeText(value.eligibleAt),
    status: normalizeText(value.status) || 'pending',
    requestedAt: normalizeText(value.requestedAt),
    channelId: normalizeText(value.channelId),
    messageId: normalizeText(value.messageId),
    reviewedAt: normalizeText(value.reviewedAt),
    reviewedByUserId: normalizeText(value.reviewedByUserId),
    reviewedByTag: normalizeText(value.reviewedByTag),
    assignedRoleId: normalizeText(value.assignedRoleId),
  };
}

function normalizePromotionState(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : createDefaultPromotionState();
  return {
    version: 1,
    requests: (Array.isArray(source.requests) ? source.requests : [])
      .map(normalizePromotionRequest)
      .filter((request) => request.id && request.mainName && request.discordUserId),
  };
}

async function readPromotionState(storageRoot) {
  const paths = createStoragePaths(storageRoot);
  const raw = await readJson(paths.promotionStateInstanceFile, {
    defaultFactory: createDefaultPromotionState,
  });
  return normalizePromotionState(raw);
}

async function writePromotionState(storageRoot, value) {
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizePromotionState(value);
  await writeJsonAtomic(paths.promotionStateInstanceFile, normalized);
  return normalized;
}

async function listPromotionRequests(storageRoot) {
  return [...(await readPromotionState(storageRoot)).requests];
}

async function findPromotionRequestById(storageRoot, requestId) {
  const id = normalizeText(requestId);
  return (await listPromotionRequests(storageRoot)).find((request) => request.id === id) || null;
}

async function findPromotionRequestByMainName(storageRoot, mainName) {
  const key = normalizeText(mainName).toLowerCase();
  return (await listPromotionRequests(storageRoot)).find(
    (request) => request.mainName.toLowerCase() === key
  ) || null;
}

async function createPromotionRequest(storageRoot, value) {
  const request = normalizePromotionRequest(value);
  const state = await readPromotionState(storageRoot);
  if (state.requests.some((entry) => entry.id === request.id)) {
    throw new Error(`Promotion request ${request.id} already exists.`);
  }
  state.requests.push(request);
  await writePromotionState(storageRoot, state);
  return request;
}

async function updatePromotionRequestById(storageRoot, requestId, patch = {}) {
  const state = await readPromotionState(storageRoot);
  const index = state.requests.findIndex((request) => request.id === normalizeText(requestId));
  if (index < 0) return null;
  state.requests[index] = normalizePromotionRequest({ ...state.requests[index], ...patch });
  await writePromotionState(storageRoot, state);
  return state.requests[index];
}

module.exports = {
  createDefaultPromotionState,
  normalizePromotionRequest,
  normalizePromotionState,
  readPromotionState,
  writePromotionState,
  listPromotionRequests,
  findPromotionRequestById,
  findPromotionRequestByMainName,
  createPromotionRequest,
  updatePromotionRequestById,
};
