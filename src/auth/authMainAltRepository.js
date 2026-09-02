const { createStoragePaths } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeRelation(value = {}) {
  return {
    main: normalizeText(value.main),
    alt: normalizeText(value.alt),
    corp: normalizeText(value.corp),
  };
}

function relationKey(value) {
  const relation = normalizeRelation(value);
  return `${relation.main.toLowerCase()}::${relation.alt.toLowerCase()}::${relation.corp.toLowerCase()}`;
}

function createDefaultAuthMainAltState() {
  return {
    version: 1,
    syncedAt: '',
    recordsCount: 0,
    familiesCount: 0,
    relations: [],
  };
}

function normalizeAuthMainAltState(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : createDefaultAuthMainAltState();
  const unique = new Map();

  for (const rawRelation of Array.isArray(source.relations) ? source.relations : []) {
    const relation = normalizeRelation(rawRelation);
    if (!relation.main || !relation.alt) continue;
    const key = relationKey(relation);
    if (!unique.has(key)) unique.set(key, relation);
  }

  const relations = [...unique.values()].sort((left, right) =>
    left.main.localeCompare(right.main) ||
    left.alt.localeCompare(right.alt) ||
    left.corp.localeCompare(right.corp)
  );

  return {
    version: 1,
    syncedAt: normalizeText(source.syncedAt),
    recordsCount: Math.max(0, Number(source.recordsCount) || 0),
    familiesCount: Math.max(0, Number(source.familiesCount) || 0),
    relations,
  };
}

async function readAuthMainAltState(storageRoot) {
  const paths = createStoragePaths(storageRoot);
  const raw = await readJson(paths.authMainAltStateFile, {
    defaultFactory: createDefaultAuthMainAltState,
  });
  return normalizeAuthMainAltState(raw);
}

async function writeAuthMainAltState(storageRoot, value) {
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeAuthMainAltState(value);
  await writeJsonAtomic(paths.authMainAltStateFile, normalized);
  return normalized;
}

module.exports = {
  normalizeRelation,
  relationKey,
  createDefaultAuthMainAltState,
  normalizeAuthMainAltState,
  readAuthMainAltState,
  writeAuthMainAltState,
};
