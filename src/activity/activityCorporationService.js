const { readRegistry } = require('../corporations/corporationRegistryRepository');
const { readCorporationProfile } = require('../corporations/corporationProfileRepository');

async function listEnabledActivityCorporationIds(storageRoot) {
  const registry = await readRegistry(storageRoot);
  return registry.corporations
    .filter((entry) => entry.enabled && entry.features?.activity !== false)
    .map((entry) => entry.corporationId);
}

async function listActivityCorporationChoices(storageRoot) {
  const registry = await readRegistry(storageRoot);
  const enabled = registry.corporations.filter(
    (entry) => entry.enabled && entry.features?.activity !== false
  );
  const choices = [];
  for (const entry of enabled) {
    const profile = await readCorporationProfile(storageRoot, entry.corporationId, {
      createIfMissing: false,
    }).catch(() => null);
    const name = String(profile?.name || '').trim();
    const ticker = String(profile?.ticker || '').trim();
    choices.push({
      name: (name ? `${name}${ticker ? ` [${ticker}]` : ''}` : entry.corporationId).slice(0, 100),
      value: entry.corporationId,
    });
  }
  return choices;
}

async function autocompleteActivityCorporations(storageRoot, focusedValue) {
  const query = String(focusedValue || '').trim().toLowerCase();
  const choices = await listActivityCorporationChoices(storageRoot);
  return choices
    .filter((choice) => !query
      || choice.name.toLowerCase().includes(query)
      || choice.value.toLowerCase().includes(query))
    .slice(0, 25);
}

async function resolveActivityCorporationId(storageRoot, requestedValue = '') {
  const registry = await readRegistry(storageRoot);
  const enabled = registry.corporations.filter(
    (entry) => entry.enabled && entry.features?.activity !== false
  );
  const requested = String(requestedValue || '').trim();
  if (requested) {
    const registration = enabled.find((entry) => entry.corporationId === requested);
    if (!registration) {
      throw new Error(`Corporation ${requested} is not registered or Activity is disabled for it.`);
    }
    return registration.corporationId;
  }
  const defaultRegistration = enabled.find(
    (entry) => entry.corporationId === registry.defaultCorporationId
  );
  if (defaultRegistration) return defaultRegistration.corporationId;
  if (enabled.length === 1) return enabled[0].corporationId;
  if (enabled.length === 0) throw new Error('No corporation is enabled for Activity.');
  throw new Error('No default Activity corporation is configured.');
}

module.exports = {
  listEnabledActivityCorporationIds,
  listActivityCorporationChoices,
  autocompleteActivityCorporations,
  resolveActivityCorporationId,
};
