const {
  ACCESS_LEVELS,
  COMMAND_ACCESS_DEFAULTS,
  SETTABLE_COMMAND_NAMES,
  createDefaultAccessConfig,
  normalizeCommandName,
  normalizeAccessLevel,
  readAccessConfig,
  writeAccessConfig,
  resetAccessConfig,
} = require('./accessConfigRepository');

const ACCESS_RANK = Object.freeze({
  [ACCESS_LEVELS.USER]: 1,
  [ACCESS_LEVELS.ADMIN]: 2,
  [ACCESS_LEVELS.MASTER_ADMIN]: 3,
});

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function levelToRank(level) {
  return ACCESS_RANK[normalizeAccessLevel(level)] || 0;
}

function getMemberRoleIds(member) {
  if (!member?.roles?.cache) return [];
  if (typeof member.roles.cache.keys === 'function') return [...member.roles.cache.keys()];
  return [];
}

async function getRequiredCommandLevel(storageRoot, commandName) {
  const config = await readAccessConfig(storageRoot);
  const normalizedCommand = normalizeCommandName(commandName);
  return config.commandLevels[normalizedCommand]
    || COMMAND_ACCESS_DEFAULTS[normalizedCommand]
    || config.defaultCommandLevel
    || ACCESS_LEVELS.USER;
}

async function getBaseAccessLevel(config, storageRoot, member) {
  const userId = String(member?.id || member?.user?.id || '').trim();
  if (config.discord.ownerIds.includes(userId)) {
    return { level: ACCESS_LEVELS.MASTER_ADMIN, reason: 'owner-id', matchedRoleIds: [] };
  }

  const accessConfig = await readAccessConfig(storageRoot);
  if (accessConfig.adminUserIds.includes(userId)) {
    return { level: ACCESS_LEVELS.ADMIN, reason: 'admin-user', matchedRoleIds: [] };
  }

  const memberRoleIds = getMemberRoleIds(member);
  const matchedRoleIds = memberRoleIds.filter((roleId) => accessConfig.adminRoleIds.includes(roleId));
  if (matchedRoleIds.length > 0) {
    return { level: ACCESS_LEVELS.ADMIN, reason: 'admin-role', matchedRoleIds };
  }

  return { level: ACCESS_LEVELS.USER, reason: 'default', matchedRoleIds: [] };
}

async function checkCommandAccess(config, storageRoot, interaction, commandName) {
  const accessConfig = await readAccessConfig(storageRoot);
  const normalizedCommand = normalizeCommandName(commandName);
  const userId = String(interaction?.user?.id || interaction?.member?.id || '').trim();
  const base = await getBaseAccessLevel(config, storageRoot, interaction?.member);
  const requiredLevel = accessConfig.commandLevels[normalizedCommand]
    || COMMAND_ACCESS_DEFAULTS[normalizedCommand]
    || accessConfig.defaultCommandLevel
    || ACCESS_LEVELS.USER;

  if (base.level === ACCESS_LEVELS.MASTER_ADMIN) {
    return {
      allowed: true,
      commandName: normalizedCommand,
      finalLevel: base.level,
      requiredLevel,
      source: 'owner-id',
      reason: 'Bot owner has full access',
    };
  }

  const deny = accessConfig.userCommandDeny[userId] || [];
  if (deny.includes(normalizedCommand)) {
    return {
      allowed: false,
      commandName: normalizedCommand,
      finalLevel: base.level,
      requiredLevel,
      source: 'user-command-deny',
      reason: `User explicitly denied for command ${normalizedCommand}`,
    };
  }

  const allow = accessConfig.userCommandAllow[userId] || [];
  if (allow.includes(normalizedCommand)) {
    return {
      allowed: true,
      commandName: normalizedCommand,
      finalLevel: base.level,
      requiredLevel,
      source: 'user-command-allow',
      reason: `User explicitly allowed for command ${normalizedCommand}`,
    };
  }

  return {
    allowed: levelToRank(base.level) >= levelToRank(requiredLevel),
    commandName: normalizedCommand,
    finalLevel: base.level,
    requiredLevel,
    source: base.reason,
    reason: `Base level ${base.level}, required ${requiredLevel}`,
  };
}

async function getAccessList(storageRoot) {
  const config = await readAccessConfig(storageRoot);
  return {
    adminRoleIds: [...config.adminRoleIds],
    adminUserIds: [...config.adminUserIds],
    commandLevels: { ...config.commandLevels },
    userCommandAllow: { ...config.userCommandAllow },
    userCommandDeny: { ...config.userCommandDeny },
    defaultCommandLevel: config.defaultCommandLevel,
  };
}

async function addAdminRole(storageRoot, roleOrRoleId) {
  const roleId = String(roleOrRoleId?.id || roleOrRoleId || '').trim();
  const config = await readAccessConfig(storageRoot);
  if (!roleId) return { ok: false, code: 'invalid_role_id' };
  if (config.adminRoleIds.includes(roleId)) return { ok: false, code: 'role_already_added', roleId };
  config.adminRoleIds = uniqueStrings([...config.adminRoleIds, roleId]);
  await writeAccessConfig(storageRoot, config);
  return { ok: true, roleId };
}

