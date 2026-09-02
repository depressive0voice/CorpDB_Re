const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { setUserLanguage } = require('../../localization/userLanguageRepository');
const { translate } = require('../../localization/localizationService');

const LANGUAGE_CHOICES = Object.freeze([
  { name: 'English', value: 'en' },
  { name: 'Русский', value: 'ru' },
]);

const data = new SlashCommandBuilder()
  .setName('language')
  .setDescription('Choose your CorpDB language')
  .setDescriptionLocalizations({
    ru: 'Выбрать язык CorpDB',
  })
  .addStringOption((option) => option
    .setName('language')
    .setDescription('Language used for CorpDB replies')
    .setDescriptionLocalizations({
      ru: 'Язык ответов CorpDB',
    })
    .setRequired(true)
    .addChoices(...LANGUAGE_CHOICES));

async function execute(interaction, context) {
  const language = interaction.options.getString('language', true);
  const enabledLanguages = context.config.localization.enabledLanguages;

  if (!enabledLanguages.includes(language)) {
    await interaction.reply({
      content: translate(language, 'language.disabled', {}, {
        fallbackLanguage: context.config.localization.defaultLanguage,
      }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await setUserLanguage(
    context.config.storage.rootDir,
    interaction.user.id,
    language
  );

  await interaction.reply({
    content: translate(language, 'language.changed', {}, {
      fallbackLanguage: context.config.localization.defaultLanguage,
    }),
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  LANGUAGE_CHOICES,
  data,
  execute,
};
