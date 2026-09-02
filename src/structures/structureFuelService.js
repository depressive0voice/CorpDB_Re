const { getCorporationAccessContext } = require('../eve/eveAuthorizationService');
const { readCorporationProfile } = require('../corporations/corporationProfileRepository');
const {
  getCorporationStructures,
  getCorporationAssets,
  getCorporationStarbases,
  getCorporationStarbaseDetail,
  getUniverseMoonDetailsByIds,
  resolveUniverseNameMap,
} = require('./structureEsiService');
const {
  readStructureConfig,
  updateStructureConfig,
} = require('./structureConfigRepository');
const {
  readStructureAlertState,
  writeStructureAlertState,
} = require('./structureAlertStateRepository');
const {
  normalizeGuardEntry,
  readMetenoxGuardState,
  writeMetenoxGuardState,
} = require('./metenoxGuardRepository');

const CRITICAL_THRESHOLD_HOURS = 72;
const MAGMATIC_GAS_TYPE_ID = '81143';
const METENOX_TYPE_ID = '81826';
const METENOX_FUEL_BLOCK_RATE_PER_HOUR = 5;
const METENOX_MAGMATIC_GAS_RATE_PER_HOUR = 200;
const METENOX_ZERO_RESOURCE_CONFIRMATION_RUNS = 2;

const STRUCTURE_STATE_LABELS = Object.freeze({
  anchor_vulnerable: 'Anchor Vulnerable',
  anchoring: 'Anchoring',
  armor_reinforce: 'Armor Reinforced',
  armor_vulnerable: 'Armor Vulnerable',
  fitting_invulnerable: 'Fitting Invulnerable',
  hull_reinforce: 'Hull Reinforced',
  hull_vulnerable: 'Hull Vulnerable',
  online_deprecated: 'Online',
  onlining_vulnerable: 'Onlining Vulnerable',
  shield_vulnerable: 'Shield Vulnerable',
  unanchored: 'Unanchored',
  unknown: 'Unknown',
});

const POS_STATE_LABELS = Object.freeze({
  online: 'Online',
  offline: 'Offline',
  unanchored: 'Unanchored',
  reinforced: 'Reinforced',
  unknown: 'Unknown',
});

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function formatInteger(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return '0';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(parsed));
}

function formatHours(hours) {
  const safe = Math.max(0, Math.floor(Number(hours || 0)));
  const days = Math.floor(safe / 24);
  const remainder = safe % 24;
  if (days === 0) return `${remainder}h`;
  if (remainder === 0) return `${days}d`;
  return `${days}d ${remainder}h`;
}

function getHoursRemaining(isoDateTime, now = new Date()) {
  const timestamp = Date.parse(String(isoDateTime || ''));
  if (!Number.isFinite(timestamp)) return null;
  const diff = timestamp - now.getTime();
  return diff <= 0 ? 0 : Math.floor(diff / 3_600_000);
}

function calculateHoursRemaining(quantity, ratePerHour) {
  const quantityNumber = Number(quantity || 0);
  const rate = Number(ratePerHour || 0);
  if (!Number.isFinite(quantityNumber) || quantityNumber < 0) return null;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return Math.floor(quantityNumber / rate);
}

function isCriticalHours(hours) {
  return hours !== null && Number.isFinite(Number(hours)) && Number(hours) <= CRITICAL_THRESHOLD_HOURS;
}

