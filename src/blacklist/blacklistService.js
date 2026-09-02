const ExcelJS = require('exceljs');

const HTTP_TIMEOUT_MS = 20_000;
const MAX_EVEWHO_PAGES = 100;

const blacklistCache = {
  key: '',
  expiresAt: 0,
  value: null,
  promise: null,
};
const corporationCache = new Map();
const corporationInFlight = new Map();
const characterResolutionCache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeCharacterName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US');
}

function splitCharacterCell(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isNonCharacterEntry(value) {
  const name = normalizeText(value);
  if (!name || name.length > 100) return true;
  return (
    /^https?:\/\//i.test(name) ||
    name.startsWith('~') ||
    /^corp\b/i.test(name) ||
    /\((?:corp|alliance)\)/i.test(name) ||
    /\{(?:corp|alliance)\}/i.test(name) ||
    /#\d{3,6}$/.test(name)
  );
}

function normalizeHeader(value) {
  return normalizeCharacterName(value).replace(/[\s_-]+/g, ' ');
}

function isCharacterColumnHeader(value) {
  const header = normalizeHeader(value);
  return (
    header.startsWith('main/') ||
    header === 'main' ||
    header.includes('主角色') ||
    header.includes('known alt') ||
    header.includes('已知账号') ||
    /^alt\s*\d*$/.test(header) ||
    header === 'character' ||
    header === 'character name' ||
    header === 'pilot' ||
    header === 'pilot name'
  );
}

function findHeaderRowIndex(rows) {
  return rows.findIndex((row) =>
    Array.isArray(row) && row.some((cell) => isCharacterColumnHeader(cell))
  );
}

function findCharacterColumnIndexes(headerRow) {
  const indexes = [];
  for (let index = 0; index < headerRow.length; index += 1) {
    if (isCharacterColumnHeader(headerRow[index])) indexes.push(index);
  }
  return indexes;
}

function buildCharacterIndex(rows) {
  if (!Array.isArray(rows)) {
    throw new Error('Google Sheets returned an invalid row collection.');
  }
  const headerRowIndex = findHeaderRowIndex(rows);
  const fallbackIndexes = [0, 5, 6, 7];
  const characterColumnIndexes = headerRowIndex >= 0
    ? findCharacterColumnIndexes(rows[headerRowIndex])
    : fallbackIndexes;
  if (characterColumnIndexes.length === 0) {
    throw new Error('Character columns were not found in the blacklist sheet.');
  }
  const index = new Set();
  const startRow = headerRowIndex >= 0 ? headerRowIndex + 1 : 0;
  for (let rowIndex = startRow; rowIndex < rows.length; rowIndex += 1) {
    const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
    for (const columnIndex of characterColumnIndexes) {
      for (const name of splitCharacterCell(row[columnIndex])) {
        if (isNonCharacterEntry(name)) continue;
        const normalized = normalizeCharacterName(name);
        if (normalized) index.add(normalized);
      }
    }
  }
  return index;
}

function getCharacterStatus(name, blackIndex, greyIndex) {
  const normalized = normalizeCharacterName(name);
  if (blackIndex.has(normalized)) return 'black';
  if (greyIndex.has(normalized)) return 'grey';
  return 'clear';
}

function parseCorporationId(input) {
  const value = normalizeText(input);
  if (/^\d{5,20}$/.test(value)) return value;
  let url;
  try {
    url = new URL(value);
  } catch {
    const error = new Error('Specify an EveWho corporation URL or a numeric corporation ID.');
    error.code = 'blacklist_invalid_corporation';
    throw error;
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'evewho.com' && host !== 'www.evewho.com') {
    const error = new Error('Only EveWho corporation links are accepted.');
    error.code = 'blacklist_invalid_corporation';
    throw error;
  }
  const match = url.pathname.match(/^\/corporation\/(\d{5,20})\/?$/i);
  if (!match) {
    const error = new Error('The EveWho link does not contain a valid corporation ID.');
    error.code = 'blacklist_invalid_corporation';
    throw error;
  }
  return match[1];
}

function validateCharacterName(value) {
  const name = String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ');
  if (!name) {
    const error = new Error('Specify a character name, character ID or EveWho URL.');
    error.code = 'blacklist_invalid_character';
    throw error;
  }
  if (name.length > 100 || /[\r\n]/.test(name)) {
    const error = new Error('Invalid character name.');
    error.code = 'blacklist_invalid_character';
    throw error;
  }
  return name;
}

function extractCharacterId(value) {
  const input = normalizeText(value);
  if (/^\d{5,20}$/.test(input)) return input;
  if (!/^https?:\/\//i.test(input)) return null;
  let url;
  try {
    url = new URL(input);
  } catch {
    const error = new Error('Invalid EveWho character URL.');
    error.code = 'blacklist_invalid_character';
    throw error;
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'evewho.com' && host !== 'www.evewho.com') {
    const error = new Error('Only EveWho character links are accepted.');
    error.code = 'blacklist_invalid_character';
    throw error;
  }
  const match = url.pathname.match(/^\/character\/(\d{5,20})\/?$/i);
  if (!match) {
    const error = new Error('The EveWho link does not contain a valid character ID.');
    error.code = 'blacklist_invalid_character';
    throw error;
  }
  return match[1];
}

function requireBlacklistConfig(config) {
  const blacklist = config?.blacklist || {};
  if (!normalizeText(blacklist.spreadsheetId)) {
    const error = new Error('BLACKLIST_SPREADSHEET_ID is not configured.');
    error.code = 'blacklist_not_configured';
    throw error;
  }
  return blacklist;
}

async function fetchJson(url, { fetchImpl = globalThis.fetch, method = 'GET', body, headers = {} } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('The current Node.js version does not provide fetch().');
  const requestHeaders = {
    Accept: 'application/json',
    'User-Agent': 'corpdb-bot/1.0 blacklist-checker',
    ...headers,
  };
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  const response = await fetchImpl(url, {
    method,
    headers: requestHeaders,
    body,
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!response.ok) {
    const responseBody = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}: ${responseBody.slice(0, 200)}`);
  }
  return response.json();
}

async function fetchText(url, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('The current Node.js version does not provide fetch().');
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'text/csv,text/plain;q=0.9,*/*;q=0.1',
      'User-Agent': 'corpdb-bot/1.0 blacklist-checker',
    },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}: ${body.slice(0, 200)}`);
  }
  return response.text();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const input = String(text ?? '');
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
      continue;
    }
    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += character;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function extractSheetName(range) {
  const value = normalizeText(range);
  const separatorIndex = value.lastIndexOf('!');
  const sheetPart = separatorIndex >= 0 ? value.slice(0, separatorIndex) : value;
  return sheetPart.replace(/^'/, '').replace(/'$/, '').replace(/''/g, "'");
}

async function fetchSheetRowsWithApi(config, ranges, { fetchImpl = globalThis.fetch } = {}) {
  const blacklist = requireBlacklistConfig(config);
  if (!normalizeText(blacklist.googleSheetsApiKey)) throw new Error('GOOGLE_SHEETS_API_KEY is not configured.');
  const params = new URLSearchParams({
    majorDimension: 'ROWS',
    valueRenderOption: 'FORMATTED_VALUE',
    key: blacklist.googleSheetsApiKey,
  });
  for (const range of ranges) params.append('ranges', range);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(blacklist.spreadsheetId)}/values:batchGet?${params}`;
  const data = await fetchJson(url, { fetchImpl });
  const valueRanges = Array.isArray(data.valueRanges) ? data.valueRanges : [];
  if (valueRanges.length !== ranges.length) throw new Error('Google Sheets returned an unexpected number of ranges.');
  return valueRanges.map((entry) => (Array.isArray(entry.values) ? entry.values : []));
}

async function fetchSheetRowsWithCsv(config, ranges, { fetchImpl = globalThis.fetch } = {}) {
  const blacklist = requireBlacklistConfig(config);
  const result = [];
  for (const range of ranges) {
    const params = new URLSearchParams({ tqx: 'out:csv', sheet: extractSheetName(range) });
    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(blacklist.spreadsheetId)}/gviz/tq?${params}`;
    result.push(parseCsv(await fetchText(url, { fetchImpl })));
  }
  return result;
}

