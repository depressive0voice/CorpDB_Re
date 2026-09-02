const { replaceAllAuthCharacters } = require('./authCharacterRepository');
const { syncMainAltFromAuth } = require('./authMainAltSyncService');

function createError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

function stripTags(value) {
  return normalizeWhitespace(
    decodeHtmlEntities(String(value || '').replace(/<[^>]+>/g, ' '))
  );
}

function parseMainBlocks(html) {
  const blocks = [];
  const mainBlockRegex =
    /<div class="caption text-center">\s*([\s\S]*?)<br[\s\S]*?<\/div>[\s\S]*?<table class="table table-hover">\s*([\s\S]*?)<\/table>/gi;

  let match;
  while ((match = mainBlockRegex.exec(html)) !== null) {
    const mainName = stripTags(match[1]);
    if (!mainName) continue;
    blocks.push({ mainName, innerTableHtml: match[2] });
  }

  return blocks;
}

function parseCharacterRows(innerTableHtml) {
  const rows = [];
  const rowRegex =
    /<tr>\s*<td[\s\S]*?<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[\s\S]*?<\/td>\s*<\/tr>/gi;

  let match;
  while ((match = rowRegex.exec(innerTableHtml)) !== null) {
    const characterName = stripTags(match[1]);
    const corporationName = stripTags(match[2]);
    if (!characterName) continue;
    rows.push({ alt: characterName, corp: corporationName });
  }

  return rows;
}

function parseAuthHtml(html) {
  const cleanHtml = String(html || '');
  if (!cleanHtml.trim()) throw createError('Auth HTML file is empty.', 'auth_html_empty');

  const mainBlocks = parseMainBlocks(cleanHtml);
  if (mainBlocks.length === 0) {
    throw createError('Could not parse auth HTML: no main-character blocks were found.', 'auth_html_parse_failed');
  }

  const records = [];
  for (const block of mainBlocks) {
    for (const row of parseCharacterRows(block.innerTableHtml)) {
      records.push({ main: block.mainName, alt: row.alt, corp: row.corp });
    }
  }

  if (records.length === 0) {
    throw createError('Could not parse auth HTML: no character rows were found.', 'auth_html_parse_failed');
  }
  return records;
}

async function importAuthHtmlFromAttachment(storageRoot, attachmentUrl, options = {}) {
  if (!attachmentUrl) throw createError('Attachment URL is missing.', 'attachment_url_missing');
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(attachmentUrl);
  if (!response.ok) {
    throw createError('Could not download the auth HTML attachment.', 'attachment_download_failed');
  }

  const html = await response.text();
  const savedRecords = await replaceAllAuthCharacters(storageRoot, parseAuthHtml(html));
  const mainAltSync = await syncMainAltFromAuth(storageRoot, 'apply', {
    records: savedRecords,
    now: options.now,
  });
  return {
    ok: true,
    recordsCount: savedRecords.length,
    mainsCount: new Set(savedRecords.map((record) => record.main.toLowerCase())).size,
    corpsCount: new Set(savedRecords.map((record) => record.corp.toLowerCase()).filter(Boolean)).size,
    records: savedRecords,
    mainAltSync,
  };
}

module.exports = {
  normalizeWhitespace,
  parseAuthHtml,
  importAuthHtmlFromAttachment,
};
