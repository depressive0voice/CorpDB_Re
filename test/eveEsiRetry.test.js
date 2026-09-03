const assert = require('node:assert/strict');
const test = require('node:test');

const {
  requestEsi,
  requestEsiJson,
  isRetryableEsiStatus,
} = require('../src/eve/eveEsiClient');

function config() {
  return {
    eve: {
      datasource: 'tranquility',
      compatibilityDate: '2025-05-13',
    },
  };
}

test('ESI retries transient 502/503/504 responses and returns the later success', async () => {
  const statuses = [502, 503, 200];
  const delays = [];
  let calls = 0;

  const result = await requestEsiJson(config(), '/corporations/98842752/', {
    fetchImpl: async () => {
      const status = statuses[calls];
      calls += 1;
      if (status === 200) {
        return new Response(JSON.stringify({ corporation_id: 98842752 }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Bad Gateway', { status });
    },
    sleepImpl: async (ms) => delays.push(ms),
    retryBaseDelayMs: 10,
  });

  assert.equal(calls, 3);
  assert.deepEqual(delays, [10, 20]);
  assert.equal(result.corporation_id, 98842752);
});

test('ESI 429 retry honors Retry-After', async () => {
  const delays = [];
  let calls = 0;

  const response = await requestEsi(config(), '/characters/1/', {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('rate limited', {
          status: 429,
          headers: { 'Retry-After': '2' },
        });
      }
      return new Response('{}', { status: 200 });
    },
    sleepImpl: async (ms) => delays.push(ms),
    maxAttempts: 2,
    retryBaseDelayMs: 10,
  });

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [2000]);
});

test('ESI does not retry non-transient HTTP errors', async () => {
  let calls = 0;
  const delays = [];

  await assert.rejects(
    requestEsi(config(), '/corporations/404/', {
      fetchImpl: async () => {
        calls += 1;
        return new Response('not found', { status: 404 });
      },
      sleepImpl: async (ms) => delays.push(ms),
    }),
    (error) => error.status === 404 && error.attempts === 1
  );

  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
  assert.equal(isRetryableEsiStatus(404), false);
  assert.equal(isRetryableEsiStatus(502), true);
});

test('ESI retries transient fetch failures', async () => {
  let calls = 0;
  const delays = [];

  const response = await requestEsi(config(), '/status/', {
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) throw new TypeError('fetch failed');
      return new Response('{}', { status: 200 });
    },
    sleepImpl: async (ms) => delays.push(ms),
    retryBaseDelayMs: 5,
  });

  assert.equal(response.status, 200);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [5, 10]);
});
