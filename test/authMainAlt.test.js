const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { initializeBaseStorage, initializeCorporationStorage } = require('../src/storage/initializeStorage');
const { registerCorporation } = require('../src/corporations/corporationRegistryRepository');
const { replaceAllAuthCharacters } = require('../src/auth/authCharacterRepository');
const { importAuthHtmlFromAttachment } = require('../src/auth/authHtmlImportService');
const {
  syncMainAltFromAuth,
  getMainAltRelations,
} = require('../src/auth/authMainAltSyncService');
const { reconcileCorpVsAuth } = require('../src/auth/authReconciliationService');
const { writeMembers } = require('../src/members/memberRepository');
const authCommand = require('../src/discord/commands/authCommand');

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-auth-main-alt-'));
  try {
    await initializeBaseStorage(root);
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

const RECORDS = [
  { main: 'Main One', alt: 'Main One', corp: 'Corp A' },
  { main: 'Main One', alt: 'Alt One', corp: 'Corp A' },
  { main: 'Main One', alt: 'Alt Two', corp: 'Corp B' },
  { main: 'Main Two', alt: 'Main Two', corp: 'Corp A' },
  { main: 'Main Two', alt: 'Alt Three', corp: 'Corp A' },
];

test('auth HTML import automatically rebuilds derived Main-Alt relations', async () => {
  await withTempStorage(async (root) => {
    const html = `
      <div class="caption text-center">Main One<br>Account</div>
      <table class="table table-hover">
        <tr><td>x</td><td>Main One</td><td>Corp A</td><td>ok</td><td>x</td></tr>
        <tr><td>x</td><td>Alt One</td><td>Corp A</td><td>ok</td><td>x</td></tr>
        <tr><td>x</td><td>Alt Two</td><td>Corp B</td><td>ok</td><td>x</td></tr>
      </table>
      <div class="caption text-center">Main Two<br>Account</div>
      <table class="table table-hover">
        <tr><td>x</td><td>Main Two</td><td>Corp A</td><td>ok</td><td>x</td></tr>
        <tr><td>x</td><td>Alt Three</td><td>Corp A</td><td>ok</td><td>x</td></tr>
      </table>`;

    const result = await importAuthHtmlFromAttachment(root, 'https://example.test/auth.html', {
      fetchImpl: async () => ({ ok: true, text: async () => html }),
      now: new Date('2026-09-01T00:00:00Z'),
    });

    assert.equal(result.mainAltSync.familiesCount, 2);
    assert.equal(result.mainAltSync.relationsCount, 3);
    const state = await getMainAltRelations(root);
    assert.deepEqual(
      state.relations.map((relation) => `${relation.alt} -> ${relation.main}`),
      ['Alt One -> Main One', 'Alt Two -> Main One', 'Alt Three -> Main Two']
    );
  });
});

test('sync-main-alt keeps the existing-link list out of operation data while show state keeps all relations', async () => {
  await withTempStorage(async (root) => {
    await replaceAllAuthCharacters(root, RECORDS);

    const first = await syncMainAltFromAuth(root, 'apply', {
      now: new Date('2026-09-01T00:00:00Z'),
    });
    assert.equal(first.linkedAltCount, 3);
    assert.equal(first.alreadyLinkedCount, 0);

    const preview = await syncMainAltFromAuth(root, 'preview');
    assert.equal(preview.linkedAltCount, 0);
    assert.equal(preview.alreadyLinkedCount, 3);
    assert.deepEqual(preview.linkedAlts, []);

    const state = await getMainAltRelations(root);
    assert.equal(state.relations.length, 3);
    assert.deepEqual(
      state.relations.map((relation) => `${relation.alt} → ${relation.main}`),
      ['Alt One → Main One', 'Alt Two → Main One', 'Alt Three → Main Two']
    );
  });
});

test('conflicting auth ownership is reported and not stored as a Main-Alt relation', async () => {
  await withTempStorage(async (root) => {
    await replaceAllAuthCharacters(root, [
      { main: 'Main A', alt: 'Main A', corp: 'Corp A' },
      { main: 'Main A', alt: 'Shared Alt', corp: 'Corp A' },
      { main: 'Main B', alt: 'Main B', corp: 'Corp B' },
      { main: 'Main B', alt: 'Shared Alt', corp: 'Corp B' },
    ]);

    const result = await syncMainAltFromAuth(root, 'apply');
    assert.equal(result.conflictsCount, 1);
    assert.equal(result.relationsCount, 0);
    assert.match(result.conflicts[0], /Shared Alt/);
  });
});

test('reconcile compares all enabled managed corporations and returns discrepancy lists only', async () => {
  await withTempStorage(async (root) => {
    await registerCorporation(root, '91001');
    await registerCorporation(root, '91002');
    await initializeCorporationStorage(root, '91001');
    await initializeCorporationStorage(root, '91002');
    await writeMembers(root, '91001', [
      {
        characterId: '1001',
        name: 'Main One',
        corporationName: 'Corp A',
        isCorporationMember: true,
        status: 'active',
      },
    ]);
    await writeMembers(root, '91002', [
      {
        characterId: '1002',
        name: 'No Auth Pilot',
        corporationName: 'Corp B',
        isCorporationMember: true,
        status: 'active',
      },
    ]);
    await replaceAllAuthCharacters(root, [
      { main: 'Main One', alt: 'Main One', corp: 'Corp A' },
      { main: 'Main One', alt: 'External Alt', corp: 'Other Corp' },
    ]);

    const result = await reconcileCorpVsAuth(root);
    assert.equal(result.currentCorpCount, 2);
    assert.equal(result.inCorpAndInAuthCount, 1);
    assert.deepEqual(result.inCorpNotInAuth.map((item) => item.name), ['No Auth Pilot']);
    assert.deepEqual(result.inAuthNotInCorp.map((item) => item.alt), ['External Alt']);
    assert.equal(result.corpMismatchCount, 0);
  });
});

test('/auth exposes sync-main-alt, reconcile, and show main-alt without a per-main show filter', () => {
  const json = authCommand.data.toJSON();
  const sync = json.options.find((option) => option.name === 'sync-main-alt');
  const reconcile = json.options.find((option) => option.name === 'reconcile');
  const show = json.options.find((option) => option.name === 'show');

  assert.ok(sync);
  assert.ok(reconcile);
  assert.ok(show);
  assert.deepEqual(show.options.map((option) => option.name), ['main-alt']);
  assert.equal(show.options[0].options?.length || 0, 0);
});
