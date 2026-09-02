const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const {
  readManagedRolePolicy,
  bindManagedRole,
  unbindManagedRole,
  setGuestRole,
} = require('../../roles/managedRolePolicyRepository');
const { sweepGuestFallback } = require('../../roles/guestFallbackService');

const data = new SlashCommandBuilder()
  .setName('roles')
  .setDescription('Configure Discord role bindings used by CorpDB')
  .setDescriptionLocalizations({
    ru: 'Настройка привязок существующих ролей Discord для CorpDB',
  })
  .addSubcommand((subcommand) => subcommand
    .setName('list')
    .setDescription('List named Discord role bindings')
    .setDescriptionLocalizations({
      ru: 'Показать привязанные роли Discord',
    }))
  .addSubcommand((subcommand) => subcommand
    .setName('bind')
    .setDescription('Bind a logical CorpDB role name to an existing Discord role')
    .setDescriptionLocalizations({
      ru: 'Привязать логическое имя CorpDB к существующей роли Discord',
    })
    .addStringOption((option) => option
      .setName('key')
      .setDescription('Logical name, for example guest, member, probation, rookie, officer')
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(64))
    .addRoleOption((option) => option
      .setName('role')
      .setDescription('Existing Discord role to bind')
      .setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName('unbind')
    .setDescription('Remove a named Discord role binding without deleting the Discord role')
    .setDescriptionLocalizations({
      ru: 'Удалить привязку, не удаляя саму роль Discord',
    })
    .addStringOption((option) => option
      .setName('key')
      .setDescription('Logical role binding name')
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(64)))
  .addSubcommand((subcommand) => subcommand
    .setName('status')
    .setDescription('Show Guest fallback role status')
    .setDescriptionLocalizations({
      ru: 'Показать состояние fallback-роли Guest',
    }))
  .addSubcommand((subcommand) => subcommand
    .setName('set-guest')
    .setDescription('Bind the fallback Guest role')
    .setDescriptionLocalizations({
      ru: 'Привязать fallback-роль Guest',
    })
    .addRoleOption((option) => option
      .setName('role')
      .setDescription('Existing Discord role used as the Guest fallback')
      .setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName('sweep')
    .setDescription('Give Guest to members with no bot-manageable role')
    .setDescriptionLocalizations({
      ru: 'Выдать Guest участникам без доступной боту роли',
    }));

function isOwner(config, userId) {
  return config.discord.ownerIds.includes(String(userId));
}

async function ensureOwner(interaction, context) {
  if (isOwner(context.config, interaction.user.id)) return true;
  await interaction.reply({
    content: context.t('common.ownerOnly'),
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

function describeBinding(guild, key, roleId, t = null) {
  const role = guild.roles.cache.get(roleId);
  if (!role) {
    return t
      ? t('roles.binding.missing', { key, roleId })
      : `\`${key}\` → missing role \`${roleId}\``;
  }
  const capability = role.editable && !role.managed
    ? (t ? t('common.manageable') : 'manageable')
    : (t ? t('common.readOnlyUnmanageable') : 'read-only/unmanageable');
  return t
    ? t('roles.binding.present', { key, role, roleId: role.id, capability })
    : `\`${key}\` → ${role} (\`${role.id}\`) — ${capability}`;
}

async function execute(interaction, context) {
  if (!(await ensureOwner(interaction, context))) return;
  const storageRoot = context.config.storage.rootDir;
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'list') {
    const policy = await readManagedRolePolicy(storageRoot);
    const entries = Object.entries(policy.bindings || {}).sort(([a], [b]) => a.localeCompare(b));
    await interaction.reply({
      content: entries.length > 0
        ? [
          context.t('roles.list.title'),
          ...entries.map(([key, roleId]) => describeBinding(interaction.guild, key, roleId, context.t)),
        ].join('\n')
        : context.t('roles.list.none'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'bind') {
    const key = interaction.options.getString('key', true);
    const role = interaction.options.getRole('role', true);
    if (role.id === interaction.guildId) {
      throw new Error(context.t('roles.error.everyoneBinding'));
    }
    if (String(key).trim().toLowerCase() === 'guest' && (!role.editable || role.managed)) {
      throw new Error(context.t('roles.error.guestUnmanageable', { roleName: role.name }));
    }

    const policy = await bindManagedRole(storageRoot, key, role.id);
    const normalizedKey = Object.keys(policy.bindings).find(
      (candidate) => policy.bindings[candidate] === role.id && candidate === String(key).trim().toLowerCase()
    ) || String(key).trim().toLowerCase();
    await interaction.reply({
      content: context.t('roles.bind.success', { key: normalizedKey, role }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'unbind') {
    const key = interaction.options.getString('key', true);
    const normalizedKey = String(key).trim().toLowerCase();
    await unbindManagedRole(storageRoot, key);
    await interaction.reply({
      content: context.t('roles.unbind.success', { key: normalizedKey }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'status') {
    const policy = await readManagedRolePolicy(storageRoot);
    const guestRoleId = policy.bindings?.guest || '';
    await interaction.reply({
      content: guestRoleId
        ? context.t('roles.status.guest', {
          binding: describeBinding(interaction.guild, 'guest', guestRoleId, context.t),
        })
        : context.t('roles.status.none'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'set-guest') {
    const role = interaction.options.getRole('role', true);
    if (role.id === interaction.guildId) {
      throw new Error(context.t('roles.error.everyoneGuest'));
    }
    if (!role.editable || role.managed) {
      throw new Error(context.t('roles.error.cannotManage', { roleName: role.name }));
    }
    await setGuestRole(storageRoot, role.id);
    await interaction.reply({
      content: context.t('roles.guest.set', { role }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'sweep') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await sweepGuestFallback(storageRoot, interaction.guild);
    await interaction.editReply({
      content: result.enabled
        ? context.t('roles.sweep.complete', {
          checked: result.checkedCount,
          granted: result.grantedCount,
          failures: result.failedCount,
        })
        : context.t('roles.sweep.disabled'),
    });
    return;
  }

  throw new Error(context.t('roles.error.unsupportedSubcommand', { subcommand }));
}

module.exports = {
  data,
  execute,
  describeBinding,
};