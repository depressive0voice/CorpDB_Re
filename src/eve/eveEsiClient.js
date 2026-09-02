const ESI_BASE_URL = 'https://esi.evetech.net';
const UNIVERSE_NAMES_BATCH_SIZE = 1000;
const DEFAULT_WALLET_JOURNAL_MAX_PAGES = 5;
const ESI_SAFE_PAGE_LIMIT = 100;

function buildEsiUrl(config, pathname) {
  const url = new URL(pathname, ESI_BASE_URL);
  if (config.eve.datasource) {
    url.searchParams.set('datasource', config.eve.datasource);
  }
  return url;
}

async function requestEsi(config, pathname, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'CorpDB/0.1.0',
    'X-Compatibility-Date': config.eve.compatibilityDate,
    ...(options.headers || {}),
  };

  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  let body;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const response = await fetchImpl(buildEsiUrl(config, pathname), {
    method: options.method || 'GET',
    headers,
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error(`ESI request failed for ${pathname} (${response.status}): ${text}`);
    error.status = response.status;
    throw error;
  }

  return response;
}

async function requestEsiJson(config, pathname, options = {}) {
  const response = await requestEsi(config, pathname, options);
  return response.json();
}

async function requestAllPages(config, pathname, options = {}) {
  const firstUrl = new URL(pathname, ESI_BASE_URL);
  firstUrl.searchParams.set('page', '1');

  const firstResponse = await requestEsi(config, `${firstUrl.pathname}${firstUrl.search}`, options);
  const firstPage = await firstResponse.json();
  const pages = Math.max(1, Number(firstResponse.headers.get('x-pages')) || 1);
  const values = Array.isArray(firstPage) ? [...firstPage] : [];

  for (let page = 2; page <= pages; page += 1) {
    const pageUrl = new URL(pathname, ESI_BASE_URL);
    pageUrl.searchParams.set('page', String(page));
    const pageValue = await requestEsiJson(config, `${pageUrl.pathname}${pageUrl.search}`, options);
    if (Array.isArray(pageValue)) values.push(...pageValue);
  }

  return values;
}

function normalizePercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed <= 1 ? parsed * 100 : parsed;
}

function normalizeWalletBalanceEntry(entry) {
  return {
    division: Number(entry?.division || 0),
    balance: Number(entry?.balance || 0),
  };
}

function normalizeWalletJournalEntry(entry, division) {
  return {
    id: String(entry?.id || '').trim(),
    division: Number(division || 0),
    date: String(entry?.date || '').trim(),
    refType: String(entry?.ref_type || '').trim().toLowerCase(),
    amount: Number(entry?.amount || 0),
    balance: Number(entry?.balance || 0),
    description: String(entry?.description || '').trim(),
    reason: String(entry?.reason || '').trim(),
    firstPartyId: String(entry?.first_party_id || '').trim(),
    secondPartyId: String(entry?.second_party_id || '').trim(),
    tax: Number(entry?.tax || 0),
    taxReceiverId: String(entry?.tax_receiver_id || '').trim(),
  };
}

async function getCharacterPublicInfo(config, characterId, options = {}) {
  return requestEsiJson(config, `/characters/${characterId}/`, options);
}

async function getCharacterNotifications(config, characterId, accessToken, options = {}) {
  const value = await requestEsiJson(config, `/characters/${characterId}/notifications/`, {
    ...options,
    accessToken,
  });
  return Array.isArray(value) ? value : [];
}

async function getCorporationPublicInfo(config, corporationId, options = {}) {
  return requestEsiJson(config, `/corporations/${corporationId}/`, options);
}

async function getAlliancePublicInfo(config, allianceId, options = {}) {
  return requestEsiJson(config, `/alliances/${allianceId}/`, options);
}

async function getCharacterCorporationRoles(config, characterId, accessToken, options = {}) {
  const value = await requestEsiJson(config, `/characters/${characterId}/roles/`, {
    ...options,
    accessToken,
  });

  const allRoles = [
    ...(Array.isArray(value.roles) ? value.roles : []),
    ...(Array.isArray(value.roles_at_hq) ? value.roles_at_hq : []),
    ...(Array.isArray(value.roles_at_base) ? value.roles_at_base : []),
    ...(Array.isArray(value.roles_at_other) ? value.roles_at_other : []),
  ];

  return [...new Set(allRoles.map(String))];
}

async function getCorporationMemberIds(config, corporationId, accessToken, options = {}) {
  const values = await requestAllPages(
    config,
    `/corporations/${corporationId}/members/`,
    { ...options, accessToken }
  );
  return [...new Set(values.map((value) => String(value)).filter(Boolean))];
}