function getMinimumKnownHours(values) {
  const known = (Array.isArray(values) ? values : [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0);
  return known.length > 0 ? Math.min(...known) : null;
}

function getStructureStateLabel(value) {
  const key = normalizeLower(value);
  return STRUCTURE_STATE_LABELS[key] || key || STRUCTURE_STATE_LABELS.unknown;
}

function getPosStateLabel(value) {
  const key = normalizeLower(value);
  return POS_STATE_LABELS[key] || key || POS_STATE_LABELS.unknown;
}

function getServicesByState(services, state) {
  return (Array.isArray(services) ? services : [])
    .filter((service) => normalizeLower(service?.state) === state)
    .map((service) => normalizeText(service?.name))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function classifyStructure(typeName, structureName, typeId) {
  const type = normalizeLower(typeName);
  const name = normalizeLower(structureName);
  const isMetenox = normalizeText(typeId) === METENOX_TYPE_ID || type.includes('metenox') || name.includes('metenox');
  const isMoonDrill = isMetenox || type.includes('moon drill') || name.includes('moon drill') || type.includes('moondrill') || name.includes('moondrill');
  return {
    isMetenox,
    isMoonDrill,
    classificationLabel: isMetenox ? 'Metenox Moon Drill' : isMoonDrill ? 'Moon Drill' : 'Upwell structure',
  };
}

function getPosFuelRatePerHour(typeName) {
  const name = normalizeLower(typeName);
  if (!name) return null;
  if (name.includes('small')) return 10;
  if (name.includes('medium')) return 20;
  if (name.includes('large')) return 40;
  return null;
}

function getPosStrontiumRatePerHour(typeName) {
  const fuelRate = getPosFuelRatePerHour(typeName);
  return fuelRate ? fuelRate * 10 : null;
}

function isFuelBlockName(value) {
  const name = normalizeLower(value);
  return name.includes('fuel block') && !name.includes('strontium');
}

function buildAssetsByLocation(assets, nameMap) {
  const result = new Map();
  for (const asset of Array.isArray(assets) ? assets : []) {
    const locationId = normalizeText(asset.locationId || asset.location_id);
    const typeId = normalizeText(asset.typeId || asset.type_id);
    if (!locationId || !typeId) continue;
    const quantity = Number(asset.quantity || 0);
    const entry = {
      itemId: normalizeText(asset.itemId || asset.item_id),
      typeId,
      typeName: nameMap.get(typeId) || normalizeText(asset.name) || `Type ${typeId}`,
      quantity: Number.isFinite(quantity) ? quantity : 0,
    };
    const list = result.get(locationId) || [];
    list.push(entry);
    result.set(locationId, list);
  }
  return result;
}

function buildMetenoxFuelData(directAssets, assetsAvailable, assetsError) {
  if (!assetsAvailable) {
    return {
      metenoxAssetsChecked: false,
      metenoxAssetError: normalizeText(assetsError),
      metenoxFuelBlockQuantity: 0,
      metenoxFuelBlockQuantityFormatted: '0',
      metenoxFuelBlockDisplayName: '',
      metenoxFuelBlockHoursRemaining: null,
      metenoxFuelBlockTimeRemainingLabel: '',
      metenoxMagmaticGasQuantity: 0,
      metenoxMagmaticGasQuantityFormatted: '0',
      metenoxMagmaticGasHoursRemaining: null,
      metenoxMagmaticGasTimeRemainingLabel: '',
    };
  }
  const assets = Array.isArray(directAssets) ? directAssets : [];
  const fuelBlocks = assets.filter((asset) => isFuelBlockName(asset.typeName));
  const gasAssets = assets.filter((asset) => asset.typeId === MAGMATIC_GAS_TYPE_ID || normalizeLower(asset.typeName) === 'magmatic gas');
  const fuelBlockQuantity = fuelBlocks.reduce((sum, asset) => sum + Number(asset.quantity || 0), 0);
  const gasQuantity = gasAssets.reduce((sum, asset) => sum + Number(asset.quantity || 0), 0);
  const fuelBlockHours = calculateHoursRemaining(fuelBlockQuantity, METENOX_FUEL_BLOCK_RATE_PER_HOUR);
  const gasHours = calculateHoursRemaining(gasQuantity, METENOX_MAGMATIC_GAS_RATE_PER_HOUR);
  const fuelNames = [...new Set(fuelBlocks.map((asset) => asset.typeName).filter(Boolean))];
  return {
    metenoxAssetsChecked: true,
    metenoxAssetError: '',
    metenoxFuelBlockQuantity: fuelBlockQuantity,
    metenoxFuelBlockQuantityFormatted: formatInteger(fuelBlockQuantity),
    metenoxFuelBlockDisplayName: fuelNames.length === 1 ? fuelNames[0] : fuelNames.length > 1 ? 'Fuel Blocks' : '',
    metenoxFuelBlockHoursRemaining: fuelBlockHours,
    metenoxFuelBlockTimeRemainingLabel: fuelBlockHours === null ? '' : formatHours(fuelBlockHours),
    metenoxMagmaticGasQuantity: gasQuantity,
    metenoxMagmaticGasQuantityFormatted: formatInteger(gasQuantity),
    metenoxMagmaticGasHoursRemaining: gasHours,
    metenoxMagmaticGasTimeRemainingLabel: gasHours === null ? '' : formatHours(gasHours),
  };
}

function mapStructureItem(raw, nameMap, assetsByLocation, assetResult, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const structureId = normalizeText(raw.structure_id);
  const typeId = normalizeText(raw.type_id);
  const systemId = normalizeText(raw.system_id);
  const name = normalizeText(raw.name) || `Structure ${structureId}`;
  const typeName = nameMap.get(typeId) || `Type ${typeId}`;
  const systemName = nameMap.get(systemId) || systemId;
  const classification = classifyStructure(typeName, name, typeId);
  const fuelExpires = normalizeText(raw.fuel_expires);
  const ordinaryHours = fuelExpires ? getHoursRemaining(fuelExpires, now) : null;
  const activeServices = getServicesByState(raw.services, 'online');
  const offlineServices = getServicesByState(raw.services, 'offline');
  const directAssets = assetsByLocation.get(structureId) || [];
  const metenox = classification.isMetenox
    ? buildMetenoxFuelData(directAssets, assetResult.available, assetResult.error)
    : {};
  const moonService = (Array.isArray(raw.services) ? raw.services : [])
    .filter((service) => normalizeLower(service?.name).includes('moon drilling'))
    .map((service) => `${normalizeText(service.name) || 'Moon Drilling'}: ${normalizeText(service.state) || 'unknown'}`)
    .join(', ');
  const item = {
    itemKind: 'structure',
    isPos: false,
    isMetenox: classification.isMetenox,
    isMoonDrill: classification.isMoonDrill,
    isAlertTrackable: true,
    structureId,
    name,
    systemId,
    systemName,
    moonId: '',
    moonName: '',
    typeId,
    typeName,
    classificationLabel: classification.classificationLabel,
    structureState: normalizeLower(raw.state),
    structureStateLabel: getStructureStateLabel(raw.state),
    fuelExpires,
    activeServices,
    offlineServices,
    moonDrillingServiceSummary: moonService || 'not found',
    directCorporationAssets: directAssets,
    ...metenox,
  };
  if (item.isMetenox) {
    item.hoursRemaining = item.metenoxAssetsChecked
      ? getMinimumKnownHours([item.metenoxFuelBlockHoursRemaining, item.metenoxMagmaticGasHoursRemaining])
      : null;
    item.timeRemainingLabel = item.metenoxAssetsChecked
      ? `Fuel Block: ${item.metenoxFuelBlockTimeRemainingLabel || '0h'}; Magmatic Gas: ${item.metenoxMagmaticGasTimeRemainingLabel || '0h'}`
      : 'no data';
  } else {
    item.hoursRemaining = ordinaryHours;
    item.timeRemainingLabel = ordinaryHours === null ? 'no fuel data / no active consumption' : formatHours(ordinaryHours);
  }
  item.isCritical = isCriticalHours(item.hoursRemaining);
  item.alertStatusLabel = item.isCritical ? 'CRITICAL' : item.hoursRemaining === null ? 'NO DATA' : 'OK';
  return item;
}

function mapPosFuelEntry(raw, nameMap) {
  const typeId = normalizeText(raw.typeId || raw.type_id);
  const quantity = Number(raw.quantity || 0);
  return {
    typeId,
    typeName: nameMap.get(typeId) || `Type ${typeId}`,
    quantity: Number.isFinite(quantity) ? quantity : 0,
  };
}

function mapStarbaseItem(raw, nameMap, detailMap, detailErrorMap, moonMap) {
  const starbaseId = normalizeText(raw.starbase_id);
  const systemId = normalizeText(raw.system_id);
  const moonId = normalizeText(raw.moon_id);
  const typeId = normalizeText(raw.type_id);
  const typeName = nameMap.get(typeId) || `Type ${typeId}`;
  const systemName = nameMap.get(systemId) || systemId;
  const moonName = normalizeText(moonMap.get(moonId)?.name) || nameMap.get(moonId) || moonId;
  const state = normalizeLower(raw.state);
  const detail = detailMap.get(starbaseId) || null;
  const detailError = normalizeText(detailErrorMap.get(starbaseId));
  const fuels = (Array.isArray(detail?.fuels) ? detail.fuels : [])
    .map((fuel) => mapPosFuelEntry(fuel, nameMap))
    .filter((fuel) => fuel.typeId && fuel.quantity > 0);
  const fuelBlock = fuels.find((fuel) => isFuelBlockName(fuel.typeName)) || null;
  const strontium = fuels.find((fuel) => normalizeLower(fuel.typeName).includes('strontium')) || null;
  const fuelRate = getPosFuelRatePerHour(typeName);
  const strontiumRate = getPosStrontiumRatePerHour(typeName);
  const fuelBlockQuantity = Number(fuelBlock?.quantity || 0);
  const strontiumQuantity = Number(strontium?.quantity || 0);
  const hoursRemaining = calculateHoursRemaining(fuelBlockQuantity, fuelRate);
  const strontiumHours = calculateHoursRemaining(strontiumQuantity, strontiumRate);
  const isTrackable = Boolean(detail) && Boolean(fuelRate) && state !== 'unanchored';
  let alertStatusLabel = 'OK';
  if (!detail) alertStatusLabel = detailError ? 'POS DETAIL ERROR' : 'NO DATA';
  else if (fuels.length === 0) alertStatusLabel = 'CRITICAL: no fuel';
  else if (!fuelBlock) alertStatusLabel = 'CRITICAL: fuel block not found';
  else if (!fuelRate) alertStatusLabel = 'UNKNOWN FUEL RATE';
  else if (isCriticalHours(hoursRemaining)) alertStatusLabel = 'CRITICAL';
  return {
    itemKind: 'starbase',
    isPos: true,
    isMetenox: false,
    isMoonDrill: false,
    isAlertTrackable: isTrackable,
    structureId: `pos:${starbaseId}`,
    starbaseId,
    name: moonName ? `POS ${moonName}` : `POS ${starbaseId}`,
    systemId,
    systemName,
    moonId,
    moonName,
    typeId,
    typeName,
    classificationLabel: 'POS',
    structureState: state,
    structureStateLabel: getPosStateLabel(state),
    fuelExpires: '',
    activeServices: [],
    offlineServices: [],
    hoursRemaining,
    timeRemainingLabel: hoursRemaining === null ? 'no data' : formatHours(hoursRemaining),
    isCritical: isTrackable && isCriticalHours(hoursRemaining),
    alertStatusLabel,
    starbaseDetailAvailable: Boolean(detail),
    starbaseDetailError: detailError,
    posFuels: fuels,
    posFuelRatePerHour: fuelRate,
    posFuelBlockName: normalizeText(fuelBlock?.typeName),
    posFuelBlockQuantity: fuelBlockQuantity,
    posFuelBlockQuantityFormatted: formatInteger(fuelBlockQuantity),
    posStrontiumName: normalizeText(strontium?.typeName),
    posStrontiumQuantity: strontiumQuantity,
    posStrontiumQuantityFormatted: formatInteger(strontiumQuantity),
    posStrontiumHoursRemaining: strontiumHours,
    posStrontiumTimeRemainingLabel: strontiumHours === null ? '' : formatHours(strontiumHours),
  };
}

function sortStructureItems(items) {
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    if (left.isAlertTrackable !== right.isAlertTrackable) return left.isAlertTrackable ? -1 : 1;
    if (left.isCritical !== right.isCritical) return left.isCritical ? -1 : 1;
    const leftHours = left.hoursRemaining === null ? Number.POSITIVE_INFINITY : left.hoursRemaining;
    const rightHours = right.hoursRemaining === null ? Number.POSITIVE_INFINITY : right.hoursRemaining;
    if (leftHours !== rightHours) return leftHours - rightHours;
    return left.systemName.localeCompare(right.systemName) || left.name.localeCompare(right.name);
  });
}

