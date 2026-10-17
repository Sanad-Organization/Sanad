import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from './secret-scan.mjs';

// Fake values assembled at runtime so this file itself scans clean.
const j = (...p) => p.join('');
const fakes = {
  'private-key': j('-----BEGIN ', 'PRIVATE KEY-----'),
  jwt: j(
    'ey',
    'JhbGciOiJIUzI1NiJ9',
    '.ey',
    'JzdWIiOiIxMjM0NTY3ODkwIn0',
    '.',
    'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  ),
  'aws-access-key': j('AKIA', 'ABCDEFGHIJKLMNOP'),
  'github-token': j('ghp_', 'a'.repeat(36)),
  'anthropic-key': j('sk-ant-', 'api03-', 'x'.repeat(30)),
  'google-api-key': j('AIza', 'B'.repeat(35)),
  'db-url-with-password': j('postgresql://postgres:', 'hunter22hunter', '@db.example.test:5432/postgres'),
  'named-secret': j('SUPABASE_SERVICE_ROLE_KEY', '=', 'abc123def456ghi789'),
  'fly-token': j('FlyV1 ', 'fm2_', 'z'.repeat(40)),
};

test('every rule catches its fake value', () => {
  for (const [rule, value] of Object.entries(fakes)) {
    const hits = scanText(`const x = "${value}";`, 'f.ts');
    assert.ok(
      hits.some((h) => h.rule === rule),
      `${rule} not caught`,
    );
  }
});

test('names, placeholders and env reads are not secrets', () => {
  for (const line of [
    'SUPABASE_SERVICE_ROLE_KEY=',
    'ANTHROPIC_API_KEY=<from Render>',
    'const key = process.env.SUPABASE_SERVICE_ROLE_KEY;',
    'SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}',
    'DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres # secret-scan: allow local default',
    'GITHUB_WEBHOOK_SECRET="..."',
    'postgresql://postgres@localhost/sanad_test',
  ])
    assert.deepEqual(scanText(line), [], line);
});

test('reports file, line and rule, never the value', () => {
  const [hit] = scanText(`a\nb ${fakes['github-token']}\n`, 'x.md');
  assert.deepEqual(hit, { file: 'x.md', line: 2, rule: 'github-token' });
  assert.ok(!JSON.stringify(hit).includes(fakes['github-token']));
});
