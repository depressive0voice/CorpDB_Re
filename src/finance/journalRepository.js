const { createStoragePaths, normalizeCorporationId } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePercent(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeOptionalBoolean(value) {
  if (value === true || value === false) return value;
  return null;
}

function createEmptyJournalState(corporationId) {
  return {
    version: 1,
    corporationId: normalizeCorporationId(corporationId),
    meta: {
      lastRefreshedAt: '',
      corporationName: '',
      authorizedCharacterId: '',
      authorizedCharacterName: '',
      currentCorporationTaxRatePercent: 0,
      allianceTaxRatePercent: 0,
    },
    entries: [],
  };
}

function normalizeJournalEntry(corporationId, value = {}) {
  return {
    id: normalizeText(value.id),
    corporationId: normalizeCorporationId(corporationId),
    division: normalizeNumber(value.division, 0),
    date: normalizeText(value.date),
    refType: normalizeText(value.refType || value.ref_type).toLowerCase(),
    amount: normalizeNumber(value.amount, 0),
    balance: normalizeNumber(value.balance, 0),
    description: normalizeText(value.description),
    reason: normalizeText(value.reason),
    firstPartyId: normalizeText(value.firstPartyId || value.first_party_id),
    secondPartyId: normalizeText(value.secondPartyId || value.second_party_id),
    tax: normalizeNumber(value.tax, 0),
    taxReceiverId: normalizeText(value.taxReceiverId || value.tax_receiver_id),
    corporationName: normalizeText(value.corporationName),
    authorizedCharacterId: normalizeText(value.authorizedCharacterId),
    authorizedCharacterName: normalizeText(value.authorizedCharacterName),
    corporationTaxRatePercent: normalizePercent(value.corporationTaxRatePercent),
    allianceTaxRatePercent: normalizePercent(value.allianceTaxRatePercent),
    taxableAtIngest: normalizeOptionalBoolean(value.taxableAtIngest),
    includedInFinanceAtIngest: normalizeOptionalBoolean(value.includedInFinanceAtIngest),
    financePolicyCapturedAt: normalizeText(value.financePolicyCapturedAt),
    retrievedAt: normalizeText(value.retrievedAt),
  };
}

function sortEntries(entries) {
  return [...entries].sort((left, right) => {
    const leftDate = Date.parse(left.date || left.retrievedAt || '') || 0;
    const rightDate = Date.parse(right.date || right.retrievedAt || '') || 0;
    if (rightDate !== leftDate) return rightDate - leftDate;
    if (right.division !== left.division) return right.division - left.division;
    return String(right.id).localeCompare(String(left.id));
  });
}

function normalizeJournalState(corporationId, value) {
  const normalizedId = normalizeCorporationId(corporationId);
  const defaults = createEmptyJournalState(normalizedId);
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const meta = source.meta && typeof source.meta === 'object' && !Array.isArray(source.meta)
    ? source.meta
    : {};
  return {
    version: 1,
    corporationId: normalizedId,
    meta: {
      lastRefreshedAt: normalizeText(meta.lastRefreshedAt),
      corporationName: normalizeText(meta.corporationName),
      authorizedCharacterId: normalizeText(meta.authorizedCharacterId),
      authorizedCharacterName: normalizeText(meta.authorizedCharacterName),
      currentCorporationTaxRatePercent: normalizePercent(meta.currentCorporationTaxRatePercent),
      allianceTaxRatePercent: normalizePercent(meta.allianceTaxRatePercent),
    },
    entries: sortEntries(
      (Array.isArray(source.entries) ? source.entries : defaults.entries)
        .map((entry) => normalizeJournalEntry(normalizedId, entry))
        .filter((entry) => entry.id)
    ),
  };
}

function buildEntryKey(entry) {
  return `${Number(entry.division || 0)}:${normalizeText(entry.id)}`;
}

function preserveHistoricalSnapshot(existing, incoming) {
  if (!existing) return incoming;
  return {
    ...incoming,
    corporationTaxRatePercent: existing.corporationTaxRatePercent,
    allianceTaxRatePercent: existing.allianceTaxRatePercent,
    taxableAtIngest: existing.taxableAtIngest === null
      ? incoming.taxableAtIngest
      : existing.taxableAtIngest,
    includedInFinanceAtIngest: existing.includedInFinanceAtIngest === null
      ? incoming.includedInFinanceAtIngest
      : existing.includedInFinanceAtIngest,
    financePolicyCapturedAt: existing.financePolicyCapturedAt || incoming.financePolicyCapturedAt,
    retrievedAt: existing.retrievedAt || incoming.retrievedAt,
  };
}

async function readJournalState(storageRoot, corporationId) {
  const normalizedId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const raw = await readJson(paths.financeJournalFile(normalizedId), {
    defaultFactory: () => createEmptyJournalState(normalizedId),
  });
  return normalizeJournalState(normalizedId, raw);
}

async function writeJournalState(storageRoot, corporationId, value) {
  const normalizedId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeJournalState(normalizedId, value);
  await writeJsonAtomic(paths.financeJournalFile(normalizedId), normalized);
  return normalized;
}

async function upsertJournalEntries(storageRoot, corporationId, options = {}) {
  const normalizedId = normalizeCorporationId(corporationId);
  const current = await readJournalState(storageRoot, normalizedId);
  const map = new Map(current.entries.map((entry) => [buildEntryKey(entry), entry]));
  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  for (const raw of Array.isArray(options.entries) ? options.entries : []) {
    const incoming = normalizeJournalEntry(normalizedId, raw);
    if (!incoming.id) continue;
    const key = buildEntryKey(incoming);
    const existing = map.get(key);
    const entry = preserveHistoricalSnapshot(existing, incoming);
    if (!existing) {
      map.set(key, entry);
      addedCount += 1;
    } else if (JSON.stringify(existing) !== JSON.stringify(entry)) {
      map.set(key, entry);
      updatedCount += 1;
    } else {
      unchangedCount += 1;
    }
  }

  const next = await writeJournalState(storageRoot, normalizedId, {
    ...current,
    meta: { ...current.meta, ...(options.metaPatch || {}) },
    entries: [...map.values()],
  });

  return {
    ...next,
    addedCount,
    updatedCount,
    unchangedCount,
    totalCount: next.entries.length,
  };
}

module.exports = {
  createEmptyJournalState,
  normalizeJournalEntry,
  normalizeJournalState,
  buildEntryKey,
  preserveHistoricalSnapshot,
  readJournalState,
  writeJournalState,
  upsertJournalEntries,
};
