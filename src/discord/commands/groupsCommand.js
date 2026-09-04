const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const {
  createAccessGroup,
  deleteAccessGroup,
  getAccessGroup,
  listAccessGroups,
  updateAccessGroup,
} = require('../../accessGroups/accessGroupRepository');
const {
  deleteAccessGroupRequests,
} = require('../../accessGroups/accessGroupRequestRepository');
const {
  listGroupAvailability,
  requestAccessGroup,
  listPendingRequestsForApprover,
  approveAccessGroupRequest,
  rejectAccessGroupRequest,
  revokeAccessGroup,
} = require('../../accessGroups/accessGroupService');
const { readRegistry } = require('../../corporations/corporationRegistryRepository');

const ROLE_KINDS = Object.freeze({
  grant: ['grantRoleIds'],
  'required-all': ['eligibility', 'requireAllRoleIds'],
  'required-any': ['eligibility', 'requireAnyRoleIds'],
  forbidden: ['eligibility', 'forbiddenRoleIds'],
  approver: ['approval', 'approverRoleIds'],
});

const data = new SlashCommandBuilder()
  .setName('groups')
  .setDescription('Request and manage officer-approved access groups')
  .setDescriptionLocalizations({
    ru: 'Запрос и управление группами доступа с аппрувом офицеров',
  })
  .addSubcommand((subcommand) => subcommand
    .setName('list')
    .setDescription('Show access groups and your eligibility')
    .setDescriptionLocalizations({
      ru: 'Показать группы доступа и вашу доступность',
    }))
  .addSubcommand((subcommand) => subcommand
    .setName('request')
    .setDescription('Request membership in an access group')
    .setDescriptionLocalizations({
      ru: 'Подать заявку на вступление в группу доступа',
    })
    .addStringOption((option) => option
      .setName('group')
      .setDescription('Access group ID')
      .setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName('pending')
    .setDescription('Show requests you are allowed to review')
    .setDescriptionLocalizations({
      ru: 'Показать заявки, которые вы можете рассматривать',
    }))
  .addSubcommand((subcommand) => subcommand
    .setName('approve')
    .setDescription('Approve an access group request')
    .setDescriptionLocalizations({
      ru: 'Одобрить заявку на группу доступа',
    })
    .addStringOption((option) => option
      .setName('request')
      .setDescription('Request ID')
      .setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName('reject')
    .setDescription('Reject an access group request')
    .setDescriptionLocalizations({
      ru: 'Отклонить заявку на группу доступа',
    })
    .addStringOption((option) => option
      .setName('request')
      .setDescription('Request ID')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('reason')
      .setDescription('Optional rejection reason')
      .setRequired(false)))
  .addSubcommand((subcommand) => subcommand
    .setName('revoke')
    .setDescription('Revoke an access group from a member')
    .setDescriptionLocalizations({
      ru: 'Отозвать группу доступа у участника',
    })
    .addStringOption((option) => option
      .setName('group')
      .setDescription('Access group ID')
      .setRequired(true))
    .addUserOption((option) => option
      .setName('user')
      .setDescription('Discord member')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('reason')
      .setDescription('Optional revoke reason')
      .setRequired(false)))
  .addSubcommand((subcommand) => subcommand
    .setName('create')
    .setDescription('Create an access group (owner only)')
    .setDescriptionLocalizations({
      ru: 'Создать группу доступа (только owner)',
    })
    .addStringOption((option) => option
      .setName('id')
      .setDescription('Stable group ID, for example capital-pilots')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('name')
      .setDescription('Display name')
      .setRequired(true))
    .addRoleOption((option) => option
      .setName('grant_role')
      .setDescription('Role granted after final approval')
      .setRequired(true))
    .addRoleOption((option) => option
      .setName('approver_role')
      .setDescription('Role allowed to approve requests')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('description')
      .setDescription('Optional group description')
      .setRequired(false))
    .addRoleOption((option) => option
      .setName('required_role')
      .setDescription('Role required before the group can be requested')
      .setRequired(false))
    .addRoleOption((option) => option
      .setName('forbidden_role')
      .setDescription('Role that blocks requesting this group')
      .setRequired(false))
    .addStringOption((option) => option
      .setName('scope')
      .setDescription('Group scope')
      .addChoices(
        { name: 'Instance', value: 'instance' },
        { name: 'Corporation', value: 'corporation' }
      )
      .setRequired(false))
    .addStringOption((option) => option
      .setName('corporation')
      .setDescription('Corporation ID when scope=corporation')
      .setRequired(false))
    .addIntegerOption((option) => option
      .setName('approvals')
      .setDescription('Independent approvals required (default 1)')
      .setMinValue(1)
      .setMaxValue(10)
      .setRequired(false))
    .addStringOption((option) => option
      .setName('revoke_policy')
      .setDescription('Policy reserved for automatic revoke workflows')
      .addChoices(
        { name: 'Manual', value: 'manual' },
        { name: 'Prerequisite loss', value: 'prerequisite-loss' },
        { name: 'Corporation leave', value: 'corporation-leave' }
      )
      .setRequired(false)))
  .addSubcommand((subcommand) => subcommand
    .setName('delete')
    .setDescription('Delete an access group and all of its requests (owner only)')
    .setDescriptionLocalizations({
      ru: 'Удалить группу доступа и все её заявки (только owner)',
    })
    .addStringOption((option) => option
      .setName('group')
      .setDescription('Access group ID')
      .setAutocomplete(true)
      .setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName('role-add')
    .setDescription('Add a role rule to an access group (owner only)')
    .setDescriptionLocalizations({
      ru: 'Добавить правило роли в группу доступа (только owner)',
    })
    .addStringOption((option) => option
      .setName('group')
      .setDescription('Access group ID')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('kind')
      .setDescription('Role rule type')
      .addChoices(
        { name: 'Granted role', value: 'grant' },
        { name: 'Required: all', value: 'required-all' },
        { name: 'Required: any', value: 'required-any' },
        { name: 'Forbidden', value: 'forbidden' },
        { name: 'Approver', value: 'approver' }
      )
      .setRequired(true))
    .addRoleOption((option) => option
      .setName('role')
      .setDescription('Discord role')
      .setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName('role-remove')
    .setDescription('Remove a role rule from an access group (owner only)')
    .setDescriptionLocalizations({
      ru: 'Удалить правило роли из группы доступа (только owner)',
    })
    .addStringOption((option) => option
      .setName('group')
      .setDescription('Access group ID')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('kind')
      .setDescription('Role rule type')
      .addChoices(
        { name: 'Granted role', value: 'grant' },
        { name: 'Required: all', value: 'required-all' },
        { name: 'Required: any', value: 'required-any' },
        { name: 'Forbidden', value: 'forbidden' },
        { name: 'Approver', value: 'approver' }
      )
      .setRequired(true))
    .addRoleOption((option) => option
      .setName('role')
      .setDescription('Discord role')
      .setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName('enable')
    .setDescription('Enable or disable an access group (owner only)')
    .setDescriptionLocalizations({
      ru: 'Включить или выключить группу доступа (только owner)',
    })
    .addStringOption((option) => option
      .setName('group')
      .setDescription('Access group ID')
      .setRequired(true))
    .addBooleanOption((option) => option
      .setName('enabled')
      .setDescription('Whether the group is available')
      .setRequired(true)));

function isOwner(config, userId) {
  return config.discord.ownerIds.includes(String(userId));
}

async function ensureOwner(interaction, context) {
  if (isOwner(context.config, interaction.user.id)) return true;
  await interaction.reply({
    content: context.t('common.ownerOnlyOperation'),
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

async function fetchInvokerMember(interaction, context) {
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) throw new Error(context.t('groups.error.memberLoad'));
  return member;
}

function mentionRoles(roleIds, t = null) {
  return roleIds.length
    ? roleIds.map((roleId) => `<@&${roleId}>`).join(', ')
    : (t ? t('common.none') : 'none');
}

function formatEligibility(eligibility, t = null) {
  if (!t) {
    if (eligibility.eligible) return 'eligible';
    const reasons = [];
    if (eligibility.missingAllRoleIds.length) reasons.push(`missing ${mentionRoles(eligibility.missingAllRoleIds)}`);
    if (eligibility.missingAnyRoleIds.length) reasons.push(`needs one of ${mentionRoles(eligibility.missingAnyRoleIds)}`);
    if (eligibility.presentForbiddenRoleIds.length) reasons.push(`blocked by ${mentionRoles(eligibility.presentForbiddenRoleIds)}`);
    return reasons.join('; ');
  }

  if (eligibility.eligible) return t('groups.eligibility.eligible');
  const reasons = [];
  if (eligibility.missingAllRoleIds.length) {
    reasons.push(t('groups.eligibility.missing', {
      roles: mentionRoles(eligibility.missingAllRoleIds, t),
    }));
  }
  if (eligibility.missingAnyRoleIds.length) {
    reasons.push(t('groups.eligibility.oneOf', {
      roles: mentionRoles(eligibility.missingAnyRoleIds, t),
    }));
  }
  if (eligibility.presentForbiddenRoleIds.length) {
    reasons.push(t('groups.eligibility.blockedBy', {
      roles: mentionRoles(eligibility.presentForbiddenRoleIds, t),
    }));
  }
  return reasons.join('; ');
}

async function handleList(interaction, context) {
  const member = await fetchInvokerMember(interaction, context);
  const availability = await listGroupAvailability(context.config.storage.rootDir, member);
  if (!availability.length) {
    await interaction.reply({
      content: context.t('groups.list.none'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = availability.slice(0, 20).map(({ group, eligibility }) => {
    const scope = group.scope === 'corporation'
      ? context.t('groups.scope.corporation', { corporationId: group.corporationId })
      : context.t('groups.scope.instance');
    return context.t('groups.list.line', {
      name: group.name,
      id: group.id,
      eligibility: formatEligibility(eligibility, context.t),
      scope,
      approvals: group.approval.requiredApprovals,
    });
  });
  if (availability.length > 20) {
    lines.push(context.t('common.more', { count: availability.length - 20 }));
  }
  await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
}

async function handleRequest(interaction, context) {
  const member = await fetchInvokerMember(interaction, context);
  const request = await requestAccessGroup(
    context.config.storage.rootDir,
    member,
    interaction.options.getString('group', true)
  );
  await interaction.reply({
    content: context.t('groups.request.created', { requestId: request.id }),
    flags: MessageFlags.Ephemeral,
  });
}

async function handlePending(interaction, context) {
  const member = await fetchInvokerMember(interaction, context);
  const values = await listPendingRequestsForApprover(
    context.config.storage.rootDir,
    context.config,
    member
  );
  if (!values.length) {
    await interaction.reply({
      content: context.t('groups.pending.none'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = values.slice(0, 15).map(({ request, group }) =>
    context.t('groups.pending.line', {
      requestId: request.id,
      groupName: group.name,
      userId: request.discordUserId,
      current: request.approvals.length,
      required: group.approval.requiredApprovals,
    })
  );
  if (values.length > 15) {
    lines.push(context.t('common.more', { count: values.length - 15 }));
  }
  await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
}

async function handleApprove(interaction, context) {
  const member = await fetchInvokerMember(interaction, context);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await approveAccessGroupRequest(
    context.config.storage.rootDir,
    context.config,
    interaction.guild,
    member,
    interaction.options.getString('request', true)
  );
  await interaction.editReply({
    content: result.finalized
      ? context.t('groups.approve.finalized', {
        groupName: result.group.name,
        userId: result.targetMember.id,
      })
      : context.t('groups.approve.recorded', {
        groupName: result.group.name,
        current: result.approvalsCount,
        required: result.requiredApprovals,
      }),
  });
}

async function handleReject(interaction, context) {
  const member = await fetchInvokerMember(interaction, context);
  const result = await rejectAccessGroupRequest(
    context.config.storage.rootDir,
    context.config,
    member,
    interaction.options.getString('request', true),
    interaction.options.getString('reason') || ''
  );
  await interaction.reply({
    content: context.t('groups.reject.done', {
      requestId: result.request.id,
      groupName: result.group.name,
    }),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRevoke(interaction, context) {
  const member = await fetchInvokerMember(interaction, context);
  const user = interaction.options.getUser('user', true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await revokeAccessGroup(
    context.config.storage.rootDir,
    context.config,
    interaction.guild,
    member,
    interaction.options.getString('group', true),
    user.id,
    interaction.options.getString('reason') || ''
  );
  await interaction.editReply({
    content: context.t('groups.revoke.done', {
      groupName: result.group.name,
      userId: user.id,
    }),
  });
}

async function handleCreate(interaction, context) {
  if (!(await ensureOwner(interaction, context))) return;

  const scope = interaction.options.getString('scope') || 'instance';
  const corporationId = interaction.options.getString('corporation') || '';
  if (scope === 'corporation') {
    if (!corporationId) throw new Error(context.t('groups.error.corporationRequired'));
    const registry = await readRegistry(context.config.storage.rootDir);
    if (!registry.corporations.some((entry) => entry.corporationId === corporationId)) {
      throw new Error(context.t('groups.error.corporationNotRegistered', { corporationId }));
    }
  }

  const grantRole = interaction.options.getRole('grant_role', true);
  if (!grantRole.editable || grantRole.managed) {
    throw new Error(context.t('groups.error.cannotManage', { roleName: grantRole.name }));
  }
  const approverRole = interaction.options.getRole('approver_role', true);
  const requiredRole = interaction.options.getRole('required_role');
  const forbiddenRole = interaction.options.getRole('forbidden_role');

  const group = await createAccessGroup(context.config.storage.rootDir, {
    id: interaction.options.getString('id', true),
    name: interaction.options.getString('name', true),
    description: interaction.options.getString('description') || '',
    scope,
    corporationId: scope === 'corporation' ? corporationId : null,
    grantRoleIds: [grantRole.id],
    eligibility: {
      requireAllRoleIds: requiredRole ? [requiredRole.id] : [],
      requireAnyRoleIds: [],
      forbiddenRoleIds: forbiddenRole ? [forbiddenRole.id] : [],
    },
    approval: {
      approverRoleIds: [approverRole.id],
      requiredApprovals: interaction.options.getInteger('approvals') || 1,
    },
    revokePolicy: interaction.options.getString('revoke_policy') || 'manual',
  });

  await interaction.reply({
    content: [
      context.t('groups.create.created', { name: group.name, id: group.id }),
      context.t('groups.create.grants', { roles: mentionRoles(group.grantRoleIds, context.t) }),
      context.t('groups.create.required', {
        roles: mentionRoles(group.eligibility.requireAllRoleIds, context.t),
      }),
      context.t('groups.create.approvers', {
        roles: mentionRoles(group.approval.approverRoleIds, context.t),
      }),
      context.t('groups.create.policy', {
        approvals: group.approval.requiredApprovals,
        policy: group.revokePolicy,
      }),
    ].join('\n'),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleDelete(interaction, context) {
  if (!(await ensureOwner(interaction, context))) return;
  const groupId = interaction.options.getString('group', true);
  const group = await getAccessGroup(context.config.storage.rootDir, groupId);
  if (!group) throw new Error(context.t('groups.error.notFound', { groupId }));

  const deletedRequests = await deleteAccessGroupRequests(context.config.storage.rootDir, group.id);
  await deleteAccessGroup(context.config.storage.rootDir, group.id);
  await interaction.reply({
    content: context.t('groups.delete.done', {
      groupName: group.name,
      groupId: group.id,
      requests: deletedRequests,
    }),
    flags: MessageFlags.Ephemeral,
  });
}

function mutateRoleList(group, kind, roleId, operation, t = null) {
  const path = ROLE_KINDS[kind];
  if (!path) {
    throw new Error(t
      ? t('groups.error.unknownRoleKind', { kind })
      : `Unknown access group role kind: ${kind}.`);
  }
  const clone = JSON.parse(JSON.stringify(group));
  let target = clone;
  for (let index = 0; index < path.length - 1; index += 1) target = target[path[index]];
  const key = path[path.length - 1];
  const values = Array.isArray(target[key]) ? target[key] : [];
  target[key] = operation === 'add'
    ? [...new Set([...values, roleId])]
    : values.filter((value) => value !== roleId);
  return clone;
}

async function handleRoleMutation(interaction, context, operation) {
  if (!(await ensureOwner(interaction, context))) return;
  const groupId = interaction.options.getString('group', true);
  const group = await getAccessGroup(context.config.storage.rootDir, groupId);
  if (!group) throw new Error(context.t('groups.error.notFound', { groupId }));
  const kind = interaction.options.getString('kind', true);
  const role = interaction.options.getRole('role', true);
  if (kind === 'grant' && operation === 'add' && (!role.editable || role.managed)) {
    throw new Error(context.t('groups.error.cannotManage', { roleName: role.name }));
  }

  const mutated = mutateRoleList(group, kind, role.id, operation, context.t);
  const updated = await updateAccessGroup(context.config.storage.rootDir, group.id, mutated);
  await interaction.reply({
    content: context.t(
      operation === 'add' ? 'groups.roleMutation.added' : 'groups.roleMutation.removed',
      { role, groupName: updated.name, kind }
    ),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleEnable(interaction, context) {
  if (!(await ensureOwner(interaction, context))) return;
  const groupId = interaction.options.getString('group', true);
  const updated = await updateAccessGroup(context.config.storage.rootDir, groupId, {
    enabled: interaction.options.getBoolean('enabled', true),
  });
  await interaction.reply({
    content: context.t('groups.enable.state', {
      groupName: updated.name,
      state: context.t(updated.enabled ? 'common.enabled' : 'common.disabled'),
    }),
    flags: MessageFlags.Ephemeral,
  });
}

async function autocomplete(interaction, context) {
  const focused = interaction.options.getFocused(true);
  const subcommand = interaction.options.getSubcommand(false);
  if (subcommand !== 'delete' || focused.name !== 'group') {
    await interaction.respond([]);
    return;
  }

  const query = String(focused.value || '').trim().toLowerCase();
  const groups = await listAccessGroups(context.config.storage.rootDir);
  const choices = groups
    .filter((group) => !query
      || group.id.toLowerCase().includes(query)
      || group.name.toLowerCase().includes(query))
    .slice(0, 25)
    .map((group) => ({
      name: `${group.name} (${group.id})`.slice(0, 100),
      value: group.id,
    }));
  await interaction.respond(choices);
}

async function execute(interaction, context) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'list') return handleList(interaction, context);
  if (subcommand === 'request') return handleRequest(interaction, context);
  if (subcommand === 'pending') return handlePending(interaction, context);
  if (subcommand === 'approve') return handleApprove(interaction, context);
  if (subcommand === 'reject') return handleReject(interaction, context);
  if (subcommand === 'revoke') return handleRevoke(interaction, context);
  if (subcommand === 'create') return handleCreate(interaction, context);
  if (subcommand === 'delete') return handleDelete(interaction, context);
  if (subcommand === 'role-add') return handleRoleMutation(interaction, context, 'add');
  if (subcommand === 'role-remove') return handleRoleMutation(interaction, context, 'remove');
  if (subcommand === 'enable') return handleEnable(interaction, context);
  throw new Error(context.t('groups.error.unsupportedSubcommand', { subcommand }));
}

module.exports = {
  data,
  autocomplete,
  execute,
  mutateRoleList,
};