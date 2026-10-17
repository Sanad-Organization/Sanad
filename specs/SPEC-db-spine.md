# SPEC — DB-SPINE

**Goal:** the whole MVP schema with fund isolation proven, before any feature needs it (priority 1).

**Scope:** migrations `20261013090000`–`20261013090400` (tenancy, jobs queue, deals and evidence, repo
scans, social); one SQL test per migration; catalogue sweep; 16 canaries; ADRs 0002, 0005, 0006.
**Non-scope:** storage buckets and policies (COLLECT-WEB adds `deal-files` with its own migration);
TEAM-INVITES.

**Data:** 21 tables (19 in `public`, `app_auth.staff`, `app_jobs.jobs`, `app_jobs.dead_letters`); RLS read
policies only; 9 user RPCs; 10 service-role RPCs; `search_evidence` (invoker).
**Flag:** none (no user surface).

**Acceptance criteria**
- `scripts/db-test.sh` green on Postgres 16 + pgvector and on `supabase start` locally.
- `scripts/db-canaries.sh`: all canaries caught.
- Owner: migrations applied to the hosted project via CI on merge; Supabase security advisor shows no
  errors (record any warnings in PROGRESS with a reason).

**Slices:** PR #1 alone (database first). **Estimate:** written and green locally 2026-10-13.