async function loadAssetsSafely(config, storageRoot, corporationId, options = {}) {
  const impl = options.getCorporationAssets || getCorporationAssets;
  try {
    const assets = await impl(config, storageRoot, corporationId, options);
    return { available: true, error: '', assets: Array.isArray(assets) ? assets : [] };
  } catch (error) {
    return { available: false, error: error?.message || String(error), assets: [] };
  }
}

async function loadStarbasesSafely(config, storageRoot, corporationId, options = {}) {
  const getList = options.getCorporationStarbases || getCorporationStarbases;
  const getDetail = options.getCorporationStarbaseDetail || getCorporationStarbaseDetail;
  try {
    const starbases = await getList(config, storageRoot, corporationId, options);
    const detailMap = new Map();
    const detailErrorMap = new Map();
    for (const starbase of Array.isArray(starbases) ? starbases : []) {
      const starbaseId = normalizeText(starbase.starbase_id);
      const systemId = normalizeText(starbase.system_id);
      if (!starbaseId || !systemId) continue;
      try {
        const detail = await getDetail(config, storageRoot, corporationId, starbaseId, systemId, options);
        detailMap.set(starbaseId, detail);
      } catch (error) {
        detailErrorMap.set(starbaseId, error?.message || String(error));
      }
    }
    return { available: true, error: '', starbases, detailMap, detailErrorMap };
  } catch (error) {
    return { available: false, error: error?.message || String(error), starbases: [], detailMap: new Map(), detailErrorMap: new Map() };
  }
}

