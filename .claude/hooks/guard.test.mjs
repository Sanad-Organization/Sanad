// Tests for guard.mjs. Run: node --test .claude/hooks/
// Every rule has a blocked case AND the allowed shapes next to it, so the guard
// can't drift into blocking ordinary work.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluate } from './guard.mjs';

const GUARD = fileURLToPath(new URL('./guard.mjs', import.meta.url));

// A throwaway repo outside the real one, so tests don't depend on its contents.
// Outside the OS temp folder, so the delete rules are exercised for real.
const ROOT = realpathSync(mkdtempSync(path.join(homedir(), '.guard-test-root-')));
for (const d of ['owner-only/designs', '.github/workflows', '.claude/hooks', 'apps/web', 'supabase/migrations', 'docs'])
  mkdirSync(path.join(ROOT, d), { recursive: true });
writeFileSync(path.join(ROOT, '.env.example'), 'NAME=\n');
writeFileSync(path.join(ROOT, 'owner-only/designs/a.txt'), 'x');
symlinkSync(path.join(ROOT, 'owner-only'), path.join(ROOT, 'docs/sneaky'));
after(() => rmSync(ROOT, { recursive: true, force: true }));

const bash = (command, cwd = ROOT) => ({ tool_name: 'Bash', tool_input: { command }, cwd });
const blocked = (payload, re) => {
  assert.throws(() => evaluate(payload, ROOT), re ?? /./, `expected BLOCK: ${JSON.stringify(payload.tool_input)}`);
};
const allowed = (payload) => {
  assert.doesNotThrow(() => evaluate(payload, ROOT), `expected ALLOW: ${JSON.stringify(payload.tool_input)}`);
};

test('gh: api, merge, review, rulesets, secrets are denied behind any wrapper', () => {
  for (const c of [
    'gh api repos/x/y/pulls',
    'gh pr merge 12 --squash',
    'gh pr review 12 --approve',
    'env FOO=1 gh pr merge 3',
    'cd apps && gh api -X PUT x',
    'bash -c "gh pr merge 1"',
    "sh -lc 'gh api user'",
    'echo "$(gh api user)"',
    'echo `gh pr merge 1`',
    'nohup gh api x &',
    'timeout 5 gh api x',
    'xargs -n1 gh pr merge < /dev/null',
    '/usr/bin/gh api x',
    'gh ruleset list',
    'gh secret set X',
    'gh variable set X',
    'gh workflow run ci',
    'gh repo delete x/y --yes',
    'eval "gh api x"',
    'pwsh -Command "gh api x"',
  ])
    blocked(bash(c));
  for (const c of [
    'gh pr create --title t --body-file /tmp/b.md',
    'gh pr view 3',
    'gh pr list',
    'gh pr checks 3',
    'gh run view 9',
  ])
    allowed(bash(c));
});

test('git push: main and force forms are denied; feature branches are fine', () => {
  for (const c of [
    'git push origin main',
    'git push origin HEAD:main',
    'git push origin feat/x:main',
    'git push origin refs/heads/main',
    'git push -f origin feat/x',
    'git push --force origin feat/x',
    'git push --force-with-lease origin feat/x',
    'git push origin +feat/x',
    'git push --mirror',
    'git push origin --delete feat/x',
    'git -c core.hooksPath=/dev/null commit -m x',
    'git commit --no-verify -m x',
    'git commit -nm x',
    'git filter-branch --all',
  ])
    blocked(bash(c));
  for (const c of [
    'git push -u origin feat/db-spine',
    'git push origin feat/maintenance',
    'git push',
    'git commit -F /tmp/msg.txt',
    'git commit -m "touches .github/workflows/ci.yml in the text"',
    'git status && git diff --stat',
    'git log --oneline -5',
    'git checkout -b feat/x',
  ])
    allowed(bash(c));
});

test("hosted database and hosting CLIs are the owner's", () => {
  for (const c of [
    'supabase link --project-ref abc',
    'supabase db push',
    'supabase db dump -f x.sql',
    'supabase migration list',
    'supabase migration repair 1 --status applied',
    'supabase functions deploy x',
    'supabase secrets set A=b',
    'npx supabase db push',
    'pnpm dlx supabase link',
    'supabase db reset --linked',
    'psql "postgresql://postgres@db.abc.supabase.co:5432/postgres"',
    'psql -h aws-0-eu-central-1.pooler.supabase.com',
    'vercel deploy --prod',
    'npx vercel env pull',
    'fly deploy',
    'flyctl secrets set X=1',
    'curl -X PUT https://api.github.com/repos/o/r/pulls/3/merge',
    'curl https://api.vercel.com/v9/projects',
  ])
    blocked(bash(c));
  for (const c of [
    'supabase start',
    'supabase db reset',
    'supabase migration new add_x',
    'supabase test db',
    'supabase gen types typescript --local',
    'psql -h /var/tmp/pg -p 54329 -d sanad_test -f x.sql',
    'scripts/db-test.sh',
    'curl -s https://example.test/health',
  ])
    allowed(bash(c));
});

