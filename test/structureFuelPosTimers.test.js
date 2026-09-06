const assert = require('node:assert/strict');
const test = require('node:test');

const { mapStarbaseItem } = require('../src/structures/structureFuelService');

function makePos({ starbaseId, systemId, moonId, typeId, typeName, fuelBlocks, strontium }) {
  const raw = {
    starbase_id: starbaseId,
    system_id: systemId,
    moon_id: moonId,
    type_id: typeId,
    state: 'online',
  };
  const nameMap = new Map([
    [String(systemId), 'Test System'],
    [String(typeId), typeName],
    ['4051', 'Nitrogen Fuel Block'],
    ['16275', 'Strontium Clathrates'],
  ]);
  const detailMap = new Map([[String(starbaseId), {
    fuels: [
      { typeId: '4051', quantity: fuelBlocks },
      { typeId: '16275', quantity: strontium },
    ],
  }]]);
  const moonMap = new Map([[String(moonId), { name: 'Test Moon' }]]);

  return mapStarbaseItem(raw, nameMap, detailMap, new Map(), moonMap);
}

test('POS timers match the in-game Control Tower Manager rates', () => {
  const small = makePos({
    starbaseId: '1001',
    systemId: '300001',
    moonId: '400001',
    typeId: '2001',
    typeName: 'Caldari Control Tower Small',
    fuelBlocks: 3510,
    strontium: 4000,
  });

  assert.equal(small.posFuelRatePerHour, 10);
  assert.equal(small.hoursRemaining, 351);
  assert.equal(small.timeRemainingLabel, '14d 15h');
  assert.equal(small.posStrontiumRatePerHour, undefined);
  assert.equal(small.posStrontiumHoursRemaining, 40);
  assert.equal(small.posStrontiumTimeRemainingLabel, '1d 16h');

  const medium = makePos({
    starbaseId: '1002',
    systemId: '300002',
    moonId: '400002',
    typeId: '2002',
    typeName: 'Caldari Control Tower Medium',
    fuelBlocks: 7980,
    strontium: 7000,
  });

  assert.equal(medium.posFuelRatePerHour, 20);
  assert.equal(medium.hoursRemaining, 399);
  assert.equal(medium.timeRemainingLabel, '16d 15h');
  assert.equal(medium.posStrontiumHoursRemaining, 35);
  assert.equal(medium.posStrontiumTimeRemainingLabel, '1d 11h');
});
