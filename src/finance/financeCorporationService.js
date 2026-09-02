const { readRegistry } = require('../corporations/corporationRegistryRepository');
const { readCorporationProfile } = require('../corporations/corporationProfileRepository');

async function listEnabledFinanceCorporationIds(storageRoot) {
  const registry = await readRegistry(storageRoot);
  return registry.corporations
    .filter((entry) => entry.enabled && entry.features?.finance !== false)
    .map((entry) => entry.corporationId);
}

async function listFinanceCorporationChoices(storageRoot, options = {}) {
  const registry = await readRegistry(storageRoot);
  const enabled = registry.corporations.filter(
    (entry) => entry.enabled && entry.features?.finance !== false
  );
  const choices = [];

  if (options.allowAll && enabled.length > 1) {
    choices.push({ name: 'All corporations', value: 'all' });
  }

  for (const entry of enabled) {
    const profile = await readCorporationProfile(storageRoot, entry.corporationId, {
      createIfMissing: false,
    }).catch(() => null);
    const name = String(profile?.name || '').trim();
    const ticker = String(profile?.ticker || '').trim();
    const label = name
      ? `${name}${ticker ? ` [${ticker}]` : ''}`
      : entry.corporationId;
    choices.push({
      name: label.slice(0, 100),
      value: entry.corporationId,
    });
  }

  return choices;
}

async function autocompleteFinanceCorporations(storageRoot, focusedValue, options = {}) {
  const query = String(focusedValue || '').trim().toLowerCase();
  const choices = await listFinanceCorporationChoices(storageRoot, options);
  return choices
    .filter((choice) => {
      if (!query) return true;
      return choice.name.toLowerCase().includes(query) || choice.value.toLowerCase().includes(query);
    })
    .slice(0, 25);
}

async function resolveFinanceCorporationIds(storageRoot, requestedValue, options = {}) {
  const registry = await readRegistry(storageRoot);
  const enabled = registry.corporations.filter(
    (entry) => entry.enabled && entry.features?.finance !== false
  );
  const requested = String(requestedValue || '').trim().toLowerCase();

  if (options.allowAll && requested === 'all') {
    if (enabled.length === 0) throw new Error('No corporation is enabled for finance.');
    return enabled.map((entry) => entry.corporationId);
  }

  if (requested) {
    const registration = enabled.find((entry) => entry.corporationId === requested);
    if (!registration) {
      throw new Error(`Corporation ${requested} is not registered or finance is disabled for it.`);
    }
    return [registration.corporationId];
  }

  const defaultRegistration = enabled.find(
    (entry) => entry.corporationId === registry.defaultCorporationId
  );
  if (defaultRegistration) return [defaultRegistration.corporationId];
  if (enabled.length === 1) return [enabled[0].corporationId];
  if (enabled.length === 0) throw new Error('No corporation is enabled for finance.');
  throw new Error('No default finance corporation is configured.');
}

module.exports = {
  listEnabledFinanceCorporationIds,
  listFinanceCorporationChoices,
  autocompleteFinanceCorporations,
  resolveFinanceCorporationIds,
};
