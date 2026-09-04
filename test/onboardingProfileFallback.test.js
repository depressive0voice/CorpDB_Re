const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { initializeBaseStorage } = require('../src/storage/initializeStorage');
const { registerCorporation } = require('../src/corporations/corporationRegistryRepository');
const {
  upsertOnboardingProfile,
  assignCorporationProfile,
  deleteOnboardingProfile,
} = require('../src/onboarding/onboardingConfigRepository');
const { resolveProfileForBinding } = require('../src/onboarding/promotionService');

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-onboarding-profile-fallback-'));
  try {
    await initializeBaseStorage(root);
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('bindings fall back to default when their saved onboarding profile was deleted', async () => {
  await withTempStorage(async (root) => {
    await registerCorporation(root, '88001');
    await registerCorporation(root, '88002');
    await upsertOnboardingProfile(root, 'default', { probationMonths: 3 });
    await upsertOnboardingProfile(root, 'special', { probationMonths: 6 });
    await assignCorporationProfile(root, '88001', 'special');

    await deleteOnboardingProfile(root, 'special');

    const resolved = await resolveProfileForBinding(root, {
      onboardingProfileId: 'special',
      corporationIds: ['88001'],
    });

    assert.equal(resolved.profileId, 'default');
    assert.equal(resolved.profile.probationMonths, 3);
    assert.deepEqual(resolved.corporationIds, ['88001']);
  });
});
