const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { initializeBaseStorage } = require('../src/storage/initializeStorage');
const {
  updateRoleExpiryConfig,
  addQualifyingRole,
  isRoleExpiryConfigured,
} = require('../src/roleExpiry/roleExpiryConfigRepository');
const { readRoleExpiryState } = require('../src/roleExpiry/roleExpiryStateRepository');
const {
  handleRoleExpiryMemberUpdate,
  runRoleExpirySweep,
  buildRoleExpiryPreview,
} = require('../src/roleExpiry/roleExpiryService');
const { MODULE_KEYS, setModuleEnabled } = require('../src/modules/moduleConfigRepository');
const adminCommand = require('../src/discord/commands/adminCommand');

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-role-expiry-'));
  try {
    await initializeBaseStorage(root);
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function role(id, name) {
  return { id: String(id), name: name || `role-${id}` };
}

function member(guild, id, roleIds = [], options = {}) {
  const value = {
    id: String(id),
    guild,
    displayName: options.displayName || `member-${id}`,
    user: { id: String(id), tag: `member-${id}`, username: `member-${id}`, bot: Boolean(options.bot) },
    roles: { cache: new Map(roleIds.map((roleId) => [String(roleId), guild.roles.cache.get(String(roleId))])) },
    kickable: options.kickable !== false,
    kicked: false,
    kickReason: '',
    async kick(reason) {
      this.kicked = true;
      this.kickReason = reason;
      guild.members.map.delete(this.id);
      return this;
    },
  };
  return value;
}

function createGuild(options = {}) {
  const trigger = role('100', 'Guest');
  const safe = role('200', 'Member');
  const logs = [];
  const guild = {
    id: '70001',
    roles: {
      cache: new Map([[trigger.id, trigger], [safe.id, safe]]),
      async fetch(roleId) { return this.cache.get(String(roleId)) || null; },
    },
    members: {
      map: new Map(),
      async fetch(userId) {
        if (userId === undefined) return this.map;
        if (typeof options.fetchMember === 'function') return options.fetchMember(String(userId), this.map);
        return this.map.get(String(userId)) || null;
      },
    },
    channels: {
      async fetch(channelId) {
        if (String(channelId) !== '300') return null;
        return {
          id: '300',
          isTextBased: () => true,
          async send(payload) { logs.push(payload); return { id: `log-${logs.length}` }; },
        };
      },
    },
    async fetchAuditLogs() {
      if (options.auditError) throw options.auditError;
      return { entries: new Map((options.auditEntries || []).map((entry) => [entry.id, entry])) };
    },
  };
  return { guild, trigger, safe, logs };
}

async function configurePolicy(root, patch = {}) {
  let policy = await updateRoleExpiryConfig(root, {
    triggerRoleId: '100',
    timeoutDays: 7,
    checkIntervalMinutes: 60,
    logChannelId: '300',
    ...patch,
  });
  if (!policy.qualifyingRoleIds.includes('200')) policy = await addQualifyingRole(root, '200');
  return policy;
}

test('role expiry requires a trigger and at least one qualifying role before enforcement', async () => {
  await withTempStorage(async (root) => {
    const { guild } = createGuild();
    const config = { storage: { rootDir: root } };
    await updateRoleExpiryConfig(root, { triggerRoleId: '100', timeoutDays: 1 });
    const result = await runRoleExpirySweep(config, null, { guild, now: new Date('2026-09-02T00:00:00.000Z') });
    assert.equal(result.enabled, true);
    assert.equal(result.configured, false);
    assert.equal(result.reason, 'policy-incomplete');
    assert.equal(isRoleExpiryConfigured(await updateRoleExpiryConfig(root, {})), false);
  });
});

test('guildMemberUpdate starts the timer and a qualifying role cancels it immediately', async () => {
  await withTempStorage(async (root) => {
    const { guild } = createGuild();
    await configurePolicy(root);
    const oldMember = member(guild, '500', []);
    const triggerMember = member(guild, '500', ['100']);
    const assignedAt = new Date('2026-09-01T12:00:00.000Z');

    const added = await handleRoleExpiryMemberUpdate(root, oldMember, triggerMember, { now: assignedAt });
    assert.equal(added.action, 'candidate-added');
    assert.equal((await readRoleExpiryState(root)).candidates['500'].assignedAt, assignedAt.toISOString());

    const safeMember = member(guild, '500', ['100', '200']);
    const removed = await handleRoleExpiryMemberUpdate(root, triggerMember, safeMember, {
      now: new Date('2026-09-01T13:00:00.000Z'),
    });
    assert.equal(removed.action, 'candidate-removed');
    assert.equal((await readRoleExpiryState(root)).candidates['500'], undefined);
  });
});

test('changing the trigger role never reuses a timer recorded for the previous trigger', async () => {
  await withTempStorage(async (root) => {
    const { guild } = createGuild();
    guild.roles.cache.set('101', role('101', 'Temporary'));
    await configurePolicy(root);
    const oldMember = member(guild, '500', []);
    const guest = member(guild, '500', ['100']);
    await handleRoleExpiryMemberUpdate(root, oldMember, guest, {
      now: new Date('2026-08-01T00:00:00.000Z'),
    });

    await updateRoleExpiryConfig(root, { triggerRoleId: '101' });
    const temporary = member(guild, '500', ['101']);
    guild.members.map.set('500', temporary);
    const result = await runRoleExpirySweep(
      { storage: { rootDir: root } },
      null,
      { guild, now: new Date('2026-09-02T00:00:00.000Z'), auditBackfill: false }
    );

    assert.equal(result.kickedCount, 0);
    assert.equal(result.initializedCount, 1);
    const candidate = (await readRoleExpiryState(root)).candidates['500'];
    assert.equal(candidate.triggerRoleId, '101');
    assert.equal(candidate.assignedAt, '2026-09-02T00:00:00.000Z');
  });
});

test('audit-log backfill recovers an old trigger assignment and overdue member is kicked with an explicit reason', async () => {
  await withTempStorage(async (root) => {
    const auditAssignedAt = new Date('2026-08-01T00:00:00.000Z');
    const { guild, logs } = createGuild({
      auditEntries: [{
        id: '9001',
        targetId: '500',
        createdAt: auditAssignedAt,
        changes: [{ key: '$add', new: [{ id: '100', name: 'Guest' }] }],
      }],
    });
    await configurePolicy(root);
    const target = member(guild, '500', ['100']);
    guild.members.map.set(target.id, target);

    const result = await runRoleExpirySweep(
      { storage: { rootDir: root } },
      null,
      { guild, now: new Date('2026-09-02T00:00:00.000Z') }
    );

    assert.equal(result.backfilledCount, 1);
    assert.equal(result.kickedCount, 1);
    assert.equal(result.failedCount, 0);
    assert.equal(target.kicked, true);
    assert.match(target.kickReason, /CorpDB role expiry/);
    assert.equal(logs.length, 1);
    assert.equal((await readRoleExpiryState(root)).candidates['500'], undefined);
  });
});

test('final member refetch cancels an overdue kick when a qualifying role appeared after the sweep snapshot', async () => {
  await withTempStorage(async (root) => {
    let safeVersion;
    const { guild } = createGuild({
      auditEntries: [{
        id: '9001',
        targetId: '500',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        changes: [{ key: '$add', new: [{ id: '100' }] }],
      }],
      fetchMember: () => safeVersion,
    });
    await configurePolicy(root);
    const snapshotVersion = member(guild, '500', ['100']);
    safeVersion = member(guild, '500', ['100', '200']);
    guild.members.map.set(snapshotVersion.id, snapshotVersion);

    const result = await runRoleExpirySweep(
      { storage: { rootDir: root } },
      null,
      { guild, now: new Date('2026-09-02T00:00:00.000Z') }
    );

    assert.equal(result.overdueCount, 1);
    assert.equal(result.kickedCount, 0);
    assert.equal(result.cancelledCount, 1);
    assert.equal(safeVersion.kicked, false);
    assert.equal((await readRoleExpiryState(root)).candidates['500'], undefined);
  });
});

test('candidate preview is read-only and the optional module can be disabled independently', async () => {
  await withTempStorage(async (root) => {
    const { guild } = createGuild();
    await configurePolicy(root);
    const target = member(guild, '500', ['100']);
    guild.members.map.set(target.id, target);

    const before = await readRoleExpiryState(root);
    const preview = await buildRoleExpiryPreview(root, guild, { now: new Date('2026-09-02T00:00:00.000Z') });
    const after = await readRoleExpiryState(root);
    assert.equal(preview.candidates.length, 1);
    assert.equal(preview.candidates[0].source, 'untracked');
    assert.deepEqual(after, before);

    const adminJson = adminCommand.data.toJSON();
    const modules = adminJson.options.find((option) => option.name === 'modules');
    assert.ok(modules);
    for (const name of [
      'role-expiry-status',
      'role-expiry-configure',
      'role-expiry-safe-add',
      'role-expiry-safe-remove',
      'role-expiry-candidates',
    ]) {
      assert.equal(modules.options.some((option) => option.name === name), true, `missing ${name}`);
    }

    await setModuleEnabled(root, MODULE_KEYS.ROLE_EXPIRY, false);
    const disabled = await runRoleExpirySweep(
      { storage: { rootDir: root } },
      null,
      { guild, now: new Date('2026-09-02T00:00:00.000Z') }
    );
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.reason, 'module-disabled');
  });
});
