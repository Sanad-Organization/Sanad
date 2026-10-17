#!/usr/bin/env node
// guard.mjs — PreToolUse guard for coding agents in this repository.
//
// Reads the hook payload ({tool_name, tool_input, cwd}) as JSON on stdin.
// Exit 0 = allow. Exit 2 = block, with the reason on stderr.
// FAILS CLOSED: any exception or unparseable input blocks.
//
// It is a heuristic over command text. It can't see inside a process
// (interpreters like `node -e` / `python -c`, name listings, shell globs stay
// open). The deny list in .claude/settings.json and the server-side ruleset on
// `main` are the real backstops (bootstrap §14.1, §14.3).
//
// Owner-controlled: this file changes only through a patch the owner applies.

import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/** Folders the agent may neither read nor write (owner-only material). */
export const OWNER_ONLY = ['owner-only'];

/** The agent's own guardrails: readable, never writable. */
export const GUARDRAILS = [
  '.github',
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.claude/hooks',
  '.claude/tools',
  '.githooks',
  '.mcp.json',
  '.gitignore',
  '.gitleaks.toml',
  '.rgignore',
  '.ignore',
  'CODEOWNERS',
];

const WRAPPERS = new Set(['command', 'exec', 'nohup', 'time', 'nice', 'stdbuf', 'ionice', 'busybox', 'builtin']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);
const PWSH = new Set(['pwsh', 'powershell', 'powershell.exe', 'pwsh.exe']);
const DELETE_VERBS = new Set(['rm', 'rmdir', 'unlink', 'shred', 'remove-item', 'del', 'erase', 'rd']);
const WRITE_VERBS = new Set([
  'rm',
  'rmdir',
  'unlink',
  'shred',
  'mv',
  'cp',
  'tee',
  'touch',
  'truncate',
  'ln',
  'chmod',
  'chown',
  'install',
  'rsync',
  'patch',
  'dd',
  'set-content',
  'add-content',
  'out-file',
  'copy-item',
  'move-item',
  'remove-item',
  'new-item',
  'rename-item',
]);
const ENV_DUMPERS = new Set(['printenv', 'env', 'set', 'export', 'declare', 'get-childitem']);
const HOSTING_CLIS = new Set(['vercel', 'fly', 'flyctl', 'render', 'heroku', 'railway', 'netlify']);

class Block extends Error {}
const block = (msg) => {
  throw new Block(msg);
};

// ---------------------------------------------------------------------------
// Shell parsing
// ---------------------------------------------------------------------------

/**
 * Split a command line into segments on ; & | && || and newlines, outside
 * quotes. Returns [{text, heredocs}] where heredocs are the bodies of any
 * here-documents that segment opened. Command substitutions $(…) and `…`
 * (also inside double quotes) become segments of their own.
 */
