const {
  readStructureConfig,
  updateStructureConfig,
  alertFilterKey,
  normalizeAlertFilter,
} = require('./structureConfigRepository');
const {
  buildSelectorCatalogFromFuelItems,
  decorateFuelItemsWithCatalog,
  matchesStructureSelector,
  normalizeSelector,
  selectorHasValue,
} = require('./structureSelectorService');
const { processStructureFuelAlerts } = require('./structureFuelService');

function addDisabledAlertFilterToList(filters, selector) {
  const normalized = normalizeAlertFilter(selector);
  if (!selectorHasValue(normalized)) throw new Error('Select at least one structure filter.');
  const map = new Map((Array.isArray(filters) ? filters : []).map((entry) => [alertFilterKey(entry), normalizeAlertFilter(entry)]));
  const key = alertFilterKey(normalized);
  const existed = map.has(key);
  map.set(key, normalized);
  return {
    filters: [...map.values()].sort((left, right) => alertFilterKey(left).localeCompare(alertFilterKey(right))),
    changed: !existed,
    filter: normalized,
  };
}

function removeDisabledAlertFilterFromList(filters, selector) {
  const normalized = normalizeAlertFilter(selector);
  if (!selectorHasValue(normalized)) throw new Error('Select at least one structure filter.');
  const key = alertFilterKey(normalized);
  const current = Array.isArray(filters) ? filters : [];
  const next = current.filter((entry) => alertFilterKey(entry) !== key);
  return {
    filters: next,
    changed: next.length !== current.length,
    filter: normalized,
  };
}

async function addDisabledAlertFilter(storageRoot, corporationId, selector) {
  const config = await readStructureConfig(storageRoot, corporationId);
  const result = addDisabledAlertFilterToList(config.disabledAlertFilters, selector);
  if (result.changed) {
    await updateStructureConfig(storageRoot, corporationId, {
      disabledAlertFilters: result.filters,
    });
  }
  return result;
}

async function removeDisabledAlertFilter(storageRoot, corporationId, selector) {
  const config = await readStructureConfig(storageRoot, corporationId);
  const result = removeDisabledAlertFilterFromList(config.disabledAlertFilters, selector);
  if (result.changed) {
    await updateStructureConfig(storageRoot, corporationId, {
      disabledAlertFilters: result.filters,
    });
  }
  return result;
}

function isAlertDisabledForItem(item, filters) {
  return (Array.isArray(filters) ? filters : []).some((filter) => matchesStructureSelector(item, filter));
}

function findStoredFilter(filters, rawSelector) {
  const selector = normalizeSelector(rawSelector);
  if (!selectorHasValue(selector)) throw new Error('Select at least one structure filter.');
  const specificity = selector.structureId ? 'structureId'
    : selector.typeId ? 'typeId'
      : selector.groupId ? 'groupId'
        : 'class';
  const matches = (Array.isArray(filters) ? filters : []).filter((filter) => {
    const value = normalizeAlertFilter(filter);
    if (specificity === 'structureId' && !value.structureId) return false;
    if (specificity === 'typeId' && (!value.typeId || value.structureId)) return false;
    if (specificity === 'groupId' && (!value.groupId || value.typeId || value.structureId)) return false;
    if (specificity === 'class' && (!value.class || value.groupId || value.typeId || value.structureId)) return false;
    if (selector.class && value.class !== selector.class) return false;
    if (selector.groupId && value.groupId !== selector.groupId) return false;
    if (selector.typeId && value.typeId !== selector.typeId) return false;
    if (selector.structureId && value.structureId !== selector.structureId) return false;
    return true;
  });
  if (matches.length === 0) return null;
  if (matches.length > 1) throw new Error('The selector matches multiple disabled alert filters. Narrow the selection.');
  return normalizeAlertFilter(matches[0]);
}

async function processStructureFuelAlertsWithFilters(
  config,
  storageRoot,
  corporationId,
  client,
  options = {}
) {
  const structureConfig = await readStructureConfig(storageRoot, corporationId);
  const baseReportImpl = options.baseGetStructureFuelReport || require('./structureFuelService').getStructureFuelReport;
  let suppressedAlertCount = 0;

  const filteredReportImpl = async (innerConfig, innerRoot, innerCorporationId, innerOptions = {}) => {
    const report = await baseReportImpl(innerConfig, innerRoot, innerCorporationId, innerOptions);
    const catalog = await buildSelectorCatalogFromFuelItems(innerConfig, report.items, innerOptions);
    const decorated = decorateFuelItemsWithCatalog(report.items, catalog);
    const enabledItems = [];
    suppressedAlertCount = 0;
    for (const item of decorated) {
      const disabled = isAlertDisabledForItem(item, structureConfig.disabledAlertFilters);
      if (disabled && item.isAlertTrackable) suppressedAlertCount += 1;
      if (!disabled) enabledItems.push(item);
    }
    return {
      ...report,
      items: enabledItems,
      alertSuppressedCount: suppressedAlertCount,
    };
  };

  const result = await processStructureFuelAlerts(
    config,
    storageRoot,
    corporationId,
    client,
    {
      ...options,
      getStructureFuelReport: filteredReportImpl,
    }
  );

  return {
    ...result,
    alertSuppressedCount: suppressedAlertCount,
  };
}

module.exports = {
  addDisabledAlertFilterToList,
  removeDisabledAlertFilterFromList,
  addDisabledAlertFilter,
  removeDisabledAlertFilter,
  isAlertDisabledForItem,
  findStoredFilter,
  processStructureFuelAlertsWithFilters,
};
