const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { requestMainBinding } = require('../../mainBinding/mainBindingService');

const data = new SlashCommandBuilder()
  .setName('request-main')
  .setDescription('Request a Discord account binding to your main character')
  .setDescriptionLocalizations({
    ru: 'Подать заявку на привязку Discord-аккаунта к мейну',
  })
  .addStringOption((option) => option
    .setName('main')
    .setDescription('Main character name from auth data')
    .setDescriptionLocalizations({
      ru: 'Имя мейна из auth-данных',
    })
    .setRequired(true));

async function execute(interaction, context) {
  const result = await requestMainBinding(
    interaction,
    context,
    interaction.options.getString('main', true)
  );

  await interaction.reply({
    content: [
      context.t('binding.request.sentTitle'),
      context.t('binding.request.main', { mainName: result.request.mainName }),
      context.t('binding.request.status', { status: context.t('binding.status.pending') }),
      context.t('binding.request.admins'),
    ].join('\n'),
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  data,
  execute,
};
