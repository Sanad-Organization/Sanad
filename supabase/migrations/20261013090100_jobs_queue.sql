-- 20261013090100_jobs_queue.sql
--
-- Context:   ADR 0006 (one Postgres job queue instead of a hosted queue). The
--            worker (Render) and the ingress service talk to it only through
--            the jobs_* RPCs below, with the service-role key.
-- Changes:   private schema app_jobs with jobs and dead_letters; leases with a
--            token, backoff, dedupe of outstanding work, reaping of expired
--            leases, a daily reconciliation that returns counts only.
-- Not here:  the scheduler. A Render cron calls jobs_enqueue('ops.sweep') and
--            jobs_reconcile(); nothing in the database holds a URL or secret.
-- Pre-check: none (new tables).
-- Test:      supabase/tests/20261013090100_jobs_queue.test.sql

create schema app_jobs;
revoke all on schema app_jobs from public, anon, authenticated;
grant usage on schema app_jobs to service_role;

create table app_jobs.jobs (
  id bigint generated always as identity primary key,
  fund_id uuid references public.funds (id) on delete cascade,   -- null for ops jobs
  kind text not null check (kind ~ '^[a-z]+\.[a-z_]+$'),
  payload jsonb not null default '{}'
    check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 8192),
  status text not null default 'pending' check (status in ('pending','running','done','failed')),
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 5 check (max_attempts between 1 and 20),
  run_after timestamptz not null default now(),
  dedupe_key text check (length(dedupe_key) <= 200),
  lease_token uuid,
  locked_until timestamptz,
  locked_by text check (length(locked_by) <= 100),
  last_error text check (length(last_error) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((status = 'running') = (lease_token is not null and locked_until is not null)),
  check ((status in ('done','failed')) = (finished_at is not null))
);
-- At most one outstanding job per (kind, dedupe_key); the same key can recur later.
create unique index jobs_outstanding_dedupe on app_jobs.jobs (kind, dedupe_key)
  where status in ('pending','running') and dedupe_key is not null;
create index jobs_ready_idx on app_jobs.jobs (run_after) where status = 'pending';
create index jobs_lease_idx on app_jobs.jobs (locked_until) where status = 'running';

