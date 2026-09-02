const { Client, GatewayIntentBits } = require('discord.js');
const { loadConfig } = require('./config/env');
const { initializeBaseStorage } = require('./storage/initializeStorage');
const { readRegistry } = require('./corporations/corporationRegistryRepository');
const {
  reconcileDiscordGuildBinding,
} = require('./discord/discordGuildBindingService');
const {
  readDiscordGuildBinding,
} = require('./discord/discordGuildBindingRepository');
const { registerGuildCommands } = require('./discord/commandRegistrationService');
const { installInteractionRouter } = require('./discord/interactionRouter');
const { startHttpServer, stopHttpServer } = require('./http/httpServer');
const { startMemberSyncJob } = require('./jobs/memberSyncJob');
const { startPromotionJob } = require('./jobs/promotionJob');
const { startApplicationJob } = require('./jobs/applicationJob');
const { createModuleRuntimeManager } = require('./modules/moduleRuntimeManager');
const {
  ensureGuestFallbackForMember,
  sweepGuestFallback,
} = require('./roles/guestFallbackService');
const { handleGuildMemberJoin } = require('./onboarding/onboardingService');

function formatGuildSummary(guild) {
  return `${guild.guildName || 'Unnamed guild'} (${guild.guildId || 'unknown'})`;
}

function logGuildBindingResult(result, reason) {
  const prefix = `[discord:guild-binding] ${reason}`;

  if (result.status === 'bound-new') {
    console.log(`${prefix}: automatically bound ${formatGuildSummary({
      guildId: result.binding.guildId,
      guildName: result.binding.guildName,
    })}`);
    return;
  }

  if (result.status === 'bound') {
    console.log(`${prefix}: bound to ${formatGuildSummary({
      guildId: result.binding.guildId,
      guildName: result.binding.guildName,
    })}`);
    return;
  }

  if (result.status === 'waiting-for-invite') {
    console.log(`${prefix}: no Discord server available yet; invite the bot to one server`);
    return;
  }

  if (result.status === 'ambiguous') {
    console.warn(
      `${prefix}: bot is present in multiple servers before initial binding; automatic selection is disabled`
    );
    for (const guild of result.availableGuilds || []) {
      console.warn(`${prefix}: candidate ${formatGuildSummary(guild)}`);
    }
    return;
  }

  if (result.status === 'bound-with-extra-guilds') {
    console.warn(
      `${prefix}: keeping existing binding ${formatGuildSummary({
        guildId: result.binding.guildId,
        guildName: result.binding.guildName,
      })}; additional server invites will not replace it`
    );
    for (const guild of result.additionalGuilds || []) {
      console.warn(`${prefix}: ignored extra server ${formatGuildSummary(guild)}`);
    }
    return;
  }

  if (result.status === 'bound-guild-unavailable') {
    console.warn(
      `${prefix}: configured server ${formatGuildSummary({
        guildId: result.binding.guildId,
        guildName: result.binding.guildName,
      })} is not currently available; binding was preserved`
    );
  }
}

