import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { FLAGS, isOn } from './flags.ts';
import { JOB_KINDS, JOB_KIND_PATTERN } from './jobs.ts';

const schemasDir = new URL('../schemas/jobs/', import.meta.url);
const migrationsDir = new URL('../../../supabase/migrations/', import.meta.url);

test('every job kind matches the database CHECK and has a payload schema', () => {
  const files = new Set(readdirSync(schemasDir));
  for (const kind of JOB_KINDS) {
    assert.match(kind, JOB_KIND_PATTERN, kind);
    assert.ok(files.has(`${kind}.json`), `missing schemas/jobs/${kind}.json`);
    const schema = JSON.parse(readFileSync(new URL(`${kind}.json`, schemasDir), 'utf8'));
    assert.equal(schema.type, 'object', kind);
    assert.equal(schema.additionalProperties, false, `${kind} must reject unknown fields`);
  }
  for (const f of files)
    assert.ok((JOB_KINDS as readonly string[]).includes(f.replace(/\.json$/, '')), `orphan schema ${f}`);
});

test('the kind pattern is the one the database enforces', () => {
  const sql = readdirSync(migrationsDir)
    .map((f) => readFileSync(new URL(f, migrationsDir), 'utf8'))
    .join('\n');
  assert.ok(sql.includes("check (kind ~ '^[a-z]+\\.[a-z_]+$')"), 'jobs.kind CHECK changed: update JOB_KIND_PATTERN');
});

test('every job kind the database enqueues is known', () => {
  const sql = readdirSync(migrationsDir)
    .map((f) => readFileSync(new URL(f, migrationsDir), 'utf8'))
    .join('\n');
  for (const m of sql.matchAll(/app_jobs\.enqueue\('([a-z_.]+)'/g)) {
    assert.ok((JOB_KINDS as readonly string[]).includes(m[1]!), `SQL enqueues unknown kind ${m[1]}`);
  }
});

test('flags fail closed', () => {
  for (const v of [undefined, null, 'true', 1, {}, 'on']) assert.equal(isOn(v), false);
  assert.equal(isOn(true), true);
  for (const [k, f] of Object.entries(FLAGS)) assert.match(f.expires, /^\d{4}-\d{2}-\d{2}$/, k);
});