export function splitSegments(cmd) {
  if (typeof cmd !== 'string') block('command is not a string');
  const text = cmd.replace(/\\\r?\n/g, ' ');
  const segs = [];
  let cur = '';
  let curHd = [];
  let pending = [];
  let q = null;
  const flush = () => {
    if (cur.trim()) segs.push({ text: cur.trim(), heredocs: curHd });
    else if (curHd.length) segs.push({ text: ':', heredocs: curHd });
    cur = '';
    curHd = [];
  };
  const substitution = (i) => {
    let depth = 0;
    let j = i + 1;
    let sq = null;
    for (; j < text.length; j++) {
      const ch = text[j];
      if (sq) {
        if (ch === sq) sq = null;
        continue;
      }
      if (ch === "'" || ch === '"') sq = ch;
      else if (ch === '(') depth++;
      else if (ch === ')' && --depth === 0) break;
    }
    if (j >= text.length) block('unbalanced $( in command');
    segs.push(...splitSegments(text.slice(i + 2, j)));
    return j;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (q === '"' && c === '$' && text[i + 1] === '(') {
        const j = substitution(i);
        cur += text.slice(i, j + 1);
        i = j;
        continue;
      }
      cur += c;
      if (c === '\\' && q === '"' && i + 1 < text.length) cur += text[++i];
      else if (c === q) q = null;
      continue;
    }
    if (c === '\\' && i + 1 < text.length) {
      cur += c + text[++i];
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      q = c;
      cur += c;
      continue;
    }
    if (c === '$' && text[i + 1] === '(') {
      const j = substitution(i);
      cur += text.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === '<' && text[i + 1] === '<' && text[i + 2] !== '<') {
      const m = /^<<(-?)[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_.-]*)\2/.exec(text.slice(i));
      if (!m) block('unparseable here-document');
      const hd = { delim: m[3], strip: m[1] === '-', body: '' };
      pending.push(hd);
      curHd.push(hd);
      cur += m[0];
      i += m[0].length - 1;
      continue;
    }
    if (c === '\n') {
      flush();
      // here-document bodies start on the next line
      let j = i + 1;
      for (const hd of pending) {
        const lines = [];
        while (j <= text.length) {
          const nl = text.indexOf('\n', j);
          const line = text.slice(j, nl === -1 ? text.length : nl);
          j = nl === -1 ? text.length + 1 : nl + 1;
          if ((hd.strip ? line.replace(/^\t+/, '') : line) === hd.delim) break;
          lines.push(line);
        }
        hd.body = lines.join('\n');
      }
      pending = [];
      i = j - 1;
      continue;
    }
    if (c === '&' && (text[i + 1] === '>' || text[i - 1] === '>' || text[i - 1] === '<')) {
      cur += c; // &>file, 2>&1, <&3
      continue;
    }
    if (c === '|' && text[i - 1] === '>') {
      cur += c; // >|file
      continue;
    }
    if (c === ';' || c === '|' || c === '&') {
      flush();
      if ((c === '|' || c === '&') && text[i + 1] === c) i++;
      continue;
    }
    cur += c;
  }
  if (q) block('unbalanced quotes in command');
  flush();
  for (const s of [...segs]) {
    for (const m of s.text.matchAll(/`([^`]*)`/g)) segs.push(...splitSegments(m[1]));
  }
  return segs;
}

/** Tokenise one segment: tokens (quotes removed), output and input redirect targets. */
export function tokenize(seg) {
  const tokens = [];
  const redirects = [];
  const inputs = [];
  let cur = '';
  let has = false;
  let q = null;
  let pending = null;
  const push = () => {
    if (!has) return;
    if (pending === 'out') redirects.push(cur);
    else if (pending === 'in') inputs.push(cur);
    else tokens.push(cur);
    pending = null;
    cur = '';
    has = false;
  };
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (q) {
      if (c === q) q = null;
      else if (c === '\\' && q === '"' && i + 1 < seg.length) cur += seg[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      has = true;
      continue;
    }
    if (c === '\\' && i + 1 < seg.length) {
      cur += seg[++i];
      has = true;
      continue;
    }
    if (/\s/.test(c)) {
      push();
      continue;
    }
    if (c === '&' && seg[i + 1] === '>') continue;
    if (c === '>' || c === '<') {
      if (has && /^\d+$/.test(cur)) {
        cur = '';
        has = false;
      } else push();
      if (c === '<' && seg[i + 1] === '<') {
        // here-document or here-string: the word after it is a delimiter, not a file
        while (seg[i + 1] === '<' || seg[i + 1] === '-') i++;
        pending = 'heredoc';
        continue;
      }
      while (seg[i + 1] === '>' || seg[i + 1] === '|') i++;
      if (seg[i + 1] === '&') {
        const m = /^&([0-9]+|-)(?=\s|$)/.exec(seg.slice(i + 1));
        if (m) {
          i += m[0].length; // fd duplication, not a file
          continue;
        }
        i++;
      }
      pending = c === '>' ? 'out' : 'in';
      continue;
    }
    cur += c;
    has = true;
  }
  if (q) block('unbalanced quotes in command');
  push();
  return { tokens, redirects, inputs };
}

const base = (t) =>
  path
    .basename(t.replace(/\\/g, '/'))
    .toLowerCase()
    .replace(/\.exe$/, '');

/** Strip wrappers (env, sudo, nohup, VAR=…, timeout …) from the front of a token list. */
export function unwrap(tokens) {
  let t = [...tokens];
  for (let guard = 0; guard < 20 && t.length; guard++) {
    const b = base(t[0]);
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0])) {
      if (/^RIPGREP_CONFIG_PATH=/.test(t[0])) block('RIPGREP_CONFIG_PATH can switch off ignore rules');
      t = t.slice(1);
      continue;
    }
    if (b === 'sudo' || b === 'doas' || b === 'su') block(`${b} is not allowed`);
    if (b === 'env') {
      let i = 1;
      while (i < t.length && (t[i].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i]))) {
        if (/^RIPGREP_CONFIG_PATH=/.test(t[i])) block('RIPGREP_CONFIG_PATH can switch off ignore rules');
        if (t[i] === '-u' || t[i] === '-C' || t[i] === '--chdir') i++;
        i++;
      }
      if (i >= t.length) return t; // bare env: an env dump, handled by the caller
      t = t.slice(i);
      continue;
    }
    if (b === 'timeout') {
      let i = 1;
      while (i < t.length && t[i].startsWith('-')) i++;
      t = t.slice(i + 1);
      continue;
    }
    if (b === 'xargs') {
      let i = 1;
      while (i < t.length && t[i].startsWith('-')) {
        if (/^-[IdEsLnP]$/.test(t[i])) i++;
        i++;
      }
      t = t.slice(i);
      continue;
    }
    if (WRAPPERS.has(b)) {
      let i = 1;
      while (i < t.length && t[i].startsWith('-')) i++;
      t = t.slice(i);
      continue;
    }
    break;
  }
  return t;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function realish(p) {
  // Resolve symlinks for the longest existing prefix.
  let cur = p;
  const rest = [];
  for (let i = 0; i < 64; i++) {
    try {
      return path.join(realpathSync(cur), ...rest.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return p;
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
  return p;
}

export function makeCtx(root, cwd) {
  const r = realish(path.resolve(root));
  return { root: r, cwd: realish(path.resolve(cwd || r)), tmp: realish(tmpdir()) };
}

/** Resolve an argument to an absolute path, or null when it can't be resolved. */
export function resolveArg(arg, ctx) {
  let a = arg;
  if (/^\$(TMPDIR|TMP|TEMP)\b|^\$\{(TMPDIR|TMP|TEMP)\}|^\$env:(TEMP|TMP)\b/i.test(a)) {
    a = a.replace(/^\$\{?(?:env:)?(TMPDIR|TMP|TEMP)\}?/i, ctx.tmp);
  } else if (/^\$\{?PWD\}?/.test(a)) {
    a = a.replace(/^\$\{?PWD\}?/, ctx.cwd);
  }
  if (a.startsWith('$') || a.startsWith('~') || a.includes('$(') || a.includes('`')) return null;
  a = a.replace(/\\/g, '/');
  return realish(path.resolve(ctx.cwd, a));
}