async function removeAdminRole(storageRoot, roleOrRoleId) {
  const roleId = String(roleOrRoleId?.id || roleOrRoleId || '').trim();
  const config = await readAccessConfig(storageRoot);
  if (!config.adminRoleIds.includes(roleId)) return { ok: false, code: 'role_not_found', roleId };
  config.adminRoleIds = config.adminRoleIds.filter((id) => id !== roleId);
  await writeAccessConfig(storageRoot, config);
  return { ok: true, roleId };
}

async function addAdminUser(storageRoot, userOrUserId) {
  const userId = String(userOrUserId?.id || userOrUserId || '').trim();
  const config = await readAccessConfig(storageRoot);
  if (!userId) return { ok: false, code: 'invalid_user_id' };
  if (config.adminUserIds.includes(userId)) return { ok: false, code: 'user_already_added', userId };
  config.adminUserIds = uniqueStrings([...config.adminUserIds, userId]);
  await writeAccessConfig(storageRoot, config);
  return { ok: true, userId };
}

async function removeAdminUser(storageRoot, userOrUserId) {
  const userId = String(userOrUserId?.id || userOrUserId || '').trim();
  const config = await readAccessConfig(storageRoot);
  if (!config.adminUserIds.includes(userId)) return { ok: false, code: 'user_not_found', userId };
  config.adminUserIds = config.adminUserIds.filter((id) => id !== userId);
  await writeAccessConfig(storageRoot, config);
  return { ok: true, userId };
}

async function setUserCommandOverride(storageRoot, userOrUserId, commandName, mode) {
  const userId = String(userOrUserId?.id || userOrUserId || '').trim();
  const normalizedCommand = normalizeCommandName(commandName);
  const config = await readAccessConfig(storageRoot);
  if (!userId) return { ok: false, code: 'invalid_user_id' };
  if (!Object.prototype.hasOwnProperty.call(COMMAND_ACCESS_DEFAULTS, normalizedCommand)) {
    return { ok: false, code: 'invalid_command_name', commandName: normalizedCommand };
  }

  const allow = new Set(config.userCommandAllow[userId] || []);
  const deny = new Set(config.userCommandDeny[userId] || []);
  if (mode === 'allow') {
    allow.add(normalizedCommand);
    deny.delete(normalizedCommand);
  } else if (mode === 'deny') {
    deny.add(normalizedCommand);
    allow.delete(normalizedCommand);
  } else {
    allow.delete(normalizedCommand);
    deny.delete(normalizedCommand);
  }

  if (allow.size > 0) config.userCommandAllow[userId] = [...allow];
  else delete config.userCommandAllow[userId];
  if (deny.size > 0) config.userCommandDeny[userId] = [...deny];
  else delete config.userCommandDeny[userId];
  await writeAccessConfig(storageRoot, config);
  return { ok: true, userId, commandName: normalizedCommand, mode };
}

async function setAccessLevelForCommand(storageRoot, commandName, level) {
  const normalizedCommand = normalizeCommandName(commandName);
  const normalizedLevel = normalizeAccessLevel(level);
  if (!SETTABLE_COMMAND_NAMES.includes(normalizedCommand)) {
    return { ok: false, code: 'command_not_settable', commandName: normalizedCommand };
  }
  if (!normalizedLevel) return { ok: false, code: 'invalid_access_level', level };
  const config = await readAccessConfig(storageRoot);
  config.commandLevels[normalizedCommand] = normalizedLevel;
  await writeAccessConfig(storageRoot, config);
  return { ok: true, commandName: normalizedCommand, level: normalizedLevel };
}

async function resetAccessLevelForCommand(storageRoot, commandName) {
  const normalizedCommand = normalizeCommandName(commandName);
  if (!SETTABLE_COMMAND_NAMES.includes(normalizedCommand)) {
    return { ok: false, code: 'command_not_settable', commandName: normalizedCommand };
  }
  const defaultLevel = COMMAND_ACCESS_DEFAULTS[normalizedCommand];
  const config = await readAccessConfig(storageRoot);
  config.commandLevels[normalizedCommand] = defaultLevel;
  await writeAccessConfig(storageRoot, config);
  return { ok: true, commandName: normalizedCommand, level: defaultLevel };
}

async function resetAllAccessSettings(storageRoot) {
  const config = await resetAccessConfig(storageRoot);
  return {
    ok: true,
    adminRoleIds: [...config.adminRoleIds],
    adminUserIds: [...config.adminUserIds],
    commandLevels: { ...config.commandLevels },
    userCommandAllow: { ...config.userCommandAllow },
    userCommandDeny: { ...config.userCommandDeny },
    defaultCommandLevel: config.defaultCommandLevel,
  };
}

module.exports = {
  ACCESS_LEVELS,
  ACCESS_RANK,
  COMMAND_ACCESS_DEFAULTS,
  SETTABLE_COMMAND_NAMES,
  createDefaultAccessConfig,
  levelToRank,
  getRequiredCommandLevel,
  getBaseAccessLevel,
  checkCommandAccess,
  getAccessList,
  addAdminRole,
  removeAdminRole,
  addAdminUser,
  removeAdminUser,
  setUserCommandOverride,
  setAccessLevelForCommand,
  resetAccessLevelForCommand,
  resetAllAccessSettings,
};