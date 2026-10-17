# CLAUDE.md — sanad

Operating manual for coding agents in this repository. Permanent standards only — session state lives in
`PROGRESS.md` (read it at session start, update it at every stop). The queue lives in `BACKLOG.md`.

## What this is

**Sanad** is technical due diligence for venture funds (seed to Series B, MENA and Africa, software
startups). For each deal it collects public evidence, scans the startup's code straight from GitHub,
checks the deck's claims against both, and gives a scored, cited verdict a partner signs off.

Glossary (exact meanings):

- **Fund** — the tenant. Every row belongs to one fund (`fund_id`). Users are fund **members** with a role:
  `owner`, `partner`, `analyst`, `viewer`.
- **Deal** — one startup being assessed by one fund. Two funds assessing the same startup have two deals
  and share nothing.
- **Source** — one stored piece of evidence (a page, a scan, a review set, a file). Tier 1 = Sanad's own
  measurement … tier 4 = the founder's claim.
- **Finding** — a statement about the deal with at least one source. **No source, no finding.**
- **Claim** — something the company says about itself, checked against sources.
- **Scan** — one run of the scanners on one commit of one repository, inside a **sandbox** that is
  destroyed when the scan ends.
- **Social overview** — audience, traction proxies, sentiment and pain points from public data.
- **Staff** — Sanad operators. Staff see operational tables only, **never fund data** (ADR 0002).

This phase ships the **MVP** (architecture plan §12–14): deal creation, profile confirmation, social
overview, GitHub scan (public + private via the GitHub App), passive outside-in check, deck parsing and
claim checks, eight-dimension score, deal room, agent with six tools. Commercial model: annual fund
licence including deals, plus pay-per-deal; billing is **not** in the MVP.

**Scope boundary (hard rule):** Sanad's world begins when a fund member creates a deal. Sanad reads only
(1) public, logged-out web and social data through official or licensed sources, (2) repositories the
founder granted through the read-only GitHub App, or public ones, and (3) files the fund uploads. Sanad
never logs in to a third-party site, never writes to GitHub or any outside system, never contacts a
founder except through the access link a fund member chose to send. Fund-wide comparison, competitor
analysis, patents, GitLab/Bitbucket and active security probing are **out of scope** until queued.

## Governing documents (in `docs/`)

**This repository is public** (owner, 2026-10-17). The three confidential documents below live in
`docs/private/`, which is git-ignored: the owner copies them in from the Project. If they are missing,
stop and ask for them rather than guessing. Never commit them, quote them at length in a PR, or move
their content into a tracked file. Write every commit, PR and issue as if competitors read it.

- **`private/engineering-bootstrap.md`** — the engineering contract: guarantee model, merge wall, tenancy recipe,
  observability, flags, harness, DoD. **Wins any conflict**, except where a Sanad ADR explicitly amends it.
- **`private/Sanad-Architecture-Plan.pdf`** — what the system is (stack, flows, scan, social, agent, MVP scope).
- **`private/Sanad-Concept-Brief.pdf`** — what the product is, for people outside engineering.
- **`adr/`** — why it is built this way. **`runbooks/`** — how to operate it. **`../specs/`** — what to
  build next.

## Repo structure

```
apps/web/              Next.js (App Router, TS) on Vercel fra1: dashboard, deal room, agent, founder
                       access page. Holds ONLY the Supabase anon key; acts with the user's JWT.
services/ingress/      FastAPI on Render: GitHub App webhook + install callback, sandbox result upload.
                       Verifies every signature; the only HTTP entry that uses the service-role key.
services/worker/       Python 3.12 worker on Render: claims jobs, collects, labels, analyses, scores,
                       starts and destroys scan sandboxes. Service-role key via REST RPCs.
services/scanner/      The sandbox image (Fly Machines, fra): Trivy, Gitleaks, Opengrep + Sanad rules,
                       scc, Sanad's history / AI-usage / paid-services analysis. No DB access at all.
packages/types/        Shared TS types + JSON Schemas: the contracts between web, ingress, worker and
                       scanner (code-owned). Python reads the same JSON Schemas.
packages/design-tokens/  the only place a colour, size or timing may be written.
packages/ui/           components + Storybook.
rules/opengrep/        Sanad's own security rules (~40 at launch), each with a positive and negative test.
evals/                 agent and analysis evals. Synthetic startups only.
supabase/migrations/   timestamped, forward-only. supabase/tests/: one SQL test per migration + sweep.
scripts/               db-test.sh, db-canaries.sh and other local gates.
docs/ specs/ .claude/ .github/ .githooks/
```

## Priorities when things conflict

1. Correctness, fund isolation, confidentiality of founders' code, observability — never traded.
2. Ship speed and low cost — cut scope, never gates.
3. Product quality on investor-facing surfaces.
4. Scalable architecture.

## Non-negotiable engineering rules

