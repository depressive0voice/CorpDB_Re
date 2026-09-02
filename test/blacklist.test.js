const assert = require('node:assert/strict');
const test = require('node:test');
const ExcelJS = require('exceljs');

const {
  normalizeCharacterName,
  buildCharacterIndex,
  getCharacterStatus,
  parseCorporationId,
  parseCsv,
  extractSheetName,
  extractEveWhoCharacters,
  extractCorporationName,
  extractPageCount,
  createBlacklistWorkbook,
  checkCharacterBlacklist,
  checkCorporationBlacklist,
  extractCharacterId,
  buildEveWhoUrl,
  validateCharacterName,
  resetBlacklistCachesForTests,
} = require('../src/blacklist/blacklistService');
const { validateLookupMode } = require('../src/discord/commands/blacklistCommand');
const blacklistCommand = require('../src/discord/commands/blacklistCommand');
const { commandsByName, allCommandsByName } = require('../src/discord/commands');

function config(overrides = {}) {
  return {
    eve: { datasource: 'tranquility' },
    blacklist: {
      googleSheetsApiKey: '',
      spreadsheetId: 'test-sheet-id',
      blackRange: "'The List'!A:J",
      greyRange: "'Grey List'!A:J",
      cacheTtlMs: 300000,
      eveWhoBaseUrl: 'https://evewho.com/api',
      eveWhoPageDelayMs: 3200,
      eveWhoCacheTtlMs: 120000,
      ...overrides,
    },
  };
}

function textResponse(text) {
  return {
    ok: true,
    status: 200,
    async text() { return text; },
  };
}

function jsonResponse(value) {
  return {
    ok: true,
    status: 200,
    async json() { return value; },
    async text() { return JSON.stringify(value); },
  };
}