async function loadStructureFuelSnapshot(config, storageRoot, corporationId, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const checkedAt = now.toISOString();
  const appConfig = await readStructureConfig(storageRoot, corporationId);
  const disabledTypeIds = new Set(appConfig.disabledTypeIds);
  const access = options.access || await getCorporationAccessContext(config, storageRoot, corporationId, options);
  const profile = await readCorporationProfile(storageRoot, corporationId, { createIfMissing: false }).catch(() => null);
  const getStructures = options.getCorporationStructures || getCorporationStructures;
  const structuresRaw = await getStructures(config, storageRoot, corporationId, options);
  const disabledStructures = (Array.isArray(structuresRaw) ? structuresRaw : []).filter(
    (item) => disabledTypeIds.has(normalizeText(item.type_id))
  );
  const structures = (Array.isArray(structuresRaw) ? structuresRaw : []).filter(
    (item) => !disabledTypeIds.has(normalizeText(item.type_id))
  );
  const [assetResult, starbaseResult] = await Promise.all([
    loadAssetsSafely(config, storageRoot, corporationId, options),
    loadStarbasesSafely(config, storageRoot, corporationId, options),
  ]);
  const moonIds = starbaseResult.starbases.map((item) => normalizeText(item.moon_id)).filter(Boolean);
  const moonResolver = options.getUniverseMoonDetailsByIds || getUniverseMoonDetailsByIds;
  const moonMap = await moonResolver(config, moonIds, options);
  const structureIds = new Set(structures.map((item) => normalizeText(item.structure_id)).filter(Boolean));
  const directAssets = assetResult.assets.filter((asset) => structureIds.has(normalizeText(asset.locationId || asset.location_id)));
  const fuelTypeIds = [...starbaseResult.detailMap.values()]
    .flatMap((detail) => Array.isArray(detail.fuels) ? detail.fuels : [])
    .map((fuel) => normalizeText(fuel.typeId || fuel.type_id))
    .filter(Boolean);
  const ids = [
    ...structures.flatMap((item) => [item.system_id, item.type_id]),
    ...starbaseResult.starbases.flatMap((item) => [item.system_id, item.type_id, item.moon_id]),
    ...directAssets.map((asset) => asset.typeId || asset.type_id),
    ...fuelTypeIds,
    MAGMATIC_GAS_TYPE_ID,
  ].map((value) => normalizeText(value)).filter(Boolean);
  const nameResolver = options.resolveUniverseNameMap || resolveUniverseNameMap;
  const nameMap = await nameResolver(config, ids, options);
  const assetsByLocation = buildAssetsByLocation(directAssets, nameMap);
  const structureItems = structures.map((item) => mapStructureItem(item, nameMap, assetsByLocation, assetResult, { now }));
  const posItems = starbaseResult.starbases.map((item) => mapStarbaseItem(item, nameMap, starbaseResult.detailMap, starbaseResult.detailErrorMap, moonMap));
  return {
    checkedAt,
    config: appConfig,
    corporationId: String(corporationId),
    corporationName: normalizeText(profile?.name) || String(corporationId),
    authorizedCharacterId: normalizeText(access.characterId),
    authorizedCharacterName: normalizeText(access.characterName),
    criticalThresholdHours: CRITICAL_THRESHOLD_HOURS,
    disabledTypeIds: [...disabledTypeIds],
    disabledStructureCount: disabledStructures.length,
    assetAccessAvailable: assetResult.available,
    assetAccessError: assetResult.error,
    posAccessAvailable: starbaseResult.available,
    posAccessError: starbaseResult.error,
    items: [...structureItems, ...posItems],
  };
}

