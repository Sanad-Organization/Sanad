#!/usr/bin/env node
// secret-scan.mjs — catches key shapes before they reach git.
//
//   node .claude/hooks/secret-scan.mjs --staged     pre-commit (default)
//   node .claude/hooks/secret-scan.mjs --all        every tracked file (CI)
//   node .claude/hooks/secret-scan.mjs --hook       Claude PreToolUse: scans staged files
//                                                   before `git commit` / `git push`
//
// Exit 1 (or 2 in --hook mode) with file:line and the RULE NAME only — never the
// matched value. Gitleaks (pre-commit if installed, and CI over full history) is
// the second layer.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// Patterns are built from parts so this file doesn't trip its own scan.
const P = (...parts) => new RegExp(parts.join(''));
export const RULES = [
  ['private-key', P('-----BEGIN ', '(RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?', 'PRIVATE KEY', '( BLOCK)?-----')],
  ['jwt', P('\\beyJ[A-Za-z0-9_-]{10,}', '\\.eyJ[A-Za-z0-9_-]{10,}', '\\.[A-Za-z0-9_-]{10,}')],
  ['aws-access-key', P('\\b(AKIA|ASIA)', '[0-9A-Z]{16}\\b')],
  ['github-token', P('\\b(gh[pousr]_', '[A-Za-z0-9]{36,}|github_pat_', '[A-Za-z0-9_]{60,})')],
  ['anthropic-key', P('\\bsk-ant-', '[A-Za-z0-9_-]{20,}')],
  ['openai-key', P('\\bsk-(proj-)?', '[A-Za-z0-9]{32,}')],
  ['stripe-secret', P('\\b(sk|rk)_live_', '[A-Za-z0-9]{20,}')],
  ['google-api-key', P('\\bAIza', '[0-9A-Za-z_-]{35}\\b')],
  ['slack-token', P('\\bxox[abprs]-', '[A-Za-z0-9-]{10,}')],
  ['posthog-personal-key', P('\\bphx_', '[A-Za-z0-9]{30,}')],
  ['fly-token', P('\\bFlyV1 ', 'fm\\d_[A-Za-z0-9_+/=-]{20,}')],
  ['supabase-secret-key', P('\\bsb_secret_', '[A-Za-z0-9_-]{20,}')],
  ['db-url-with-password', P('postgres(ql)?://[^\\s:/@]+:', '[^\\s@/$<{]{6,}@')],
  [
    'named-secret',
    P(
      '\\b(SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|ANTHROPIC_API_KEY|VOYAGE_API_KEY|GITHUB_APP_PRIVATE_KEY|GITHUB_WEBHOOK_SECRET|',
      'SCAN_UPLOAD_SECRET|AUTHOR_HASH_SALT|X_API_BEARER_TOKEN|BRIGHTDATA_API_KEY|FLY_API_TOKEN|POSTHOG_PERSONAL_API_KEY|',
      'SENTRY_AUTH_TOKEN|LANGFUSE_SECRET_KEY|RESEND_API_KEY|DATABASE_URL)',
      '\\s*[=:]\\s*["\']?(?![\\s"\'$<{]|\\.\\.\\.|changeme|placeholder|example|xxx|<)',
      '[^\\s"\']{8,}',
    ),
  ],
];

const SKIP =
  /(^|\/)(node_modules|\.git|dist|\.next|\.turbo|\.venv)\/|\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|zip|gz|lock)$|pnpm-lock\.yaml$|uv\.lock$/;

export function scanText(text, file = '<text>') {
  const hits = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (/secret-scan:\s*allow/.test(line)) return; // reviewed exception, must be justified in the PR
    for (const [name, re] of RULES) if (re.test(line)) hits.push({ file, line: i + 1, rule: name });
  });
  return hits;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean);
}

function files(mode) {
  if (mode === '--all') return git(['ls-files', '-z']);
  return git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']);
}

function contentOf(f, mode) {
  if (mode === '--all') {
    if (statSync(f).size > 2_000_000) return '';
    return readFileSync(f, 'utf8');
  }
  return execFileSync('git', ['show', `:${f}`], { encoding: 'utf8', maxBuffer: 10_000_000 });
}

export function run(mode) {
  const hits = [];
  for (const f of files(mode)) {
    if (SKIP.test(f)) continue;
    try {
      hits.push(...scanText(contentOf(f, mode), f));
    } catch {
      // unreadable or binary: skip
    }
  }
  return hits;
}

function main() {
  let mode = process.argv[2] ?? '--staged';
  if (mode === '--hook') {
    let payload = {};
    try {
      payload = JSON.parse(readFileSync(0, 'utf8'));
    } catch {
      process.stderr.write('BLOCKED by secret-scan: unreadable hook payload\n');
      process.exit(2);
    }
    const cmd = payload?.tool_input?.command ?? '';
    if (!/\bgit\b[^\n;|&]*\b(commit|push)\b/.test(cmd)) process.exit(0);
    const hits = run('--staged');
    if (hits.length) {
      process.stderr.write(
        `BLOCKED by secret-scan: possible secrets staged:\n${hits.map((h) => `  ${h.file}:${h.line} ${h.rule}`).join('\n')}\n`,
      );
      process.exit(2);
    }
    process.exit(0);
  }
  const hits = run(mode);
  if (hits.length) {
    console.error(`secret-scan: ${hits.length} possible secret(s):`);
    for (const h of hits) console.error(`  ${h.file}:${h.line} ${h.rule}`);
    console.error('Remove the value (use env vars), or mark a reviewed false positive with "secret-scan: allow".');
    process.exit(1);
  }
  console.log(`secret-scan: clean (${mode})`);
}

if (path.resolve(process.argv[1] ?? '') === new URL(import.meta.url).pathname) main();
