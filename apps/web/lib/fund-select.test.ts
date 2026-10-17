import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mayUseFund, pickFund, toMemberships } from './fund-select.ts';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const FOREIGN = '00000000-0000-4000-8000-0000000000ff';
const funds = toMemberships([
  { fund_id: A, role: 'analyst', funds: { name: 'Synthetic Fund A' } },
  { fund_id: B, role: 'viewer', funds: { name: 'Synthetic Fund B' } },
]);

test('a cookie naming a fund the user is not in is ignored', () => {
  assert.equal(pickFund(funds, FOREIGN)?.fundId, A);
  assert.equal(pickFund(funds, B)?.fundId, B);
  assert.equal(pickFund([], A), null);
});

test('switching is allowed only to a fund the database returned', () => {
  assert.equal(mayUseFund(funds, B), true);
  for (const bad of [FOREIGN, '', null, 42, `${A} `]) assert.equal(mayUseFund(funds, bad), false, String(bad));
});

test('rows with an unknown role are dropped', () => {
  const rows = toMemberships([
    { fund_id: A, role: 'superuser', funds: { name: 'X' } },
    { fund_id: B, role: 'partner', funds: null },
  ]);
  assert.deepEqual(rows, [{ fundId: B, fundName: 'Fund', role: 'partner' }]);
});
