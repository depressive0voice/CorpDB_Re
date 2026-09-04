const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { initializeBaseStorage } = require('../src/storage/initializeStorage');
const { saveEveAuthorization } = require('../src/eve/eveOAuthRepository');
const { createTranslator } = require('../src/localization/localizationService');
const authCommand = require('../src/discord/commands/authCommand');

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-auth-status-'));
  try {
    await initializeBaseStorage(root);
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function createContext(root) {
  const config = {
    storage: { rootDir: root },
    discord: { ownerIds: ['90001'] },
    localization: { defaultLanguage: 'en', enabledLanguages: ['en', 'ru'] },
  };
  return {
    config,
    language: 'en',
    t: createTranslator('en', config),
  };
}

function createStatusInteraction() {
  const messages = [];
  return {
    messages,
    deferred: false,
    replied: false,
    user: { id: '90001', tag: 'owner', username: 'owner' },
    member: {},
    options: {
      getSubcommand() { return 'status'; },
      getSubcommandGroup() { return null; },
    },
    async deferReply() {
      this.deferred = true;
    },
    async editReply(payload) {
      this.replied = true;
      messages.push(payload.content);
    },
    async followUp(payload) {
      messages.push(payload.content);
    },
    async reply(payload) {
      this.replied = true;
      messages.push(payload.content);
    },
  };
}

test('auth status chunks long corporation role lists without exceeding Discord message limits', async () => {
  await withTempStorage(async (root) => {
    const roles = Array.from({ length: 220 }, (_, index) => (
      `Role-${String(index).padStart(3, '0')}-${'x'.repeat(18)}`
    ));
    await saveEveAuthorization(root, {
      corporationId: '98842748',
      characterId: '10001',
      characterName: 'Service Pilot',
      refreshToken: 'refresh-token',
      scopes: ['scope-a', 'scope-b'],
      corporationRoles: roles,
    });

    const interaction = createStatusInteraction();
    await authCommand.execute(interaction, createContext(root));

    assert.equal(interaction.deferred, true);
    assert.ok(interaction.messages.length > 1);
    for (const message of interaction.messages) {
      assert.ok(message.length <= 1800, `message length ${message.length} exceeds chunk limit`);
    }

    const combined = interaction.messages.join('\n');
    assert.match(combined, /Service Pilot/);
    assert.match(combined, /Role-000-/);
    assert.match(combined, /Role-219-/);
  });
});

test('chunkLines preserves the full content of one oversized line', () => {
  const source = `prefix ${Array.from({ length: 180 }, (_, index) => `item-${index}`).join(', ')} suffix`;
  const chunks = authCommand.chunkLines([source], 120);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 120));
  const normalized = chunks.join(' ').replace(/\s+/g, ' ');
  assert.match(normalized, /prefix/);
  assert.match(normalized, /item-179/);
  assert.match(normalized, /suffix/);
});
