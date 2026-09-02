const { requestEsiJson } = require('../eve/eveEsiClient');
const {
  getCorporationStructures,
  getCorporationStarbases,
  resolveUniverseNameMap,
} = require('./structureEsiService');
const { readStructureConfig } = require('./structureConfigRepository');

const STRUCTURE_CLASSES = Object.freeze({
  UPWELL: 'upwell',
  POS: 'pos',
});
const SELECTOR_CACHE_TTL_MS = 5 * 60 * 1000;

const typeCache = new Map();
const groupCache = new Map();
const selectorCatalogCache = new Map();

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeClass(value) {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === STRUCTURE_CLASSES.UPWELL || normalized === STRUCTURE_CLASSES.POS
    ? normalized
    : '';
}

function unique(values) {
  return [...new Set(values)];
}

function cacheKey(config, id) {
  return `${normalizeText(config?.eve?.compatibilityDate)}:${normalizeText(id)}`;
}

async function getUniverseTypeDescriptor(config, typeId, options = {}) {
  const id = normalizeText(typeId);
  if (!/^\d+$/.test(id)) return null;
  const key = cacheKey(config, id);
  if (!options.noTaxonomyCache && typeCache.has(key)) return typeCache.get(key);

  const promise = (async () => {
    const value = await requestEsiJson(config, `/universe/types/${id}/`, options);
    return {
      typeId: id,
      typeName: normalizeText(value?.name) || `Type ${id}`,
      groupId: normalizeText(value?.group_id),
    };
  })();

  if (!options.noTaxonomyCache) typeCache.set(key, promise);
  try {
    return await promise;
  } catch (error) {
    typeCache.delete(key);
    throw error;
  }
}

async function getUniverseGroupDescriptor(config, groupId, options = {}) {
  const id = normalizeText(groupId);
  if (!/^\d+$/.test(id)) return null;
  const key = cacheKey(config, id);
  if (!options.noTaxonomyCache && groupCache.has(key)) return groupCache.get(key);

  const promise = (async () => {
    const value = await requestEsiJson(config, `/universe/groups/${id}/`, options);
    return {
      groupId: id,
      groupName: normalizeText(value?.name) || `Group ${id}`,
      categoryId: normalizeText(value?.category_id),
    };
  })();

  if (!options.noTaxonomyCache) groupCache.set(key, promise);
  try {
    return await promise;
  } catch (error) {
    groupCache.delete(key);
    throw error;
  }
}

async function resolveUniverseTypeTaxonomy(config, typeIds, options = {}) {
  const ids = unique((Array.isArray(typeIds) ? typeIds : [])
    .map(normalizeText)
    .filter((value) => /^\d+$/.test(value)));
  const typeDescriptors = await Promise.all(ids.map(async (typeId) => {
    try {
      return await getUniverseTypeDescriptor(config, typeId, options);
    } catch {
      return { typeId, typeName: `Type ${typeId}`, groupId: '' };
    }
  }));
  const groupIds = unique(typeDescriptors.map((entry) => entry?.groupId).filter(Boolean));
  const groupDescriptors = await Promise.all(groupIds.map(async (groupId) => {
    try {
      return await getUniverseGroupDescriptor(config, groupId, options);
    } catch {
      return { groupId, groupName: `Group ${groupId}`, categoryId: '' };
    }
  }));
  const groups = new Map(groupDescriptors.filter(Boolean).map((entry) => [entry.groupId, entry]));
  return new Map(typeDescriptors.filter(Boolean).map((entry) => {
    const group = groups.get(entry.groupId) || null;
    return [entry.typeId, {
      typeId: entry.typeId,
      typeName: entry.typeName,
      groupId: entry.groupId,
      groupName: group?.groupName || (entry.groupId ? `Group ${entry.groupId}` : ''),
      categoryId: group?.categoryId || '',
    }];
  }));
}