test('secrets: env files and key material are off limits; .env.example is fine', () => {
  for (const c of [
    'cat .env',
    'cat apps/web/.env.local',
    'less .env.production',
    'head -5 ./.env',
    'grep KEY .env',
    'source .env',
    '. ./.env',
    'cp .env /tmp/x',
    'echo X=1 > .env.local',
    'echo X=1 >> apps/web/.env',
    'cat < .env',
    'cat id_rsa',
    'openssl rsa -in server.key',
    'node --env-file=.env x.js',
    'printenv',
    'env',
    'export -p',
  ])
    blocked(bash(c));
  for (const c of ['cat .env.example', 'git check-ignore .env', 'printenv NODE_ENV', 'env NODE_ENV=test node --test'])
    allowed(bash(c));
  blocked({ tool_name: 'Read', tool_input: { file_path: path.join(ROOT, '.env') } });
  blocked({ tool_name: 'Read', tool_input: { file_path: path.join(ROOT, 'apps/web/.env.local') } });
  blocked({ tool_name: 'Write', tool_input: { file_path: path.join(ROOT, '.env'), content: '' } });
  allowed({ tool_name: 'Read', tool_input: { file_path: path.join(ROOT, '.env.example') } });
  blocked({ tool_name: 'Glob', tool_input: { pattern: '**/.env*' } });
  blocked({ tool_name: 'Grep', tool_input: { pattern: 'KEY', glob: '**/.env*' } });
  allowed({ tool_name: 'Grep', tool_input: { pattern: 'API_KEY', glob: '**/*.ts' } });
});

test('guardrails: readable, never writable', () => {
  for (const c of [
    'echo x > .github/workflows/ci.yml',
    'sed -i s/a/b/ .claude/settings.json',
    'tee .claude/hooks/guard.mjs < /dev/null',
    'rm .claude/hooks/guard.mjs',
    'mv .github .github.bak',
    'cp /tmp/evil.yml .github/workflows/ci.yml',
    'chmod -x .githooks/pre-commit',
    'printf x >> .gitignore',
    'cd .github && rm -rf workflows',
    'git checkout -- .claude/settings.json',
    'perl -pi -e s/a/b/ .gitleaks.toml',
    "bash -c 'echo x > .mcp.json'",
  ])
    blocked(bash(c), /guardrail/);
  for (const c of [
    'cat .github/workflows/ci.yml',
    'cp .claude/settings.json /tmp/settings.copy',
    'node --test .claude/hooks/',
    'git diff .github',
  ])
    allowed(bash(c));
  for (const t of ['Write', 'Edit', 'MultiEdit']) {
    blocked({ tool_name: t, tool_input: { file_path: path.join(ROOT, '.github/workflows/ci.yml') } }, /guardrail/);
    blocked({ tool_name: t, tool_input: { file_path: path.join(ROOT, '.claude/settings.json') } }, /guardrail/);
    blocked({ tool_name: t, tool_input: { file_path: path.join(ROOT, '.claude/hooks/guard.mjs') } }, /guardrail/);
    blocked({ tool_name: t, tool_input: { file_path: path.join(ROOT, '.gitignore') } }, /guardrail/);
  }
  allowed({ tool_name: 'Read', tool_input: { file_path: path.join(ROOT, '.github/workflows/ci.yml') } });
  allowed({ tool_name: 'Edit', tool_input: { file_path: path.join(ROOT, '.claude/agents/code-reviewer.md') } });
  allowed({
    tool_name: 'Write',
    tool_input: { file_path: path.join(ROOT, 'supabase/migrations/20261014000000_x.sql') },
  });
});

test('owner-only folder: no reads, writes, cd or recursive search into it (also via symlink)', () => {
  for (const c of [
    'cat owner-only/designs/a.txt',
    'ls owner-only',
    'cd owner-only',
    'cat docs/sneaky/designs/a.txt',
    'grep -r secret .',
    'grep -rn x',
    'grep --recursive x docs',
    'grep -d recurse x .',
    'rg -u token',
    'rg --no-ignore token .',
    'git grep --no-index x',
    'RIPGREP_CONFIG_PATH=/tmp/rc rg x',
    'cp owner-only/designs/a.txt /tmp/',
  ])
    blocked(bash(c));
  for (const c of ['rg token', 'rg token apps', 'git grep token', 'grep -rn token apps', 'grep token docs/x.md'])
    allowed(bash(c));
  blocked({ tool_name: 'Read', tool_input: { file_path: path.join(ROOT, 'owner-only/designs/a.txt') } });
  blocked({ tool_name: 'Grep', tool_input: { pattern: 'x', path: path.join(ROOT, 'owner-only') } });
  blocked({ tool_name: 'Read', tool_input: { file_path: path.join(ROOT, 'docs/sneaky/designs/a.txt') } });
});