const inside = (p, dir) => p === dir || p.startsWith(dir + path.sep);
const rel = (p, ctx) => path.relative(ctx.root, p).split(path.sep).join('/');

export function isOwnerOnly(p, ctx) {
  if (!inside(p, ctx.root)) return false;
  const r = rel(p, ctx);
  return OWNER_ONLY.some((d) => r === d || r.startsWith(d + '/'));
}

export function isGuardrail(p, ctx) {
  if (!inside(p, ctx.root)) return false;
  const r = rel(p, ctx);
  if (r === '') return false;
  return GUARDRAILS.some(
    (g) => r === g || r.startsWith(g + '/') || (g === 'CODEOWNERS' && path.basename(r) === 'CODEOWNERS'),
  );
}

export function isSecretFile(p) {
  const b = path.basename(p).toLowerCase();
  if (b === '.env.example') return false;
  return (
    /^\.env(\..+)?$/.test(b) ||
    b === '.envrc' ||
    /\.(pem|key|p12|pfx|jks|keystore)$/.test(b) ||
    /^id_(rsa|ed25519|ecdsa|dsa)$/.test(b) ||
    /credentials.*\.json$/.test(b) ||
    /service[-_]?account.*\.json$/.test(b) ||
    b === '.netrc' ||
    b === '.pgpass'
  );
}

