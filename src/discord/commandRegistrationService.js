const { commands, optionalCommands } = require('./commands');
const { getModuleStateMap } = require('../modules/moduleConfigRepository');
const {
  getModuleForCommand,
  getModuleForAdminGroup,
  getModuleForSystemJob,
} = require('../modules/moduleRegistry');

const EXTRA_SYSTEM_JOB_CHOICES = Object.freeze([
  Object.freeze({ name: 'Role expiry check', value: 'role-expiry' }),
]);

function isEnabled(moduleStates, moduleKey) {
  return !moduleKey || moduleStates[moduleKey] !== false;
}

async function listVisibleCommands(storageRoot) {
  const moduleStates = storageRoot ? await getModuleStateMap(storageRoot) : {};
  const visible = [...commands];
  for (const command of optionalCommands) {
    const moduleKey = getModuleForCommand(command.data.name);
    if (isEnabled(moduleStates, moduleKey)) visible.push(command);
  }
  return visible;
}

function filterAdminOptionsForModules(commandJson, moduleStates) {
  if (commandJson.name !== 'admin' || !Array.isArray(commandJson.options)) return commandJson;
  return {
    ...commandJson,
    options: commandJson.options.filter((option) => {
      const moduleKey = getModuleForAdminGroup(option.name);
      return isEnabled(moduleStates, moduleKey);
    }),
  };
}

function filterSystemJobsForModules(commandJson, moduleStates) {
  if (commandJson.name !== 'system' || !Array.isArray(commandJson.options)) return commandJson;
  return {
    ...commandJson,
    options: commandJson.options.map((option) => {
      if (option.name !== 'run-job' || !Array.isArray(option.options)) return option;
      return {
        ...option,
        options: option.options.map((nested) => {
          if (nested.name !== 'job') return nested;
          const choices = [...(nested.choices || []), ...EXTRA_SYSTEM_JOB_CHOICES]
            .filter((choice, index, all) => all.findIndex((candidate) => candidate.value === choice.value) === index)
            .filter((choice) => isEnabled(moduleStates, getModuleForSystemJob(choice.value)));
          return { ...nested, choices };
        }),
      };
    }),
  };
}

function buildRegistrationData(command, moduleStates) {
  const commandJson = command.data.toJSON();
  return filterSystemJobsForModules(
    filterAdminOptionsForModules(commandJson, moduleStates),
    moduleStates
  );
}

async function registerGuildCommands(guild, storageRoot) {
  if (!guild) throw new Error('Cannot register commands without a Discord guild.');
  const moduleStates = storageRoot ? await getModuleStateMap(storageRoot) : {};
  const visibleCommands = await listVisibleCommands(storageRoot);
  const payload = visibleCommands.map((command) => buildRegistrationData(command, moduleStates));
  const registered = await guild.commands.set(payload);
  console.log(`[discord:commands] registered ${registered.size} guild command(s) in ${guild.name} (${guild.id})`);
  return registered;
}

module.exports = {
  EXTRA_SYSTEM_JOB_CHOICES,
  listVisibleCommands,
  filterAdminOptionsForModules,
  filterSystemJobsForModules,
  buildRegistrationData,
  registerGuildCommands,
};
