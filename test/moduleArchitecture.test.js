const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { initializeBaseStorage } = require('../src/storage/initializeStorage');
const {
  MODULE_KEYS,
  listModuleStates,
  setModuleEnabled,
} = require('../src/modules/moduleConfigRepository');
const {
  listVisibleCommands,
  buildRegistrationData,
} = require('../src/discord/commandRegistrationService');
const { allCommands } = require('../src/discord/commands');
const { runSystemJob } = require('../src/system/systemJobService');

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-modules-'));
  try {
    await initializeBaseStorage(root);
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function commandNames(commands) {
  return commands.map((command) => command.data.name);
}

function systemJobChoices(moduleStates) {
  const system = allCommands.find((command) => command.data.name === 'system');
  const json = buildRegistrationData(system, moduleStates);
  const runJob = json.options.find((option) => option.name === 'run-job');
  const job = runJob.options.find((option) => option.name === 'job');
  return job.choices.map((choice) => choice.value);
}

test('confirmed optional modules default on while agreed core commands are never module-gated', async () => {
  await withTempStorage(async (root) => {
    const states = await listModuleStates(root);
    assert.deepEqual(states.map((state) => state.key), [
      MODULE_KEYS.ADVANCED_ROLES,
      MODULE_KEYS.FINANCE,
      MODULE_KEYS.STRUCTURE_FUEL,
      MODULE_KEYS.BLACKLIST,
      MODULE_KEYS.FAT_REWARDS,
      MODULE_KEYS.ROLE_EXPIRY,
    ]);
    assert.equal(states.every((state) => state.enabled), true);

    const visible = commandNames(await listVisibleCommands(root));
    for (const core of ['applications', 'track', 'request-main', 'binding-admin', 'promote', 'roles', 'system']) {
      assert.equal(visible.includes(core), true, `${core} must remain core`);
    }

    const stateMap = Object.fromEntries(states.map((state) => [state.key, state.enabled]));
    assert.equal(systemJobChoices(stateMap).includes('role-expiry'), true);
  });
});

test('disabling optional modules removes their command/admin surfaces and system job choices', async () => {
  await withTempStorage(async (root) => {
    await setModuleEnabled(root, MODULE_KEYS.ADVANCED_ROLES, false);
    await setModuleEnabled(root, MODULE_KEYS.FINANCE, false);
    await setModuleEnabled(root, MODULE_KEYS.STRUCTURE_FUEL, false);
    await setModuleEnabled(root, MODULE_KEYS.BLACKLIST, false);
    await setModuleEnabled(root, MODULE_KEYS.FAT_REWARDS, false);
    await setModuleEnabled(root, MODULE_KEYS.ROLE_EXPIRY, false);

    const visible = commandNames(await listVisibleCommands(root));
    for (const optional of ['groups', 'finance', 'structure-fuel', 'blacklist', 'fat-rewards']) {
      assert.equal(visible.includes(optional), false, `${optional} should be hidden`);
    }
    for (const core of ['applications', 'track', 'promote', 'roles', 'system']) {
      assert.equal(visible.includes(core), true, `${core} must stay visible`);
    }

    const states = Object.fromEntries((await listModuleStates(root)).map((state) => [state.key, state.enabled]));
    const admin = allCommands.find((command) => command.data.name === 'admin');
    const adminJson = buildRegistrationData(admin, states);
    assert.equal(adminJson.options.some((option) => option.name === 'finance'), false);
    assert.equal(adminJson.options.some((option) => option.name === 'onboarding'), true);
    assert.equal(adminJson.options.some((option) => option.name === 'modules'), true);

    const jobs = systemJobChoices(states);
    for (const optionalJob of ['finance', 'structure-fuel', 'fat-rewards-reminder', 'role-expiry']) {
      assert.equal(jobs.includes(optionalJob), false, `${optionalJob} should be hidden from /system run-job`);
    }
    for (const coreJob of ['members', 'applications', 'promotion']) {
      assert.equal(jobs.includes(coreJob), true, `${coreJob} must stay in /system run-job`);
    }
  });
});

test('/system refuses manual jobs that belong to disabled optional modules', async () => {
  await withTempStorage(async (root) => {
    const config = { storage: { rootDir: root } };

    await setModuleEnabled(root, MODULE_KEYS.FINANCE, false);
    await assert.rejects(
      runSystemJob(config, null, 'finance'),
      (error) => error.code === 'system_job_module_disabled' && error.moduleKey === MODULE_KEYS.FINANCE
    );

    await setModuleEnabled(root, MODULE_KEYS.ROLE_EXPIRY, false);
    await assert.rejects(
      runSystemJob(config, null, 'role-expiry'),
      (error) => error.code === 'system_job_module_disabled' && error.moduleKey === MODULE_KEYS.ROLE_EXPIRY
    );
  });
});