async function getStructureFuelReport(config, storageRoot, corporationId, options = {}) {
  const snapshot = await loadStructureFuelSnapshot(config, storageRoot, corporationId, options);
  const allItems = snapshot.items;
  const visible = options.onlyCritical
    ? allItems.filter((item) => item.isAlertTrackable && item.isCritical)
    : allItems;
  return {
    ...snapshot,
    items: sortStructureItems(visible),
    totalCount: allItems.length,
    structureCount: allItems.filter((item) => !item.isPos).length,
    regularUpwellCount: allItems.filter((item) => !item.isPos && !item.isMetenox).length,
    metenoxCount: allItems.filter((item) => item.isMetenox).length,
    posCount: allItems.filter((item) => item.isPos).length,
    alertTrackableCount: allItems.filter((item) => item.isAlertTrackable).length,
    criticalCount: allItems.filter((item) => item.isAlertTrackable && item.isCritical).length,
    noFuelDataCount: allItems.filter((item) => item.isAlertTrackable && item.hoursRemaining === null).length,
  };
}

async function setStructureFuelAlertChannel(storageRoot, corporationId, channelId) {
  return updateStructureConfig(storageRoot, corporationId, { alertChannelId: normalizeText(channelId) });
}

async function clearStructureFuelAlertChannel(storageRoot, corporationId) {
  return updateStructureConfig(storageRoot, corporationId, { alertChannelId: '' });
}

