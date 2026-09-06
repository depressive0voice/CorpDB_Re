const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveUniverseNameMap } = require('../src/structures/structureEsiService');

function makeResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get() {
        return null;
      },
    },
    async json() {
      return payload;
    },
    async text() {
      return typeof payload === 'string' ? payload : JSON.stringify(payload);
    },
  };
}

test('structure universe-name resolution skips IDs rejected by ESI without failing the report', async () => {
  const requests = [];
  const invalidMoonId = 40000001;
  const config = {
    eve: {
      datasource: 'tranquility',
      compatibilityDate: '2026-08-31',
    },
  };

  const fetchImpl = async (_url, request) => {
    const ids = JSON.parse(request.body);
    requests.push(ids);

    if (ids.includes(invalidMoonId)) {
      return makeResponse(404, {
        error: 'Ensure all IDs are valid before resolving.',
      });
    }

    return makeResponse(200, ids.map((id) => ({
      id,
      name: id === 30000142 ? 'Jita' : 'Astrahus',
      category: id === 30000142 ? 'solar_system' : 'inventory_type',
    })));
  };

  const names = await resolveUniverseNameMap(
    config,
    [30000142, invalidMoonId, 35832],
    { fetchImpl, maxAttempts: 1 }
  );

  assert.equal(names.get('30000142'), 'Jita');
  assert.equal(names.get('35832'), 'Astrahus');
  assert.equal(names.has(String(invalidMoonId)), false);
  assert.ok(requests.length > 1);
});
