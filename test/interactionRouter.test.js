const assert = require('node:assert/strict');
const test = require('node:test');

const { shouldAutoDeferInteraction } = require('../src/discord/interactionRouter');

function interaction(commandName, subcommand = '') {
  return {
    commandName,
    options: {
      getSubcommand() {
        return subcommand;
      },
    },
  };
}

test('binding-admin bind-user is auto-deferred to avoid Discord interaction timeout', () => {
  assert.equal(
    shouldAutoDeferInteraction(interaction('binding-admin', 'bind-user')),
    true
  );
});

test('unrelated commands and binding-admin read operations are not auto-deferred', () => {
  assert.equal(shouldAutoDeferInteraction(interaction('binding-admin', 'status')), false);
  assert.equal(shouldAutoDeferInteraction(interaction('members', 'sync')), false);
});