test('deletes: only inside the repo or the temp folder; never .git; unresolvable targets blocked', () => {
  for (const c of [
    'rm -rf /',
    'rm -rf ~/projects',
    'rm -rf "$HOME/x"',
    'rm -rf ../other-repo',
    'rm -rf .git',
    'rm -rf .',
    'find / -name x -delete',
    'find .. -exec rm {} ;',
    'cd .. && rm -rf sanad-other',
    'sudo rm x',
  ])
    blocked(bash(c));
  for (const c of [
    'rm -rf node_modules',
    'rm -f apps/web/.next/cache/x',
    'rm -rf "$TMPDIR/guard-x"',
    'rm -rf /tmp/sanad-test',
    'find . -name "*.log" -delete',
  ])
    allowed(bash(c));
});

test('here-documents: bodies are data, unless fed to a shell', () => {
  allowed(bash("cat > /tmp/notes.md <<'EOF'\nrun gh api later; rm -rf /\nEOF"));
  allowed(bash("git commit -F - <<'EOF'\nfeat: mention .github/workflows and gh pr merge\nEOF"));
  blocked(bash("bash <<'EOF'\ngh pr merge 1\nEOF"));
  blocked(bash("cat > .github/workflows/x.yml <<'EOF'\non: push\nEOF"), /guardrail/);
});

test('fails closed on garbage', () => {
  blocked(bash('echo "unterminated'));
  blocked(bash('echo $(gh api x'));
  blocked({ tool_name: 'Bash', tool_input: {} });
  blocked({});
  blocked({ tool_name: 'Read', tool_input: {} });
  const r = spawnSync(process.execPath, [GUARD], {
    input: 'not json',
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr.toString(), /failed closed/);
});

test('MCP: merge, approve, writes to main and hosted tools are blocked', () => {
  blocked({ tool_name: 'mcp__github__merge_pull_request', tool_input: {} });
  blocked({ tool_name: 'mcp__gh__create_pull_request_review', tool_input: { event: 'APPROVE' } });
  blocked({ tool_name: 'mcp__github__enable_auto_merge', tool_input: {} });
  blocked({ tool_name: 'mcp__github__push_files', tool_input: { files: [] } });
  blocked({ tool_name: 'mcp__github__create_or_update_file', tool_input: { branch: 'main' } });
  allowed({ tool_name: 'mcp__github__create_or_update_file', tool_input: { branch: 'feat/x' } });
  blocked({ tool_name: 'mcp__Supabase__execute_sql', tool_input: { project_id: 'x', query: 'select 1' } });
  blocked({ tool_name: 'mcp__Supabase__apply_migration', tool_input: {} });
  allowed({ tool_name: 'mcp__Supabase__search_docs', tool_input: { query: 'rls' } });
  blocked({ tool_name: 'mcp__Vercel__create_project_env', tool_input: {} });
  allowed({ tool_name: 'mcp__Vercel__get_deployment', tool_input: {} });
  allowed({ tool_name: 'mcp__github__get_pull_request', tool_input: {} });
});

test('ordinary work is not blocked', () => {
  for (const c of [
    'pnpm install --frozen-lockfile',
    'pnpm -r test',
    'pnpm gate',
    'pnpm --filter @sanad/web build',
    'node --test .claude/hooks/',
    'uv run pytest -q',
    'cd services/worker && uv run pytest',
    'ls -la apps',
    'mkdir -p apps/web/app/deals && touch apps/web/app/deals/page.tsx',
    'npx prettier --check .',
    'docker build -t sanad-scanner services/scanner',
    'echo hi 2>&1 | tee /tmp/out.log',
    'node scripts/x.mjs > /tmp/out.json 2>/dev/null',
    'cat package.json | jq .scripts',
    'bash scripts/db-test.sh',
    'git add -A && git commit -F /tmp/msg && git push -u origin feat/x',
  ])
    allowed(bash(c));
  blocked(bash('bash /tmp/downloaded.sh'));
});

test('the CLI entry point blocks with exit 2 and allows with exit 0', () => {
  const run = (payload) =>
    spawnSync(process.execPath, [GUARD], {
      input: JSON.stringify(payload),
      env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
    });
  assert.equal(run(bash('gh api x')).status, 2);
  assert.equal(run(bash('git status')).status, 0);
});
