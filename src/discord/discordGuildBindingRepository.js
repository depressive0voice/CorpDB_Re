const { createStoragePaths } = require('../storage/paths');
const { readJson, writeJsonAtomic } = require('../storage/jsonFileStore');

function createEmptyDiscordGuildBinding() {
  return {
    version: 1,
    guildId: '',
    guildName: '',
    boundAt: '',
    updatedAt: '',
  };
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeDiscordGuildBinding(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : createEmptyDiscordGuildBinding();

  return {
    version: 1,
    guildId: normalizeText(source.guildId),
    guildName: normalizeText(source.guildName),
    boundAt: normalizeText(source.boundAt),
    updatedAt: normalizeText(source.updatedAt),
  };
}

async function readDiscordGuildBinding(storageRoot) {
  const paths = createStoragePaths(storageRoot);
  const raw = await readJson(paths.discordGuildBindingFile, {
    defaultFactory: createEmptyDiscordGuildBinding,
  });
  return normalizeDiscordGuildBinding(raw);
}

async function writeDiscordGuildBinding(storageRoot, value) {
  const paths = createStoragePaths(storageRoot);
  const normalized = normalizeDiscordGuildBinding(value);
  await writeJsonAtomic(paths.discordGuildBindingFile, normalized);
  return normalized;
}

async function bindDiscordGuild(storageRoot, guild) {
  const guildId = normalizeText(guild?.id);
  const guildName = normalizeText(guild?.name);

  if (!guildId) {
    throw new Error('Cannot bind Discord guild without guild ID.');
  }

  const previous = await readDiscordGuildBinding(storageRoot);
  const now = new Date().toISOString();

  return writeDiscordGuildBinding(storageRoot, {
    version: 1,
    guildId,
    guildName,
    boundAt: previous.guildId === guildId && previous.boundAt ? previous.boundAt : now,
    updatedAt: now,
  });
}

module.exports = {
  createEmptyDiscordGuildBinding,
  normalizeDiscordGuildBinding,
  readDiscordGuildBinding,
  writeDiscordGuildBinding,
  bindDiscordGuild,
};
