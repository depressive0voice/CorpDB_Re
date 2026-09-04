const { MessageFlags } = require('discord.js');
const { allCommandsByName } = require('./commands');
const { readDiscordGuildBinding } = require('./discordGuildBindingRepository');
const {
  resolveUserLanguage,
  createTranslator,
} = require('../localization/localizationService');
const {
  isMainBindingButton,
  handleMainBindingButtonInteraction,
} = require('../mainBinding/mainBindingService');
const { checkCommandAccess } = require('../access/accessService');
const { isModuleEnabled } = require('../modules/moduleConfigRepository');
const {
  getModuleForCommand,
  getModuleForAdminGroup,
} = require('../modules/moduleRegistry');

async function replyWithError(interaction, error, t) {
  const message = error?.message || t('common.unknownError');
  const payload = {
    content: t('common.commandFailed', { message }),
    flags: MessageFlags.Ephemeral,
  };

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(payload).catch(() => null);
  } else {
    await interaction.reply(payload).catch(() => null);
  }
}

function getInteractionModuleKey(interaction) {
  const commandModule = getModuleForCommand(interaction.commandName);
  if (commandModule) return commandModule;
  if (interaction.commandName !== 'admin') return '';
  const group = interaction.options.getSubcommandGroup(false);
  return getModuleForAdminGroup(group);
}

function shouldAutoDeferInteraction(interaction) {
  if (interaction.commandName !== 'binding-admin') return false;
  return interaction.options.getSubcommand(false) === 'bind-user';
}

async function installModuleGuard(interaction, context, isAutocomplete) {
  const moduleKey = getInteractionModuleKey(interaction);
  if (!moduleKey) return true;
  if (await isModuleEnabled(context.config.storage.rootDir, moduleKey)) return true;

  if (isAutocomplete) await interaction.respond([]).catch(() => null);
  else {
    await interaction.reply({
      content: `Optional module \`${moduleKey}\` is disabled.`,
      flags: MessageFlags.Ephemeral,
    });
  }
  return false;
}

function installInteractionRouter(client, context) {
  client.on('interactionCreate', async (interaction) => {
    const isCommand = interaction.isChatInputCommand();
    const isButton = interaction.isButton();
    const isAutocomplete = interaction.isAutocomplete();
    if (!isCommand && !isButton && !isAutocomplete) return;

    let t = (key) => key;

    try {
      const language = await resolveUserLanguage(
        context.config.storage.rootDir,
        context.config,
        interaction.user.id
      );
      t = createTranslator(language, context.config);
      const interactionContext = {
        ...context,
        language,
        t,
      };

      const binding = await readDiscordGuildBinding(context.config.storage.rootDir);
      if (!binding.guildId || interaction.guildId !== binding.guildId) {
        if (isAutocomplete) await interaction.respond([]).catch(() => null);
        else {
          await interaction.reply({
            content: t('common.guildMismatch'),
            flags: MessageFlags.Ephemeral,
          });
        }
        return;
      }

      if (isButton) {
        if (isMainBindingButton(interaction.customId)) {
          await handleMainBindingButtonInteraction(interaction, interactionContext);
        }
        return;
      }

      const command = allCommandsByName.get(interaction.commandName);
      if (!command) {
        if (isAutocomplete) await interaction.respond([]).catch(() => null);
        return;
      }

      if (!(await installModuleGuard(interaction, interactionContext, isAutocomplete))) return;

      const access = await checkCommandAccess(
        context.config,
        context.config.storage.rootDir,
        interaction,
        interaction.commandName
      );
      if (!access.allowed) {
        if (isAutocomplete) await interaction.respond([]).catch(() => null);
        else {
          await interaction.reply({
            content: t('access.denied.command', {
              command: access.commandName,
              level: access.requiredLevel,
            }),
            flags: MessageFlags.Ephemeral,
          });
        }
        return;
      }

      if (isAutocomplete) {
        if (typeof command.autocomplete === 'function') {
          await command.autocomplete(interaction, interactionContext);
        } else {
          await interaction.respond([]);
        }
        return;
      }

      if (shouldAutoDeferInteraction(interaction) && !interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      }

      await command.execute(interaction, interactionContext);
    } catch (error) {
      const label = isCommand || isAutocomplete ? `/${interaction.commandName}` : interaction.customId;
      console.error(`[discord:interaction] ${label} failed:`, error?.stack || error);
      if (isAutocomplete) await interaction.respond([]).catch(() => null);
      else await replyWithError(interaction, error, t);
    }
  });
}

module.exports = {
  getInteractionModuleKey,
  shouldAutoDeferInteraction,
  installInteractionRouter,
};