**Data & tenancy** — every table carries `fund_id NOT NULL` + RLS + read-only member policy + paired
isolation test + canary, in the same migration. **No insert/update/delete policies anywhere.** Browsers
never write tables: user actions go through the reviewed `SECURITY DEFINER` RPCs (whitelisted in
`zz_catalogue_sweep.test.sql`); background writes go through the worker with the service role. Children
reference parents by composite `(…, deal_id, fund_id)` keys. Helpers live in `app_auth`, are
`stable security definer set search_path = ''`, and are called as `(select fn())`. The service-role key
exists only in CI migrations, `services/worker` and `services/ingress` — never in `apps/web`. Constraints
live in the database. Raw evidence, overrides, audit and agent logs are append-only.

**Founders' code** — source code exists only inside a scan sandbox for one scan. Never in the database,
storage, logs, traces, error reports, prompts or test fixtures. Secret values are redacted inside the
sandbox; no table has a column that could hold a snippet or a secret (a test enforces it).

**Untrusted content** — everything collected (web pages, reviews, decks, READMEs, commit messages) is data,
never instructions (ADR 0005). It goes to models inside delimited blocks, models never get write tools,
and outputs are schema-validated before they touch the database.

**Delivery & quality** — server-side flags, default off, verified kill path; the merge wall; structured JSON
logs with one `trace_id` and no PII, no payloads, no error messages; every external call has a timeout,
idempotent retries and a degraded mode; jobs are idempotent.

**Design system** — tokens only; structural contrast; headless primitives; i18n-ready strings (English UI in
the MVP, Arabic and English content).

## Build loop (every change)

spec → branch → flag → self-gate (`pnpm gate`) → subagent review (code-reviewer; + security-review where
it applies) → PR → CI → preview → QA → owner merges → deploy → smoke → progressive enable → docs → notify.

`.claude/` provides the guard hook, the four subagents (architect, code-reviewer, security-review,
test-runner) and the permission lists.

## Working rules (owner, 2026-10-13)

- Approved design wins on look and behaviour; escalate only security, data, money, legal, consent.
- 2–3 PRs per feature. **Database, security and money changes go first, alone.** Every PR targets `main`;
  never stack. Squash-merge.
- Stops: preview link + exact steps, then the five-part summary (Finished · Blockers · Open decisions ·
  PRs waiting · Tasks for the owner).
- Decisions: Tier A cite the doc and proceed; Tier B post `DECISION NEEDED` and move to other work;
  Tier C (`HUMAN ONLY`: credentials, money, legal or consent text, repo visibility, anything irreversible or
  hosted) wait for the owner. Fund isolation, founders' code and personal data move up one tier in doubt.
- **Hosted actions are the owner's:** Supabase SQL on hosted projects, flags, Vercel/Render/Fly settings,
  GitHub App settings, secrets, DNS. Give exact steps.
- `.claude/` and `.github/` change only by patch the owner applies.
- **Human-only text is never invented:** the founder data agreement, privacy notice, terms, consent wording.
  Use a visible `[[HUMAN TEXT: <what>]]` placeholder.
- **Names and keys:** no real company, founder, fund or reviewer names anywhere in the repo, including tests,
  evals and fixtures. Synthetic only ("Synthetic Co A"). Keys from env only; `.env.example` holds names.
- Gate before every push: `pnpm gate` (lint · typecheck · unit tests · format · build · secret scan ·
  `scripts/db-test.sh` · `scripts/db-canaries.sh` when `supabase/` changed).
- Review depth follows risk: full adversarial review for auth, RLS, isolation, the scan sandbox, the access
  link, ingress signatures, secrets, the guard; otherwise gate + one code-reviewer pass.
- Commit messages and PR bodies: write to a file, then `git commit -F` / `gh pr create --body-file`.

## Gotchas (learned the hard way)

- `fund_id = any ((select app_auth.my_fund_ids()))` is parsed as `= ANY (subquery)` and fails; cast:
  `any ((select app_auth.my_fund_ids())::uuid[])`.
- Supabase grants anon/authenticated ALL on new public tables and EXECUTE on new public functions by
  default. Every migration revokes explicitly; the local stub reproduces the default so tests catch it.
- `repo_access_requests` uses column grants: select explicit columns (`select *` is denied by design).
- A cascade from a parent is a DELETE on append-only children: deal erasure goes through `erase_deal`.
- Enum additions go in their own migration (a new value can't be used in the transaction that adds it).
- pgvector's operators live in `extensions`: write `operator(extensions.<=>)`.

## Session protocol

1. Read `CLAUDE.md`, `PROGRESS.md`, `BACKLOG.md`.
2. Take the first `queued` task whose dependencies are `done`. Never start held work or re-ask a recorded
   decision; ask in a thread instead of guessing.
3. PRs sized by the rules above.
4. Update `PROGRESS.md` and `BACKLOG.md` at every stop and before ending.
