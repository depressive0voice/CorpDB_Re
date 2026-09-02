const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { getBaseAccessLevel } = require('../../access/accessService');

const data = new SlashCommandBuilder()
  .setName('access')
  .setDescription('Show your current CorpDB access level')
  .setDescriptionLocalizations({
    ru: 'Показать ваш текущий уровень доступа CorpDB',
  })
  .addSubcommand((subcommand) => subcommand
    .setName('whoami')
    .setDescription('Show your current access level')
    .setDescriptionLocalizations({
      ru: 'Показать ваш текущий уровень доступа',
    }));

async function execute(interaction, context) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand !== 'whoami') {
    throw new Error(context.t('access.error.unsupportedSubcommand', { subcommand }));
  }

  const result = await getBaseAccessLevel(
    context.config,
    context.config.storage.rootDir,
    interaction.member
  );

  await interaction.reply({
    content: [
      context.t('access.whoami.title'),
      context.t('access.whoami.level', { level: result.level }),
      context.t('access.whoami.reason', { reason: result.reason }),
      context.t('access.whoami.roles', {
        roles: result.matchedRoleIds.length > 0
          ? result.matchedRoleIds.map((id) => `<@&${id}>`).join(', ')
          : context.t('common.none'),
      }),
    ].join('\n'),
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = { data, execute };