test('blacklist sheet parsing preserves legacy character-column and status behavior', async () => {
  assert.equal(normalizeCharacterName('  Test   Pilot  '), 'test pilot');
  assert.equal(parseCorporationId('https://evewho.com/corporation/98765432'), '98765432');
  assert.equal(parseCorporationId('98765432'), '98765432');
  assert.throws(() => parseCorporationId('https://example.com/corporation/98765432'));

  const csvRows = parseCsv(
    'Main,Alt\r\n"Pilot One","Alt One\nAlt Two"\r\n"Quoted ""Pilot""",clear'
  );
  assert.deepEqual(csvRows, [
    ['Main', 'Alt'],
    ['Pilot One', 'Alt One\nAlt Two'],
    ['Quoted "Pilot"', 'clear'],
  ]);
  assert.equal(extractSheetName("'Grey List'!A:J"), 'Grey List');

  const blackRows = [
    ['Search instruction'],
    [
      'Main/主角色',
      'Date Added',
      'Added By',
      'Reason',
      'Verification',
      'known alt1/已知账号1',
      'known alt2/已知账号2',
      'known alt3/已知账号3',
    ],
    ['Main Pilot', '', '', '', '', 'Alt One\nAlt Two', '', ''],
    ['~Blocked Corp (corp)', '', '', '', '', '', '', ''],
  ];
  const greyRows = [
    ['Main', 'Known Alt1'],
    ['Grey Pilot', 'Shared Pilot'],
  ];
  const blackIndex = buildCharacterIndex(blackRows);
  const greyIndex = buildCharacterIndex(greyRows);
  assert.equal(blackIndex.has('main pilot'), true);
  assert.equal(blackIndex.has('alt one'), true);
  assert.equal(blackIndex.has('alt two'), true);
  assert.equal(blackIndex.has('~blocked corp (corp)'), false);
  assert.equal(greyIndex.has('grey pilot'), true);
  assert.equal(getCharacterStatus('Shared Pilot', new Set(['shared pilot']), greyIndex), 'black');
  assert.equal(getCharacterStatus('Grey Pilot', blackIndex, greyIndex), 'grey');
  assert.equal(getCharacterStatus('Clean Pilot', blackIndex, greyIndex), 'clear');

  const eveWhoPayload = {
    corporation: { name: 'Example Corporation' },
    pagination: { pages: 3 },
    characters: [
      { character_id: 1, name: 'Pilot One' },
      { characterId: 2, characterName: 'Pilot Two' },
    ],
  };
  assert.deepEqual(extractEveWhoCharacters(eveWhoPayload), [
    { id: '1', name: 'Pilot One' },
    { id: '2', name: 'Pilot Two' },
  ]);
  assert.equal(extractCorporationName(eveWhoPayload), 'Example Corporation');
  assert.equal(extractPageCount(eveWhoPayload, 2), 3);

  const report = await createBlacklistWorkbook('Example Corporation', [
    { name: 'Pilot One', status: 'black' },
    { name: 'Pilot Two', status: 'clear' },
  ]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(report);
  const sheet = workbook.getWorksheet('Blacklist Check');
  assert.ok(sheet);
  assert.equal(sheet.getCell('A1').value, 'Corporation: Example Corporation');
  assert.equal(sheet.getCell('A2').value, 'Pilot One');
  assert.equal(sheet.getCell('B2').value, 'black');
  assert.equal(sheet.getCell('A3').value, 'Pilot Two');
  assert.equal(sheet.getCell('B3').value, 'clear');
  assert.equal(sheet.rowCount, 3);
});

test('single character blacklist lookup resolves ID/name through ESI and caches blacklist sheets', async () => {
  resetBlacklistCachesForTests();
  const blackCsv = [
    'Search instruction',
    'Main/主角色,Date Added,Added By,Reason,Verification,known alt1/已知账号1,known alt2/已知账号2,known alt3/已知账号3',
    'Onofria,,,,,,,',
    'Black Main,,,,,"Black Alt One\nBlack Alt Two",,',
  ].join('\r\n');
  const greyCsv = [
    'Main/主角色,known alt1/已知账号1',
    'Grey Main,Grey Alt',
  ].join('\r\n');
  const requestedCalls = [];
  const nameIds = new Map([
    ['black main', 2115000001],
    ['black alt two', 2115000002],
    ['grey alt', 2115000003],
    ['clear pilot', 2115000004],
  ]);

  async function fetchImpl(url, options = {}) {
    const requestedUrl = String(url);
    requestedCalls.push({ url: requestedUrl, method: options.method || 'GET', body: options.body });
    if (requestedUrl.includes('/latest/characters/2114573835/')) return jsonResponse({ name: 'Onofria' });
    if (requestedUrl.includes('/latest/universe/ids/')) {
      const names = JSON.parse(options.body || '[]');
      return jsonResponse({
        characters: names
          .map((name) => ({ id: nameIds.get(String(name).toLowerCase()), name }))
          .filter((entry) => entry.id),
      });
    }
    if (requestedUrl.includes('sheet=The+List')) return textResponse(blackCsv);
    if (requestedUrl.includes('sheet=Grey+List')) return textResponse(greyCsv);
    throw new Error(`Unexpected URL: ${url}`);
  }

  assert.equal(validateCharacterName('  Black   Main  '), 'Black Main');
  assert.throws(() => validateCharacterName('   '));
  assert.equal(extractCharacterId('2114573835'), '2114573835');
  assert.equal(extractCharacterId('https://evewho.com/character/2114573835'), '2114573835');
  assert.equal(extractCharacterId('Onofria'), null);
  assert.equal(buildEveWhoUrl('2114573835'), 'https://evewho.com/character/2114573835');
  assert.equal(buildEveWhoUrl(null), null);

  const onofria = await checkCharacterBlacklist(
    config(),
    'https://evewho.com/character/2114573835',
    { fetchImpl }
  );
  assert.equal(onofria.characterName, 'Onofria');
  assert.equal(onofria.status, 'black');

  assert.equal((await checkCharacterBlacklist(config(), 'black main', { fetchImpl })).status, 'black');
  assert.equal((await checkCharacterBlacklist(config(), ' Black Alt Two ', { fetchImpl })).status, 'black');
  assert.equal((await checkCharacterBlacklist(config(), 'grey alt', { fetchImpl })).status, 'grey');
  assert.equal((await checkCharacterBlacklist(config(), 'Clear Pilot', { fetchImpl })).status, 'clear');

  assert.equal(
    requestedCalls.filter((call) => call.url.includes('docs.google.com/spreadsheets')).length,
    2,
    'Blacklist sheets should be cached.'
  );
  assert.equal(
    requestedCalls.filter((call) => call.url.includes('/latest/characters/2114573835/')).length,
    1
  );
  const universeCalls = requestedCalls.filter((call) => call.url.includes('/latest/universe/ids/'));
  assert.equal(universeCalls.length, 4);
  assert.equal(universeCalls.every((call) => call.method === 'POST'), true);
});

test('corporation blacklist lookup follows EveWho pagination and produces status counts', async () => {
  resetBlacklistCachesForTests();
  const calls = [];
  async function fetchImpl(url) {
    const requestedUrl = String(url);
    calls.push(requestedUrl);
    if (requestedUrl.endsWith('/api/corplist/98765432')) {
      return jsonResponse({
        corporation: { name: 'Example Corporation' },
        pagination: { pages: 2 },
        characters: [{ character_id: 1, name: 'Black Pilot' }],
      });
    }
    if (requestedUrl.endsWith('/api/corplist/98765432/page/2')) {
      return jsonResponse({ characters: [
        { character_id: 2, name: 'Grey Pilot' },
        { character_id: 3, name: 'Clear Pilot' },
      ] });
    }
    if (requestedUrl.includes('sheet=The+List')) return textResponse('Main\r\nBlack Pilot');
    if (requestedUrl.includes('sheet=Grey+List')) return textResponse('Main\r\nGrey Pilot');
    throw new Error(`Unexpected URL: ${url}`);
  }
  let slept = 0;
  const result = await checkCorporationBlacklist(config(), '98765432', {
    fetchImpl,
    sleepImpl: async (ms) => { slept += ms; },
  });
  assert.equal(result.corporationName, 'Example Corporation');
  assert.deepEqual(result.counts, { black: 1, grey: 1, clear: 1 });
  assert.equal(result.results.length, 3);
  assert.equal(result.fileName, 'Example_Corporation_blacklist_check.xlsx');
  assert.equal(slept, 3200);
  assert.equal(calls.some((url) => url.endsWith('/page/2')), true);
});

test('/blacklist keeps the legacy mutually-exclusive corporation/character surface and has no hardcoded source', async () => {
  const json = blacklistCommand.data.toJSON();
  assert.equal(json.name, 'blacklist');
  assert.deepEqual(json.options.map((option) => option.name), ['corporation', 'character']);
  assert.equal(commandsByName.has('blacklist'), false);
  assert.equal(allCommandsByName.has('blacklist'), true);
  assert.doesNotThrow(() => validateLookupMode('98765432', null));
  assert.doesNotThrow(() => validateLookupMode(null, 'Black Main'));
  assert.throws(() => validateLookupMode(null, null), (error) => error.code === 'blacklist_lookup_required');
  assert.throws(
    () => validateLookupMode('98765432', 'Black Main'),
    (error) => error.code === 'blacklist_lookup_ambiguous'
  );
  await assert.rejects(
    checkCharacterBlacklist(config({ spreadsheetId: '' }), 'Black Main'),
    (error) => error.code === 'blacklist_not_configured'
  );
});
