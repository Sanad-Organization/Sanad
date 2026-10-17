# Sanad — Build Progress

> **Living document.** `CLAUDE.md` holds permanent standards; this file changes every session. Read at
> start; at every stop: add a dated entry, refresh Status, append Decisions / Known Issues, rewrite Next
> Session precisely. Write it as if a customer will read it: no credentials, no infrastructure
> identifiers, no real company, founder or fund names.

**Last updated:** 2026-10-17
**Latest (2026-10-17, published):** The starter is pushed to the public repository as one fresh commit
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
| HARNESS | 🟡 In progress | Pushed to main 2026-10-17; waiting on CODEOWNERS handle, ruleset, first green CI (owner) |
| DB-SPINE | 🟡 In progress | On main (in the starter commit); green locally; not yet applied to a hosted project |
| Day-0 accounts | ⏳ Held | Owner: `docs/runbooks/day0-accounts.md` |
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

- Whether any pilot fund needs in-region storage (not Frankfurt).
- Bright Data and X cost per deal: measure in week 1.
- Storage bucket policies arrive with COLLECT-WEB (own migration, tests, canary).

## Next Session — Start Here

The starter is on `main` of the public repository. The database spine shipped in that commit, so there is
no separate DB-SPINE PR.

### 0. First thing next session

1. Owner: CODEOWNERS handle, ruleset on `main`, Supabase project + `production` environment secrets
   (`day0-accounts.md`). Copy the three confidential docs into `docs/private/`.
2. Agent: confirm CI is green on `main`; apply the migrations to the hosted project only through the
   `migrate` workflow (owner approves the run); run the catalogue sweep queries read-only against it and
   record the advisor results here. Then mark HARNESS and DB-SPINE done.
3. Agent: APP-SHELL and WORKER-CORE as separate PRs against `main`.
