import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFlag, readFlag } from './flags.ts';

const FUND = '00000000-0000-4000-8000-000000000001';
const cfg = (f: typeof fetch) => ({
  host: 'https://flags.example.test',
  projectKey: 'phc_test',
  fetch: f,
  timeoutMs: 50,
});
const json = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

test('explicit true is on', async () => {
  const r = await evaluateFlag('app-shell', FUND, cfg(json({ flags: { 'app-shell': { enabled: true } } })));
  assert.deepEqual(r, { on: true, reason: 'on' });
});

test('sends only the fund id as distinct_id', async () => {
  let sent: unknown;
  const f = (async (_u: unknown, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ flags: {} }));
  }) as typeof fetch;
  await evaluateFlag('app-shell', FUND, cfg(f));
  assert.deepEqual(Object.keys(sent as object).sort(), ['api_key', 'distinct_id', 'flag_keys_to_evaluate']);
  assert.equal((sent as { distinct_id: string }).distinct_id, FUND);
});

test('anything but explicit true is off', async () => {
  for (const v of [false, 'true', 1, null, undefined, { enabled: 'true' }]) {
    assert.equal(
      readFlag({ flags: { 'app-shell': typeof v === 'object' && v ? v : { enabled: v } } }, 'app-shell').on,
      false,
      String(v),
    );
  }
  assert.equal(readFlag({ featureFlags: { 'app-shell': 'true' } }, 'app-shell').on, false);
  assert.equal(readFlag({ featureFlags: { 'app-shell': true } }, 'app-shell').on, true);
});

test('partial evaluation is off', () => {
  assert.equal(
    readFlag({ errorsWhileComputingFlags: true, flags: { 'app-shell': { enabled: true } } }, 'app-shell').on,
    false,
  );
});

test('fails closed on timeout, network error, non-200, bad JSON and missing config', async () => {
  // AbortSignal.timeout's timer is unref'd; keep the loop alive like a real socket would.
  const slow = ((_u: unknown, init?: RequestInit) =>
    new Promise((_res, rej) => {
      const keepAlive = setTimeout(() => {}, 5000);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(keepAlive);
        rej(init.signal!.reason);
      });
    })) as typeof fetch;
  assert.deepEqual(await evaluateFlag('app-shell', FUND, cfg(slow)), { on: false, reason: 'timeout' });
  const down = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  assert.deepEqual(await evaluateFlag('app-shell', FUND, cfg(down)), { on: false, reason: 'error' });
  assert.equal(
    (await evaluateFlag('app-shell', FUND, cfg(json({ flags: { 'app-shell': { enabled: true } } }, 500)))).on,
    false,
  );
  const notJson = (async () => new Response('<html>')) as typeof fetch;
  assert.equal((await evaluateFlag('app-shell', FUND, cfg(notJson))).on, false);
  assert.equal((await evaluateFlag('app-shell', FUND, { host: undefined, projectKey: 'k' })).reason, 'no_config');
  assert.equal((await evaluateFlag('app-shell', '', cfg(json({})))).reason, 'no_config');
});

test('a transient failure is retried once within the budget', async () => {
  let calls = 0;
  const flaky = (async () => {
    calls++;
    if (calls === 1) throw new TypeError('fetch failed');
    return new Response(JSON.stringify({ flags: { 'app-shell': { enabled: true } } }));
  }) as typeof fetch;
  assert.deepEqual(await evaluateFlag('app-shell', FUND, cfg(flaky)), { on: true, reason: 'on' });
  assert.equal(calls, 2);
});
