const {
  readDiscordGuildBinding,
  bindDiscordGuild,
} = require('./discordGuildBindingRepository');

function normalizeGuilds(guilds) {
  if (!guilds) return [];
  if (Array.isArray(guilds)) return guilds.filter(Boolean);
  if (typeof guilds.values === 'function') return [...guilds.values()].filter(Boolean);
  return [];
}

function toGuildSummary(guild) {
  return {
    guildId: String(guild?.id || ''),
    guildName: String(guild?.name || ''),
  };
}

async function reconcileDiscordGuildBinding(storageRoot, guilds) {
  const availableGuilds = normalizeGuilds(guilds);
  const binding = await readDiscordGuildBinding(storageRoot);

  if (binding.guildId) {
    const boundGuild = availableGuilds.find((guild) => String(guild?.id || '') === binding.guildId);

    if (!boundGuild) {
      return {
        status: 'bound-guild-unavailable',
        binding,
        availableGuildsCount: availableGuilds.length,
        availableGuilds: availableGuilds.map(toGuildSummary),
      };
    }

    const currentBinding = String(boundGuild.name || '').trim() !== binding.guildName
      ? await bindDiscordGuild(storageRoot, boundGuild)
      : binding;
    const additionalGuilds = availableGuilds
      .filter((guild) => String(guild?.id || '') !== binding.guildId)
      .map(toGuildSummary);

    return {
      status: additionalGuilds.length > 0 ? 'bound-with-extra-guilds' : 'bound',
      binding: currentBinding,
      availableGuildsCount: availableGuilds.length,
      additionalGuilds,
    };
  }

  if (availableGuilds.length === 0) {
    return {
      status: 'waiting-for-invite',
      binding,
      availableGuildsCount: 0,
    };
  }

  if (availableGuilds.length > 1) {
    return {
      status: 'ambiguous',
      binding,
      availableGuildsCount: availableGuilds.length,
      availableGuilds: availableGuilds.map(toGuildSummary),
    };
  }

  const nextBinding = await bindDiscordGuild(storageRoot, availableGuilds[0]);
  return {
    status: 'bound-new',
    binding: nextBinding,
    availableGuildsCount: 1,
  };
}

module.exports = {
  normalizeGuilds,
  reconcileDiscordGuildBinding,
};
