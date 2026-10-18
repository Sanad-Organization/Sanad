import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_MESSAGES, MAX_GITHUB_URLS, parseDealForm, roundLabel } from './deal-form.ts';

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

test('a name alone is a valid deal', () => {
  const r = parseDealForm(form({ company_name: '  Synthetic Co A  ' }));
  assert.deepEqual(r, {
    ok: true,
    data: {
      company_name: 'Synthetic Co A',
      website: undefined,
      sector: undefined,
      country: undefined,
      round: undefined,
      github_urls: [],
    },
  });
});

test('optional fields are normalised the way the database expects', () => {
  const r = parseDealForm(
    form({
      company_name: 'Synthetic Co A',
      website: 'synthetic-a.example',
      sector: 'fintech',
      country: 'ae',
      round: 'seed',
      github_urls:
        'https://github.com/synthetic-a/api/\nhttps://github.com/synthetic-a/web.git, https://github.com/synthetic-a/api',
    }),
  );
  assert.deepEqual(r, {
    ok: true,
    data: {
      company_name: 'Synthetic Co A',
      website: 'https://synthetic-a.example',
      sector: 'fintech',
      country: 'AE',
      round: 'seed',
      github_urls: ['https://github.com/synthetic-a/api', 'https://github.com/synthetic-a/web'],
    },
  });
});

test('an upper-case scheme is accepted and lower-cased', () => {
  const r = parseDealForm(form({ company_name: 'A', website: 'HTTPS://Synthetic-A.example/Path' }));
  assert.equal(r.ok && r.data.website, 'https://Synthetic-A.example/Path');
});

test('each invalid field gets its own message', () => {
  const r = parseDealForm(
    form({
      company_name: '',
      website: 'https://bad host',
      sector: 'x'.repeat(101),
      country: 'UAE',
      round: 'series_z',
      github_urls: 'https://gitlab.com/synthetic-a/api',
    }),
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(r.errors, {
    company_name: FIELD_MESSAGES.company_name,
    website: FIELD_MESSAGES.website,
    sector: FIELD_MESSAGES.sector,
    country: FIELD_MESSAGES.country,
    round: FIELD_MESSAGES.round,
    github_urls: FIELD_MESSAGES.github_urls,
  });
});

test('limits match the database checks', () => {
  assert.equal(parseDealForm(form({ company_name: 'a'.repeat(200) })).ok, true);
  assert.equal(parseDealForm(form({ company_name: 'a'.repeat(201) })).ok, false);
  assert.equal(parseDealForm(form({ company_name: 'A', website: 'https://a.example/' + 'p'.repeat(500) })).ok, false);
  const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://github.com/synthetic-a/r${i}`).join('\n');
  assert.equal(parseDealForm(form({ company_name: 'A', github_urls: urls(MAX_GITHUB_URLS) })).ok, true);
  assert.equal(parseDealForm(form({ company_name: 'A', github_urls: urls(MAX_GITHUB_URLS + 1) })).ok, false);
  // http, a bare owner and a deeper path are all refused, as in app_auth.valid_github_urls.
  for (const bad of ['http://github.com/a/b', 'https://github.com/a', 'https://github.com/a/b/tree/main']) {
    assert.equal(parseDealForm(form({ company_name: 'A', github_urls: bad })).ok, false, bad);
  }
});

test('a missing field reads as empty, never as a crash', () => {
  const r = parseDealForm(new FormData());
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(Object.keys(r.errors), ['company_name']);
});

test('round labels', () => {
  assert.equal(roundLabel('series_a'), 'Series A');
  assert.equal(roundLabel(null), '—');
  assert.equal(roundLabel('unknown'), '—');
});