async function getCorporationMemberTracking(config, corporationId, accessToken, options = {}) {
  const value = await requestEsiJson(
    config,
    `/corporations/${corporationId}/membertracking/`,
    { ...options, accessToken }
  );
  return Array.isArray(value) ? value : [];
}

async function getCorporationWalletBalances(config, corporationId, accessToken, options = {}) {
  const values = await requestEsiJson(
    config,
    `/corporations/${corporationId}/wallets/`,
    { ...options, accessToken }
  );
  return (Array.isArray(values) ? values : [])
    .map(normalizeWalletBalanceEntry)
    .filter((entry) => Number.isInteger(entry.division) && entry.division > 0)
    .sort((left, right) => left.division - right.division);
}

async function getCorporationWalletJournalByDivision(
  config,
  corporationId,
  division,
  accessToken,
  options = {}
) {
  const cleanDivision = Number(division);
  if (!Number.isInteger(cleanDivision) || cleanDivision <= 0) {
    throw new Error('Wallet division must be a positive integer.');
  }
  const requestedPages = Number(options.maxPages || options.maxJournalPages);
  const maxPages = Number.isInteger(requestedPages) && requestedPages > 0
    ? Math.min(requestedPages, ESI_SAFE_PAGE_LIMIT)
    : DEFAULT_WALLET_JOURNAL_MAX_PAGES;
  const entries = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= maxPages) {
    const url = new URL(`/corporations/${corporationId}/wallets/${cleanDivision}/journal/`, ESI_BASE_URL);
    url.searchParams.set('page', String(page));
    const response = await requestEsi(config, `${url.pathname}${url.search}`, {
      ...options,
      accessToken,
    });
    const values = await response.json();
    entries.push(...(Array.isArray(values) ? values : []).map(
      (entry) => normalizeWalletJournalEntry(entry, cleanDivision)
    ));
    totalPages = Math.max(1, Number(response.headers.get('x-pages')) || 1);
    page += 1;
  }

  return entries;
}

async function resolveUniverseNames(config, ids, options = {}) {
  const normalizedIds = [...new Set((ids || []).map((value) => String(value).trim()).filter(Boolean))];
  const results = [];

  for (let offset = 0; offset < normalizedIds.length; offset += UNIVERSE_NAMES_BATCH_SIZE) {
    const batch = normalizedIds.slice(offset, offset + UNIVERSE_NAMES_BATCH_SIZE);
    const values = await requestEsiJson(config, '/universe/names/', {
      ...options,
      method: 'POST',
      body: batch.map((value) => Number(value)),
    });
    if (Array.isArray(values)) results.push(...values);
  }

  return results;
}

async function resolveCorporationProfileFromCharacter(config, characterId, options = {}) {
  const character = await getCharacterPublicInfo(config, characterId, options);
  const corporationId = String(character.corporation_id || '').trim();
  if (!corporationId) {
    throw new Error(`Character ${characterId} has no corporation_id in ESI response.`);
  }

  const corporation = await getCorporationPublicInfo(config, corporationId, options);
  const allianceId = String(corporation.alliance_id || '').trim();
  let allianceName = '';

  if (allianceId) {
    const alliance = await getAlliancePublicInfo(config, allianceId, options);
    allianceName = String(alliance.name || '').trim();
  }

  return {
    corporationId,
    name: String(corporation.name || '').trim(),
    ticker: String(corporation.ticker || '').trim(),
    allianceId,
    allianceName,
    taxRatePercent: normalizePercent(corporation.tax_rate),
    metadataUpdatedAt: new Date().toISOString(),
  };
}

module.exports = {
  ESI_BASE_URL,
  UNIVERSE_NAMES_BATCH_SIZE,
  DEFAULT_WALLET_JOURNAL_MAX_PAGES,
  ESI_SAFE_PAGE_LIMIT,
  buildEsiUrl,
  requestEsi,
  requestEsiJson,
  requestAllPages,
  normalizePercent,
  normalizeWalletBalanceEntry,
  normalizeWalletJournalEntry,
  getCharacterPublicInfo,
  getCharacterNotifications,
  getCorporationPublicInfo,
  getAlliancePublicInfo,
  getCharacterCorporationRoles,
  getCorporationMemberIds,
  getCorporationMemberTracking,
  getCorporationWalletBalances,
  getCorporationWalletJournalByDivision,
  resolveUniverseNames,
  resolveCorporationProfileFromCharacter,
};