function createCatalogEntry(value = {}) {
  return {
    class: normalizeClass(value.class),
    groupId: normalizeText(value.groupId),
    groupName: normalizeText(value.groupName),
    typeId: normalizeText(value.typeId),
    typeName: normalizeText(value.typeName),
    structureId: normalizeText(value.structureId),
    structureName: normalizeText(value.structureName),
    systemId: normalizeText(value.systemId),
    systemName: normalizeText(value.systemName),
  };
}

async function buildSelectorCatalogFromFuelItems(config, items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  const taxonomy = await resolveUniverseTypeTaxonomy(
    config,
    list.map((item) => item?.typeId).filter(Boolean),
    options
  );
  return list.map((item) => {
    const typeId = normalizeText(item?.typeId);
    const descriptor = taxonomy.get(typeId) || {};
    return createCatalogEntry({
      class: item?.isPos ? STRUCTURE_CLASSES.POS : STRUCTURE_CLASSES.UPWELL,
      groupId: descriptor.groupId,
      groupName: descriptor.groupName,
      typeId,
      typeName: descriptor.typeName || normalizeText(item?.typeName) || `Type ${typeId}`,
      structureId: normalizeText(item?.structureId),
      structureName: normalizeText(item?.name) || normalizeText(item?.structureId),
      systemId: normalizeText(item?.systemId),
      systemName: normalizeText(item?.systemName),
    });
  });
}

async function loadStructureSelectorCatalog(config, storageRoot, corporationId, options = {}) {
  const corporationKey = normalizeText(corporationId);
  const key = `${normalizeText(config?.eve?.compatibilityDate)}:${corporationKey}`;
  const now = Date.now();
  const cached = selectorCatalogCache.get(key);
  if (!options.noSelectorCache && cached && cached.expiresAt > now) return cached.entries;

  const appConfig = await readStructureConfig(storageRoot, corporationKey);
  const disabledTypeIds = new Set(appConfig.disabledTypeIds || []);
  const [structuresResult, starbasesResult] = await Promise.all([
    (options.getCorporationStructures || getCorporationStructures)(
      config,
      storageRoot,
      corporationKey,
      options
    ).catch(() => []),
    (options.getCorporationStarbases || getCorporationStarbases)(
      config,
      storageRoot,
      corporationKey,
      options
    ).catch(() => []),
  ]);

  const structures = (Array.isArray(structuresResult) ? structuresResult : [])
    .filter((item) => !disabledTypeIds.has(normalizeText(item?.type_id)));
  const starbases = Array.isArray(starbasesResult) ? starbasesResult : [];
  const typeIds = [
    ...structures.map((item) => normalizeText(item?.type_id)),
    ...starbases.map((item) => normalizeText(item?.type_id)),
  ].filter(Boolean);
  const taxonomy = await resolveUniverseTypeTaxonomy(config, typeIds, options);
  const locationIds = unique([
    ...structures.map((item) => normalizeText(item?.system_id)),
    ...starbases.map((item) => normalizeText(item?.system_id)),
    ...starbases.map((item) => normalizeText(item?.moon_id)),
  ].filter(Boolean));
  const resolveNames = options.resolveUniverseNameMap || resolveUniverseNameMap;
  const nameMap = await resolveNames(config, locationIds, options).catch(() => new Map());

  const entries = [
    ...structures.map((item) => {
      const typeId = normalizeText(item?.type_id);
      const descriptor = taxonomy.get(typeId) || {};
      const structureId = normalizeText(item?.structure_id);
      const systemId = normalizeText(item?.system_id);
      return createCatalogEntry({
        class: STRUCTURE_CLASSES.UPWELL,
        groupId: descriptor.groupId,
        groupName: descriptor.groupName,
        typeId,
        typeName: descriptor.typeName || `Type ${typeId}`,
        structureId,
        structureName: normalizeText(item?.name) || `Structure ${structureId}`,
        systemId,
        systemName: nameMap.get(systemId) || systemId,
      });
    }),
    ...starbases.map((item) => {
      const typeId = normalizeText(item?.type_id);
      const descriptor = taxonomy.get(typeId) || {};
      const starbaseId = normalizeText(item?.starbase_id);
      const structureId = `pos:${starbaseId}`;
      const systemId = normalizeText(item?.system_id);
      const moonId = normalizeText(item?.moon_id);
      const moonName = nameMap.get(moonId) || moonId;
      return createCatalogEntry({
        class: STRUCTURE_CLASSES.POS,
        groupId: descriptor.groupId,
        groupName: descriptor.groupName,
        typeId,
        typeName: descriptor.typeName || `Type ${typeId}`,
        structureId,
        structureName: moonName ? `POS ${moonName}` : `POS ${starbaseId}`,
        systemId,
        systemName: nameMap.get(systemId) || systemId,
      });
    }),
  ];

  if (!options.noSelectorCache) {
    selectorCatalogCache.set(key, {
      expiresAt: now + SELECTOR_CACHE_TTL_MS,
      entries,
    });
  }
  return entries;
}

