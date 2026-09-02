const { AttachmentBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const {
  checkCorporationBlacklist,
  checkCharacterBlacklist,
} = require('../../blacklist/blacklistService');

function validateLookupMode(corporation, character) {
  if (!corporation && !character) {
    const error = new Error('Specify corporation or character.');
    error.code = 'blacklist_lookup_required';
    throw error;
  }
  if (corporation && character) {
    const error = new Error('Specify only one lookup: corporation or character.');
    error.code = 'blacklist_lookup_ambiguous';
    throw error;
  }
}

function localizedStatus(context, status) {
  return context.t(`blacklist.status.${status}`);
}

const data = new SlashCommandBuilder()
  .setName('blacklist')
  .setDescription('Check a corporation or character against the coalition blacklist')
  .setDescriptionLocalizations({
    ru: 'Проверить корпорацию или персонажа по coalition blacklist',
  })
  .addStringOption((option) => option
    .setName('corporation')
    .setDescription('Corporation ID or EveWho corporation URL')
    .setDescriptionLocalizations({
      ru: 'Corporation ID или ссылка EveWho на корпорацию',
    })
    .setRequired(false)
    .setMaxLength(200))
  .addStringOption((option) => option
    .setName('character')
    .setDescription('Character name, character ID or EveWho character URL')
    .setDescriptionLocalizations({
      ru: 'Имя, character ID или ссылка EveWho на персонажа',
    })
    .setRequired(false)
    .setMaxLength(200));

async function execute(interaction, context) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const corporation = interaction.options.getString('corporation', false);
    const character = interaction.options.getString('character', false);
    validateLookupMode(corporation, character);

    if (character) {
      const result = await checkCharacterBlacklist(context.config, character);
      await interaction.editReply({
        content: [
          context.t('blacklist.character.character', { character: result.characterName }),
          result.eveWhoUrl
            ? context.t('blacklist.character.eveWho', { url: result.eveWhoUrl })
            : '',
          context.t('blacklist.character.status', { status: localizedStatus(context, result.status) }),
        ].filter(Boolean).join('\n'),
      });
      return;
    }

    const result = await checkCorporationBlacklist(context.config, corporation);
    const attachment = new AttachmentBuilder(result.content, { name: result.fileName });
    await interaction.editReply({
      content: [
        context.t('blacklist.corporation.corporation', { corporation: result.corporationName }),
        context.t('blacklist.corporation.checked', { count: result.results.length }),
        context.t('blacklist.corporation.black', { count: result.counts.black }),
        context.t('blacklist.corporation.grey', { count: result.counts.grey }),
        context.t('blacklist.corporation.clear', { count: result.counts.clear }),
      ].join('\n'),
      files: [attachment],
    });
  } catch (error) {
    console.error('[blacklist] command failed:', error?.stack || error);
    const knownKey = {
      blacklist_lookup_required: 'blacklist.error.lookupRequired',
      blacklist_lookup_ambiguous: 'blacklist.error.lookupAmbiguous',
      blacklist_not_configured: 'blacklist.error.notConfigured',
      blacklist_invalid_corporation: 'blacklist.error.invalidCorporation',
      blacklist_invalid_character: 'blacklist.error.invalidCharacter',
    }[error?.code];
    await interaction.editReply({
      content: knownKey
        ? context.t(knownKey)
        : context.t('blacklist.error.failed', { message: error?.message || context.t('common.unknownError') }),
    });
  }
}

module.exports = {
  data,
  execute,
  validateLookupMode,
};
