const { createStoragePaths, normalizeCorporationId } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

const DEFAULT_FEATURES = Object.freeze({
  members: true,
  finance: true,
  applications: true,
  structures: true,
  activity: true,
  onboarding: true,
});

function createDefaultRegistry() {
  return {
    version: 1,
    defaultCorporationId: null,
    corporations: [],
  };
}

function normalizeFeatures(value = {}) {
  return Object.fromEntries(
    Object.entries(DEFAULT_FEATURES).map(([key, defaultValue]) => [
      key,
      value[key] === undefined ? defaultValue : Boolean(value[key]),
    ])
  );
}

function normalizeRegistryEntry(value) {
  const corporationId = normalizeCorporationId(value?.corporationId);

  return {
    corporationId,
    enabled: value?.enabled === undefined ? true : Boolean(value.enabled),
    features: normalizeFeatures(value?.features),
  };
}

function normalizeRegistry(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : createDefaultRegistry();
  const seen = new Set();
  const corporations = [];

  for (const rawEntry of Array.isArray(source.corporations) ? source.corporations : []) {
    const entry = normalizeRegistryEntry(rawEntry);
    if (seen.has(entry.corporationId)) continue;
    seen.add(entry.corporationId);
    corporations.push(entry);
  }

  const requestedDefault = source.defaultCorporationId
    ? normalizeCorporationId(source.defaultCorporationId)
    : null;
  const defaultCorporationId = requestedDefault && seen.has(requestedDefault)
    ? requestedDefault
    : corporations[0]?.corporationId || null;

  return {
    version: 1,
    defaultCorporationId,
    corporations,
  };
}

async function readRegistry(storageRoot) {
  const paths = createStoragePaths(storageRoot);
  const raw = await readJson(paths.corporationRegistryFile, {
    defaultFactory: createDefaultRegistry,
  });
  return normalizeRegistry(raw);
}

async function writeRegistry(storageRoot, registry) {
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeRegistry(registry);
  await writeJsonAtomic(paths.corporationRegistryFile, normalized);
  return normalized;
}

async function listCorporations(storageRoot, options = {}) {
  const registry = await readRegistry(storageRoot);
  return options.enabledOnly
    ? registry.corporations.filter((entry) => entry.enabled)
    : registry.corporations;
}

async function getCorporationRegistration(storageRoot, corporationId) {
  const normalizedId = normalizeCorporationId(corporationId);
  const registry = await readRegistry(storageRoot);
  return registry.corporations.find((entry) => entry.corporationId === normalizedId) || null;
}

async function registerCorporation(storageRoot, corporationId, options = {}) {
  const normalizedId = normalizeCorporationId(corporationId);
  const registry = await readRegistry(storageRoot);
  const existingIndex = registry.corporations.findIndex(
    (entry) => entry.corporationId === normalizedId
  );

  if (existingIndex >= 0) {
    const previous = registry.corporations[existingIndex];
    registry.corporations[existingIndex] = normalizeRegistryEntry({
      corporationId: normalizedId,
      enabled: options.enabled === undefined ? previous.enabled : options.enabled,
      features: options.features === undefined
        ? previous.features
        : { ...previous.features, ...options.features },
    });
  } else {
    registry.corporations.push(
      normalizeRegistryEntry({
        corporationId: normalizedId,
        enabled: options.enabled,
        features: options.features,
      })
    );
  }

  if (!registry.defaultCorporationId || options.makeDefault) {
    registry.defaultCorporationId = normalizedId;
  }

  const saved = await writeRegistry(storageRoot, registry);
  return saved.corporations.find((entry) => entry.corporationId === normalizedId);
}

async function setDefaultCorporation(storageRoot, corporationId) {
  const normalizedId = normalizeCorporationId(corporationId);
  const registry = await readRegistry(storageRoot);

  if (!registry.corporations.some((entry) => entry.corporationId === normalizedId)) {
    throw new Error(`Corporation ${normalizedId} is not registered.`);
  }

  registry.defaultCorporationId = normalizedId;
  return writeRegistry(storageRoot, registry);
}

module.exports = {
  DEFAULT_FEATURES,
  createDefaultRegistry,
  readRegistry,
  writeRegistry,
  listCorporations,
  getCorporationRegistration,
  registerCorporation,
  setDefaultCorporation,
};