function normalizeSelector(value = {}) {
  return {
    class: normalizeClass(value.class),
    groupId: normalizeText(value.groupId || value.group),
    typeId: normalizeText(value.typeId || value.type),
    structureId: normalizeText(value.structureId || value.structure),
  };
}

function selectorHasValue(selector) {
  const value = normalizeSelector(selector);
  return Boolean(value.class || value.groupId || value.typeId || value.structureId);
}

function matchesStructureSelector(entry, selector) {
  const item = entry || {};
  const rule = normalizeSelector(selector);
  if (rule.class && normalizeClass(item.class) !== rule.class) return false;
  if (rule.groupId && normalizeText(item.groupId) !== rule.groupId) return false;
  if (rule.typeId && normalizeText(item.typeId) !== rule.typeId) return false;
  if (rule.structureId && normalizeText(item.structureId) !== rule.structureId) return false;
  return true;
}

function filterCatalogBySelector(entries, selector) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => matchesStructureSelector(entry, selector));
}

function canonicalizeSelectorFromCatalog(entries, selector) {
  const raw = normalizeSelector(selector);
  if (!selectorHasValue(raw)) throw new Error('Select at least one structure filter.');
  const matches = filterCatalogBySelector(entries, raw);
  if (matches.length === 0) throw new Error('The selected structure filter does not match any current object.');

  const reference = matches[0];
  if (raw.structureId) {
    const exact = matches.find((entry) => entry.structureId === raw.structureId);
    if (!exact) throw new Error('The selected structure was not found.');
    return normalizeSelector({
      class: exact.class,
      groupId: exact.groupId,
      typeId: exact.typeId,
      structureId: exact.structureId,
    });
  }
  if (raw.typeId) {
    return normalizeSelector({
      class: reference.class,
      groupId: reference.groupId,
      typeId: reference.typeId,
    });
  }
  if (raw.groupId) {
    const classes = unique(matches.map((entry) => entry.class));
    if (classes.length > 1 && !raw.class) throw new Error('Select class before this group.');
    return normalizeSelector({
      class: raw.class || reference.class,
      groupId: reference.groupId,
    });
  }
  return normalizeSelector({ class: reference.class });
}

function decorateFuelItemsWithCatalog(items, entries) {
  const byStructure = new Map((Array.isArray(entries) ? entries : [])
    .map((entry) => [entry.structureId, entry]));
  return (Array.isArray(items) ? items : []).map((item) => {
    const entry = byStructure.get(normalizeText(item?.structureId));
    return {
      ...item,
      class: entry?.class || (item?.isPos ? STRUCTURE_CLASSES.POS : STRUCTURE_CLASSES.UPWELL),
      groupId: entry?.groupId || '',
      groupName: entry?.groupName || '',
    };
  });
}

function filterFuelItemsBySelector(items, selector) {
  const rule = normalizeSelector(selector);
  if (!selectorHasValue(rule)) return [...(Array.isArray(items) ? items : [])];
  return (Array.isArray(items) ? items : []).filter((item) => matchesStructureSelector(item, rule));
}

