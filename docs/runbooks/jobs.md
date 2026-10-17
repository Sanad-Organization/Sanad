# Runbook — Jobs, dead letters and reconciliation

**When:** an alert fires: `jobs_failed` (notify), `dead_letters_open` (notify), `jobs_stuck` (page).

## Look

```sql
select public.jobs_reconcile();   -- as service role (or in the SQL editor as postgres)
select id, kind, attempts, last_error, finished_at from app_jobs.jobs
 where status = 'failed' and finished_at > now() - interval '24 hours' order by finished_at desc;
select id, source, error_message, created_at from app_jobs.dead_letters where resolved_at is null;
```

## Fix

| Signal | Meaning | Fix |
| --- | --- | --- |
| `failed` with `no handler` | a job kind the deployed worker doesn't know | deploy the worker; re-enqueue with `jobs_enqueue` |
| `failed` with `lease expired` ×5 | the job keeps outliving its lease | raise the lease or add heartbeats; re-enqueue |
| `stuck_running > 0` | worker died and nothing reaped | check the worker is running; the next claim reaps |
| open dead letter from `github.webhook` | ingress couldn't process an install event | fix, then replay: worker command `replay-dead-letter <id>` (idempotent), then `dead_letter_resolve` |

Never delete a dead letter (the database refuses). Resolve it with a note.
