const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { initializeBaseStorage, initializeCorporationStorage } = require('../src/storage/initializeStorage');
const { registerCorporation } = require('../src/corporations/corporationRegistryRepository');
const { writeCorporationProfile } = require('../src/corporations/corporationProfileRepository');
const {
  resolveUniverseTypeTaxonomy,
  canonicalizeSelectorFromCatalog,
  filterCatalogBySelector,
  selectorAutocompleteChoices,
} = require('../src/structures/structureSelectorService');
const {
  readStructureConfig,
} = require('../src/structures/structureConfigRepository');
const {
  addDisabledAlertFilter,
  removeDisabledAlertFilter,
  processStructureFuelAlertsWithFilters,
} = require('../src/structures/structureAlertFilterService');
const { setStructureFuelAlertChannel } = require('../src/structures/structureFuelService');

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-structure-selector-'));
  try {
    await initializeBaseStorage(root);
    await registerCorporation(root, '88001');
    await initializeCorporationStorage(root, '88001');
    await writeCorporationProfile(root, '88001', {
      corporationId: '88001',
      name: 'Overheat Unlimited',
      ticker: 'VERH',
      allianceId: '',
      allianceName: '',
      taxRatePercent: 10,
      metadataUpdatedAt: '2026-09-01T00:00:00.000Z',
    });
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function config(root) {
  return {
    storage: { rootDir: root },
    eve: {
      datasource: 'tranquility',
      compatibilityDate: '2026-08-31',
    },
    localization: { defaultLanguage: 'en', enabledLanguages: ['en', 'ru'] },
  };
}

function taxonomyFetch(url) {
  const pathname = new URL(url).pathname;
  let body = {};
  if (pathname === '/universe/types/35834/') {
    body = { name: 'Fortizar', group_id: 1657 };
  } else if (pathname === '/universe/types/35832/') {
    body = { name: 'Astrahus', group_id: 1657 };
  } else if (pathname === '/universe/groups/1657/') {
    body = { name: 'Citadel', category_id: 65 };
  } else {
    return Promise.resolve({
      ok: false,
      status: 404,
      text: async () => 'not found',
      headers: new Headers(),
    });
  }
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  });
}

const catalog = [
  {
    class: 'upwell',
    groupId: '1657',
    groupName: 'Citadel',
    typeId: '35832',
    typeName: 'Astrahus',
    structureId: '1001',
    structureName: 'Home Astrahus',
    systemId: '30000142',
    systemName: 'Jita',
  },
  {
    class: 'upwell',
    groupId: '1657',
    groupName: 'Citadel',
    typeId: '35834',
    typeName: 'Fortizar',
    structureId: '1002',
    structureName: 'Home Fortizar',
    systemId: '30000142',
    systemName: 'Jita',
  },
  {
    class: 'pos',
    groupId: '365',
    groupName: 'Control Tower',
    typeId: '12235',
    typeName: 'Amarr Control Tower Small',
    structureId: 'pos:2001',
    structureName: 'POS Jita IV - Moon 4',
    systemId: '30000142',
    systemName: 'Jita',
  },
];

test('EVE typeID resolves to EVE group for generated structure selectors', async () => {
  const taxonomy = await resolveUniverseTypeTaxonomy(
    config('/tmp'),
    ['35834'],
    { fetchImpl: taxonomyFetch, noTaxonomyCache: true }
  );
  assert.deepEqual(taxonomy.get('35834'), {
    typeId: '35834',
    typeName: 'Fortizar',
    groupId: '1657',
    groupName: 'Citadel',
    categoryId: '65',
  });
});

test('selector hierarchy is class -> group -> type -> structure and uses class naming', () => {
  const classChoices = selectorAutocompleteChoices(catalog, 'class', {}, '');
  assert.deepEqual(classChoices.map((choice) => choice.value), ['upwell', 'pos']);

  const groupChoices = selectorAutocompleteChoices(catalog, 'group', { class: 'upwell' }, '');
  assert.deepEqual(groupChoices, [{ name: 'Citadel', value: '1657' }]);

  const typeChoices = selectorAutocompleteChoices(
    catalog,
    'type',
    { class: 'upwell', groupId: '1657' },
    ''
  );
  assert.deepEqual(typeChoices.map((choice) => choice.name), ['Astrahus', 'Fortizar']);

  const structureChoices = selectorAutocompleteChoices(
    catalog,
    'structure',
    { class: 'upwell', groupId: '1657', typeId: '35834' },
    ''
  );
  assert.equal(structureChoices.length, 1);
  assert.equal(structureChoices[0].value, '1002');

  const canonical = canonicalizeSelectorFromCatalog(catalog, { structureId: '1002' });
  assert.deepEqual(canonical, {
    class: 'upwell',
    groupId: '1657',
    typeId: '35834',
    structureId: '1002',
  });
  assert.deepEqual(
    filterCatalogBySelector(catalog, { class: 'upwell', groupId: '1657', typeId: '35834' })
      .map((entry) => entry.structureId),
    ['1002']
  );
});

