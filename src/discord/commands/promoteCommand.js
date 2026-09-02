const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { checkCommandAccess } = require('../../access/accessService');
const { promoteMember } = require('../../onboarding/promotionService');

const data = new SlashCommandBuilder()
  .setName('promote')
  .setDescription('Complete Rookie probation and assign the Main role')
  .setDescriptionLocalizations({
    ru: 'Завершить испытательный срок Rookie и выдать роль Main',
  })
  .addStringOption((option) => option
    .setName('role')
    .setDescription('Final Discord role')
    .setDescriptionLocalizations({ ru: 'Итоговая Discord-роль'})
    .setRequired(true)
    .addChoices({ name: 'MAIN', value: 'main' }))
  .addUserOption((option) => option
    .setName('user')
    .setDescription('Discord user')
    .setDescriptionLocalizations({ ru: 'Discord-пользователь'})
    .setRequired(false))
  .addStringOption((option) => option
    .setName('name')
    .setDescription('EVE main or alt character name')
    .setDescriptionLocalizations({
      ru: 'Имя EVE-мейна или альта',
    })
    .setMaxLength(100)
    .setRequired(false));

async function execute(interaction, context) {
  const storageRoot = context.config.storage.rootDir;
  const access = await checkCommandAccess(
    context.config,
    storageRoot,
    interaction,
    'promote'
  );
  if (!access.allowed) {
    await interaction.reply({
      content: context.t('access.denied.command', {
        command: 'promote',
        level: access.requiredLevel,
      }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const role = interaction.options.getString('role', true);
  const user = interaction.options.getUser('user', false);
  const name = interaction.options.getString('name', false) || '';
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await promoteMember({
    config: context.config,
    storageRoot,
    guild: interaction.guild,
    client: interaction.client,
    discordUserId: user?.id || '',
    characterName: name,
    role,
    reviewedByUser: interaction.user,
    t: context.t,
  });

  await interaction.editReply({
    content: context.t('promotion.command.done', {
      userId: result.binding.discordUserId,
      mainName: result.binding.mainName,
      role: result.roleLabel,
      dmSent: context.t(result.dmSent ? 'promotion.command.dmYes' : 'promotion.command.dmNo'),
    }),
  });
}

module.exports = { data, execute };
