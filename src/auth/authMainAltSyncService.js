const { findAllAuthCharacters } = require('./authCharacterRepository');
const {
  relationKey,
  readAuthMainAltState,
  writeAuthMainAltState,
} = require('./authMainAltRepository');

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function buildAuthMainAltModel(records) {
  const source = Array.isArray(records) ? records : [];
  const mains = new Map();
  const altOwners = new Map();

  for (const record of source) {
    const main = normalizeText(record.main);
    const alt = normalizeText(record.alt);
    const corp = normalizeText(record.corp);
    if (!main || !alt) continue;

    const mainKey = normalizeKey(main);
    const altKey = normalizeKey(alt);
    if (!mains.has(mainKey)) mains.set(mainKey, main);

    if (altKey !== mainKey) {
      if (!altOwners.has(altKey)) altOwners.set(altKey, new Map());
      altOwners.get(altKey).set(mainKey, main);
    }
  }

  const conflicts = [];
  const conflictedAltKeys = new Set();
  for (const [altKey, owners] of altOwners.entries()) {
    if (owners.size <= 1) continue;
    conflictedAltKeys.add(altKey);
    const displayAlt = source.find((record) => normalizeKey(record.alt) === altKey)?.alt || altKey;
    conflicts.push(`${displayAlt}: ${[...owners.values()].sort().join(', ')}`);
  }

  const unique = new Map();
  for (const record of source) {
    const main = normalizeText(record.main);
    const alt = normalizeText(record.alt);
    const corp = normalizeText(record.corp);
    if (!main || !alt) continue;
    if (normalizeKey(main) === normalizeKey(alt)) continue;
    if (conflictedAltKeys.has(normalizeKey(alt))) continue;

    const relation = { main, alt, corp };
    const key = relationKey(relation);
    if (!unique.has(key)) unique.set(key, relation);
  }

  const relations = [...unique.values()].sort((left, right) =>
    left.main.localeCompare(right.main) ||
    left.alt.localeCompare(right.alt) ||
    left.corp.localeCompare(right.corp)
  );

  return {
    recordsCount: source.length,
    familiesCount: mains.size,
    relations,
    conflicts: conflicts.sort((left, right) => left.localeCompare(right)),
  };
}

function compareRelations(currentRelations, nextRelations) {
  const currentMap = new Map((currentRelations || []).map((relation) => [relationKey(relation), relation]));
  const nextMap = new Map((nextRelations || []).map((relation) => [relationKey(relation), relation]));

  const added = [...nextMap.entries()]
    .filter(([key]) => !currentMap.has(key))
    .map(([, relation]) => relation);
  const removed = [...currentMap.entries()]
    .filter(([key]) => !nextMap.has(key))
    .map(([, relation]) => relation);
  const unchanged = [...nextMap.keys()].filter((key) => currentMap.has(key)).length;

  return { added, removed, unchanged };
}

async function syncMainAltFromAuth(storageRoot, mode = 'preview', options = {}) {
  const normalizedMode = normalizeText(mode).toLowerCase() || 'preview';
  if (!['preview', 'apply'].includes(normalizedMode)) {
    throw new Error('Invalid sync-main-alt mode. Use preview or apply.');
  }

  const records = options.records || await findAllAuthCharacters(storageRoot);
  const current = await readAuthMainAltState(storageRoot);
  const model = buildAuthMainAltModel(records);
  const diff = compareRelations(current.relations, model.relations);
  const now = options.now instanceof Date ? options.now : new Date();

  let state = current;
  if (normalizedMode === 'apply') {
    state = await writeAuthMainAltState(storageRoot, {
      version: 1,
      syncedAt: now.toISOString(),
      recordsCount: model.recordsCount,
      familiesCount: model.familiesCount,
      relations: model.relations,
    });
  }

  return {
    ok: true,
    mode: normalizedMode,
    recordsCount: model.recordsCount,
    familiesCount: model.familiesCount,
    relationsCount: model.relations.length,
    alreadyLinkedCount: diff.unchanged,
    linkedAltCount: diff.added.length,
    removedRelationsCount: diff.removed.length,
    conflictsCount: model.conflicts.length,
    linkedAlts: diff.added.map((relation) => `${relation.alt} → ${relation.main}`),
    removedRelations: diff.removed.map((relation) => `${relation.alt} → ${relation.main}`),
    conflicts: model.conflicts,
    state,
  };
}

async function getMainAltRelations(storageRoot) {
  const state = await readAuthMainAltState(storageRoot);
  return {
    ...state,
    relations: [...state.relations],
  };
}

module.exports = {
  buildAuthMainAltModel,
  compareRelations,
  syncMainAltFromAuth,
  getMainAltRelations,
};
