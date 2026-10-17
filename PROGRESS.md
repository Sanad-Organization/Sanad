# Sanad — Build Progress

> **Living document.** `CLAUDE.md` holds permanent standards; this file changes every session. Read at
> start; at every stop: add a dated entry, refresh Status, append Decisions / Known Issues, rewrite Next
> Session precisely. Write it as if a customer will read it: no credentials, no infrastructure
> identifiers, no real company, founder or fund names.

**Last updated:** 2026-10-17 (evening)
**Latest (2026-10-17, app shell + worker core):** Two PRs are ready for review, each on its own branch
against `main`. `feat/app-shell` (APP-SHELL slice 1) adds the web app with email-link and Google sign-in,
fund switcher, flag-gated `/deals`, server-side flags that fail closed, JSON logs with a trace id, server-only
Sentry and `/api/health`. `feat/worker-core` (WORKER-CORE slice 1) adds the Python worker: job store, handler
registry, deadlines and heartbeats, kill switch, ops sweep and reconcile. Both passed the gate and an
adversarial review whose blocking findings are fixed. The Vercel project exists (Frankfurt, previews behind
Vercel login, environment set) but is not yet connected to the repository: the Vercel GitHub app must be
installed on the organisation first. The PostHog project has the eight flags, all off.
**Earlier (2026-10-17, database live):** The hosted Supabase project `sanad` (owner's organisation,
Frankfurt) has all five migrations; the last three went through the `migrate` workflow with the owner's
approval. The live schema matches the tested local schema: constraints, policies, table grants and
function permissions are identical; all functions except one match exactly (the pgvector search function
and index print without the `extensions.` prefix on Supabase, a cosmetic difference). CI is green on `main`
after the macOS guard fix (#1).
**Earlier (2026-10-17, published):** The starter is pushed to the public repository as one fresh commit
(owner chose public, ADR 0007). The confidential plan, brief and engineering contract are kept out of git
in `docs/private/`. The database is not yet applied to a hosted project: the Supabase connection needs the
owner to re-authorise it, and the Sanad project must be created in the owner's own organisation.
**Earlier (2026-10-13, starter repo):** The plan was rebuilt to the engineering bootstrap. The database is
rewritten as five timestamped migrations with read-only RLS, nine user RPCs and a lease-based job queue.
Composite fund keys and append-only guards are in place, plus one SQL test per migration, a catalogue sweep
and 16 canaries. All are green on Postgres 16 + pgvector. CLAUDE.md, BACKLOG, nine ADRs, 15 specs, the
runbooks and the agent harness (guard hook + tests, subagents, CI) are written. Nothing is pushed: the
repository doesn't exist yet (owner, day 0).

## THE PLAN (the only one)

Build the Sanad MVP defined in `docs/private/Sanad-Architecture-Plan.pdf` §12–14 in two weeks after day 0, under
the engineering contract `docs/private/engineering-bootstrap.md`. The queue is `BACKLOG.md`: database first, then
app shell and worker in parallel, then collection, GitHub access and the scan sandbox, social collection
and analysis, claims, scoring, deal room, agent, and pilot hardening.

## Status

| Track | Status | Notes |
| --- | --- | --- |
| HARNESS | ✅ Done | On main; CI green; ruleset, CODEOWNERS and production environment set (owner, 2026-10-17) |
| DB-SPINE | ✅ Done | Live on the hosted project; schema verified against the local test database |
| APP-SHELL | 🔄 Slice 1 in review | `feat/app-shell`; slice 2 (deals list, new deal) after merge |
| WORKER-CORE | 🔄 Slice 1 in review | `feat/worker-core`; slice 2 (ingress skeleton, Render crons) after merge |
| Day-0 accounts | ⏳ Partly done | Vercel project and PostHog flags created; rest per `docs/runbooks/day0-accounts.md` |
| Everything else | ⏳ Queued | See BACKLOG |

## What Was Built Last Session

- `supabase/migrations/20261013090000…090400`: tenancy (`app_auth`, funds, memberships, staff, audit_log),
  jobs queue (`app_jobs`), deals and evidence, repo scans, social.
- `supabase/tests/`: one test per migration, `zz_catalogue_sweep.test.sql`, `support/local_stub.sql`
  (Supabase-like roles and default grants on plain Postgres) and `support/fixtures.sql` (synthetic funds A and B).
- `scripts/db-test.sh` and `scripts/db-canaries.sh`. **Verified:** `db-test.sh` → 6/6 test files ok;
  `db-canaries.sh` → 16/16 caught. After restoring, all tests pass again.
- Docs: `CLAUDE.md`, `BACKLOG.md`, `docs/adr/0001–0009`, `specs/` (15), `docs/runbooks/` (7).
- Harness: see the HARNESS spec; guard tests run with `node --test`.

## Decisions Made (must be remembered)

- **Product scope:** all software startups; MENA + Africa; annual fund licence including deals, plus
  pay-per-deal; founder self-assessment only when the fund allows it (owner, 2026-10-12).
- **MVP:** GitHub scan + social overview; fund-wide comparison right after; competitors in phase 2 (owner, 2026-10-13).
- **Scanning:** from Sanad on GitHub's default branch with full history; no founder-run scanner (owner, 2026-10-13).
- **Build target:** 2 weeks with Claude Code (owner, 2026-10-13).
- **Engineering contract:** the owner's engineering bootstrap governs (owner, 2026-10-13).
- **Tenant = fund; staff see no fund data** (ADR 0002, agent under the bootstrap; owner to confirm).
- **Queue in Postgres** replaces Supabase Queues (ADR 0006).
- **Ingress service** takes the GitHub webhook and scan results so the web app holds no service key (ADR 0009).
- **Pilot membership** is added by staff (runbook); self-serve invites are `TEAM-INVITES`.
- **Repository is public;** confidential docs live in git-ignored `docs/private/` (owner, 2026-10-17; ADR 0007).
- **Sign-ups are closed.** Sign-in never creates an account; staff create members (runbook add-fund).
  Personal data moves up a tier, so this follows the security review rather than the earlier
  "sign in once" runbook (agent, Tier A from CLAUDE.md; 2026-10-17).
- **Magic links use token_hash** (`/auth/confirm`) so they work in any browser; needs the email template
  in `docs/runbooks/web-hosting.md`.
- **Flags evaluate per fund** with distinct id = fund id; `worker-kill` uses the fixed id `sanad-worker`.
  The PostHog project is US-hosted; only those ids are sent.
- **Hosted database:** a new Supabase project in the owner's own organisation, Frankfurt, separate from
  any other product's project (owner, 2026-10-17).

## Known Issues / TODOs

### Waiting on owner

- **DECISION NEEDED · BACKLOG · 2-week line.** The harness and gates add roughly 1.5 days. Options:
  A) keep 2 weeks and move VERDICT-PDF and half of PILOT-HARDEN to week 3 (recommended);
  B) 12 working days for everything.
