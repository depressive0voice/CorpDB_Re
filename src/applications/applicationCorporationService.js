const { readRegistry } = require('../corporations/corporationRegistryRepository');
const { readCorporationProfile } = require('../corporations/corporationProfileRepository');

async function listEnabledApplicationCorporationIds(storageRoot) {
  const registry = await readRegistry(storageRoot);
  return registry.corporations
    .filter((entry) => entry.enabled && entry.features?.applications !== false)
    .map((entry) => entry.corporationId);
}

async function listApplicationCorporationChoices(storageRoot, options = {}) {
  const registry = await readRegistry(storageRoot);
  const enabled = registry.corporations.filter(
    (entry) => entry.enabled && entry.features?.applications !== false
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
    choices.push({
      name: (name ? `${name}${ticker ? ` [${ticker}]` : ''}` : entry.corporationId).slice(0, 100),
      value: entry.corporationId,
    });
  }

  return choices;
}

async function autocompleteApplicationCorporations(storageRoot, focusedValue, options = {}) {
  const query = String(focusedValue || '').trim().toLowerCase();
  const choices = await listApplicationCorporationChoices(storageRoot, options);
  return choices
    .filter((choice) => {
      if (!query) return true;
      return choice.name.toLowerCase().includes(query) || choice.value.toLowerCase().includes(query);
    })
    .slice(0, 25);
}

async function resolveApplicationCorporationIds(storageRoot, requestedValue, options = {}) {
  const registry = await readRegistry(storageRoot);
  const enabled = registry.corporations.filter(
    (entry) => entry.enabled && entry.features?.applications !== false
  );
  const requested = String(requestedValue || '').trim().toLowerCase();

  if (options.allowAll && requested === 'all') {
    if (enabled.length === 0) throw new Error('No corporation is enabled for applications.');
    return enabled.map((entry) => entry.corporationId);
  }

  if (requested) {
    const registration = enabled.find((entry) => entry.corporationId === requested);
    if (!registration) {
      throw new Error(`Corporation ${requested} is not registered or applications are disabled for it.`);
    }
    return [registration.corporationId];
  }

  const defaultRegistration = enabled.find(
    (entry) => entry.corporationId === registry.defaultCorporationId
  );
  if (defaultRegistration) return [defaultRegistration.corporationId];
  if (enabled.length === 1) return [enabled[0].corporationId];
  if (enabled.length === 0) throw new Error('No corporation is enabled for applications.');
  throw new Error('No default applications corporation is configured.');
}

module.exports = {
  listEnabledApplicationCorporationIds,
  listApplicationCorporationChoices,
  autocompleteApplicationCorporations,
  resolveApplicationCorporationIds,
};