async function setStructureFuelAlertRole(storageRoot, corporationId, roleId) {
  return updateStructureConfig(storageRoot, corporationId, { alertRoleId: normalizeText(roleId) });
}

async function clearStructureFuelAlertRole(storageRoot, corporationId) {
  return updateStructureConfig(storageRoot, corporationId, { alertRoleId: '' });
}

function getMetenoxZeroOnlyCriticalResources(item) {
  if (!item?.isMetenox || !item.isCritical) return [];
  const resources = [];
  const fuelCritical = isCriticalHours(item.metenoxFuelBlockHoursRemaining);
  const gasCritical = isCriticalHours(item.metenoxMagmaticGasHoursRemaining);
  if (Number(item.metenoxFuelBlockQuantity || 0) <= 0 && fuelCritical) resources.push('fuelBlock');
  if (Number(item.metenoxMagmaticGasQuantity || 0) <= 0 && gasCritical) resources.push('gas');
  const hasNonZeroCritical =
    (Number(item.metenoxFuelBlockQuantity || 0) > 0 && fuelCritical) ||
    (Number(item.metenoxMagmaticGasQuantity || 0) > 0 && gasCritical);
  return hasNonZeroCritical ? [] : resources;
}

function stabilizeMetenox(item, previousGuard, checkedAt) {
  if (!item?.isMetenox) return { item, guard: null };
  const previous = normalizeGuardEntry(item.structureId, previousGuard || {});
  const zeroResources = getMetenoxZeroOnlyCriticalResources(item);
  const next = {
    ...previous,
    structureId: item.structureId,
    lastSeenAt: checkedAt,
    lastFuelBlockHoursRemaining: item.metenoxFuelBlockHoursRemaining,
    lastFuelBlockQuantity: Number(item.metenoxFuelBlockQuantity || 0),
    lastMagmaticGasHoursRemaining: item.metenoxMagmaticGasHoursRemaining,
    lastMagmaticGasQuantity: Number(item.metenoxMagmaticGasQuantity || 0),
  };
  if (zeroResources.length === 0) {
    next.zeroFuelBlockCriticalCount = 0;
    next.zeroGasCriticalCount = 0;
    next.stableCritical = Boolean(item.isCritical);
    if (item.isCritical) next.lastStableCriticalAt = checkedAt;
    else if (previous.stableCritical) next.lastRecoveredAt = checkedAt;
    return { item, guard: next };
  }
  next.zeroFuelBlockCriticalCount = zeroResources.includes('fuelBlock') ? previous.zeroFuelBlockCriticalCount + 1 : 0;
  next.zeroGasCriticalCount = zeroResources.includes('gas') ? previous.zeroGasCriticalCount + 1 : 0;
  const counts = [];
  if (zeroResources.includes('fuelBlock')) counts.push(next.zeroFuelBlockCriticalCount);
  if (zeroResources.includes('gas')) counts.push(next.zeroGasCriticalCount);
  if (counts.length > 0 && counts.every((count) => count >= METENOX_ZERO_RESOURCE_CONFIRMATION_RUNS)) {
    next.stableCritical = true;
    next.lastStableCriticalAt = checkedAt;
    return { item, guard: next };
  }
  next.lastSuppressedAt = checkedAt;
  next.stableCritical = Boolean(previous.stableCritical);
  return {
    item: {
      ...item,
      isCritical: Boolean(previous.stableCritical),
      alertStatusLabel: previous.stableCritical ? item.alertStatusLabel : 'OK',
    },
    guard: next,
  };
}

