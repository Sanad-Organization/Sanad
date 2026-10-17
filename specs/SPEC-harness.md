# SPEC — HARNESS (day 0)

**Goal:** a repository where the merge wall, the guard hook and the database gates work before any feature
code exists (priority 1: never traded).

**Scope:** root configs (pnpm, turbo, tsconfig, eslint, prettier, .gitattributes, .gitignore,
.env.example, .nvmrc); `.claude/` (settings, guard hook + tests, secret scan, 4 subagents);
`.githooks/pre-commit`; `.github/` (CI workflow with jobs `verify`, `isolation`, `secrets`, `guard (ubuntu-24.04)`, `guard (macos-15)`; CODEOWNERS;
PR template); `pnpm gate`.
**Non-scope:** any app code; preview deploys (come with APP-SHELL); the agent loop workflow.

**Surfaces:** repository only. **Data:** none. **Flag:** none.

**Acceptance criteria**
- `pnpm gate` runs lint, typecheck, unit tests, format check, guard tests, secret scan and (when
  `supabase/` changed) `scripts/db-test.sh` + `scripts/db-canaries.sh`; all green on the starter repo.
- `node --test .claude/hooks/guard.test.mjs` passes, including fail-closed cases (unparseable input,
  unknown tool → allow only if read-only).
- CI runs the same checks on every PR; GitHub Actions pinned by commit SHA.
- Owner tasks done: repository created per ADR 0007, ruleset on `main` (required checks `verify`, `isolation`,
  `secrets`, `guard (…)`; squash only; no bypass; CODEOWNERS review for `.claude/`, `.github/`,
  `supabase/`, `packages/types/`, `docs/adr/`).

**Slices:** one PR (the starter repo). **Estimate:** done by the agent 2026-10-13; owner setup ~1 h.
