import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dealCheckField, userMessage } from './errors.ts';
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

test('check violations map to the form field, from the constraint name only', () => {
  const check = (name: string) => ({
    code: '23514',
    message: `new row for relation "x" violates check constraint "${name}"`,
  });
  assert.equal(dealCheckField(check('companies_name_check')), 'company_name');
  assert.equal(dealCheckField(check('companies_website_check')), 'website');
  assert.equal(dealCheckField(check('companies_sector_check')), 'sector');
  assert.equal(dealCheckField(check('companies_country_check')), 'country');
  assert.equal(dealCheckField(check('deals_round_check')), 'round');
  assert.equal(dealCheckField(check('deals_github_urls_check')), 'github_urls');
  assert.equal(dealCheckField(check('deals_pipeline_check')), undefined);
  assert.equal(
    dealCheckField({ code: '42501', message: 'violates check constraint "companies_name_check"' }),
    undefined,
  );
  assert.equal(dealCheckField({ code: '23514' }), undefined);
  assert.equal(dealCheckField(null), undefined);
  assert.equal(userMessage({ code: '23514' }), 'Some details are not valid. Check the highlighted fields.');
});
