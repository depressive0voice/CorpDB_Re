const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const {
  ACCESS_LEVELS,
  getBaseAccessLevel,
  getAccessList,
  addAdminRole,
  removeAdminRole,
  setAccessLevelForCommand,
  resetAccessLevelForCommand,
  resetAllAccessSettings,
} = require('../../access/accessService');
const {
  configureOnboardingGroup,
  autocompleteOnboardingAdmin,
  executeOnboardingAdmin,
} = require('./onboardingAdminGroup');
const {
  configureFinanceGroup,
  autocompleteFinanceAdmin,
  executeFinanceAdmin,
} = require('./financeAdminGroup');
const {
  configureModuleAdminGroup,
  executeModuleAdmin,
} = require('./moduleAdminGroup');
const {
  configureBindingAuditSubcommand,
  executeBindingAuditAdmin,
} = require('./bindingAuditAdmin');

const data = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('Bindings, onboarding, access and configuration')
  .setDescriptionLocalizations({
    ru: 'Привязки, онбординг, доступы и конфигурация',
  })
  .addSubcommand(configureBindingAuditSubcommand)
  .addSubcommandGroup((group) => group
    .setName('access')
    .setDescription('Access levels and administrator roles')
    .setDescriptionLocalizations({
      ru: 'Уровни доступа и админские роли',
    })
    .addSubcommand((subcommand) => subcommand
      .setName('add-admin-role')
      .setDescription('Add a Discord role to the administrator role list')
      .setDescriptionLocalizations({
        ru: 'Добавить Discord-роль в список админских ролей',
      })
      .addRoleOption((option) => option
        .setName('role')
        .setDescription('Discord role')
        .setDescriptionLocalizations({ ru: 'Discord-роль'})
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('remove-admin-role')
      .setDescription('Remove a Discord role from the administrator role list')
      .setDescriptionLocalizations({
        ru: 'Удалить Discord-роль из списка админских ролей',
      })
      .addRoleOption((option) => option
        .setName('role')
        .setDescription('Discord role')
        .setDescriptionLocalizations({ ru: 'Discord-роль'})
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('set-command-level')
      .setDescription('Set the required access level for a command')
      .setDescriptionLocalizations({
        ru: 'Задать требуемый уровень доступа для команды',
      })
      .addStringOption((option) => option
        .setName('command')
        .setDescription('Command name')
        .setDescriptionLocalizations({ ru: 'Имя команды'})
        .setRequired(true))
      .addStringOption((option) => option
        .setName('level')
        .setDescription('Required access level')
        .setDescriptionLocalizations({ ru: 'Требуемый уровень'})
        .setRequired(true)
        .addChoices(
          { name: ACCESS_LEVELS.USER, value: ACCESS_LEVELS.USER },
          { name: ACCESS_LEVELS.ADMIN, value: ACCESS_LEVELS.ADMIN },
          { name: ACCESS_LEVELS.MASTER_ADMIN, value: ACCESS_LEVELS.MASTER_ADMIN }
        )))
    .addSubcommand((subcommand) => subcommand
      .setName('reset-command-level')
      .setDescription('Reset a command access level to its default')
      .setDescriptionLocalizations({
        ru: 'Сбросить уровень доступа команды к значению по умолчанию',
      })
      .addStringOption((option) => option
        .setName('command')
        .setDescription('Command name')
        .setDescriptionLocalizations({ ru: 'Имя команды'})
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('reset-all')
      .setDescription('Reset all access settings to defaults')
      .setDescriptionLocalizations({
        ru: 'Сбросить все настройки доступа к значениям по умолчанию',
      }))
    .addSubcommand((subcommand) => subcommand
      .setName('list')
      .setDescription('Show current access configuration')
      .setDescriptionLocalizations({
        ru: 'Показать текущую конфигурацию доступа',
      })))
  .addSubcommandGroup(configureOnboardingGroup)
  .addSubcommandGroup(configureFinanceGroup)
  .addSubcommandGroup(configureModuleAdminGroup);

async function getAccessContext(interaction, context) {
  return getBaseAccessLevel(
    context.config,
    context.config.storage.rootDir,
    interaction.member
  );
}

function isAdminOrHigher(access) {
  return access.level === ACCESS_LEVELS.ADMIN || access.level === ACCESS_LEVELS.MASTER_ADMIN;
}

function isMasterAdmin(access) {
  return access.level === ACCESS_LEVELS.MASTER_ADMIN;
}

async function reply(interaction, content) {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function executeAccessAdmin(interaction, context, access) {
  const subcommand = interaction.options.getSubcommand();
  const storageRoot = context.config.storage.rootDir;

  if (subcommand === 'list') {
    if (!isAdminOrHigher(access)) {
      await reply(interaction, context.t('access.denied.admin'));
      return;
    }
    const current = await getAccessList(storageRoot);
    const lines = [
      context.t('access.list.title'),
      context.t('access.list.adminRoleCount', { count: current.adminRoleIds.length }),
    ];
    if (current.adminRoleIds.length > 0) {
      lines.push(context.t('access.list.roles', {
        roles: current.adminRoleIds.map((id) => `<@&${id}>`).join(', '),
      }));
    }
    lines.push('', context.t('access.list.commandLevels'));
    for (const [commandName, level] of Object.entries(current.commandLevels)) {
      lines.push(`/${commandName} → **${level}**`);
    }
    await reply(interaction, lines.join('\n'));
    return;
  }

  if (!isMasterAdmin(access)) {
    await reply(interaction, context.t('access.denied.masterAdmin'));
    return;
  }

  if (subcommand === 'add-admin-role') {
    const role = interaction.options.getRole('role', true);
    const result = await addAdminRole(storageRoot, role);
    if (!result.ok && result.code === 'role_already_added') {
      await reply(interaction, context.t('access.adminRole.alreadyAdded', { role: `<@&${result.roleId}>` }));
      return;
    }
    if (!result.ok) throw new Error(context.t('access.adminRole.addFailed'));
    await reply(interaction, context.t('access.adminRole.added', { role: `<@&${result.roleId}>` }));
    return;
  }

  if (subcommand === 'remove-admin-role') {
    const role = interaction.options.getRole('role', true);
    const result = await removeAdminRole(storageRoot, role);
    if (!result.ok && result.code === 'role_not_found') {
      await reply(interaction, context.t('access.adminRole.notFound', { role: `<@&${result.roleId}>` }));
      return;
    }
    if (!result.ok) throw new Error(context.t('access.adminRole.removeFailed'));
    await reply(interaction, context.t('access.adminRole.removed', { role: `<@&${result.roleId}>` }));
    return;
  }

  if (subcommand === 'set-command-level') {
    const commandName = interaction.options.getString('command', true);
    const level = interaction.options.getString('level', true);
    const result = await setAccessLevelForCommand(storageRoot, commandName, level);
    if (!result.ok && result.code === 'command_not_settable') {
      await reply(interaction, context.t('access.command.notSettable', { command: commandName }));
      return;
    }
    if (!result.ok && result.code === 'invalid_access_level') {
      await reply(interaction, context.t('access.command.invalidLevel', { level }));
      return;
    }
    if (!result.ok) throw new Error(context.t('access.command.updateFailed'));
    await reply(interaction, context.t('access.command.updated', {
      command: result.commandName,
      level: result.level,
    }));
    return;
  }

  if (subcommand === 'reset-command-level') {
    const commandName = interaction.options.getString('command', true);
    const result = await resetAccessLevelForCommand(storageRoot, commandName);
    if (!result.ok && result.code === 'command_not_settable') {
      await reply(interaction, context.t('access.command.notSettable', { command: commandName }));
      return;
    }
    if (!result.ok) throw new Error(context.t('access.command.resetFailed'));
    await reply(interaction, context.t('access.command.reset', {
      command: result.commandName,
      level: result.level,
    }));
    return;
  }

  if (subcommand === 'reset-all') {
    const result = await resetAllAccessSettings(storageRoot);
    await reply(interaction, context.t('access.resetAll.done', {
      roles: result.adminRoleIds.length,
      commands: Object.keys(result.commandLevels).length,
    }));
    return;
  }

  throw new Error(context.t('admin.error.unsupportedSubcommand', { subcommand }));
}

async function autocomplete(interaction, context) {
  const group = interaction.options.getSubcommandGroup(false);
  if (group === 'onboarding') {
    await autocompleteOnboardingAdmin(interaction, context);
    return;
  }
  if (group === 'finance') {
    await autocompleteFinanceAdmin(interaction, context);
    return;
  }
  await interaction.respond([]);
}

async function execute(interaction, context) {
  const group = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand(false);
  const access = await getAccessContext(interaction, context);

  if (!group && subcommand === 'binding-audit') {
    if (!isAdminOrHigher(access)) {
      await reply(interaction, context.t('access.denied.admin'));
      return;
    }
    await executeBindingAuditAdmin(interaction, context);
    return;
  }

  if (group === 'access') {
    await executeAccessAdmin(interaction, context, access);
    return;
  }

  if (group === 'onboarding' || group === 'finance' || group === 'modules') {
    if (!isMasterAdmin(access)) {
      await reply(interaction, context.t('access.denied.masterAdmin'));
      return;
    }
    if (group === 'onboarding') {
      await executeOnboardingAdmin(interaction, context);
    } else if (group === 'finance') {
      await executeFinanceAdmin(interaction, context);
    } else {
      await executeModuleAdmin(interaction, context);
    }
    return;
  }

  throw new Error(context.t('admin.error.unsupportedGroup', { group: group || 'none' }));
}

module.exports = { data, execute, autocomplete };
