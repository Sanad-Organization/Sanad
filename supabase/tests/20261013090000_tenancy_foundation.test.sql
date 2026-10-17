-- Tests for 20261013090000_tenancy_foundation.sql
-- CRITICAL = security failure, FAIL = functional failure.
begin;

-- ---- Fund A owner ----------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
do $$ begin
  perform test_helpers.assert_isolated('public.memberships', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 'owner A');
  perform test_helpers.assert_isolated('public.audit_log',   '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 'owner A');
  if (select count(*) from public.funds) <> 1 or not exists (select 1 from public.funds where id = '00000000-0000-0000-0000-00000000000a') then
    raise exception 'CRITICAL: owner A sees the wrong funds';
  end if;
  raise notice 'PASS: tenancy isolation (A)';
end $$;
do $$ declare t text; begin
  -- funds has id, not fund_id: test its writes by hand.
  perform test_helpers.expect_denied('insert into public.funds (name) values (''x'')', 'owner A insert funds');
  perform test_helpers.expect_denied('update public.funds set name = ''x''', 'owner A update funds');
  perform test_helpers.expect_denied('delete from public.funds', 'owner A delete funds');
  -- Privilege escalation through memberships.
  perform test_helpers.expect_denied('update public.memberships set role = ''owner''', 'analyst self-promotion via update');
  perform test_helpers.expect_denied(
    'insert into public.memberships (fund_id, user_id, role) values (''00000000-0000-0000-0000-00000000000b'', ''00000000-0000-0000-0000-0000000000a1'', ''owner'')',
    'joining another fund');
  foreach t in array array['public.memberships','public.audit_log'] loop
    perform test_helpers.assert_no_client_writes(t, 'owner A');
  end loop;
  perform test_helpers.expect_denied('select count(*) from app_auth.staff', 'reading the staff list');
  raise notice 'PASS: no client writes (A)';
end $$;
reset role;

-- ---- Fund B owner (the other direction) ------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
do $$ begin
  perform test_helpers.assert_isolated('public.memberships', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', 'owner B');
  perform test_helpers.assert_isolated('public.audit_log',   '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', 'owner B');
  if exists (select 1 from public.funds where id = '00000000-0000-0000-0000-00000000000a') then
    raise exception 'CRITICAL: owner B can read fund A';
  end if;
  raise notice 'PASS: tenancy isolation (B)';
end $$;
reset role;

-- ---- Viewer A: no audit log (owner/partner only) ---------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
do $$ begin
  perform test_helpers.assert_sees_nothing('public.audit_log', 'viewer A');
  if (select count(*) from public.memberships) = 0 then
    raise exception 'FAIL: viewer A cannot see their own team';
  end if;
  raise notice 'PASS: viewer limits';
end $$;
reset role;

-- ---- Signed-in user with no fund, staff, anon ------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
do $$ declare t text; begin
  foreach t in array array['public.funds','public.memberships','public.audit_log'] loop
    perform test_helpers.assert_sees_nothing(t, 'user without a fund');
  end loop;
  raise notice 'PASS: no fund, no rows';
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000005f","role":"authenticated"}', true);
do $$ declare t text; begin
  -- ADR 0002: staff have no read access to fund data.
  foreach t in array array['public.funds','public.memberships','public.audit_log'] loop
    perform test_helpers.assert_sees_nothing(t, 'staff');
  end loop;
  if not app_auth.is_staff() then raise exception 'FAIL: is_staff() false for staff'; end if;
  raise notice 'PASS: staff see no fund data';
end $$;
reset role;

set local role anon;
select set_config('request.jwt.claims', '', true);
do $$ declare t text; begin
  foreach t in array array['public.funds','public.memberships','public.audit_log'] loop
    perform test_helpers.assert_sees_nothing(t, 'anon');
  end loop;
  raise notice 'PASS: anon sees nothing';
end $$;
reset role;

-- ---- Audit log is append-only, even for the service role -------------------
set local role service_role;
do $$ begin
  perform test_helpers.expect_denied('update public.audit_log set action = ''x.y''', 'service role update audit_log');
  perform test_helpers.expect_denied('delete from public.audit_log', 'service role delete audit_log');
  perform test_helpers.expect_denied('truncate public.audit_log', 'service role truncate audit_log');
  -- created_at is server-stamped.
  insert into public.audit_log (fund_id, action, target_table, target_id, created_at)
  values ('00000000-0000-0000-0000-00000000000a', 'test.backdate', 'funds', 'x', '2000-01-01');
  if exists (select 1 from public.audit_log where action = 'test.backdate' and created_at < now() - interval '1 minute') then
    raise exception 'CRITICAL: audit_log.created_at can be backdated';
  end if;
  raise notice 'PASS: audit_log append-only';
end $$;

-- ---- Positive control: the service role CAN write --------------------------
do $$ begin
  insert into public.funds (id, name) values ('00000000-0000-0000-0000-0000000000cc', 'Control fund');
  insert into public.memberships (fund_id, user_id, role)
  values ('00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-0000000000f1', 'viewer');
  raise notice 'PASS: service role can write (positive control)';
end $$;
reset role;

-- ---- Helpers are definer with an empty search_path -------------------------
do $$ declare bad text; begin
  select string_agg(p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_auth' and p.prosecdef
     and not coalesce(p.proconfig @> array['search_path=""'], false);
  if bad is not null then
    raise exception 'CRITICAL: definer helpers without search_path='''': %', bad;
  end if;
  raise notice 'PASS: helper hygiene';
end $$;

rollback;
