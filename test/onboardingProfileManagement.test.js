const assert = require('node:assert/strict');
const test = require('node:test');

const adminCommand = require('../src/discord/commands/adminCommand');

test('onboarding profile management supports create/delete without exceeding Discord option limits', () => {
  const json = adminCommand.data.toJSON();
  const onboarding = json.options.find((option) => option.name === 'onboarding');
  assert.ok(onboarding);
  assert.ok(onboarding.options.length <= 25);

  const profile = onboarding.options.find((option) => option.name === 'profile');
  assert.ok(profile);
  assert.equal(onboarding.options.some((option) => option.name === 'profile-create'), false);

  const action = profile.options.find((option) => option.name === 'action');
  assert.ok(action);
  assert.deepEqual(action.choices.map((choice) => choice.value), ['create', 'delete']);

  const profileId = profile.options.find((option) => option.name === 'profile');
  assert.ok(profileId);
  assert.equal(profileId.autocomplete, true);
});
