import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traceIdFrom } from './trace.ts';

const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
const UUID = /^[0-9a-f-]{36}$/;

test('prefers the Vercel request id', () => {
  assert.equal(
    traceIdFrom(h({ 'x-vercel-id': 'fra1::iad1::abcd1-1792248002126-fe09a9847301', 'x-request-id': 'req-12345678' })),
    'fra1::iad1::abcd1-1792248002126-fe09a9847301',
  );
});

test('falls back to a well-formed x-request-id', () => {
  assert.equal(traceIdFrom(h({ 'x-request-id': 'req-12345678' })), 'req-12345678');
});

test('ignores malformed ids and makes a UUID', () => {
  for (const bad of ['short', 'has space in it', '{"inject":1}', 'a'.repeat(200), 'line\nbreak-12345']) {
    assert.match(traceIdFrom(h({ 'x-request-id': bad })), UUID, bad);
  }
  assert.match(traceIdFrom(h({})), UUID);
});
