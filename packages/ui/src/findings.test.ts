import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { FINDINGS, countLabel } from './findings.ts';

const migrations = new URL('../../../supabase/migrations/', import.meta.url);

test('every database finding_type has a word and glyph, and nothing extra', () => {
  const sql = readdirSync(migrations)
    .map((f) => readFileSync(new URL(f, migrations), 'utf8'))
    .join('\n');
  const m = /create type public\.finding_type as enum\s*\(([^)]*)\)/i.exec(sql);
  assert.ok(m, 'finding_type enum not found in migrations');
  const dbValues = [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
  assert.deepEqual(Object.keys(FINDINGS).sort(), dbValues);
});

test('glyphs and words are distinct, so no two types look alike', () => {
  const glyphs = Object.values(FINDINGS).map((f) => f.glyph);
  const words = Object.values(FINDINGS).map((f) => f.word);
  assert.equal(new Set(glyphs).size, glyphs.length);
  assert.equal(new Set(words).size, words.length);
});

test('counted badges read as a full phrase', () => {
  assert.equal(countLabel('red_flag', 1), '1 red flag');
  assert.equal(countLabel('red_flag', 3), '3 red flags');
  assert.equal(countLabel('risk', 0), '0 risks');
});
