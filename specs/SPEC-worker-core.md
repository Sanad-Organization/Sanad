# SPEC — WORKER-CORE

**Goal:** a worker and an ingress that run jobs safely: leases, idempotent handlers, dead letters,
reconciliation, logs (priority 1: nothing happens unobserved).

**Scope:** `services/worker` (Python 3.12, uv): `Store` interface over the jobs RPCs with an in-memory fake;
handler registry (`kind → handler`, unknown kind fails permanently); one job per slot under a deadline;
heartbeat for long jobs; JSON logger (`trace_id` = job id chain) with redaction test; Sentry; config via
`requireEnv`-style check (missing var → refuse to start, log the name). `services/ingress` (FastAPI):
`/health`, signed-request helpers, body caps on the stream, generic 403, 503 on unhandled. Render crons:
`ops.sweep` each minute (calls `redact_old_founder_emails`, retention), daily `jobs_reconcile`. JSON Schemas
in `packages/types/schemas` for every job payload; contract test TS ↔ Python.
**Non-scope:** any collector or analyser.

**Data:** jobs RPCs only; `deals.pipeline` updates.
**Flag:** `worker-kill` (global): when on, the worker claims nothing and logs `worker_paused`.

**Acceptance criteria**
- Unit tests on the fake store: lease lost, retry, permanent failure, idempotent re-run.
- Integration test against the local DB: kill a worker mid-job; the lease expires; a second worker finishes;
  exactly one result row.
- Reconcile alarms log at error level; alert rule named in `docs/runbooks/jobs.md`.

**Slices:** (1) worker loop + store + logs; (2) ingress skeleton + crons. **Estimate:** 1–1.5 days.
