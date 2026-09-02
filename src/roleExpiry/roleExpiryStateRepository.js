const path = require('path');
const { createStoragePaths } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

const updateQueues = new Map();

function createDefaultRoleExpiryState() {
  return { version: 1, candidates: {} };
}

function normalizeCandidate(value = {}) {
  const assignedAt = String(value.assignedAt || '').trim();
  if (!assignedAt || !Number.isFinite(Date.parse(assignedAt))) return null;
  return {
    assignedAt: new Date(assignedAt).toISOString(),
    triggerRoleId: String(value.triggerRoleId || '').trim(),
    source: String(value.source || 'unknown').trim() || 'unknown',
    lastSeenAt: Number.isFinite(Date.parse(String(value.lastSeenAt || '')))
      ? new Date(value.lastSeenAt).toISOString()
      : '',
  };
}

function normalizeRoleExpiryState(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const candidates = {};
  if (source.candidates && typeof source.candidates === 'object' && !Array.isArray(source.candidates)) {
    for (const [rawUserId, rawCandidate] of Object.entries(source.candidates)) {
      const userId = String(rawUserId || '').trim();
      const candidate = normalizeCandidate(rawCandidate);
      if (userId && candidate) candidates[userId] = candidate;
    }
  }
  return { version: 1, candidates };
}

async function readRoleExpiryState(storageRoot) {
  const paths = createStoragePaths(storageRoot);
  const raw = await readJson(paths.roleExpiryStateFile, { defaultFactory: createDefaultRoleExpiryState });
  return normalizeRoleExpiryState(raw);
}

async function writeRoleExpiryState(storageRoot, value) {
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeRoleExpiryState(value);
  await writeJsonAtomic(paths.roleExpiryStateFile, normalized);
  return normalized;
}

async function updateRoleExpiryState(storageRoot, updater) {
  const key = path.resolve(storageRoot);
  const previous = updateQueues.get(key) || Promise.resolve();
  const operation = previous.catch(() => null).then(async () => {
    const current = await readRoleExpiryState(storageRoot);
    const next = await updater(current);
    return writeRoleExpiryState(storageRoot, next || current);
  });
  updateQueues.set(key, operation);
  try {
    return await operation;
  } finally {
    if (updateQueues.get(key) === operation) updateQueues.delete(key);
  }
}

module.exports = {
  createDefaultRoleExpiryState,
  normalizeRoleExpiryState,
  readRoleExpiryState,
  writeRoleExpiryState,
  updateRoleExpiryState,
};
