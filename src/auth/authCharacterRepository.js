const { createStoragePaths } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeAuthRecord(record = {}) {
  return {
    main: normalizeText(record.main),
    alt: normalizeText(record.alt),
    corp: normalizeText(record.corp),
  };
}

function buildRecordKey(record) {
  return [normalizeKey(record.main), normalizeKey(record.alt), normalizeKey(record.corp)].join('::');
}

function normalizeAuthCharacters(records) {
  const unique = new Map();

  for (const rawRecord of Array.isArray(records) ? records : []) {
    const record = normalizeAuthRecord(rawRecord);
    if (!record.main || !record.alt) continue;
    const key = buildRecordKey(record);
    if (!unique.has(key)) unique.set(key, record);
  }

  return [...unique.values()].sort((left, right) => {
    const mainCompare = left.main.localeCompare(right.main);
    if (mainCompare !== 0) return mainCompare;
    const altCompare = left.alt.localeCompare(right.alt);
    if (altCompare !== 0) return altCompare;
    return left.corp.localeCompare(right.corp);
  });
}

async function findAllAuthCharacters(storageRoot) {
  const paths = createStoragePaths(storageRoot);
  const value = await readJson(paths.authCharactersFile, {
    defaultFactory: () => [],
  });
  return normalizeAuthCharacters(value);
}

async function replaceAllAuthCharacters(storageRoot, records) {
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeAuthCharacters(records);
  await writeJsonAtomic(paths.authCharactersFile, normalized);
  return normalized;
}

async function getAuthCharactersSummary(storageRoot) {
  const records = await findAllAuthCharacters(storageRoot);
  return {
    recordsCount: records.length,
    mainsCount: new Set(records.map((record) => normalizeKey(record.main))).size,
    corpsCount: new Set(records.map((record) => normalizeKey(record.corp)).filter(Boolean)).size,
  };
}

module.exports = {
  normalizeAuthRecord,
  normalizeAuthCharacters,
  findAllAuthCharacters,
  replaceAllAuthCharacters,
  getAuthCharactersSummary,
};
