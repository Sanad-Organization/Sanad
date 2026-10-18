-- Tests for 20261018090000_reaper_truncate_fk_indexes.sql
begin;

-- ---- jobs_claim keeps its shape and stays closed to clients ----------------
do $$ declare f record; begin
  select p.prosecdef, p.proconfig, p.prorettype::regtype::text as rt, p.proretset into f
    from pg_proc p where p.oid = 'public.jobs_claim(text, int, int)'::regprocedure;
  if not f.prosecdef or not coalesce(f.proconfig @> array['search_path=""'], false)
     or f.rt <> 'app_jobs.jobs' or not f.proretset then
    raise exception 'CRITICAL: jobs_claim lost security definer, search_path or its return type';
  end if;
  if has_function_privilege('authenticated', 'public.jobs_claim(text, int, int)', 'execute')
     or has_function_privilege('anon', 'public.jobs_claim(text, int, int)', 'execute')
     or not has_function_privilege('service_role', 'public.jobs_claim(text, int, int)', 'execute') then
    raise exception 'CRITICAL: jobs_claim grants changed';
  end if;
  raise notice 'PASS: jobs_claim signature and grants';
end $$;

-- ---- The reaper truncates last_error -----------------------------------------
set local role service_role;
do $$ declare a bigint; j record; e text; begin
  a := public.jobs_enqueue('scan.repo', '{}', null, 'reap-long-error');
  select * into j from public.jobs_claim('w1', 1, 60);
  if j.id <> a then raise exception 'FAIL: claimed % instead of %', j.id, a; end if;
  perform test_helpers.owner_exec(format(
    'update app_jobs.jobs set last_error = repeat(''x'', 2000), locked_until = now() - interval ''1 second'' where id = %s', a));

  -- Before the fix this raised a CHECK violation and stopped every claim.
  select * into j from public.jobs_claim('w2', 1, 60);
  if j.id is distinct from a or j.attempts <> 2 then raise exception 'FAIL: expired lease with a full last_error not reclaimed'; end if;
  if length(j.last_error) <> 2000 then raise exception 'FAIL: last_error length %', length(j.last_error); end if;

  -- A short error still gets the marker appended.
  perform test_helpers.owner_exec(format(
    'update app_jobs.jobs set last_error = ''boom'', locked_until = now() - interval ''1 second'' where id = %s', a));
  select * into j from public.jobs_claim('w3', 1, 60);
  if j.id is distinct from a then raise exception 'FAIL: expired lease with a short last_error not reclaimed'; end if;
  if j.last_error <> 'boom | lease expired' then raise exception 'FAIL: last_error was %', j.last_error; end if;
  raise notice 'PASS: reaper keeps last_error within 2000 characters';
end $$;
reset role;

-- ---- Every foreign key has a covering index -----------------------------------
-- An index covers a foreign key when its leading key columns are exactly the
-- foreign key's columns (any order), it is not partial and has no expressions.
do $$ declare bad text; begin
  select string_agg(c.conrelid::regclass || '.' || c.conname, ', ' order by c.conrelid::regclass::text, c.conname) into bad
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
   where c.contype = 'f' and n.nspname in ('public','app_auth','app_jobs')
     and not exists (
       select 1 from pg_index i
        where i.indrelid = c.conrelid and i.indpred is null and i.indexprs is null
          and i.indnkeyatts >= cardinality(c.conkey)
          and (select array_agg(x order by x) from unnest((i.indkey::int2[])[0:cardinality(c.conkey) - 1]) x)
            = (select array_agg(x order by x) from unnest(c.conkey) x));
  if bad is not null then raise exception 'CRITICAL: foreign keys without a covering index: %', bad; end if;
  raise notice 'PASS: every foreign key has a covering index';
end $$;

rollback;