-- Payloads the ingress could not process (e.g. a GitHub webhook whose handler
-- threw). Verbatim for exact replay; resolved, never deleted; staff-only.
create table app_jobs.dead_letters (
  id bigint generated always as identity primary key,
  source text not null check (source ~ '^[a-z]+\.[a-z_]+$'),
  source_payload jsonb not null check (octet_length(source_payload::text) <= 65536),
  error_message text not null check (length(error_message) <= 2000),   -- original cause, never overwritten
  last_error text check (length(last_error) <= 2000),
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index dead_letters_open_idx on app_jobs.dead_letters (created_at) where resolved_at is null;

create trigger jobs_updated_at before update on app_jobs.jobs
  for each row execute function app_auth.set_updated_at();

create function app_jobs.forbid_dead_letter_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.error_message is distinct from old.error_message then
    raise exception 'dead_letters.error_message is write-once' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.source_payload is distinct from old.source_payload then
    raise exception 'dead_letters.source_payload is write-once' using errcode = '42501';
  end if;
  if tg_op in ('DELETE','TRUNCATE') then
    raise exception 'dead letters are resolved, never deleted' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger dead_letters_guard before update or delete on app_jobs.dead_letters
  for each row execute function app_jobs.forbid_dead_letter_delete();
create trigger dead_letters_no_truncate before truncate on app_jobs.dead_letters
  for each statement execute function app_jobs.forbid_dead_letter_delete();

revoke all on all tables in schema app_jobs from public, anon, authenticated;
alter table app_jobs.jobs enable row level security;
alter table app_jobs.dead_letters enable row level security;
-- No policies: only definer functions (owner) touch these tables.

-- ---------------------------------------------------------------------------
-- Internal enqueue, used by user RPCs (definer) in later migrations.
-- ---------------------------------------------------------------------------
create function app_jobs.enqueue(p_kind text, p_payload jsonb, p_fund uuid,
                                 p_dedupe text default null, p_delay_seconds int default 0)
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare v_id bigint;
begin
  insert into app_jobs.jobs (kind, payload, fund_id, dedupe_key, run_after)
  values (p_kind, coalesce(p_payload, '{}'), p_fund, p_dedupe,
          now() + make_interval(secs => greatest(p_delay_seconds, 0)))
  on conflict (kind, dedupe_key) where status in ('pending','running') and dedupe_key is not null
  do nothing
  returning id into v_id;
  if v_id is null then
    select j.id into v_id from app_jobs.jobs j
     where j.kind = p_kind and j.dedupe_key = p_dedupe and j.status in ('pending','running');
  end if;
  return v_id;
end $$;
revoke all on function app_jobs.enqueue(text, jsonb, uuid, text, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Worker RPCs (public so the worker can call them over REST; service_role only).
-- ---------------------------------------------------------------------------
create function public.jobs_enqueue(p_kind text, p_payload jsonb, p_fund uuid default null,
                                    p_dedupe text default null, p_delay_seconds int default 0)
returns bigint language sql volatile security definer set search_path = '' as $$
  select app_jobs.enqueue(p_kind, p_payload, p_fund, p_dedupe, p_delay_seconds)
$$;

-- Reap expired leases, then claim up to p_n ready jobs in one statement.
create function public.jobs_claim(p_worker text, p_n int default 1, p_lease_seconds int default 600)
returns setof app_jobs.jobs language plpgsql volatile security definer set search_path = '' as $$
begin
  -- Expired leases: back to pending, or failed if out of attempts.
  update app_jobs.jobs j
     set status = case when j.attempts >= j.max_attempts then 'failed' else 'pending' end,
         finished_at = case when j.attempts >= j.max_attempts then now() end,
         last_error = coalesce(j.last_error || ' | ', '') || 'lease expired',
         lease_token = null, locked_until = null, locked_by = null,
         run_after = now()
   where j.status = 'running' and j.locked_until < now();

  return query
  update app_jobs.jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         lease_token = gen_random_uuid(),
         locked_until = now() + make_interval(secs => least(greatest(p_lease_seconds, 30), 3600)),
         locked_by = left(p_worker, 100)
   where j.id in (
     select c.id from app_jobs.jobs c
      where c.status = 'pending' and c.run_after <= now()
      order by c.run_after
      limit least(greatest(p_n, 1), 20)
      for update skip locked)
  returning j.*;
end $$;

-- Complete only with the lease token. Returns false when the lease was lost.
create function public.jobs_complete(p_id bigint, p_lease uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  update app_jobs.jobs
     set status = 'done', finished_at = now(), lease_token = null, locked_until = null
   where id = p_id and lease_token = p_lease and status = 'running';
  return found;
end $$;

-- Retry with backoff 2^min(attempts,10) s, or fail now when permanent
-- (unknown kind, missing payload field, CHECK refusal on replay).
-- Returns the new status, or 'lease_lost'.
create function public.jobs_fail(p_id bigint, p_lease uuid, p_error text, p_permanent boolean default false)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare v_status text;
begin
  update app_jobs.jobs j
     set status = case when p_permanent or j.attempts >= j.max_attempts then 'failed' else 'pending' end,
         finished_at = case when p_permanent or j.attempts >= j.max_attempts then now() end,
         run_after = now() + make_interval(secs => power(2, least(j.attempts, 10))::int),
         last_error = left(p_error, 2000),
         lease_token = null, locked_until = null, locked_by = null
   where j.id = p_id and j.lease_token = p_lease and j.status = 'running'
  returning j.status into v_status;
  return coalesce(v_status, 'lease_lost');
end $$;

-- Extend a lease during a long step (a scan can take minutes).
create function public.jobs_heartbeat(p_id bigint, p_lease uuid, p_lease_seconds int default 600)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  update app_jobs.jobs
     set locked_until = now() + make_interval(secs => least(greatest(p_lease_seconds, 30), 3600))
   where id = p_id and lease_token = p_lease and status = 'running';
  return found;
end $$;

create function public.dead_letter_add(p_source text, p_payload jsonb, p_error text)
returns bigint language sql volatile security definer set search_path = '' as $$
  insert into app_jobs.dead_letters (source, source_payload, error_message)
  values (p_source, p_payload, left(p_error, 2000))
  returning id
$$;

create function public.dead_letter_resolve(p_id bigint, p_last_error text default null)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  update app_jobs.dead_letters
     set resolved_at = now(), attempts = attempts + 1, last_error = coalesce(left(p_last_error, 2000), last_error)
   where id = p_id and resolved_at is null;
  return found;
end $$;

-- Counts only. The caller logs at error level when any alarm counter is > 0.
create function public.jobs_reconcile()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'failed_24h',      (select count(*) from app_jobs.jobs where status = 'failed' and finished_at > now() - interval '24 hours'),
    'overdue_pending', (select count(*) from app_jobs.jobs where status = 'pending' and run_after < now() - interval '15 minutes'),
    'stuck_running',   (select count(*) from app_jobs.jobs where status = 'running' and locked_until < now() - interval '15 minutes'),
    'open_dead_letters', (select count(*) from app_jobs.dead_letters where resolved_at is null)
  )
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.jobs_enqueue(text, jsonb, uuid, text, int)',
    'public.jobs_claim(text, int, int)',
    'public.jobs_complete(bigint, uuid)',
    'public.jobs_fail(bigint, uuid, text, boolean)',
    'public.jobs_heartbeat(bigint, uuid, int)',
    'public.dead_letter_add(text, jsonb, text)',
    'public.dead_letter_resolve(bigint, text)',
    'public.jobs_reconcile()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
