#!/usr/bin/env node
// gate.mjs — the local gate before every push (CLAUDE.md "Working rules").
// Runs every check CI runs; stops at the first failure and says which.
// Database tests run when supabase/ changed against origin/main, or with --db.
import { execSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const steps = [
  ['format', 'pnpm', ['format:check']],
  ['lint', 'pnpm', ['lint']],
  ['typecheck', 'pnpm', ['typecheck']],
  ['test', 'pnpm', ['test']],
  ['guard tests', 'pnpm', ['guard:test']],
  ['secret scan', 'pnpm', ['secrets:scan']],
];

// Python worker: lint, format and unit tests (the DB integration test runs when
// PGHOST and SANAD_TEST_DB point at a local database built by db-test.sh).
if (existsSync('services/worker/pyproject.toml')) {
  const uv = ['--project', 'services/worker'];
  steps.push(['worker lint', 'uv', ['run', ...uv, 'ruff', 'check', 'services/worker']]);
  steps.push(['worker format', 'uv', ['run', ...uv, 'ruff', 'format', '--check', 'services/worker']]);
  steps.push(['worker tests', 'uv', ['run', ...uv, 'pytest', 'services/worker/tests']]);
}

let dbChanged = process.argv.includes('--db');
if (!dbChanged) {
  try {
    const base = execSync('git merge-base HEAD origin/main', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const out = execSync(`git diff --name-only ${base} -- supabase scripts/db-test.sh scripts/db-canaries.sh`, {
      encoding: 'utf8',
    });
    const dirty = execSync('git status --porcelain -- supabase', { encoding: 'utf8' });
    dbChanged = Boolean(out.trim() || dirty.trim());
  } catch {
    dbChanged = true; // no origin/main yet: run everything
  }
}
if (dbChanged) {
  steps.push(['db tests', 'scripts/db-test.sh', []]);
  steps.push(['db canaries', 'scripts/db-canaries.sh', []]);
}

for (const [name, cmd, args] of steps) {
  process.stdout.write(`\n▶ ${name}\n`);
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\n✗ gate failed at: ${name}`);
    process.exit(1);
  }
}
console.log('\n✓ gate passed');
