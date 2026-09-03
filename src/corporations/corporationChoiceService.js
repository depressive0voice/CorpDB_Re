const { readRegistry } = require('./corporationRegistryRepository');
const { readCorporationProfile } = require('./corporationProfileRepository');

function normalizeQuery(value) {
  return String(value || '').trim().toLowerCase();
}

function isEligibleCorporation(entry, options = {}) {
  if (options.enabledOnly !== false && !entry.enabled) return false;
  const feature = String(options.feature || '').trim();
  if (feature && entry.features?.[feature] === false) return false;
  return true;
}

async function listCorporationChoices(storageRoot, options = {}) {
  const registry = await readRegistry(storageRoot);
  const registrations = registry.corporations.filter((entry) => isEligibleCorporation(entry, options));
  const choices = [];

  if (options.allowAll && registrations.length > 1) {
    choices.push({
      name: String(options.allLabel || 'All corporations').slice(0, 100),
      value: 'all',
    });
  }

  for (const entry of registrations) {
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

async function autocompleteCorporations(storageRoot, focusedValue, options = {}) {
  const query = normalizeQuery(focusedValue);
  const choices = await listCorporationChoices(storageRoot, options);
  return choices
    .filter((choice) => {
      if (!query) return true;
      return choice.name.toLowerCase().includes(query) || choice.value.toLowerCase().includes(query);
    })
    .slice(0, 25);
}

module.exports = {
  listCorporationChoices,
  autocompleteCorporations,
};