function blacklistCacheKey(blacklist) {
  return [blacklist.spreadsheetId, blacklist.blackRange, blacklist.greyRange].join('::');
}

async function loadBlacklistIndexes(config, { fetchImpl = globalThis.fetch } = {}) {
  const blacklist = requireBlacklistConfig(config);
  const key = blacklistCacheKey(blacklist);
  const now = Date.now();
  if (blacklistCache.key === key && blacklistCache.value && blacklistCache.expiresAt > now) return blacklistCache.value;
  if (blacklistCache.key === key && blacklistCache.promise) return blacklistCache.promise;
  blacklistCache.key = key;
  blacklistCache.promise = (async () => {
    const ranges = [blacklist.blackRange, blacklist.greyRange];
    let rows;
    if (blacklist.googleSheetsApiKey) {
      try {
        rows = await fetchSheetRowsWithApi(config, ranges, { fetchImpl });
      } catch (apiError) {
        console.warn('[blacklist] Google Sheets API failed, using CSV fallback:', apiError.message);
        rows = await fetchSheetRowsWithCsv(config, ranges, { fetchImpl });
      }
    } else {
      rows = await fetchSheetRowsWithCsv(config, ranges, { fetchImpl });
    }
    const value = {
      blackIndex: buildCharacterIndex(rows[0]),
      greyIndex: buildCharacterIndex(rows[1]),
    };
    blacklistCache.value = value;
    blacklistCache.expiresAt = Date.now() + blacklist.cacheTtlMs;
    return value;
  })();
  try {
    return await blacklistCache.promise;
  } finally {
    blacklistCache.promise = null;
  }
}

