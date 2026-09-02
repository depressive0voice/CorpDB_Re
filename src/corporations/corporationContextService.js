const { normalizeCorporationId } = require('../storage/paths');
const {
  readRegistry,
  getCorporationRegistration,
} = require('./corporationRegistryRepository');
const { readCorporationProfile } = require('./corporationProfileRepository');

async function resolveCorporationId(storageRoot, requestedCorporationId = '') {
  if (String(requestedCorporationId ?? '').trim()) {
    return normalizeCorporationId(requestedCorporationId);
  }

  const registry = await readRegistry(storageRoot);
  if (!registry.defaultCorporationId) {
    throw new Error('No corporation is configured yet. Complete corporation authorization/setup first.');
  }

  return registry.defaultCorporationId;
}

async function getCorporationContext(storageRoot, requestedCorporationId = '') {
  const corporationId = await resolveCorporationId(storageRoot, requestedCorporationId);
  const registration = await getCorporationRegistration(storageRoot, corporationId);

  if (!registration) {
    throw new Error(`Corporation ${corporationId} is not registered.`);
  }

  const profile = await readCorporationProfile(storageRoot, corporationId, {
    createIfMissing: false,
  });

  return {
    corporationId,
    enabled: registration.enabled,
    features: { ...registration.features },
    profile,
  };
}

module.exports = {
  resolveCorporationId,
  getCorporationContext,
};
