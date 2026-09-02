const { createStoragePaths, normalizeCorporationId } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

const LEGACY_ALLIANCE_TAX_RATE_PERCENT = 7.5;
const LEGACY_TAXABLE_REF_TYPES = Object.freeze([
  'bounty_prizes',
  'ess_escrow_transfer',
]);

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeRate(value, fallback = LEGACY_ALLIANCE_TAX_RATE_PERCENT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return fallback;
  return parsed;
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeRefTypes(value) {
  const source = Array.isArray(value) ? value : LEGACY_TAXABLE_REF_TYPES;
  return [...new Set(source.map((entry) => normalizeText(entry).toLowerCase()).filter(Boolean))];
}

function normalizeExcludedWalletDivisions(value) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry >= 1 && entry <= 7))]
    .sort((left, right) => left - right);
}

function createDefaultFinancePolicy(corporationId) {
  return {
    version: 1,
    corporationId: normalizeCorporationId(corporationId),
    allianceTaxRatePercent: LEGACY_ALLIANCE_TAX_RATE_PERCENT,
    taxableRefTypes: [...LEGACY_TAXABLE_REF_TYPES],
    excludedWalletDivisions: [],
    donationAlert: {
      discordUserId: '',
      division: 1,
    },
  };
}

function normalizeFinancePolicy(corporationId, value) {
  const normalizedId = normalizeCorporationId(corporationId);
  const defaults = createDefaultFinancePolicy(normalizedId);
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const alert = source.donationAlert && typeof source.donationAlert === 'object' && !Array.isArray(source.donationAlert)
    ? source.donationAlert
    : {};

  if (source.corporationId && normalizeCorporationId(source.corporationId) !== normalizedId) {
    throw new Error(`Finance policy corporation mismatch: ${source.corporationId} != ${normalizedId}.`);
  }

  return {
    version: 1,
    corporationId: normalizedId,
    allianceTaxRatePercent: normalizeRate(
      source.allianceTaxRatePercent,
      defaults.allianceTaxRatePercent
    ),
    taxableRefTypes: normalizeRefTypes(source.taxableRefTypes),
    excludedWalletDivisions: normalizeExcludedWalletDivisions(source.excludedWalletDivisions),
    donationAlert: {
      discordUserId: normalizeText(alert.discordUserId),
      division: normalizePositiveInteger(alert.division, defaults.donationAlert.division),
    },
  };
}

async function readFinancePolicy(storageRoot, corporationId) {
  const normalizedId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const raw = await readJson(paths.financePolicyFile(normalizedId), {
    defaultFactory: () => createDefaultFinancePolicy(normalizedId),
  });
  return normalizeFinancePolicy(normalizedId, raw);
}

async function writeFinancePolicy(storageRoot, corporationId, value) {
  const normalizedId = normalizeCorporationId(corporationId);
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeFinancePolicy(normalizedId, value);
  await writeJsonAtomic(paths.financePolicyFile(normalizedId), normalized);
  return normalized;
}

async function updateFinancePolicy(storageRoot, corporationId, patch = {}) {
  const current = await readFinancePolicy(storageRoot, corporationId);
  return writeFinancePolicy(storageRoot, corporationId, {
    ...current,
    ...patch,
    donationAlert: patch.donationAlert
      ? { ...current.donationAlert, ...patch.donationAlert }
      : current.donationAlert,
  });
}

module.exports = {
  LEGACY_ALLIANCE_TAX_RATE_PERCENT,
  LEGACY_TAXABLE_REF_TYPES,
  createDefaultFinancePolicy,
  normalizeFinancePolicy,
  normalizeExcludedWalletDivisions,
  readFinancePolicy,
  writeFinancePolicy,
  updateFinancePolicy,
};
