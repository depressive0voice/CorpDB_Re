const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { initializeBaseStorage } = require('../src/storage/initializeStorage');
const {
  ACCESS_LEVELS,
  COMMAND_ACCESS_DEFAULTS,
  getBaseAccessLevel,
  checkCommandAccess,
  addAdminRole,
  setUserCommandOverride,
  setAccessLevelForCommand,
  resetAccessLevelForCommand,
  getAccessList,
  resetAllAccessSettings,
} = require('../src/access/accessService');

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-access-'));
  try {
    await initializeBaseStorage(root);
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function config(root, ownerIds = ['90001']) {
  return {
    storage: { rootDir: root },
    discord: { ownerIds },
  };
}

function member(id, roleIds = []) {
  return {
    id: String(id),
    user: { id: String(id) },
    roles: { cache: new Map(roleIds.map((roleId) => [String(roleId), { id: String(roleId) }])) },
  };
}

function interaction(value) {
  return { user: value.user, member: value };
}

test('command access defaults match the current CorpDB command policy', async () => {
  await withTempStorage(async (root) => {
    const current = await getAccessList(root);
    assert.deepEqual(current.commandLevels, COMMAND_ACCESS_DEFAULTS);
    assert.equal(current.defaultCommandLevel, ACCESS_LEVELS.USER);
    assert.equal(current.commandLevels['request-main'], ACCESS_LEVELS.USER);
    assert.equal(current.commandLevels.auth, ACCESS_LEVELS.ADMIN);
    assert.equal(current.commandLevels.track, ACCESS_LEVELS.ADMIN);
    assert.equal(current.commandLevels['fat-rewards'], ACCESS_LEVELS.ADMIN);
    assert.equal(current.commandLevels.admin, ACCESS_LEVELS.ADMIN);
    assert.equal(current.commandLevels.system, ACCESS_LEVELS.MAIN_ADMIN);
    assert.equal(Object.hasOwn(current.commandLevels, 'help'), false);
    assert.equal(Object.hasOwn(current.commandLevels, 'activity'), false);
  });
});

test('owners are main-admin and configured Discord admin roles grant admin', async () => {
  await withTempStorage(async (root) => {
    const cfg = config(root);
    await addAdminRole(root, '73003');

    assert.equal((await getBaseAccessLevel(cfg, root, member('90001'))).level, ACCESS_LEVELS.MAIN_ADMIN);
    assert.equal((await getBaseAccessLevel(cfg, root, member('72001', ['73003']))).level, ACCESS_LEVELS.ADMIN);
    assert.equal((await getBaseAccessLevel(cfg, root, member('72002'))).level, ACCESS_LEVELS.USER);
  });
});

test('command access honors role levels plus per-user allow and deny overrides', async () => {
  await withTempStorage(async (root) => {
    const cfg = config(root, []);
    const user = member('72001');
    const admin = member('72002', ['73003']);
    await addAdminRole(root, '73003');

    assert.equal((await checkCommandAccess(cfg, root, interaction(user), 'auth')).allowed, false);
    assert.equal((await checkCommandAccess(cfg, root, interaction(admin), 'auth')).allowed, true);

    await setUserCommandOverride(root, user.id, 'auth', 'allow');
    assert.equal((await checkCommandAccess(cfg, root, interaction(user), 'auth')).allowed, true);

    await setUserCommandOverride(root, admin.id, 'auth', 'deny');
    assert.equal((await checkCommandAccess(cfg, root, interaction(admin), 'auth')).allowed, false);
  });
});

test('command levels can be changed and reset only for current settable commands', async () => {
  await withTempStorage(async (root) => {
    const changed = await setAccessLevelForCommand(root, 'track', ACCESS_LEVELS.USER);
    assert.deepEqual(changed, { ok: true, commandName: 'track', level: ACCESS_LEVELS.USER });
    assert.equal((await getAccessList(root)).commandLevels.track, ACCESS_LEVELS.USER);

    const legacyTopLevel = await setAccessLevelForCommand(root, 'track', 'master-admin');
    assert.deepEqual(legacyTopLevel, {
      ok: true,
      commandName: 'track',
      level: ACCESS_LEVELS.MAIN_ADMIN,
    });
    assert.equal((await getAccessList(root)).commandLevels.track, ACCESS_LEVELS.MAIN_ADMIN);

    const reset = await resetAccessLevelForCommand(root, 'track');
    assert.equal(reset.level, COMMAND_ACCESS_DEFAULTS.track);
    assert.equal((await getAccessList(root)).commandLevels.track, COMMAND_ACCESS_DEFAULTS.track);

    const removedActivityMutation = await setAccessLevelForCommand(root, 'activity', ACCESS_LEVELS.ADMIN);
    assert.equal(removedActivityMutation.ok, false);
    assert.equal(removedActivityMutation.code, 'command_not_settable');

    const helpMutation = await setAccessLevelForCommand(root, 'help', ACCESS_LEVELS.ADMIN);
    assert.equal(helpMutation.ok, false);
    assert.equal(helpMutation.code, 'command_not_settable');

    const accessMutation = await setAccessLevelForCommand(root, 'access', ACCESS_LEVELS.MAIN_ADMIN);
    assert.equal(accessMutation.ok, false);
    assert.equal(accessMutation.code, 'command_not_settable');
  });
});

test('reset-all removes admin roles and overrides and restores command defaults', async () => {
  await withTempStorage(async (root) => {
    await addAdminRole(root, '73003');
    await setUserCommandOverride(root, '72001', 'auth', 'allow');
    await setAccessLevelForCommand(root, 'track', ACCESS_LEVELS.USER);

    const reset = await resetAllAccessSettings(root);
    assert.deepEqual(reset.adminRoleIds, []);
    assert.deepEqual(reset.userCommandAllow, {});
    assert.deepEqual(reset.commandLevels, COMMAND_ACCESS_DEFAULTS);
  });
});