// ---------------------------------------------------------------------------
// Command rules
// ---------------------------------------------------------------------------

function checkGh(t) {
  const args = t.slice(1).filter((a) => !a.startsWith('-'));
  const [sub, act] = args;
  if (sub === 'api') block('gh api is denied (a read and a write differ only in flags)');
  if (sub === 'pr' && ['merge', 'review'].includes(act)) block(`gh pr ${act} is the owner's action`);
  if (['ruleset', 'secret', 'variable', 'workflow', 'auth', 'ssh-key', 'gpg-key', 'extension', 'alias'].includes(sub))
    block(`gh ${sub} is denied`);
  if (sub === 'repo' && ['edit', 'delete', 'archive', 'rename', 'deploy-key', 'set-default', 'sync'].includes(act))
    block(`gh repo ${act} is denied`);
  if (sub === 'release' && act !== 'view' && act !== 'list') block("gh release changes are the owner's");
}

function checkGitPush(t) {
  const args = t.slice(2);
  for (const a of args) {
    if (
      /^(-f|--force|--force-with-lease.*|--force-if-includes|--mirror|--all|--delete|-d|--prune|--no-verify)$/.test(a)
    )
      block(`git push ${a} is denied`);
    if (/^-[a-zA-Z]*f/.test(a) && !a.startsWith('--')) block('git push -f is denied');
    if (a.startsWith('+')) block('force refspec (+) is denied');
    if (/(^|:)(refs\/heads\/)?(main|master)$/.test(a) || /^(HEAD|[^:]*):(refs\/heads\/)?(main|master)$/.test(a))
      block('pushing to main is denied; open a PR');
    if (/refs\/heads\/(main|master)/.test(a)) block('pushing to main is denied');
  }
}

function checkGit(t, ctx) {
  let i = 1;
  while (i < t.length && t[i].startsWith('-')) {
    if (t[i] === '-c' || t[i].startsWith('--config-env')) block('git -c config overrides are denied');
    if (t[i] === '-C' || t[i] === '--git-dir' || t[i] === '--work-tree') {
      const p = resolveArg(t[i + 1] ?? '', ctx);
      if (p === null) block(`unresolvable git ${t[i]} path`);
      if (isOwnerOnly(p, ctx)) block('owner-only folder is off limits');
      i++;
    }
    i++;
  }
  const sub = t[i];
  const rest = t.slice(i + 1);
  if (sub === 'push') checkGitPush(['git', 'push', ...rest]);
  if (
    sub === 'config' &&
    rest.some((a) => /core\.(hookspath|sshcommand|fsmonitor)|alias\.|credential\./i.test(a)) &&
    !rest.includes('--get')
  )
    block('changing git hooks, aliases or credentials config is denied');
  if (sub === 'grep' && rest.some((a) => a === '--no-index' || a === '--untracked'))
    recursiveSearch(['grep', '-r', ...rest], ctx, true);
  if (['update-ref', 'filter-branch', 'filter-repo', 'replace'].includes(sub)) block(`git ${sub} is denied`);
  if (sub === 'commit' && rest.some((a) => a === '--no-verify' || /^-[a-zA-Z]*n[a-zA-Z]*$/.test(a)))
    block('git commit --no-verify / -n skips the secret scan');
}