function extractEveWhoCharacters(data) {
  const candidates = [data?.characters, data?.members, data?.data?.characters, data?.data?.members];
  const collection = candidates.find(Array.isArray) || [];
  return collection
    .map((entry) => ({
      id: normalizeText(entry?.character_id || entry?.characterId || entry?.id),
      name: normalizeText(entry?.name || entry?.character_name || entry?.characterName),
    }))
    .filter((entry) => entry.name);
}

function extractCorporationName(data) {
  const candidates = [
    data?.corporation?.name,
    data?.corporationName,
    data?.info?.corporationName,
    data?.info?.name,
    data?.data?.corporation?.name,
    data?.name,
  ];
  return normalizeText(candidates.find((value) => normalizeText(value)) || '');
}

function extractPageCount(data, firstPageLength) {
  const directCandidates = [
    data?.pagination?.pages,
    data?.pagination?.totalPages,
    data?.pagination?.last_page,
    data?.pages,
    data?.totalPages,
    data?.info?.pages,
  ];
  for (const value of directCandidates) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return Math.min(parsed, MAX_EVEWHO_PAGES);
  }
  const memberCount = Number(data?.pagination?.total || data?.memberCount || data?.info?.memberCount || data?.corporation?.memberCount);
  const perPage = Number(data?.pagination?.perPage || data?.pagination?.per_page || data?.perPage || firstPageLength);
  if (Number.isFinite(memberCount) && memberCount > 0 && perPage > 0) {
    return Math.min(Math.max(1, Math.ceil(memberCount / perPage)), MAX_EVEWHO_PAGES);
  }
  return 1;
}

async function fetchCorporationNameFromEsi(config, corporationId, { fetchImpl = globalThis.fetch } = {}) {
  const params = new URLSearchParams({ datasource: config?.eve?.datasource || 'tranquility' });
  const url = `https://esi.evetech.net/latest/corporations/${encodeURIComponent(corporationId)}/?${params}`;
  const data = await fetchJson(url, { fetchImpl });
  return normalizeText(data?.name);
}

