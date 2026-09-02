const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { initializeBaseStorage, initializeCorporationStorage } = require('../src/storage/initializeStorage');
const {
  registerCorporation,
  readRegistry,
  writeRegistry,
} = require('../src/corporations/corporationRegistryRepository');
const { writeCorporationProfile } = require('../src/corporations/corporationProfileRepository');
const {
  readStructureConfig,
  updateStructureConfig,
} = require('../src/structures/structureConfigRepository');
const {
  CRITICAL_THRESHOLD_HOURS,
  METENOX_TYPE_ID,
  getPosFuelRatePerHour,
  getStructureFuelReport,
  stabilizeMetenox,
  processStructureFuelAlerts,
  setStructureFuelAlertChannel,
} = require('../src/structures/structureFuelService');
const {
  readStructureAlertState,
} = require('../src/structures/structureAlertStateRepository');
const {
  listEnabledStructureCorporationIds,
  resolveStructureCorporationIds,
} = require('../src/structures/structureCorporationService');
const { runStructureFuelJob } = require('../src/jobs/structureFuelJob');
const { allCommands } = require('../src/discord/commands');
const { COMMAND_ACCESS_DEFAULTS, ACCESS_LEVELS } = require('../src/access/accessService');

async function withTempStorage(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpdb-structure-fuel-'));
  try {
    await initializeBaseStorage(root);
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function addCorporation(root, corporationId, name = `Corp ${corporationId}`) {
  await registerCorporation(root, corporationId);
  await initializeCorporationStorage(root, corporationId);
  await writeCorporationProfile(root, corporationId, {
    corporationId,
    name,
    ticker: `C${String(corporationId).slice(-2)}`,
    allianceId: '',
    allianceName: '',
    taxRatePercent: 10,
    metadataUpdatedAt: '2026-09-01T00:00:00.000Z',
  });
}

function config(root) {
  return {
    storage: { rootDir: root },
    localization: { defaultLanguage: 'en', enabledLanguages: ['en', 'ru'] },
    jobs: {
      enabled: true,
      structureFuelEnabled: true,
      structureFuelCheckIntervalMinutes: 60,
    },
  };
}

function makeReport(corporationId, checkedAt, item) {
  return {
    checkedAt,
    corporationId,
    corporationName: `Corp ${corporationId}`,
    authorizedCharacterId: '90000001',
    authorizedCharacterName: 'Service Pilot',
    criticalThresholdHours: 72,
    disabledStructureCount: 0,
    totalCount: 1,
    structureCount: item.isPos ? 0 : 1,
    regularUpwellCount: !item.isPos && !item.isMetenox ? 1 : 0,
    metenoxCount: item.isMetenox ? 1 : 0,
    posCount: item.isPos ? 1 : 0,
    noFuelDataCount: item.hoursRemaining === null ? 1 : 0,
    items: [item],
  };
}

function upwellItem(hoursRemaining, overrides = {}) {
  return {
    itemKind: 'structure',
    isPos: false,
    isMetenox: false,
    isMoonDrill: false,
    isAlertTrackable: true,
    structureId: '1001',
    name: 'Astrahus Alpha',
    systemName: 'Jita',
    typeName: 'Astrahus',
    structureStateLabel: 'Shield Vulnerable',
    fuelExpires: '2026-09-03T00:00:00.000Z',
    hoursRemaining,
    timeRemainingLabel: `${hoursRemaining}h`,
    isCritical: hoursRemaining <= 72,
    alertStatusLabel: hoursRemaining <= 72 ? 'CRITICAL' : 'OK',
    activeServices: ['Clone Bay'],
    ...overrides,
  };
}

test('structure fuel defaults preserve 72h threshold and disable Metenox typeID 81826', async () => {
  await withTempStorage(async (root) => {
    await addCorporation(root, '88001');
    const value = await readStructureConfig(root, '88001');
    assert.equal(CRITICAL_THRESHOLD_HOURS, 72);
    assert.deepEqual(value.disabledTypeIds, [METENOX_TYPE_ID]);
  });
});

test('legacy POS fuel rates remain 10/20/40 blocks per hour', () => {
  assert.equal(getPosFuelRatePerHour('Amarr Control Tower Small'), 10);
  assert.equal(getPosFuelRatePerHour('Caldari Control Tower Medium'), 20);
  assert.equal(getPosFuelRatePerHour('Gallente Control Tower Large'), 40);
  assert.equal(getPosFuelRatePerHour('Unknown Tower'), null);
});

test('structure report combines Upwell and POS while excluding disabled Metenox by typeID', async () => {
  await withTempStorage(async (root) => {
    await addCorporation(root, '88001', 'Overheat Unlimited');
    const now = new Date('2026-09-01T00:00:00.000Z');
    const report = await getStructureFuelReport(config(root), root, '88001', {
      now,
      access: {
        characterId: '90000001',
        characterName: 'Service Pilot',
        scopes: [],
      },
      getCorporationStructures: async () => [
        {
          structure_id: 1001,
          system_id: 30000142,
          type_id: 35832,
          name: 'Astrahus Critical',
          state: 'shield_vulnerable',
          fuel_expires: '2026-09-03T00:00:00.000Z',
          services: [{ name: 'Clone Bay', state: 'online' }],
        },
        {
          structure_id: 1002,
          system_id: 30000142,
          type_id: 35833,
          name: 'Fortizar Safe',
          state: 'shield_vulnerable',
          fuel_expires: '2026-09-06T00:00:00.000Z',
          services: [],
        },
        {
          structure_id: 1003,
          system_id: 30000142,
          type_id: Number(METENOX_TYPE_ID),
          name: 'Metenox Disabled',
          state: 'shield_vulnerable',
          services: [],
        },
      ],
      getCorporationAssets: async () => [],
      getCorporationStarbases: async () => [
        {
          starbase_id: 2001,
          system_id: 30000142,
          moon_id: 4001,
          type_id: 12235,
          state: 'online',
        },
      ],
      getCorporationStarbaseDetail: async () => ({
        fuels: [
          { typeId: '4051', quantity: 600 },
          { typeId: '16275', quantity: 10000 },
        ],
      }),
      getUniverseMoonDetailsByIds: async () => new Map([
        ['4001', { moonId: '4001', name: 'Jita IV - Moon 4' }],
      ]),
      resolveUniverseNameMap: async () => new Map([
        ['30000142', 'Jita'],
        ['35832', 'Astrahus'],
        ['35833', 'Fortizar'],
        [METENOX_TYPE_ID, 'Metenox Moon Drill'],
        ['12235', 'Amarr Control Tower Small'],
        ['4051', 'Helium Fuel Block'],
        ['16275', 'Strontium Clathrates'],
      ]),
    });

    assert.equal(report.disabledStructureCount, 1);
    assert.equal(report.totalCount, 3);
    assert.equal(report.regularUpwellCount, 2);
    assert.equal(report.metenoxCount, 0);
    assert.equal(report.posCount, 1);
    assert.equal(report.criticalCount, 2);

    const astrahus = report.items.find((item) => item.structureId === '1001');
    const fortizar = report.items.find((item) => item.structureId === '1002');
    const pos = report.items.find((item) => item.isPos);
    assert.equal(astrahus.hoursRemaining, 48);
    assert.equal(astrahus.isCritical, true);
    assert.equal(fortizar.hoursRemaining, 120);
    assert.equal(fortizar.isCritical, false);
    assert.equal(pos.hoursRemaining, 60);
    assert.equal(pos.isCritical, true);
    assert.equal(pos.posStrontiumHoursRemaining, 100);
  });
});

test('critical alert is sent once and recovery is sent on transition', async () => {
  await withTempStorage(async (root) => {
    await addCorporation(root, '88001');
    await setStructureFuelAlertChannel(root, '88001', '71001');
    const cfg = config(root);
    const sent = [];
    const sender = async (_client, _channelId, items, meta) => {
      sent.push({ mode: meta.mode, names: items.map((item) => item.name) });
      return true;
    };

    let currentReport = makeReport('88001', '2026-09-01T00:00:00.000Z', upwellItem(48));
    const reportImpl = async () => currentReport;

    const first = await processStructureFuelAlerts(cfg, root, '88001', {}, {
      getStructureFuelReport: reportImpl,
      sendAlerts: sender,
    });
    assert.equal(first.newCriticalAlertsCount, 1);
    assert.equal(first.criticalAlertsCount, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].mode, 'critical');

    currentReport = makeReport('88001', '2026-09-01T01:00:00.000Z', upwellItem(47));
    const second = await processStructureFuelAlerts(cfg, root, '88001', {}, {
      getStructureFuelReport: reportImpl,
      sendAlerts: sender,
    });
    assert.equal(second.newCriticalAlertsCount, 0);
    assert.equal(second.criticalAlertsCount, 0);
    assert.equal(sent.length, 1);

    currentReport = makeReport('88001', '2026-09-01T02:00:00.000Z', upwellItem(96, {
      fuelExpires: '2026-09-05T00:00:00.000Z',
      isCritical: false,
      alertStatusLabel: 'OK',
    }));
    const third = await processStructureFuelAlerts(cfg, root, '88001', {}, {
      getStructureFuelReport: reportImpl,
      sendAlerts: sender,
    });
    assert.equal(third.recoveredAlertsCount, 1);
    assert.equal(sent.length, 2);
    assert.equal(sent[1].mode, 'recovered');

    const state = await readStructureAlertState(root, '88001');
    assert.equal(state.structures['1001'].isCritical, false);
    assert.equal(state.structures['1001'].lastResolvedAt, '2026-09-01T02:00:00.000Z');
  });
});

test('manual alert check force-sends an already critical structure without marking it new', async () => {
  await withTempStorage(async (root) => {
    await addCorporation(root, '88001');
    await setStructureFuelAlertChannel(root, '88001', '71001');
    const cfg = config(root);
    let checkedAt = '2026-09-01T00:00:00.000Z';
    const reportImpl = async () => makeReport('88001', checkedAt, upwellItem(48));
    const sent = [];
    const sender = async (_client, _channelId, items, meta) => {
      sent.push({ items, meta });
      return true;
    };

    await processStructureFuelAlerts(cfg, root, '88001', {}, {
      getStructureFuelReport: reportImpl,
      sendAlerts: sender,
    });
    checkedAt = '2026-09-01T01:00:00.000Z';
    const forced = await processStructureFuelAlerts(cfg, root, '88001', {}, {
      getStructureFuelReport: reportImpl,
      sendAlerts: sender,
      forceSendCurrentCritical: true,
    });

    assert.equal(forced.newCriticalAlertsCount, 0);
    assert.equal(forced.criticalAlertsCount, 1);
    assert.equal(sent.length, 2);
    assert.equal(sent[1].meta.forceSendCurrentCritical, true);
  });
});

test('Metenox zero-resource critical state still requires two consecutive confirmations when enabled', () => {
  const item = {
    ...upwellItem(0),
    structureId: '81826001',
    name: 'Metenox Test',
    isMetenox: true,
    metenoxFuelBlockHoursRemaining: 0,
    metenoxFuelBlockQuantity: 0,
    metenoxMagmaticGasHoursRemaining: 0,
    metenoxMagmaticGasQuantity: 0,
    isCritical: true,
  };

  const first = stabilizeMetenox(item, null, '2026-09-01T00:00:00.000Z');
  assert.equal(first.item.isCritical, false);
  assert.equal(first.guard.stableCritical, false);
  assert.equal(first.guard.zeroFuelBlockCriticalCount, 1);
  assert.equal(first.guard.zeroGasCriticalCount, 1);

  const second = stabilizeMetenox(item, first.guard, '2026-09-01T01:00:00.000Z');
  assert.equal(second.item.isCritical, true);
  assert.equal(second.guard.stableCritical, true);
  assert.equal(second.guard.zeroFuelBlockCriticalCount, 2);
  assert.equal(second.guard.zeroGasCriticalCount, 2);
});

test('structure feature is corporation-scoped and background job isolates corporation failures', async () => {
  await withTempStorage(async (root) => {
    await addCorporation(root, '88001');
    await addCorporation(root, '88002');
    const registry = await readRegistry(root);
    registry.corporations.find((entry) => entry.corporationId === '88002').features.structures = false;
    await writeRegistry(root, registry);

    assert.deepEqual(await listEnabledStructureCorporationIds(root), ['88001']);
    assert.deepEqual(await resolveStructureCorporationIds(root, '', { allowAll: true }), ['88001']);

    registry.corporations.find((entry) => entry.corporationId === '88002').features.structures = true;
    await writeRegistry(root, registry);
    const result = await runStructureFuelJob(config(root), {}, {
      silent: true,
      sendAlerts: async () => true,
      processImpl: async (_config, _root, corporationId) => {
        if (corporationId === '88001') throw new Error('simulated failure');
        return {
          totalCount: 1,
          criticalCount: 0,
          criticalUpwellCount: 0,
          criticalMetenoxCount: 0,
          criticalPosCount: 0,
          newCriticalAlertsCount: 0,
          recoveredAlertsCount: 0,
        };
      },
    });
    assert.equal(result.checkedCorporations, 2);
    assert.equal(result.succeeded, 1);
    assert.equal(result.failed, 1);
  });
});

test('structure-fuel exposes class/group/type/structure filters and alert filter controls', () => {
  const command = allCommands.find((entry) => entry.data.name === 'structure-fuel');
  assert.ok(command);
  const json = command.data.toJSON();
  assert.deepEqual(json.options.map((option) => option.name), [
    'show',
    'show-config',
    'alert-disable',
    'alert-enable',
    'alert-filters',
    'set-alert-channel',
    'clear-alert-channel',
    'set-alert-role',
    'clear-alert-role',
    'check-alerts',
  ]);
  assert.equal(COMMAND_ACCESS_DEFAULTS['structure-fuel'], ACCESS_LEVELS.ADMIN);

  const show = json.options.find((option) => option.name === 'show');
  const selectorNames = ['class', 'group', 'type', 'structure'];
  for (const name of selectorNames) {
    const option = show.options.find((entry) => entry.name === name);
    assert.ok(option, `missing ${name}`);
    assert.equal(option.autocomplete, true);
    assert.equal(option.choices, undefined);
  }
});
