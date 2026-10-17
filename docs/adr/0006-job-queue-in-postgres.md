# 0006 — One job queue in Postgres, with leases

**Status:** accepted — 2026-10-13. **Supersedes** the architecture plan's "Supabase Queues" line.

## Context

The architecture plan named Supabase Queues. The bootstrap's queue (§8.7) adds what a diligence pipeline
needs: dedupe of outstanding work, lease tokens so a stale worker can't overwrite a new owner, backoff,
dead letters and daily reconciliation, all testable in plain SQL.

## Decision

1. `app_jobs.jobs` and `app_jobs.dead_letters` in a private schema with no client grants. The worker and
   ingress use only the RPCs `jobs_enqueue`, `jobs_claim`, `jobs_complete`, `jobs_fail`, `jobs_heartbeat`,
   `dead_letter_add`, `dead_letter_resolve`, `jobs_reconcile` (service role only).
2. Claim = reap expired leases, then `FOR UPDATE SKIP LOCKED`, one job per worker slot. Complete and fail
   need the lease token; `lease_lost` is not an error to retry.
3. Backoff `2^min(attempts,10)` s; `max_attempts` 5; unknown kind or missing payload field fails at once
   (`p_permanent`).
4. Dedupe: partial unique index on `(kind, dedupe_key)` while pending or running. User RPCs enqueue with
   keys like `deal:<id>`.
5. Scheduler: a Render cron (every minute) enqueues `ops.sweep`; a daily cron calls `jobs_reconcile()` and
   logs at error level when any counter is above 0. No URL or secret lives in the database.
6. Users see progress through `deals.pipeline` (written by the worker), not through the queue.

## Consequences

- A scan can take minutes: the scan job heartbeats its lease.
- Alerts: `failed_24h > 0` notifies; `open_dead_letters > 0` notifies; `stuck_running > 0` pages.