function checkSupabase(t) {
  const args = t.slice(1);
  const words = args.filter((a) => !a.startsWith('-'));
  const [a, b] = words;
  if (args.some((x) => /^--(linked|db-url|project-ref)(=|$)/.test(x))) block('hosted database flags are denied');
  if (
    [
      'link',
      'login',
      'logout',
      'secrets',
      'branches',
      'projects',
      'orgs',
      'sso',
      'domains',
      'vanity-subdomains',
      'storage',
      'snippets',
      'postgres-config',
      'network-restrictions',
      'ssl-enforcement',
      'backups',
      'encryption',
    ].includes(a)
  )
    block(`supabase ${a} acts on hosted projects (owner only)`);
  if (a === 'db' && ['push', 'pull', 'dump', 'remote'].includes(b))
    block(`supabase db ${b} touches the hosted database`);
  if (a === 'migration' && ['list', 'repair', 'fetch', 'up'].includes(b))
    block(`supabase migration ${b} touches the hosted database`);
  if (a === 'functions' && ['deploy', 'delete', 'download'].includes(b)) block(`supabase functions ${b} is hosted`);
  if (a === 'inspect') block('supabase inspect targets hosted databases');
}

function checkPsql(t) {
  const joined = t.join(' ');
  if (/supabase\.(co|com)|pooler\.supabase|\.supabase\.net|render\.com|fly\.dev|flycast/i.test(joined))
    block('psql to a hosted database is denied');
}

/** Does a directory tree contain a symlink that resolves into an owner-only folder? Bounded walk. */
function linksIntoOwnerOnly(dir, ctx) {
  const skip = new Set(['node_modules', '.git', '.next', '.turbo', '.venv', 'dist']);
  let budget = 5000;
  const walk = (d, depth) => {
    if (depth > 6 || budget <= 0) return false;
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const e of entries) {
      if (--budget <= 0) return false;
      const full = path.join(d, e.name);
      if (e.isSymbolicLink()) {
        if (isOwnerOnly(realish(full), ctx)) return true;
      } else if (e.isDirectory() && !skip.has(e.name)) {
        if (walk(full, depth + 1)) return true;
      }
    }
    return false;
  };
  return walk(dir, 0);
}

function recursiveSearch(t, ctx, forced = false) {
  const b = base(t[0]);
  let recursive = forced || b === 'rgrep';
  const roots = [];
  for (let i = 1; i < t.length; i++) {
    const a = t[i];
    if (b === 'grep' || b === 'egrep' || b === 'fgrep') {
      if (/^-[A-Za-z]*[rR]/.test(a) && !a.startsWith('--')) recursive = true;
      if (/^--recu/.test(a)) recursive = true;
      if ((a === '-d' || a === '--directories') && /^recurse$/.test(t[i + 1] ?? '')) recursive = true;
      if (/^--directories=recurse$/.test(a)) recursive = true;
    }
    if (b === 'rg') {
      if (/^-[A-Za-z]*u/.test(a) && !a.startsWith('--')) recursive = true;
      if (/^--(no-ignore|unrestricted|hidden)/.test(a)) recursive = true;
      if (/^--(ignore-file|no-config)/.test(a)) recursive = true;
    }
    if (!a.startsWith('-')) roots.push(a);
  }
  if (!recursive) return;
  // first non-flag is usually the pattern for grep; check every candidate root to be safe
  const candidates = roots.length > 1 ? roots.slice(1) : [];
  if (candidates.length === 0) candidates.push('.');
  for (const r of candidates) {
    const p = resolveArg(r, ctx);
    if (p === null) block(`unresolvable search root ${r}`);
    if (isOwnerOnly(p, ctx) || OWNER_ONLY.some((d) => inside(path.join(ctx.root, d), p)) || linksIntoOwnerOnly(p, ctx))
      block('recursive search that reaches an owner-only folder (use plain rg or git grep, which honour .gitignore)');
  }
}

