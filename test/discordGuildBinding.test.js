const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { initializeBaseStorage } = require('../src/storage/initializeStorage');
const {
  readDiscordGuildBinding,
} = require('../src/discord/discordGuildBindingRepository');
const {
  reconcileDiscordGuildBinding,
} = require('../src/discord/discordGuildBindingService');

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-discord-test-'));
  try {
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function guild(id, name) {
  return { id, name };
}

test('clean storage waits for a Discord invite', async () => {
  await withTempStorage(async (root) => {
    await initializeBaseStorage(root);

    const result = await reconcileDiscordGuildBinding(root, []);
    const binding = await readDiscordGuildBinding(root);

    assert.equal(result.status, 'waiting-for-invite');
    assert.equal(binding.guildId, '');
  });
});

test('a single available Discord guild is bound automatically', async () => {
  await withTempStorage(async (root) => {
    await initializeBaseStorage(root);

    const result = await reconcileDiscordGuildBinding(root, [
      guild('111111111111111111', 'Corp Server'),
    ]);
    const binding = await readDiscordGuildBinding(root);

    assert.equal(result.status, 'bound-new');
    assert.equal(binding.guildId, '111111111111111111');
    assert.equal(binding.guildName, 'Corp Server');
    assert.ok(binding.boundAt);
  });
});

test('multiple guilds before first binding are never selected implicitly', async () => {
  await withTempStorage(async (root) => {
    await initializeBaseStorage(root);

    const result = await reconcileDiscordGuildBinding(root, [
      guild('111111111111111111', 'First'),
      guild('222222222222222222', 'Second'),
    ]);
    const binding = await readDiscordGuildBinding(root);

    assert.equal(result.status, 'ambiguous');
    assert.equal(binding.guildId, '');
    assert.equal(result.availableGuildsCount, 2);
  });
});

test('an existing guild binding is not replaced by a later invite', async () => {
  await withTempStorage(async (root) => {
    await initializeBaseStorage(root);

    await reconcileDiscordGuildBinding(root, [
      guild('111111111111111111', 'Primary'),
    ]);

    const result = await reconcileDiscordGuildBinding(root, [
      guild('111111111111111111', 'Primary'),
      guild('222222222222222222', 'Extra'),
    ]);
    const binding = await readDiscordGuildBinding(root);

    assert.equal(result.status, 'bound-with-extra-guilds');
    assert.equal(binding.guildId, '111111111111111111');
    assert.equal(result.additionalGuilds.length, 1);
    assert.equal(result.additionalGuilds[0].guildId, '222222222222222222');
  });
});

test('a missing bound guild does not cause automatic rebinding', async () => {
  await withTempStorage(async (root) => {
    await initializeBaseStorage(root);

    await reconcileDiscordGuildBinding(root, [
      guild('111111111111111111', 'Primary'),
    ]);

    const result = await reconcileDiscordGuildBinding(root, [
      guild('222222222222222222', 'Other'),
    ]);
    const binding = await readDiscordGuildBinding(root);

    assert.equal(result.status, 'bound-guild-unavailable');
    assert.equal(binding.guildId, '111111111111111111');
  });
});