test('alert filters are stored separately from disabled typeIDs and can be removed exactly', async () => {
  await withTempStorage(async (root) => {
    const before = await readStructureConfig(root, '88001');
    assert.deepEqual(before.disabledTypeIds, ['81826']);
    assert.deepEqual(before.disabledAlertFilters, []);

    const added = await addDisabledAlertFilter(root, '88001', {
      class: 'upwell',
      groupId: '1657',
      typeId: '35834',
    });
    assert.equal(added.changed, true);

    const stored = await readStructureConfig(root, '88001');
    assert.deepEqual(stored.disabledTypeIds, ['81826']);
    assert.deepEqual(stored.disabledAlertFilters, [{
      class: 'upwell',
      groupId: '1657',
      typeId: '35834',
      structureId: '',
    }]);

    const removed = await removeDisabledAlertFilter(root, '88001', added.filter);
    assert.equal(removed.changed, true);
    assert.deepEqual((await readStructureConfig(root, '88001')).disabledAlertFilters, []);
  });
});

test('disabled alert filter suppresses a matching critical Fortizar but keeps it in fuel reporting model', async () => {
  await withTempStorage(async (root) => {
    await setStructureFuelAlertChannel(root, '88001', '71001');
    await addDisabledAlertFilter(root, '88001', {
      class: 'upwell',
      groupId: '1657',
      typeId: '35834',
    });

    const item = {
      itemKind: 'structure',
      isPos: false,
      isMetenox: false,
      isMoonDrill: false,
      isAlertTrackable: true,
      structureId: '1002',
      name: 'Home Fortizar',
      systemId: '30000142',
      systemName: 'Jita',
      typeId: '35834',
      typeName: 'Fortizar',
      structureStateLabel: 'Shield Vulnerable',
      fuelExpires: '2026-09-02T00:00:00.000Z',
      hoursRemaining: 24,
      timeRemainingLabel: '1d',
      isCritical: true,
      alertStatusLabel: 'CRITICAL',
      activeServices: [],
    };
    const report = {
      checkedAt: '2026-09-01T00:00:00.000Z',
      corporationId: '88001',
      corporationName: 'Overheat Unlimited',
      authorizedCharacterId: '90000001',
      authorizedCharacterName: 'Service Pilot',
      criticalThresholdHours: 72,
      disabledStructureCount: 0,
      totalCount: 1,
      structureCount: 1,
      regularUpwellCount: 1,
      metenoxCount: 0,
      posCount: 0,
      noFuelDataCount: 0,
      items: [item],
    };
    const sent = [];
    const result = await processStructureFuelAlertsWithFilters(
      config(root),
      root,
      '88001',
      {},
      {
        baseGetStructureFuelReport: async () => report,
        fetchImpl: taxonomyFetch,
        noTaxonomyCache: true,
        sendAlerts: async (_client, _channel, items) => {
          sent.push(...items);
          return true;
        },
      }
    );

    assert.equal(report.items.length, 1);
    assert.equal(result.alertSuppressedCount, 1);
    assert.equal(result.criticalAlertsCount, 0);
    assert.equal(sent.length, 0);

    await removeDisabledAlertFilter(root, '88001', {
      class: 'upwell',
      groupId: '1657',
      typeId: '35834',
    });
    const enabled = await processStructureFuelAlertsWithFilters(
      config(root),
      root,
      '88001',
      {},
      {
        baseGetStructureFuelReport: async () => ({ ...report, checkedAt: '2026-09-01T01:00:00.000Z' }),
        fetchImpl: taxonomyFetch,
        noTaxonomyCache: true,
        sendAlerts: async (_client, _channel, items) => {
          sent.push(...items);
          return true;
        },
      }
    );
    assert.equal(enabled.alertSuppressedCount, 0);
    assert.equal(enabled.newCriticalAlertsCount, 1);
    assert.equal(enabled.criticalAlertsCount, 1);
    assert.equal(sent.length, 1);
  });
});