function classLabel(value) {
  return normalizeClass(value) === STRUCTURE_CLASSES.POS ? 'POS' : 'Upwell';
}

function formatSelectorLabel(selector, metadata = {}) {
  const rule = normalizeSelector(selector);
  const lines = [];
  if (rule.class) lines.push(`Class: ${classLabel(rule.class)}`);
  if (rule.groupId) lines.push(`Group: ${normalizeText(metadata.groupName) || rule.groupId}`);
  if (rule.typeId) lines.push(`Type: ${normalizeText(metadata.typeName) || rule.typeId}`);
  if (rule.structureId) lines.push(`Structure: ${normalizeText(metadata.structureName) || rule.structureId}`);
  return lines.join(' → ') || 'All structures';
}

function metadataForSelector(entries, selector) {
  const rule = normalizeSelector(selector);
  const match = filterCatalogBySelector(entries, rule)[0] || null;
  return {
    groupName: match?.groupName || '',
    typeName: match?.typeName || '',
    structureName: match?.structureName || '',
  };
}

function makeChoices(values, focusedValue) {
  const query = normalizeText(focusedValue).toLowerCase();
  return values
    .filter((entry) => !query || entry.name.toLowerCase().includes(query) || entry.value.toLowerCase().includes(query))
    .slice(0, 25);
}

function selectorAutocompleteChoices(entries, fieldName, selector, focusedValue) {
  const raw = normalizeSelector(selector);
  const baseSelector = { ...raw };
  if (fieldName === 'class') baseSelector.class = '';
  if (fieldName === 'group') baseSelector.groupId = '';
  if (fieldName === 'type') baseSelector.typeId = '';
  if (fieldName === 'structure') baseSelector.structureId = '';
  const filtered = filterCatalogBySelector(entries, baseSelector);

  if (fieldName === 'class') {
    const classes = unique(filtered.map((entry) => entry.class).filter(Boolean));
    return makeChoices(classes.map((value) => ({ name: classLabel(value), value })), focusedValue);
  }
  if (fieldName === 'group') {
    const map = new Map();
    for (const entry of filtered) {
      if (entry.groupId) map.set(entry.groupId, entry.groupName || entry.groupId);
    }
    return makeChoices([...map.entries()].map(([value, name]) => ({ name, value })), focusedValue);
  }
  if (fieldName === 'type') {
    const map = new Map();
    for (const entry of filtered) {
      if (entry.typeId) map.set(entry.typeId, entry.typeName || entry.typeId);
    }
    return makeChoices([...map.entries()].map(([value, name]) => ({ name, value })), focusedValue);
  }
  if (fieldName === 'structure') {
    return makeChoices(filtered.map((entry) => ({
      name: `${entry.structureName}${entry.systemName ? ` | ${entry.systemName}` : ''}`.slice(0, 100),
      value: entry.structureId,
    })), focusedValue);
  }
  return [];
}

function clearStructureSelectorCache(corporationId = '') {
  const id = normalizeText(corporationId);
  if (!id) {
    selectorCatalogCache.clear();
    return;
  }
  for (const key of selectorCatalogCache.keys()) {
    if (key.endsWith(`:${id}`)) selectorCatalogCache.delete(key);
  }
}

module.exports = {
  STRUCTURE_CLASSES,
  SELECTOR_CACHE_TTL_MS,
  normalizeClass,
  normalizeSelector,
  selectorHasValue,
  getUniverseTypeDescriptor,
  getUniverseGroupDescriptor,
  resolveUniverseTypeTaxonomy,
  buildSelectorCatalogFromFuelItems,
  loadStructureSelectorCatalog,
  matchesStructureSelector,
  filterCatalogBySelector,
  canonicalizeSelectorFromCatalog,
  decorateFuelItemsWithCatalog,
  filterFuelItemsBySelector,
  classLabel,
  formatSelectorLabel,
  metadataForSelector,
  selectorAutocompleteChoices,
  clearStructureSelectorCache,
};
