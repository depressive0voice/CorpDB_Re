const { createStoragePaths } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

function createDefaultManagedRolePolicy() {
  return {
    version: 2,
    bindings: {},
  };
}

function normalizeRoleId(value) {
  const roleId = String(value ?? '').trim();
  if (roleId && !/^\d{5,25}$/.test(roleId)) {
    throw new Error(`Invalid Discord role ID: ${roleId}.`);
  }
  return roleId;
}

function normalizeBindingKey(value) {
  const key = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(key)) {
    throw new Error(
      'Role binding key must contain only lowercase letters, numbers, hyphens, or underscores (1-64 characters).'
    );
  }
  return key;
}

function normalizeBindings(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const bindings = {};

  for (const [rawKey, rawRoleId] of Object.entries(source)) {
    const key = normalizeBindingKey(rawKey);
    const roleId = normalizeRoleId(rawRoleId);
    if (roleId) bindings[key] = roleId;
  }

  return bindings;
}

function normalizeManagedRolePolicy(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : createDefaultManagedRolePolicy();

  const bindings = normalizeBindings(source.bindings);

  // Compatibility with the first CorpDB_Re role-policy shape used during development.
  const legacyGuestRoleId = normalizeRoleId(source.guestRoleId);
  if (legacyGuestRoleId && !bindings.guest) bindings.guest = legacyGuestRoleId;

  return {
    version: 2,
    bindings,
  };
}

async function readManagedRolePolicy(storageRoot) {
  const paths = createStoragePaths(storageRoot);
  const raw = await readJson(paths.managedRolePolicyFile, {
    defaultFactory: createDefaultManagedRolePolicy,
  });
  return normalizeManagedRolePolicy(raw);
}

async function writeManagedRolePolicy(storageRoot, value) {
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeManagedRolePolicy(value);
  await writeJsonAtomic(paths.managedRolePolicyFile, normalized);
  return normalized;
}

async function bindManagedRole(storageRoot, key, roleId) {
  const normalizedKey = normalizeBindingKey(key);
  const normalizedRoleId = normalizeRoleId(roleId);
  if (!normalizedRoleId) throw new Error('Discord role ID is required.');

  const current = await readManagedRolePolicy(storageRoot);
  return writeManagedRolePolicy(storageRoot, {
    ...current,
    bindings: {
      ...current.bindings,
      [normalizedKey]: normalizedRoleId,
    },
  });
}

async function unbindManagedRole(storageRoot, key) {
  const normalizedKey = normalizeBindingKey(key);
  const current = await readManagedRolePolicy(storageRoot);
  const bindings = { ...current.bindings };
  delete bindings[normalizedKey];
  return writeManagedRolePolicy(storageRoot, { ...current, bindings });
}

async function getManagedRoleBinding(storageRoot, key) {
  const normalizedKey = normalizeBindingKey(key);
  const current = await readManagedRolePolicy(storageRoot);
  return current.bindings[normalizedKey] || '';
}

async function setGuestRole(storageRoot, roleId) {
  return bindManagedRole(storageRoot, 'guest', roleId);
}

module.exports = {
  createDefaultManagedRolePolicy,
  normalizeBindingKey,
  normalizeManagedRolePolicy,
  readManagedRolePolicy,
  writeManagedRolePolicy,
  bindManagedRole,
  unbindManagedRole,
  getManagedRoleBinding,
  setGuestRole,
};
