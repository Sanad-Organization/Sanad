-- Tests for 20261013090100_jobs_queue.sql
begin;

-- ---- Clients can't reach the queue ----------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
do $$ declare s text; begin
  foreach s in array array[
    'select * from app_jobs.jobs',
    'select * from app_jobs.dead_letters',
    'select public.jobs_enqueue(''deal.collect'', ''{}'')',
    'select * from public.jobs_claim(''x'')',
    'select public.jobs_complete(1, gen_random_uuid())',
    'select public.jobs_fail(1, gen_random_uuid(), ''x'')',
    'select public.jobs_heartbeat(1, gen_random_uuid())',
    'select public.dead_letter_add(''github.webhook'', ''{}'', ''x'')',
    'select public.dead_letter_resolve(1)',
    'select public.jobs_reconcile()',
    'select app_jobs.enqueue(''deal.collect'', ''{}'', null)'
  ] loop
    perform test_helpers.expect_denied(s, 'client: ' || s);
  end loop;
  raise notice 'PASS: queue closed to clients';
end $$;
reset role;

set local role anon;
do $$ begin
  perform test_helpers.expect_denied('select * from public.jobs_claim(''x'')', 'anon jobs_claim');
  raise notice 'PASS: queue closed to anon';
end $$;
reset role;

-- ---- Worker behaviour (service role) ---------------------------------------
set local role service_role;
do $$
declare a bigint; b bigint; c bigint; j record; st text; ok boolean; lease uuid;
begin
  -- Dedupe of outstanding work.
  a := public.jobs_enqueue('deal.collect', '{"deal_id":"x"}', '00000000-0000-0000-0000-00000000000a', 'deal:x');
  b := public.jobs_enqueue('deal.collect', '{"deal_id":"x"}', '00000000-0000-0000-0000-00000000000a', 'deal:x');
  if a is null or a <> b then raise exception 'FAIL: dedupe returned % and %', a, b; end if;

  -- Claim gives a lease; completing needs that lease.
  select * into j from public.jobs_claim('w1', 1, 60);
  if j.id <> a or j.lease_token is null or j.attempts <> 1 then raise exception 'FAIL: claim returned %', row_to_json(j); end if;
  if public.jobs_complete(a, gen_random_uuid()) then raise exception 'FAIL: completed with a wrong lease'; end if;
  if not public.jobs_complete(a, j.lease_token) then raise exception 'FAIL: could not complete with the right lease'; end if;
  if public.jobs_complete(a, j.lease_token) then raise exception 'FAIL: completed twice'; end if;

  -- The same key can recur once the first is done.
  c := public.jobs_enqueue('deal.collect', '{"deal_id":"x"}', '00000000-0000-0000-0000-00000000000a', 'deal:x');
  if c = a then raise exception 'FAIL: done job blocked a new one with the same key'; end if;

  -- Retry with backoff, then permanent failure.
  select * into j from public.jobs_claim('w1', 1, 60);
  st := public.jobs_fail(j.id, j.lease_token, 'boom');
  if st <> 'pending' then raise exception 'FAIL: first failure gave %', st; end if;
  if (select run_after from public.jobs_claim('w1', 1, 60) limit 1) is not null then
    raise exception 'FAIL: job reclaimed before its backoff';
  end if;
  perform test_helpers.owner_exec(format('update app_jobs.jobs set run_after = now() where id = %s', j.id));
  select * into j from public.jobs_claim('w1', 1, 60);
  if public.jobs_fail(j.id, gen_random_uuid(), 'x') <> 'lease_lost' then raise exception 'FAIL: fail with wrong lease'; end if;
  st := public.jobs_fail(j.id, j.lease_token, 'no handler', true);
  if st <> 'failed' then raise exception 'FAIL: permanent failure gave %', st; end if;

  -- Expired leases are reaped, and a stale worker loses its lease.
  a := public.jobs_enqueue('scan.repo', '{}', null, 'reap');
  select * into j from public.jobs_claim('w1', 1, 60);
  lease := j.lease_token;
  perform test_helpers.owner_exec(format('update app_jobs.jobs set locked_until = now() - interval ''1 second'' where id = %s', j.id));
  select * into j from public.jobs_claim('w2', 1, 60);
  if j.id <> a or j.lease_token = lease or j.attempts <> 2 then raise exception 'FAIL: expired lease not reaped'; end if;
  if public.jobs_complete(a, lease) then raise exception 'FAIL: stale worker overwrote the new owner'; end if;
  if not public.jobs_heartbeat(a, j.lease_token, 120) then raise exception 'FAIL: heartbeat'; end if;

  -- Out of attempts on reap -> failed.
  perform test_helpers.owner_exec(format('update app_jobs.jobs set attempts = max_attempts, locked_until = now() - interval ''1 second'' where id = %s', a));
  perform public.jobs_claim('w3', 1, 60);
  if (public.jobs_reconcile() ->> 'failed_24h')::int < 2 then raise exception 'FAIL: exhausted job not failed on reap'; end if;

  -- Kind format is enforced.
  perform test_helpers.expect_error('select public.jobs_enqueue(''DROP TABLE'', ''{}'')', 'check constraint', 'bad kind');

  -- Reconcile returns counts only.
  if not (public.jobs_reconcile() ?& array['failed_24h','overdue_pending','stuck_running','open_dead_letters']) then
    raise exception 'FAIL: reconcile keys';
  end if;
  if (public.jobs_reconcile() ->> 'failed_24h')::int < 2 then raise exception 'FAIL: reconcile missed failed jobs'; end if;
  raise notice 'PASS: leases, dedupe, backoff, reaping, reconcile';
end $$;

-- Dead letters: resolved, never deleted; the original error is write-once.
do $$ declare d bigint; begin
  d := public.dead_letter_add('github.webhook', '{"action":"created"}', 'handler crashed');
  perform test_helpers.expect_denied(format('delete from app_jobs.dead_letters where id = %s', d), 'service role deletes a dead letter directly');
  perform test_helpers.expect_error(format('select test_helpers.owner_exec(''delete from app_jobs.dead_letters where id = %s'')', d),
                                    'never deleted', 'owner deletes a dead letter', 'CRITICAL');
  perform test_helpers.expect_error(format('select test_helpers.owner_exec(''update app_jobs.dead_letters set error_message = ''''x'''' where id = %s'')', d),
                                    'write-once', 'owner rewrites a dead letter cause', 'CRITICAL');
  if not public.dead_letter_resolve(d, 'replayed') then raise exception 'FAIL: resolve'; end if;
  if public.dead_letter_resolve(d) then raise exception 'FAIL: resolved twice'; end if;
  raise notice 'PASS: dead letters';
end $$;
reset role;

rollback;