function getObjectTypeLabel(item) {
  if (item.isPos) return 'POS / Control Tower';
  if (item.isMetenox) return 'Metenox Moon Drill';
  return 'Upwell structure';
}

async function processStructureFuelAlerts(config, storageRoot, corporationId, client, options = {}) {
  const reportImpl = options.getStructureFuelReport || getStructureFuelReport;
  const report = await reportImpl(config, storageRoot, corporationId, options);
  const appConfig = await readStructureConfig(storageRoot, corporationId);
  const previousState = await readStructureAlertState(storageRoot, corporationId);
  const previousGuard = await readMetenoxGuardState(storageRoot, corporationId);
  const nextGuardStructures = {};
  const stabilized = report.items.map((item) => {
    if (!item.isMetenox) return item;
    const result = stabilizeMetenox(item, previousGuard.structures[item.structureId], report.checkedAt);
    if (result.guard) nextGuardStructures[item.structureId] = result.guard;
    return result.item;
  });
  const criticalAlerts = [];
  const recoveredAlerts = [];
  const nextStructures = {};
  let newCriticalAlertsCount = 0;
  for (const item of stabilized.filter((entry) => entry.isAlertTrackable)) {
    const previous = previousState.structures[item.structureId] || null;
    const previousStable = item.isMetenox
      ? Boolean(previousGuard.structures[item.structureId]?.stableCritical)
      : Boolean(previous?.isCritical);
    const currentCritical = item.hoursRemaining !== null && item.isCritical;
    const newCritical = currentCritical && !previousStable;
    const recovered = item.hoursRemaining !== null && !currentCritical && previousStable;
    if (newCritical) newCriticalAlertsCount += 1;
    if (newCritical || (options.forceSendCurrentCritical && currentCritical)) criticalAlerts.push(item);
    if (recovered) recoveredAlerts.push(item);
    nextStructures[item.structureId] = {
      structureId: item.structureId,
      name: item.name,
      systemName: item.systemName,
      itemKind: item.itemKind,
      objectTypeLabel: getObjectTypeLabel(item),
      isPos: Boolean(item.isPos),
      isMetenox: Boolean(item.isMetenox),
      isCritical: currentCritical,
      alertStatusLabel: item.alertStatusLabel,
      timeRemainingLabel: item.timeRemainingLabel,
      lastFuelExpires: item.fuelExpires,
      lastAlertAt: (newCritical || (options.forceSendCurrentCritical && currentCritical)) ? report.checkedAt : normalizeText(previous?.lastAlertAt),
      lastResolvedAt: recovered ? report.checkedAt : normalizeText(previous?.lastResolvedAt),
      updatedAt: report.checkedAt,
    };
  }
  await writeStructureAlertState(storageRoot, corporationId, {
    lastCheckedAt: report.checkedAt,
    structures: nextStructures,
  });
  await writeMetenoxGuardState(storageRoot, corporationId, {
    version: 1,
    structures: nextGuardStructures,
  });

  let criticalMessageSent = false;
  let recoveredMessageSent = false;
  if (appConfig.alertChannelId && client && typeof options.sendAlerts === 'function') {
    if (criticalAlerts.length > 0) {
      criticalMessageSent = await options.sendAlerts(client, appConfig.alertChannelId, criticalAlerts, {
        mode: 'critical',
        roleId: appConfig.alertRoleId,
        thresholdHours: CRITICAL_THRESHOLD_HOURS,
        corporationName: report.corporationName,
        forceSendCurrentCritical: Boolean(options.forceSendCurrentCritical),
      });
    }
    if (recoveredAlerts.length > 0) {
      recoveredMessageSent = await options.sendAlerts(client, appConfig.alertChannelId, recoveredAlerts, {
        mode: 'recovered',
        roleId: '',
        thresholdHours: CRITICAL_THRESHOLD_HOURS,
        corporationName: report.corporationName,
      });
    }
  }

  const trackable = stabilized.filter((item) => item.isAlertTrackable);
  return {
    checkedAt: report.checkedAt,
    corporationId: report.corporationId,
    corporationName: report.corporationName,
    authorizedCharacterId: report.authorizedCharacterId,
    authorizedCharacterName: report.authorizedCharacterName,
    criticalThresholdHours: CRITICAL_THRESHOLD_HOURS,
    totalCount: report.totalCount,
    structureCount: report.structureCount,
    posCount: report.posCount,
    disabledStructureCount: report.disabledStructureCount,
    criticalCount: trackable.filter((item) => item.isCritical).length,
    criticalUpwellCount: trackable.filter((item) => !item.isPos && !item.isMetenox && item.isCritical).length,
    criticalMetenoxCount: trackable.filter((item) => item.isMetenox && item.isCritical).length,
    criticalPosCount: trackable.filter((item) => item.isPos && item.isCritical).length,
    noFuelDataCount: report.noFuelDataCount,
    alertChannelConfigured: Boolean(appConfig.alertChannelId),
    alertRoleConfigured: Boolean(appConfig.alertRoleId),
    forceSendCurrentCritical: Boolean(options.forceSendCurrentCritical),
    newCriticalAlertsCount,
    criticalAlertsCount: criticalAlerts.length,
    recoveredAlertsCount: recoveredAlerts.length,
    criticalMessageSent,
    recoveredMessageSent,
    criticalAlerts,
    recoveredAlerts,
  };
}

module.exports = {
  CRITICAL_THRESHOLD_HOURS,
  MAGMATIC_GAS_TYPE_ID,
  METENOX_TYPE_ID,
  METENOX_FUEL_BLOCK_RATE_PER_HOUR,
  METENOX_MAGMATIC_GAS_RATE_PER_HOUR,
  METENOX_ZERO_RESOURCE_CONFIRMATION_RUNS,
  formatHours,
  getHoursRemaining,
  calculateHoursRemaining,
  isCriticalHours,
  classifyStructure,
  getPosFuelRatePerHour,
  getPosStrontiumRatePerHour,
  buildAssetsByLocation,
  buildMetenoxFuelData,
  mapStructureItem,
  mapStarbaseItem,
  sortStructureItems,
  loadStructureFuelSnapshot,
  getStructureFuelReport,
  readStructureConfig,
  setStructureFuelAlertChannel,
  clearStructureFuelAlertChannel,
  setStructureFuelAlertRole,
  clearStructureFuelAlertRole,
  stabilizeMetenox,
  processStructureFuelAlerts,
};