async function fetchEveWhoCorporation(config, corporationId, { fetchImpl = globalThis.fetch, sleepImpl = sleep } = {}) {
  const blacklist = requireBlacklistConfig(config);
  const cacheKey = `${blacklist.eveWhoBaseUrl}::${corporationId}`;
  const cached = corporationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (corporationInFlight.has(cacheKey)) return corporationInFlight.get(cacheKey);
  const promise = (async () => {
    const baseUrl = `${blacklist.eveWhoBaseUrl.replace(/\/$/, '')}/corplist/${corporationId}`;
    const firstPage = await fetchJson(baseUrl, { fetchImpl });
    const firstCharacters = extractEveWhoCharacters(firstPage);
    const pages = extractPageCount(firstPage, firstCharacters.length);
    const allCharacters = [...firstCharacters];
    for (let page = 2; page <= pages; page += 1) {
      if (blacklist.eveWhoPageDelayMs > 0) await sleepImpl(blacklist.eveWhoPageDelayMs);
      allCharacters.push(...extractEveWhoCharacters(await fetchJson(`${baseUrl}/page/${page}`, { fetchImpl })));
    }
    const characterMap = new Map();
    for (const character of allCharacters) {
      const key = character.id || normalizeCharacterName(character.name);
      if (!characterMap.has(key)) characterMap.set(key, character);
    }
    let corporationName = extractCorporationName(firstPage);
    if (!corporationName) {
      corporationName = await fetchCorporationNameFromEsi(config, corporationId, { fetchImpl }).catch(() => '');
    }
    const value = {
      corporationId,
      corporationName: corporationName || `Corporation ${corporationId}`,
      characters: [...characterMap.values()],
    };
    if (value.characters.length === 0) throw new Error('EveWho returned no corporation members.');
    corporationCache.set(cacheKey, { value, expiresAt: Date.now() + blacklist.eveWhoCacheTtlMs });
    return value;
  })();
  corporationInFlight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    corporationInFlight.delete(cacheKey);
  }
}

function buildEveWhoUrl(characterId) {
  const normalizedId = normalizeText(characterId);
  return normalizedId ? `https://evewho.com/character/${encodeURIComponent(normalizedId)}` : null;
}

async function resolveCharacterIdByName(config, characterName, { fetchImpl = globalThis.fetch } = {}) {
  const validatedName = validateCharacterName(characterName);
  const cacheKey = normalizeCharacterName(validatedName);
  if (characterResolutionCache.has(cacheKey)) return characterResolutionCache.get(cacheKey);
  const params = new URLSearchParams({ datasource: config?.eve?.datasource || 'tranquility' });
  const url = `https://esi.evetech.net/latest/universe/ids/?${params}`;
  const data = await fetchJson(url, {
    fetchImpl,
    method: 'POST',
    body: JSON.stringify([validatedName]),
  });
  const characters = Array.isArray(data?.characters) ? data.characters : [];
  const resolved = characters.find((entry) => normalizeCharacterName(entry?.name) === cacheKey);
  const characterId = resolved?.id ? String(resolved.id) : null;
  characterResolutionCache.set(cacheKey, characterId);
  return characterId;
}

async function resolveCharacterInput(config, characterInput, { fetchImpl = globalThis.fetch } = {}) {
  const rawInput = normalizeText(characterInput);
  if (!rawInput) return { characterId: null, characterName: validateCharacterName(rawInput), source: 'name' };
  const characterId = extractCharacterId(rawInput);
  if (!characterId) {
    const characterName = validateCharacterName(rawInput);
    let resolvedCharacterId = null;
    try {
      resolvedCharacterId = await resolveCharacterIdByName(config, characterName, { fetchImpl });
    } catch (error) {
      console.warn(`[blacklist] failed to resolve character ID for ${characterName}:`, error.message);
    }
    return { characterId: resolvedCharacterId, characterName, source: 'name' };
  }
  const params = new URLSearchParams({ datasource: config?.eve?.datasource || 'tranquility' });
  const url = `https://esi.evetech.net/latest/characters/${encodeURIComponent(characterId)}/?${params}`;
  const data = await fetchJson(url, { fetchImpl });
  const characterName = validateCharacterName(data?.name);
  characterResolutionCache.set(normalizeCharacterName(characterName), characterId);
  return { characterId, characterName, source: 'character-id' };
}

