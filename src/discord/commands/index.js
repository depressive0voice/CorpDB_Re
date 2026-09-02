const authCommand = require('./authCommand');
const membersCommand = require('./membersCommand');
const rolesCommand = require('./rolesCommand');
const groupsCommand = require('./groupsCommand');
const languageCommand = require('./languageCommand');
const requestMainCommand = require('./requestMainCommand');
const bindingConfigCommand = require('./bindingConfigCommand');
const bindingAdminCommand = require('./bindingAdminCommand');
const accessCommand = require('./accessCommand');
const adminCommand = require('./adminCommand');
const promoteCommand = require('./promoteCommand');
const financeCommand = require('./financeCommand');
const applicationsCommand = require('./applicationsCommand');
const structureFuelCommand = require('./structureFuelCommand');
const trackCommand = require('./trackCommand');
const blacklistCommand = require('./blacklistCommand');
const systemCommand = require('./systemCommand');
const fatRewardsCommand = require('./fatRewardsCommand');

const coreCommands = [
  authCommand,
  membersCommand,
  rolesCommand,
  languageCommand,
  requestMainCommand,
  bindingConfigCommand,
  bindingAdminCommand,
  accessCommand,
  adminCommand,
  promoteCommand,
  applicationsCommand,
  trackCommand,
  systemCommand,
];

const optionalCommands = [
  groupsCommand,
  financeCommand,
  structureFuelCommand,
  blacklistCommand,
  fatRewardsCommand,
];

// Backward-compatible export name used by existing tests and callers.
const commands = coreCommands;
const allCommands = [...coreCommands, ...optionalCommands];
const commandsByName = new Map(coreCommands.map((command) => [command.data.name, command]));
const allCommandsByName = new Map(allCommands.map((command) => [command.data.name, command]));

module.exports = {
  coreCommands,
  commands,
  optionalCommands,
  allCommands,
  commandsByName,
  allCommandsByName,
};
