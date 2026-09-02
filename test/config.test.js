const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseDiscordOwnerIds,
  buildConfig,
  validateConfig,
} = require('../src/config/env');

test('multiple bot owners are parsed, merged, and deduplicated', () => {
  const ownerIds = parseDiscordOwnerIds({
    BOT_OWNER_IDS: '111111111111111111, 222222222222222222,111111111111111111',
    BOT_OWNER_ID: '333333333333333333',
  });

  assert.deepEqual(ownerIds, [
    '111111111111111111',
    '222222222222222222',
    '333333333333333333',
  ]);
});

test('legacy single BOT_OWNER_ID remains a valid fallback and PKCE needs no client secret', () => {
  const config = buildConfig({
    DISCORD_TOKEN: 'token',
    DISCORD_CLIENT_ID: '111111111111111111',
    BOT_OWNER_ID: '333333333333333333',
    EVE_SSO_CLIENT_ID: 'eve-client',
    EVE_SSO_REDIRECT_URI: 'http://127.0.0.1:3000/auth/eve/callback',
  });
  const validation = validateConfig(config);

  assert.equal(validation.ok, true);
  assert.deepEqual(config.discord.ownerIds, ['333333333333333333']);
  assert.equal(config.discord.ownerId, '333333333333333333');
  assert.equal(config.eve.compatibilityDate, '2026-08-31');
  assert.equal(config.blacklist.spreadsheetId, '');
  assert.equal(config.blacklist.blackRange, "'The List'!A:J");
  assert.equal(config.blacklist.greyRange, "'Grey List'!A:J");
  assert.equal(config.blacklist.cacheTtlMs, 300000);
  assert.equal(config.blacklist.eveWhoBaseUrl, 'https://evewho.com/api');
  assert.equal(config.blacklist.eveWhoPageDelayMs, 3200);
  assert.equal(config.blacklist.eveWhoCacheTtlMs, 120000);
  assert.equal(validation.warnings.some((warning) => warning.includes('BLACKLIST_SPREADSHEET_ID')), true);
  assert.equal(config.jobs.memberSyncIntervalMinutes, 30);
  assert.equal(config.jobs.promotionEnabled, true);
  assert.equal(config.jobs.promotionCheckIntervalMinutes, 360);
  assert.equal(config.jobs.financeEnabled, true);
  assert.equal(config.jobs.financeRefreshIntervalMinutes, 15);
  assert.equal(config.jobs.applicationsEnabled, true);
  assert.equal(config.jobs.applicationsCheckIntervalMinutes, 15);
  assert.equal(config.jobs.structureFuelEnabled, true);
  assert.equal(config.jobs.structureFuelCheckIntervalMinutes, 60);
  assert.equal(config.jobs.fatRewardsReminderEnabled, true);
  assert.equal(config.jobs.fatRewardsReminderIntervalMinutes, 360);
});

test('blacklist source is environment-configured and never receives a built-in spreadsheet ID', () => {
  const config = buildConfig({
    DISCORD_TOKEN: 'token',
    DISCORD_CLIENT_ID: '111111111111111111',
    BOT_OWNER_ID: '333333333333333333',
    EVE_SSO_CLIENT_ID: 'eve-client',
    EVE_SSO_REDIRECT_URI: 'http://127.0.0.1:3000/auth/eve/callback',
    BLACKLIST_SPREADSHEET_ID: 'sheet-123',
    GOOGLE_SHEETS_API_KEY: 'api-key',
    BLACKLIST_BLACK_RANGE: "'Black'!A:H",
    BLACKLIST_GREY_RANGE: "'Grey'!A:H",
    BLACKLIST_CACHE_TTL_MS: '600000',
    EVEWHO_PAGE_DELAY_MS: '4500',
  });
  assert.equal(config.blacklist.spreadsheetId, 'sheet-123');
  assert.equal(config.blacklist.googleSheetsApiKey, 'api-key');
  assert.equal(config.blacklist.blackRange, "'Black'!A:H");
  assert.equal(config.blacklist.greyRange, "'Grey'!A:H");
  assert.equal(config.blacklist.cacheTtlMs, 600000);
  assert.equal(config.blacklist.eveWhoPageDelayMs, 4500);
  assert.equal(validateConfig(config).warnings.some((warning) => warning.includes('BLACKLIST_SPREADSHEET_ID')), false);
});

test('background feature checks can be disabled or rescheduled independently', () => {
  const config = buildConfig({
    DISCORD_TOKEN: 'token',
    DISCORD_CLIENT_ID: '111111111111111111',
    BOT_OWNER_ID: '333333333333333333',
    EVE_SSO_CLIENT_ID: 'eve-client',
    EVE_SSO_REDIRECT_URI: 'http://127.0.0.1:3000/auth/eve/callback',
    ENABLE_PROMOTION_JOB: 'false',
    PROMOTION_CHECK_INTERVAL_MINUTES: '120',
    ENABLE_FINANCE_JOB: 'false',
    FINANCE_REFRESH_INTERVAL_MINUTES: '20',
    ENABLE_APPLICATIONS_JOB: 'false',
    APPLICATIONS_CHECK_INTERVAL_MINUTES: '25',
    ENABLE_STRUCTURE_FUEL_JOB: 'false',
    STRUCTURE_FUEL_CHECK_INTERVAL_MINUTES: '90',
    ENABLE_FAT_REWARDS_REMINDER_JOB: 'false',
    FAT_REWARDS_REMINDER_INTERVAL_MINUTES: '240',
    MEMBER_SYNC_INTERVAL_MINUTES: '45',
  });

  assert.equal(config.jobs.enabled, true);
  assert.equal(config.jobs.promotionEnabled, false);
  assert.equal(config.jobs.promotionCheckIntervalMinutes, 120);
  assert.equal(config.jobs.financeEnabled, false);
  assert.equal(config.jobs.financeRefreshIntervalMinutes, 20);
  assert.equal(config.jobs.applicationsEnabled, false);
  assert.equal(config.jobs.applicationsCheckIntervalMinutes, 25);
  assert.equal(config.jobs.structureFuelEnabled, false);
  assert.equal(config.jobs.structureFuelCheckIntervalMinutes, 90);
  assert.equal(config.jobs.fatRewardsReminderEnabled, false);
  assert.equal(config.jobs.fatRewardsReminderIntervalMinutes, 240);
  assert.equal(config.jobs.memberSyncIntervalMinutes, 45);
});