function checkPaths(t, redirects, inputs, ctx) {
  const b = base(t[0]);
  const gitWrite =
    b === 'git' && ['checkout', 'restore', 'rm', 'mv', 'apply', 'am', 'stash', 'reset', 'clean'].includes(t[1]);
  const isWrite =
    WRITE_VERBS.has(b) ||
    gitWrite ||
    (b === 'sed' && t.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'))) ||
    (b === 'perl' && t.some((a) => /^-[a-zA-Z]*i/.test(a)));

  for (const target of redirects) {
    if (['/dev/null', '/dev/stderr', '/dev/stdout', '/dev/tty'].includes(target)) continue;
    const p = resolveArg(target, ctx);
    if (p === null) block(`unresolvable redirect target ${target}`);
    if (isGuardrail(p, ctx)) block(`writing to a guardrail file (${rel(p, ctx)}) is denied; propose a patch`);
    if (isOwnerOnly(p, ctx)) block('writing into an owner-only folder is denied');
    if (isSecretFile(p)) block('writing an env/secret file is denied');
  }
  for (const src of inputs) {
    const p = resolveArg(src, ctx);
    if (p === null) block(`unresolvable input redirect ${src}`);
    if (isOwnerOnly(p, ctx)) block('owner-only folder is off limits');
    if (isSecretFile(p)) block(`env/secret files are off limits (${path.basename(p)})`);
  }

  const args = [];
  for (const a of t.slice(1)) {
    if (a.startsWith('-')) {
      const eq = a.indexOf('=');
      if (eq > 0) args.push(a.slice(eq + 1));
      continue;
    }
    args.push(a.replace(/^(of|if)=/, ''));
  }
  const pathArgs = args.filter((a) => a !== '');
  for (const a of pathArgs) {
    const p = resolveArg(a, ctx);
    if (p === null) {
      if (isWrite || DELETE_VERBS.has(b)) block(`unresolvable path argument ${a} for ${b}`);
      continue;
    }
    if (isOwnerOnly(p, ctx)) block('owner-only folder is off limits');
    if (isSecretFile(p) && !(b === 'git' && t[1] === 'check-ignore'))
      block(`env/secret files are off limits (${path.basename(p)})`);
    if (isWrite && isGuardrail(p, ctx)) {
      // cp/install read their sources; only the destination matters
      if ((b === 'cp' || b === 'install' || b === 'copy-item' || b === 'rsync') && a !== pathArgs[pathArgs.length - 1])
        continue;
      block(`modifying a guardrail path (${rel(p, ctx)}) is denied; propose a patch`);
    }
    if (DELETE_VERBS.has(b)) {
      if (!inside(p, ctx.root) && !inside(p, ctx.tmp)) block(`deleting outside the repo and temp (${p}) is denied`);
      if (p === ctx.root || inside(p, path.join(ctx.root, '.git'))) block('deleting the repository or .git is denied');
    }
  }
  if (b === 'find' && t.some((a) => ['-delete', '-exec', '-execdir', '-ok', '-okdir'].includes(a))) {
    const root = t[1] && !t[1].startsWith('-') ? t[1] : '.';
    const p = resolveArg(root, ctx);
    if (p === null || (!inside(p, ctx.root) && !inside(p, ctx.tmp)))
      block('find -delete/-exec outside the repo and temp is denied');
    if (inside(p, path.join(ctx.root, '.git')) && t.includes('-delete')) block('find -delete inside .git is denied');
    const i = t.findIndex((a) => ['-exec', '-execdir', '-ok', '-okdir'].includes(a));
    if (i > 0) {
      const inner = t.slice(i + 1).filter((a) => ![';', '\\;', '+', '{}'].includes(a));
      if (inner.length) checkTokens(inner, [], [], [], ctx, 1);
    }
  }
}

function checkTokens(rawTokens, redirects, inputs, heredocs, ctx, depth) {
  if (depth > 5) block('command nesting too deep');
  if (rawTokens.some((a) => /RIPGREP_CONFIG_PATH/.test(a))) block('RIPGREP_CONFIG_PATH can switch off ignore rules');
  const t = unwrap(rawTokens);
  if (t.length === 0) return;
  const b = base(t[0]);

  if (b === 'cd' || b === 'pushd' || b === 'set-location' || b === 'chdir' || b === 'sl') {
    const dest = t[1] ?? ctx.root;
    const p = resolveArg(dest === '-' ? ctx.cwd : dest, ctx);
    if (p === null) block(`unresolvable cd target ${dest}`);
    if (isOwnerOnly(p, ctx)) block('cd into an owner-only folder is denied');
    ctx.cwd = p;
    return;
  }

  // interpreters that take a command string
  if (SHELLS.has(b)) {
    const i = t.findIndex((a, k) => k > 0 && /^-[a-zA-Z]*c$/.test(a));
    if (i > 0) {
      if (t[i + 1] === undefined) block('shell -c without a command');
      return checkCommand(t[i + 1], ctx, depth + 1);
    }
    // `bash <<EOF … EOF` — the here-document is the script
    for (const hd of heredocs) checkCommand(hd.body, ctx, depth + 1);
    // `bash script.sh` — the script runs unseen; allow only scripts inside the repo
    const script = t.slice(1).find((a) => !a.startsWith('-'));
    if (script) {
      const p = resolveArg(script, ctx);
      if (p === null || !inside(p, ctx.root)) block(`running a script from outside the repo (${script}) is denied`);
      if (isOwnerOnly(p, ctx)) block('owner-only folder is off limits');
    }
    return;
  }
  if (PWSH.has(b)) {
    const i = t.findIndex((a) => /^-(c|command|encodedcommand|ec|e)$/i.test(a));
    if (i > 0 && /^-(encodedcommand|ec|e)$/i.test(t[i])) block('encoded PowerShell commands are denied');
    if (i > 0) return checkCommand(t.slice(i + 1).join(' '), ctx, depth + 1);
    return;
  }
  if (b === 'eval') return checkCommand(t.slice(1).join(' '), ctx, depth + 1);
  if (b === 'source' || b === '.') {
    const p = t[1] ? resolveArg(t[1], ctx) : null;
    if (p === null || isSecretFile(p)) block('sourcing env/secret files is denied');
  }

  if (
    ENV_DUMPERS.has(b) &&
    (t.length === 1 ||
      (b === 'export' && t[1] === '-p') ||
      (b === 'declare' && /^-[a-z]*x/.test(t[1] ?? '')) ||
      (b === 'get-childitem' && /^env:/i.test(t[1] ?? '')))
  )
    block('dumping the environment can reveal secrets');

  if (b === 'gh') checkGh(t);
  if (b === 'git') checkGit(t, ctx);
  if (
    b === 'supabase' ||
    (b === 'npx' && base(t[1] ?? '') === 'supabase') ||
    (b === 'pnpm' && t[1] === 'dlx' && base(t[2] ?? '') === 'supabase')
  )
    checkSupabase(b === 'supabase' ? t : t.slice(b === 'npx' ? 1 : 2));
  if (b === 'psql' || b === 'pg_dump' || b === 'pg_restore' || b === 'pgcli') checkPsql(t);
  if (
    HOSTING_CLIS.has(b) ||
    ((b === 'npx' || b === 'pnpm' || b === 'yarn') && t.some((a) => HOSTING_CLIS.has(base(a))))
  )
    block('hosting CLIs act on hosted systems (owner only)');
  if (b === 'curl' || b === 'wget') {
    if (
      t.some((a) =>
        /api\.github\.com\/repos\/[^ ]+\/(merges|pulls\/\d+\/(merge|reviews))|\/rulesets|\/branches\/[^/]+\/protection/i.test(
          a,
        ),
      )
    )
      block("GitHub merge/review/ruleset endpoints are the owner's");
    if (
      t.some((a) =>
        /supabase\.co\/(rest|auth|storage)\/|api\.supabase\.com|api\.vercel\.com|api\.fly\.io|api\.render\.com/i.test(
          a,
        ),
      )
    )
      block("calling hosted platform APIs is the owner's");
  }
  if (b === 'grep' || b === 'egrep' || b === 'fgrep' || b === 'rgrep' || b === 'rg') recursiveSearch(t, ctx);
  checkPaths(t, redirects, inputs, ctx);
}

export function checkCommand(cmd, ctx, depth = 0) {
  if (depth > 5) block('command nesting too deep');
  for (const seg of splitSegments(cmd)) {
    const { tokens, redirects, inputs } = tokenize(seg.text);
    checkTokens(tokens, redirects, inputs, seg.heredocs, ctx, depth);
  }
}

// ---------------------------------------------------------------------------
// Tool rules
// ---------------------------------------------------------------------------

const READ_TOOLS = new Set(['Read', 'NotebookRead']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const SEARCH_TOOLS = new Set(['Grep', 'Glob', 'LS']);

function checkMcp(name, input) {
  const tool = name.split('__').slice(2).join('__').toLowerCase();
  const server = (name.split('__')[1] ?? '').toLowerCase();
  if (
    /(^|_)(merge|approve|enable_auto_merge|auto_merge)(_|$)|merge_pull_request|create_pull_request_review|submit_review/.test(
      tool,
    )
  )
    block(`MCP ${tool}: merging and approving are the owner's`);
  if (/^(push_files|create_or_update_file|delete_file|create_branch_protection|update_ref)$/.test(tool)) {
    const branch = input?.branch ?? input?.ref ?? '';
    if (!branch || /^(refs\/heads\/)?(main|master)$/.test(branch))
      block(`MCP ${tool} without a feature branch writes to main`);
  }
  if (server.includes('supabase') && !/^(search_docs)$/.test(tool)) block("hosted database MCP tools are the owner's");
  if (
    input &&
    typeof input === 'object' &&
    'project_id' in input &&
    /^(get_project|execute_sql|apply_migration)$/.test(tool)
  )
    block("hosted database MCP tools are the owner's");
  // Hosting, flags and data vendors: read-only tools only.
  if (
    /(vercel|render|fly|posthog|sentry|cloudflare)/.test(server) &&
    !/^(get|list|search|read|count|aggregate|query|filter|web_fetch)/.test(tool)
  )
    block(`MCP ${tool}: changes to hosted systems are the owner's`);
}

export function evaluate(payload, root) {
  if (!payload || typeof payload !== 'object') block('unreadable hook payload');
  const name = payload.tool_name;
  const input = payload.tool_input ?? {};
  if (typeof name !== 'string' || !name) block('missing tool name');
  const ctx = makeCtx(root, payload.cwd);

  if (name === 'Bash' || name === 'PowerShell') return checkCommand(input.command, ctx);

  if (READ_TOOLS.has(name) || WRITE_TOOLS.has(name)) {
    const f = input.file_path ?? input.notebook_path ?? input.path;
    if (typeof f !== 'string') block(`${name} without a path`);
    const p = resolveArg(f, ctx);
    if (p === null) block(`unresolvable path ${f}`);
    if (isOwnerOnly(p, ctx)) block('owner-only folder is off limits');
    if (isSecretFile(p)) block(`env/secret files are off limits (${path.basename(p)})`);
    if (WRITE_TOOLS.has(name) && isGuardrail(p, ctx))
      block(`editing a guardrail file (${rel(p, ctx)}) is denied; propose a patch`);
    return;
  }
  if (SEARCH_TOOLS.has(name)) {
    const f = input.path ?? '.';
    const p = resolveArg(f, ctx);
    if (p === null) block(`unresolvable path ${f}`);
    if (isOwnerOnly(p, ctx)) block('owner-only folder is off limits');
    for (const g of [input.glob, input.pattern]) {
      if (name !== 'Grep' || g === input.glob)
        if (typeof g === 'string' && /(^|\/)\.env([.*]|$)|\.(pem|key)$|id_rsa/.test(g) && !/example/.test(g))
          block('searching env/secret files is denied');
    }
    return;
  }
  if (name.startsWith('mcp__')) return checkMcp(name, input);
  // Other tools (WebFetch, WebSearch, Task, TodoWrite, …) carry no path or command.
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  try {
    const payload = JSON.parse(readFileSync(0, 'utf8'));
    const root = process.env.CLAUDE_PROJECT_DIR || path.resolve(HERE, '..', '..');
    evaluate(payload, root);
    process.exit(0);
  } catch (e) {
    const msg = e instanceof Block ? e.message : `guard failed closed: ${e?.name ?? 'error'}`;
    process.stderr.write(`BLOCKED by .claude/hooks/guard.mjs: ${msg}\n`);
    process.exit(2);
  }
}

if (process.argv[1] && realish(path.resolve(process.argv[1])) === realish(fileURLToPath(import.meta.url))) main();
