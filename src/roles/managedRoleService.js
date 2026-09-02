function normalizeRoleId(value) {
  const roleId = String(value ?? '').trim();
  if (!roleId) throw new Error('Discord role ID is required.');
  return roleId;
}

function assertGuildMember(member) {
  if (!member?.guild || !member?.roles?.cache) {
    throw new Error('A Discord guild member is required for managed role operations.');
  }
}

function resolveRole(member, roleId) {
  assertGuildMember(member);
  const id = normalizeRoleId(roleId);
  const role = member.guild.roles.cache.get(id);
  if (!role) throw new Error(`Discord role ${id} does not exist in ${member.guild.name}.`);
  if (!role.editable) {
    throw new Error(
      `CorpDB cannot manage Discord role ${role.name} (${role.id}); move the bot role above it or adjust permissions.`
    );
  }
  return role;
}

function listNonEveryoneRoleIds(member) {
  assertGuildMember(member);
  const everyoneRoleId = member.guild.id;
  return [...member.roles.cache.keys()].filter((roleId) => roleId !== everyoneRoleId);
}

function listDiscordManageableRoleIds(member) {
  assertGuildMember(member);
  const everyoneRoleId = member.guild.id;
  const roleIds = [];

  for (const role of member.roles.cache.values()) {
    if (role.id === everyoneRoleId) continue;
    if (role.managed) continue;
    if (!role.editable) continue;
    roleIds.push(role.id);
  }

  return roleIds;
}

async function grantManagedRole(member, roleId, options = {}) {
  const role = resolveRole(member, roleId);
  if (member.roles.cache.has(role.id)) {
    return { changed: false, action: 'already-present', roleId: role.id, roleName: role.name };
  }

  await member.roles.add(role.id, options.reason || 'CorpDB managed role grant');
  return { changed: true, action: 'granted', roleId: role.id, roleName: role.name };
}

async function removeManagedRole(member, roleId, options = {}) {
  const role = resolveRole(member, roleId);
  if (!member.roles.cache.has(role.id)) {
    return { changed: false, action: 'already-absent', roleId: role.id, roleName: role.name };
  }

  await member.roles.remove(role.id, options.reason || 'CorpDB managed role removal');
  return { changed: true, action: 'removed', roleId: role.id, roleName: role.name };
}

async function replaceManagedRoles(member, grantRoleIds, removeRoleIds, options = {}) {
  const granted = [];
  const removed = [];

  for (const roleId of [...new Set(grantRoleIds || [])]) {
    granted.push(await grantManagedRole(member, roleId, options));
  }

  const grantSet = new Set((grantRoleIds || []).map(String));
  for (const roleId of [...new Set(removeRoleIds || [])]) {
    if (grantSet.has(String(roleId))) continue;
    removed.push(await removeManagedRole(member, roleId, options));
  }

  return { granted, removed };
}

module.exports = {
  listNonEveryoneRoleIds,
  listDiscordManageableRoleIds,
  grantManagedRole,
  removeManagedRole,
  replaceManagedRoles,
};
