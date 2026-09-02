const MODULE_KEYS = Object.freeze({
  ADVANCED_ROLES: 'advanced-roles',
  FINANCE: 'finance',
  STRUCTURE_FUEL: 'structure-fuel',
  BLACKLIST: 'blacklist',
  FAT_REWARDS: 'fat-rewards',
  ROLE_EXPIRY: 'role-expiry',
});

const MODULE_DEFINITIONS = Object.freeze({
  [MODULE_KEYS.ADVANCED_ROLES]: Object.freeze({
    key: MODULE_KEYS.ADVANCED_ROLES,
    label: 'Advanced Roles',
    defaultEnabled: true,
    dependencies: Object.freeze([]),
    commandNames: Object.freeze(['groups']),
    adminGroups: Object.freeze([]),
    systemJobs: Object.freeze([]),
  }),
  [MODULE_KEYS.FINANCE]: Object.freeze({
    key: MODULE_KEYS.FINANCE,
    label: 'Finance',
    defaultEnabled: true,
    dependencies: Object.freeze([]),
    commandNames: Object.freeze(['finance']),
    adminGroups: Object.freeze(['finance']),
    systemJobs: Object.freeze(['finance']),
  }),
  [MODULE_KEYS.STRUCTURE_FUEL]: Object.freeze({
    key: MODULE_KEYS.STRUCTURE_FUEL,
    label: 'Structure Fuel',
    defaultEnabled: true,
    dependencies: Object.freeze([]),
    commandNames: Object.freeze(['structure-fuel']),
    adminGroups: Object.freeze([]),
    systemJobs: Object.freeze(['structure-fuel']),
  }),
  [MODULE_KEYS.BLACKLIST]: Object.freeze({
    key: MODULE_KEYS.BLACKLIST,
    label: 'Blacklist',
    defaultEnabled: true,
    dependencies: Object.freeze([]),
    commandNames: Object.freeze(['blacklist']),
    adminGroups: Object.freeze([]),
    systemJobs: Object.freeze([]),
  }),
  [MODULE_KEYS.FAT_REWARDS]: Object.freeze({
    key: MODULE_KEYS.FAT_REWARDS,
    label: 'FAT Rewards',
    defaultEnabled: true,
    dependencies: Object.freeze([]),
    commandNames: Object.freeze(['fat-rewards']),
    adminGroups: Object.freeze([]),
    systemJobs: Object.freeze(['fat-rewards-reminder']),
  }),
  [MODULE_KEYS.ROLE_EXPIRY]: Object.freeze({
    key: MODULE_KEYS.ROLE_EXPIRY,
    label: 'Role Expiry / Autokick',
    defaultEnabled: true,
    dependencies: Object.freeze([]),
    commandNames: Object.freeze([]),
    adminGroups: Object.freeze([]),
    systemJobs: Object.freeze(['role-expiry']),
  }),
});

const MODULE_ORDER = Object.freeze(Object.keys(MODULE_DEFINITIONS));

function buildReverseIndex(field) {
  const index = {};
  for (const definition of Object.values(MODULE_DEFINITIONS)) {
    for (const value of definition[field]) index[value] = definition.key;
  }
  return Object.freeze(index);
}

const COMMAND_MODULES = buildReverseIndex('commandNames');
const ADMIN_GROUP_MODULES = buildReverseIndex('adminGroups');
const SYSTEM_JOB_MODULES = buildReverseIndex('systemJobs');

function normalizeModuleKey(value) {
  return String(value || '').trim().toLowerCase();
}

function getModuleDefinition(moduleKey) {
  return MODULE_DEFINITIONS[normalizeModuleKey(moduleKey)] || null;
}

function getModuleForCommand(commandName) {
  return COMMAND_MODULES[String(commandName || '').trim().toLowerCase()] || '';
}

function getModuleForAdminGroup(groupName) {
  return ADMIN_GROUP_MODULES[String(groupName || '').trim().toLowerCase()] || '';
}

function getModuleForSystemJob(jobName) {
  return SYSTEM_JOB_MODULES[String(jobName || '').trim().toLowerCase()] || '';
}

module.exports = {
  MODULE_KEYS,
  MODULE_DEFINITIONS,
  MODULE_ORDER,
  COMMAND_MODULES,
  ADMIN_GROUP_MODULES,
  SYSTEM_JOB_MODULES,
  normalizeModuleKey,
  getModuleDefinition,
  getModuleForCommand,
  getModuleForAdminGroup,
  getModuleForSystemJob,
};
