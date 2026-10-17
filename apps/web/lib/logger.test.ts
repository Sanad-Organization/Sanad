import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, errorFields } from './logger.ts';

function capture() {
  const lines: Record<string, unknown>[] = [];
  return { lines, log: createLogger('trace-123456', (l) => lines.push(JSON.parse(l))) };
}

test('every line is JSON with level, event and trace_id', () => {
  const { lines, log } = capture();
  log.info('action.end', { action: 'deal.create', outcome: 'ok', duration_ms: 12 });
  assert.equal(lines.length, 1);
  assert.deepEqual(
    { level: lines[0]!.level, event: lines[0]!.event, trace_id: lines[0]!.trace_id, outcome: lines[0]!.outcome },
    { level: 'info', event: 'action.end', trace_id: 'trace-123456', outcome: 'ok' },
  );
});

test('drops fields that are not allow-listed (PII, payloads, messages)', () => {
  const { lines, log } = capture();
  log.error('x', {
    email: 'someone@example.test',
    message: 'duplicate key value violates unique constraint',
    payload: { company: 'Synthetic Co A' },
    headers: { authorization: 'Bearer abc' },
    action: 'a',
  });
  const line = JSON.stringify(lines[0]);
  for (const leaked of ['example.test', 'duplicate key', 'Synthetic', 'Bearer'])
    assert.ok(!line.includes(leaked), leaked);
  assert.equal(lines[0]!.action, 'a');
});

test('objects in allowed fields are dropped and strings are capped', () => {
  const { lines, log } = capture();
  log.info('x', { reason: 'r'.repeat(500), code: { nested: true } });
  assert.equal((lines[0]!.reason as string).length, 200);
  assert.equal(lines[0]!.code, undefined);
});

test('errorFields keeps the class name and code, never the message', () => {
  const err = Object.assign(new TypeError('secret detail from user input'), { code: '42501' });
  const f = errorFields(err);
  assert.deepEqual(f, { error_name: 'TypeError', code: '42501' });
});

test('values shaped like PII or credentials are redacted even in allowed fields', () => {
  const { lines, log } = capture();
  const samples = [
    'someone@example.test',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3OCJ9.abc',
    'Bearer abcdef123456',
    'sb_publishable_abcdefgh123',
    '/auth/callback?code=abc',
  ];
  for (const reason of samples) log.warn('x', { reason });
  for (const line of lines) assert.equal(line.reason, '[redacted]');
  log.info('x', { reason: 'lease_lost' });
  assert.equal(lines.at(-1)!.reason, 'lease_lost');
});