- **HUMAN ONLY:** founder data agreement text; legal review of the social data rules (ADR 0004).
- **HUMAN ONLY:** day-0 accounts (`docs/runbooks/day0-accounts.md`).
- Confirm ADR 0002 (staff see no fund data) and ADR 0005 (untrusted content, erasure).

### Carried

- **Deferred from APP-SHELL slice 1:** the two-user Playwright isolation test, axe and Lighthouse. They
  need a seeded test Supabase project with Auth (DECISION NEEDED, Tier B: a separate "sanad-test" project
  vs Supabase branching). Fund selection and the switcher's refusal are unit-tested; RLS isolation is
  covered by the SQL tests.
- **CSP header** before the first real tenant (bootstrap §18.4).
- **Rate limiting / bot check on the sign-in action** (bootstrap §18.4); Supabase's limits apply meanwhile.
- **Worker CI job:** `.github` changes are owner-applied; the patch adding the `worker` job (ruff, pytest,
  DB integration test) is in the PR description of `feat/worker-core`.
- **SQL follow-up (DB-only PR):** `jobs_claim` appends " | lease expired" to `last_error` without
  truncating, so a 2000-character error would break the CHECK and stop every claim. Fix with
  `left(…, 2000)` in a new migration (with DB-FK-INDEXES if queued together).
- Sentry does not see job failures (they are handled); decide whether permanent failures should raise an
  event.

- **Advisor results (2026-10-17), accepted:** security WARN ×9 = the nine reviewed user RPCs (by design,
  ADR 0002); INFO ×2 = `app_jobs` tables with RLS and no policies (by design, ADR 0006).
- **Advisor follow-up:** 30 composite foreign keys have no covering index (INFO). Add the indexes in one
  migration before real data volume (proposed backlog item DB-FK-INDEXES; owner to queue).

- Whether any pilot fund needs in-region storage (not Frankfurt).
- Bright Data and X cost per deal: measure in week 1.
- Storage bucket policies arrive with COLLECT-WEB (own migration, tests, canary).

## Next Session — Start Here

The starter is on `main` of the public repository. The database spine shipped in that commit, so there is
no separate DB-SPINE PR.

### 0. First thing next session

1. Owner: open and merge the PRs for `feat/app-shell` and `feat/worker-core` (CI must be green).
2. Owner: the hosted steps in `docs/runbooks/web-hosting.md` (Vercel ↔ GitHub, Supabase Auth: sign-ups
   off, redirect URLs, magic-link template), then create your own member account (`add-fund.md`).
3. Agent: APP-SHELL slice 2 (deals list, `/deals/new` → `create_deal`), then WORKER-CORE slice 2 (ingress
   skeleton, Render crons), each from fresh `main`.
4. Owner: remaining day-0 accounts (Render, Fly, GitHub App, X, Bright Data, model keys, Sentry).
