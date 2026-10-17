// The web app's hard boundary (CLAUDE.md): no service-role key, no env var
// outside the allow-list, no table writes from the browser side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEB_ENV } from './env.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.next', '.turbo']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|mjs|js|json)$/.test(name) ? [p] : [];
  });
}
const sources = files(root).filter((f) => !f.endsWith('boundary.test.ts'));
const read = (f: string) => readFileSync(f, 'utf8');

test('no service-role key anywhere in apps/web', () => {
  const banned = new RegExp(
    ['SERVICE', 'ROLE'].join('_') + '|' + ['service', 'role'].join('_') + '|sb_' + 'secret_',
    'i',
  );
  for (const f of sources) assert.ok(!banned.test(read(f)), `${path.relative(root, f)} mentions a service-role key`);
});

test('code reads only allow-listed environment variables', () => {
  const allowed = new Set<string>([...WEB_ENV, 'NEXT_RUNTIME']);
  for (const f of sources) {
    for (const m of read(f).matchAll(/process\.env\.([A-Z0-9_]+)|process\.env\[['"]([A-Z0-9_]+)['"]\]/g)) {
      const name = m[1] ?? m[2]!;
      assert.ok(allowed.has(name), `${path.relative(root, f)} reads ${name}, which is not in WEB_ENV`);
    }
    assert.ok(!/process\.env\[(?!['"])/.test(read(f)), `${path.relative(root, f)} reads env by computed key`);
  }
});

test('no direct table writes: writes go through reviewed RPCs', () => {
  for (const f of sources) {
    const src = read(f);
    assert.ok(
      !/\.from\([^)]*\)\s*\.(insert|update|upsert|delete)\(/.test(src),
      `${path.relative(root, f)} writes a table`,
    );
  }
});

test('every env var turbo passes to the build is allow-listed', () => {
  const turbo = JSON.parse(read(path.join(root, 'turbo.json')));
  for (const name of turbo.tasks.build.env as string[]) assert.ok((WEB_ENV as readonly string[]).includes(name), name);
});
