const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { buildConfig } = require('../src/config/env');
const {
  createDefaultUserPreferences,
  getUserLanguage,
  setUserLanguage,
} = require('../src/localization/userLanguageRepository');
const {
  dictionaries,
  translate,
  resolveUserLanguage,
} = require('../src/localization/localizationService');
const { initializeBaseStorage } = require('../src/storage/initializeStorage');

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-i18n-'));
  try {
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function createConfig(root) {
  return buildConfig({
    DISCORD_TOKEN: 'token',
    DISCORD_CLIENT_ID: '111111111111111111',
    BOT_OWNER_IDS: '222222222222222222',
    EVE_SSO_CLIENT_ID: 'eve-client',
    EVE_SSO_REDIRECT_URI: 'http://127.0.0.1:3000/auth/eve/callback',
    CORPDB_STORAGE_DIR: root,
  });
}

test('English is the default language when no preference exists', async () => {
  await withTempStorage(async (root) => {
    await initializeBaseStorage(root);
    const config = createConfig(root);

    assert.equal(config.localization.defaultLanguage, 'en');
    assert.equal(
      await resolveUserLanguage(root, config, '333333333333333333'),
      'en'
    );
  });
});

test('language preference is persisted by Discord user ID', async () => {
  await withTempStorage(async (root) => {
    await initializeBaseStorage(root);
    assert.deepEqual(createDefaultUserPreferences(), { version: 1, users: {} });

    await setUserLanguage(root, '333333333333333333', 'ru', {
      now: '2026-09-01T00:00:00.000Z',
    });

    assert.equal(await getUserLanguage(root, '333333333333333333'), 'ru');
    assert.equal(await getUserLanguage(root, '444444444444444444'), null);
  });
});

test('each selectable language uses its own dictionary', () => {
  assert.notEqual(dictionaries.en, dictionaries.ru);
  assert.equal(translate('en', 'language.changed'), 'Language changed to English.');
  assert.equal(translate('ru', 'language.changed'), 'Язык изменён на русский.');
});

test('all selectable dictionaries expose the same translation keys', () => {
  const englishKeys = Object.keys(dictionaries.en).sort();
  assert.deepEqual(Object.keys(dictionaries.ru).sort(), englishKeys);
});

test('translation interpolation works independently in each dictionary', () => {
  assert.equal(
    translate('en', 'members.status.active', { count: 7 }),
    'Active members: **7**'
  );
  assert.equal(
    translate('ru', 'members.status.active', { count: 7 }),
    'Активных участников: **7**'
  );
});

test('direct-message role labels never emit guild role mentions', () => {
  const roleMention = '<@&73002>';
  const cases = [
    ['en', 'binding.dm.roleGranted', 'Granted role: **Rookie**'],
    ['ru', 'binding.dm.roleGranted', 'Выдана роль: **Rookie**'],
    ['en', 'bindingAdmin.dm.role', 'Granted role: **Rookie**'],
    ['ru', 'bindingAdmin.dm.role', 'Выдана роль: **Rookie**'],
    ['en', 'promotion.dm.role', 'Granted role: **Main**'],
    ['ru', 'promotion.dm.role', 'Выдана роль: **Main**'],
  ];

  for (const [language, key, expected] of cases) {
    const value = translate(language, key, { role: roleMention });
    assert.equal(value, expected);
    assert.doesNotMatch(value, /<@&\d+>/);
  }
});

test('unknown language falls back to the English/default dictionary', () => {
  assert.equal(
    translate('unsupported', 'language.changed'),
    'Language changed to English.'
  );
});
