const { getCorporationAccessContext } = require('../eve/eveAuthorizationService');
const {
  requestEsiJson,
  requestAllPages,
  resolveUniverseNames,
} = require('../eve/eveEsiClient');

const STRUCTURES_SCOPE = 'esi-corporations.read_structures.v1';
const STARBASES_SCOPE = 'esi-corporations.read_starbases.v1';
const ASSETS_SCOPE = 'esi-assets.read_corporation_assets.v1';

function ensureScope(access, scope) {
  const scopes = new Set(Array.isArray(access?.scopes) ? access.scopes : []);
  if (!scopes.has(scope)) {
    const error = new Error(`EVE authorization is missing required scope: ${scope}`);
    error.code = 'eve_sso_missing_scope';
    throw error;
  }
}

function normalizeAsset(entry = {}) {
  const quantity = Number(entry.quantity || 0);
  return {
    itemId: String(entry.item_id || '').trim(),
    typeId: String(entry.type_id || '').trim(),
    locationId: String(entry.location_id || '').trim(),
    locationType: String(entry.location_type || '').trim(),
    locationFlag: String(entry.location_flag || '').trim(),
    quantity: Number.isFinite(quantity) ? quantity : 0,
    isSingleton: Boolean(entry.is_singleton),
    name: String(entry.name || '').trim(),
  };
}

function normalizeFuel(entry = {}) {
  const quantity = Number(entry.quantity || 0);
  return {
    typeId: String(entry.type_id || '').trim(),
    quantity: Number.isFinite(quantity) ? quantity : 0,
  };
}

async function getStructureAccess(config, storageRoot, corporationId, scope, options = {}) {
  const access = await getCorporationAccessContext(
    config,
    storageRoot,
    corporationId,
    options
  );
  ensureScope(access, scope);
  return access;
}

async function getCorporationStructures(config, storageRoot, corporationId, options = {}) {
  const access = await getStructureAccess(
    config,
    storageRoot,
    corporationId,
    STRUCTURES_SCOPE,
    options
  );
  return requestAllPages(
    config,
    `/corporations/${corporationId}/structures/`,
    { ...options, accessToken: access.accessToken }
  );
}

async function getCorporationAssets(config, storageRoot, corporationId, options = {}) {
  const access = await getStructureAccess(
    config,
    storageRoot,
    corporationId,
    ASSETS_SCOPE,
    options
  );
  const values = await requestAllPages(
    config,
    `/corporations/${corporationId}/assets/`,
    { ...options, accessToken: access.accessToken }
  );
  return (Array.isArray(values) ? values : []).map(normalizeAsset);
}

async function getCorporationStarbases(config, storageRoot, corporationId, options = {}) {
  const access = await getStructureAccess(
    config,
    storageRoot,
    corporationId,
    STARBASES_SCOPE,
    options
  );
  const values = await requestEsiJson(
    config,
    `/corporations/${corporationId}/starbases/`,
    { ...options, accessToken: access.accessToken }
  );
  return Array.isArray(values) ? values : [];
}

async function getCorporationStarbaseDetail(
  config,
  storageRoot,
  corporationId,
  starbaseId,
  systemId,
  options = {}
) {
  const cleanStarbaseId = String(starbaseId || '').trim();
  const cleanSystemId = String(systemId || '').trim();
  if (!cleanStarbaseId || !cleanSystemId) {
    throw new Error('Starbase detail requires starbaseId and systemId.');
  }
  const access = await getStructureAccess(
    config,
    storageRoot,
    corporationId,
    STARBASES_SCOPE,
    options
  );
  const detail = await requestEsiJson(
    config,
    `/corporations/${corporationId}/starbases/${cleanStarbaseId}/?system_id=${encodeURIComponent(cleanSystemId)}`,
    { ...options, accessToken: access.accessToken }
  );
  const source = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : {};
  return {
    ...source,
    starbase_id: cleanStarbaseId,
    system_id: cleanSystemId,
    fuels: (Array.isArray(source.fuels) ? source.fuels : [])
      .map(normalizeFuel)
      .filter((fuel) => fuel.typeId && fuel.quantity > 0),
  };
}

async function getUniverseMoonDetail(config, moonId, options = {}) {
  const cleanMoonId = String(moonId || '').trim();
  if (!cleanMoonId) throw new Error('Moon detail requires moonId.');
  const detail = await requestEsiJson(config, `/universe/moons/${cleanMoonId}/`, options);
  return {
    moonId: cleanMoonId,
    name: String(detail?.name || '').trim(),
    systemId: String(detail?.system_id || '').trim(),
    position: detail?.position || null,
  };
}

async function getUniverseMoonDetailsByIds(config, moonIds, options = {}) {
  const ids = [...new Set((Array.isArray(moonIds) ? moonIds : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
  const result = new Map();
  for (const moonId of ids) {
    try {
      const detail = await getUniverseMoonDetail(config, moonId, options);
      if (detail.name) result.set(moonId, detail);
    } catch {
      // A missing public moon record must not fail the corporation report.
    }
  }
  return result;
}

async function resolveUniverseNameMap(config, ids, options = {}) {
  const values = await resolveUniverseNames(config, ids, options);
  return new Map((Array.isArray(values) ? values : [])
    .map((entry) => [String(entry?.id || '').trim(), String(entry?.name || '').trim()])
    .filter(([id, name]) => id && name));
}

module.exports = {
  STRUCTURES_SCOPE,
  STARBASES_SCOPE,
  ASSETS_SCOPE,
  ensureScope,
  normalizeAsset,
  normalizeFuel,
  getCorporationStructures,
  getCorporationAssets,
  getCorporationStarbases,
  getCorporationStarbaseDetail,
  getUniverseMoonDetail,
  getUniverseMoonDetailsByIds,
  resolveUniverseNameMap,
};