async function checkCharacterBlacklist(config, characterInput, { fetchImpl = globalThis.fetch } = {}) {
  const [resolvedCharacter, indexes] = await Promise.all([
    resolveCharacterInput(config, characterInput, { fetchImpl }),
    loadBlacklistIndexes(config, { fetchImpl }),
  ]);
  return {
    characterId: resolvedCharacter.characterId,
    characterName: resolvedCharacter.characterName,
    eveWhoUrl: buildEveWhoUrl(resolvedCharacter.characterId),
    normalizedName: normalizeCharacterName(resolvedCharacter.characterName),
    status: getCharacterStatus(resolvedCharacter.characterName, indexes.blackIndex, indexes.greyIndex),
  };
}

function sanitizeFileName(value) {
  const sanitized = String(value ?? '')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return sanitized || 'corporation';
}

async function createBlacklistWorkbook(corporationName, results) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'corpdb_bot';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Blacklist Check');
  sheet.mergeCells('A1:B1');
  sheet.getCell('A1').value = `Corporation: ${corporationName}`;
  sheet.getCell('A1').font = { bold: true, size: 14 };
  sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 24;
  for (const result of results) sheet.addRow([result.name, result.status]);
  sheet.getColumn('A').width = 36;
  sheet.getColumn('B').width = 12;
  sheet.getColumn('B').alignment = { horizontal: 'center' };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function checkCorporationBlacklist(config, corporationInput, { fetchImpl = globalThis.fetch, sleepImpl = sleep } = {}) {
  const corporationId = parseCorporationId(corporationInput);
  const [corporation, indexes] = await Promise.all([
    fetchEveWhoCorporation(config, corporationId, { fetchImpl, sleepImpl }),
    loadBlacklistIndexes(config, { fetchImpl }),
  ]);
  const results = corporation.characters
    .map((character) => ({
      name: character.name,
      status: getCharacterStatus(character.name, indexes.blackIndex, indexes.greyIndex),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }));
  const counts = results.reduce((accumulator, result) => {
    accumulator[result.status] += 1;
    return accumulator;
  }, { black: 0, grey: 0, clear: 0 });
  const content = await createBlacklistWorkbook(corporation.corporationName, results);
  return {
    corporationId,
    corporationName: corporation.corporationName,
    results,
    counts,
    content,
    fileName: `${sanitizeFileName(corporation.corporationName)}_blacklist_check.xlsx`,
  };
}

function resetBlacklistCachesForTests() {
  blacklistCache.key = '';
  blacklistCache.expiresAt = 0;
  blacklistCache.value = null;
  blacklistCache.promise = null;
  corporationCache.clear();
  corporationInFlight.clear();
  characterResolutionCache.clear();
}

module.exports = {
  HTTP_TIMEOUT_MS,
  MAX_EVEWHO_PAGES,
  normalizeCharacterName,
  splitCharacterCell,
  isNonCharacterEntry,
  findHeaderRowIndex,
  findCharacterColumnIndexes,
  buildCharacterIndex,
  getCharacterStatus,
  parseCorporationId,
  validateCharacterName,
  extractCharacterId,
  parseCsv,
  extractSheetName,
  extractEveWhoCharacters,
  extractCorporationName,
  extractPageCount,
  buildEveWhoUrl,
  resolveCharacterIdByName,
  resolveCharacterInput,
  checkCharacterBlacklist,
  createBlacklistWorkbook,
  checkCorporationBlacklist,
  resetBlacklistCachesForTests,
};
