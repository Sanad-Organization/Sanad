import { test } from 'node:test';
import assert from 'node:assert/strict';
import { userMessage } from './errors.ts';
import { safeNextPath } from './redirect.ts';

test('permission errors read as a permission message', () => {
  assert.equal(userMessage({ code: '42501' }), "You don't have permission to do that.");
});

test('unknown errors never echo the database message', () => {
  assert.equal(userMessage({ code: 'XX000' }), 'Something went wrong. Try again in a moment.');
  assert.equal(userMessage(null), 'Something went wrong. Try again in a moment.');
});

test('only same-site relative paths survive login', () => {
  assert.equal(safeNextPath('/deals/new'), '/deals/new');
  for (const bad of [
    'https://evil.test',
    '//evil.test',
    '/\\evil.test',
    'deals',
    '/a\nb',
    null,
    '',
    '/' + 'a'.repeat(300),
  ]) {
    assert.equal(safeNextPath(bad), '/deals', String(bad));
  }
});