async function main() {
  const config = loadConfig();
  await initializeBaseStorage(config.storage.rootDir);

  const registry = await readRegistry(config.storage.rootDir);

  console.log('[startup] CorpDB foundation starting');
  console.log(`[startup] storage=${config.storage.rootDir}`);
  console.log(
    `[startup] corporations=${registry.corporations.length}; default=${registry.defaultCorporationId || 'none'}`
  );
  console.log(`[startup] backgroundJobs=${config.jobs.enabled ? 'enabled' : 'disabled'}`);
  console.log(`[startup] ESI compatibility date=${config.eve.compatibilityDate}`);

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });
  const moduleRuntimeManager = createModuleRuntimeManager(config, client);

  installInteractionRouter(client, { config, moduleRuntimeManager });

  const httpServer = await startHttpServer({
    config,
    storageRoot: config.storage.rootDir,
    discordClient: client,
  });

  let memberSyncJob = null;
  let promotionJob = null;
  let applicationJob = null;

  const reconcileGuildBinding = async (reason) => {
    try {
      const result = await reconcileDiscordGuildBinding(
        config.storage.rootDir,
        client.guilds.cache
      );
      logGuildBindingResult(result, reason);

      if (result.binding?.guildId) {
        const guild = client.guilds.cache.get(result.binding.guildId);
        if (guild) {
          await registerGuildCommands(guild, config.storage.rootDir);
        }
      }

      return result;
    } catch (error) {
      console.error(`[discord:guild-binding] ${reason} failed:`, error);
      return null;
    }
  };

  const applyGuestFallback = async (member, reason) => {
    try {
      const binding = await readDiscordGuildBinding(config.storage.rootDir);
      if (!binding.guildId || member.guild.id !== binding.guildId) return;
      const result = await ensureGuestFallbackForMember(config.storage.rootDir, member, { reason });
      if (result.changed) {
        console.log(`[discord:guest] granted fallback role to ${member.user?.tag || member.id}`);
      }
    } catch (error) {
      console.error(`[discord:guest] ${reason} failed for ${member?.id || 'unknown'}:`, error?.message || error);
    }
  };

  const sendOnboardingWelcome = async (member) => {
    try {
      const binding = await readDiscordGuildBinding(config.storage.rootDir);
      if (!binding.guildId || member.guild.id !== binding.guildId) return;
      const result = await handleGuildMemberJoin(config.storage.rootDir, member);
      if (result.welcomeSentTo === 'channel') {
        console.log(`[onboarding] welcome sent for ${member.user?.tag || member.id} to channel=${result.welcomeChannelId}`);
      } else if (result.welcomeSentTo === 'dm') {
        console.log(`[onboarding] welcome sent for ${member.user?.tag || member.id} by DM`);
      } else if (result.welcomeSentTo === 'disabled') {
        console.log(`[onboarding] welcome disabled; skipped ${member.user?.tag || member.id}`);
      }
    } catch (error) {
      console.error(`[onboarding] welcome failed for ${member?.id || 'unknown'}:`, error?.message || error);
    }
  };

  client.once('clientReady', async () => {
    console.log(`[discord] connected as ${client.user?.tag || client.user?.id || 'unknown'}`);
    const bindingResult = await reconcileGuildBinding('clientReady');

    if (bindingResult?.binding?.guildId) {
      const guild = client.guilds.cache.get(bindingResult.binding.guildId);
      if (guild) {
        const result = await sweepGuestFallback(config.storage.rootDir, guild).catch((error) => {
          console.error('[discord:guest] startup sweep failed:', error?.message || error);
          return null;
        });
        if (result?.enabled) {
          console.log(
            `[discord:guest] startup sweep checked=${result.checkedCount} granted=${result.grantedCount} failed=${result.failedCount}`
          );
        }
      }
    }

    const currentRegistry = await readRegistry(config.storage.rootDir);
    if (currentRegistry.corporations.length === 0) {
      console.log('[startup] no corporation configured yet; run /auth setup when the service character is ready');
    }

    memberSyncJob = startMemberSyncJob(config);
    promotionJob = startPromotionJob(config, client);
    applicationJob = startApplicationJob(config, client);
    await moduleRuntimeManager.startEnabledModules();
  });

  client.on('guildCreate', async (guild) => {
    console.log(`[discord] joined server ${guild.name || 'Unnamed guild'} (${guild.id})`);
    await reconcileGuildBinding('guildCreate');
  });

  client.on('guildDelete', async (guild) => {
    console.log(`[discord] left server ${guild.name || 'Unnamed guild'} (${guild.id})`);
    await reconcileGuildBinding('guildDelete');
  });

  client.on('guildMemberAdd', async (member) => {
    await applyGuestFallback(member, 'guildMemberAdd');
    await sendOnboardingWelcome(member);
  });

  client.on('guildMemberUpdate', async (_oldMember, newMember) => {
    await applyGuestFallback(newMember, 'guildMemberUpdate');
  });

  client.on('error', (error) => {
    console.error('[discord] client error:', error);
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal}`);
    memberSyncJob?.stop();
    promotionJob?.stop();
    applicationJob?.stop();
    moduleRuntimeManager.stopAll();
    client.destroy();
    await stopHttpServer(httpServer).catch((error) => {
      console.error('[shutdown] HTTP server close failed:', error);
    });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  await client.login(config.discord.token);
}

main().catch((error) => {
  console.error('[startup] fatal:', error?.stack || error);
  process.exitCode = 1;
});
