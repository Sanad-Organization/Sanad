-- Tests for 20261013090200_deals_evidence.sql
begin;

-- ---- Isolation, both directions, every table --------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
do $$ declare t text; begin
  foreach t in array array['public.companies','public.deals','public.sources','public.chunks','public.claims',
                           'public.findings','public.finding_overrides','public.scores','public.questions','public.agent_turns'] loop
    perform test_helpers.assert_isolated(t, '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 'analyst A');
    perform test_helpers.assert_no_client_writes(t, 'analyst A');
  end loop;
  raise notice 'PASS: evidence isolation and no client writes (A)';
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
do $$ declare t text; begin
  foreach t in array array['public.companies','public.deals','public.sources','public.chunks','public.claims',
                           'public.findings','public.finding_overrides','public.scores','public.questions','public.agent_turns'] loop
    perform test_helpers.assert_isolated(t, '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', 'owner B');
  end loop;
  raise notice 'PASS: evidence isolation (B)';
end $$;
reset role;

set local role anon;
select set_config('request.jwt.claims', '', true);
do $$ declare t text; begin
  foreach t in array array['public.companies','public.deals','public.sources','public.chunks','public.findings','public.scores'] loop
    perform test_helpers.assert_sees_nothing(t, 'anon');
  end loop;
  perform test_helpers.expect_denied('select public.create_deal(''00000000-0000-0000-0000-00000000000a'', ''X'')', 'anon create_deal');
  raise notice 'PASS: anon sees nothing';
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000005f","role":"authenticated"}', true);
do $$ begin
  perform test_helpers.assert_sees_nothing('public.findings', 'staff');
  perform test_helpers.assert_sees_nothing('public.chunks', 'staff');
  raise notice 'PASS: staff see no evidence';
end $$;
reset role;

-- ---- Search runs under RLS -------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
do $$ declare e extensions.vector := array_fill(0.01, array[1024])::real[]::extensions.vector; n int; begin
  select count(*) into n from public.search_evidence('00000000-0000-0000-0000-00000000d00b', 'machine learning', e);
  if n <> 0 then raise exception 'CRITICAL: search_evidence returned % chunk(s) from fund B', n; end if;
  select count(*) into n from public.search_evidence('00000000-0000-0000-0000-00000000d00a', 'machine learning', e);
  if n <> 1 then raise exception 'FAIL: search_evidence found % own chunk(s), expected 1', n; end if;
  raise notice 'PASS: search_evidence isolation';
end $$;

-- ---- RPC authorisation -----------------------------------------------------
do $$ declare d uuid; begin
  -- Analyst A can create a deal in A, and it queues collection.
  d := public.create_deal('00000000-0000-0000-0000-00000000000a', 'Synthetic New Co', 'https://new.example.test',
                          null, 'sa', 'seed', array['https://github.com/synthetic-new/api']);
  if not exists (select 1 from public.deals where id = d and fund_id = '00000000-0000-0000-0000-00000000000a') then
    raise exception 'FAIL: create_deal did not create a visible deal';
  end if;
  -- …but not in fund B (the body names a fund the caller isn't in).
  perform test_helpers.expect_denied('select public.create_deal(''00000000-0000-0000-0000-00000000000b'', ''Injected'')', 'analyst A creates a deal in fund B');
  -- Bad GitHub URL is refused by the database.
  perform test_helpers.expect_error('select public.create_deal(''00000000-0000-0000-0000-00000000000a'', ''X'', null, null, null, null, array[''https://evil.test/x/y''])',
                                    'check constraint', 'non-GitHub repo URL');
  -- Analyst can't change deal status or approve scores.
  perform test_helpers.expect_denied('select public.set_deal_status(''00000000-0000-0000-0000-00000000d00a'', ''passed'')', 'analyst sets deal status');
  perform test_helpers.expect_denied('select public.approve_score(''00000000-0000-0000-0000-000000005c0a'')', 'analyst approves a score');
  -- Cross-fund RPCs.
  perform test_helpers.expect_denied('select public.override_finding(''00000000-0000-0000-0000-00000000f00b'', ''dismiss'', ''not real'')', 'override fund B finding');
  perform test_helpers.expect_denied('select public.request_rescore(''00000000-0000-0000-0000-00000000d00b'')', 'rescore fund B deal');
  perform test_helpers.expect_denied('select public.set_question_status(''00000000-0000-0000-0000-000000009a0b'', ''asked'')', 'question in fund B');
  perform test_helpers.expect_denied('select public.log_agent_turn(''00000000-0000-0000-0000-00000000d00b'', ''q'', ''a'', ''{}'', ''m'', 0, 0)', 'agent turn on fund B deal');
  -- Citing another fund's source from your own deal.
  perform test_helpers.expect_error('select public.log_agent_turn(''00000000-0000-0000-0000-00000000d00a'', ''q'', ''a'', array[''00000000-0000-0000-0000-00000000500b''::uuid], ''m'', 0, 0)',
                                    'not in this deal', 'agent cites fund B source', 'CRITICAL');
  -- Own-fund override works and is append-only.
  perform public.override_finding('00000000-0000-0000-0000-00000000f00a', 'change_severity', 'Key was rotated', 2::smallint);
  perform public.set_question_status('00000000-0000-0000-0000-000000009a0a', 'answered', 'We fine-tune an open model.');
  perform public.log_agent_turn('00000000-0000-0000-0000-00000000d00a', 'q', 'a', array['00000000-0000-0000-0000-00000000500a'::uuid], 'm', 10, 20);
  raise notice 'PASS: analyst RPC rights';
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
do $$ begin
  perform test_helpers.expect_denied('select public.create_deal(''00000000-0000-0000-0000-00000000000a'', ''Viewer Co'')', 'viewer creates a deal');
  perform test_helpers.expect_denied('select public.override_finding(''00000000-0000-0000-0000-00000000f00a'', ''dismiss'', ''viewer says so'')', 'viewer overrides a finding');
  perform public.log_agent_turn('00000000-0000-0000-0000-00000000d00a', 'q', 'a', '{}', 'm', 1, 1);   -- viewers may ask the agent
  raise notice 'PASS: viewer RPC rights';
end $$;
reset role;

-- ---- Partner approves once; approved scores are frozen ----------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}', true);
do $$ begin
  perform public.approve_score('00000000-0000-0000-0000-000000005c0a');
  perform test_helpers.expect_error('select public.approve_score(''00000000-0000-0000-0000-000000005c0a'')', 'already approved', 'second approval');
  perform test_helpers.expect_denied('select public.approve_score(''00000000-0000-0000-0000-000000005c0b'')', 'partner A approves fund B score');
  perform public.set_deal_status('00000000-0000-0000-0000-00000000d00a', 'diligence');
  raise notice 'PASS: partner approval';
end $$;
reset role;

set local role service_role;
do $$ begin
  perform test_helpers.expect_denied('update public.scores set overall = 99 where id = ''00000000-0000-0000-0000-000000005c0a''', 'changing an approved score');
  perform test_helpers.expect_denied('update public.scores set overall = 99, approved_at = now(), approved_by = ''00000000-0000-0000-0000-0000000000a4'' where id = ''00000000-0000-0000-0000-000000005c0b''',
                                     'approving and changing in one update');
  perform test_helpers.expect_denied('update public.finding_overrides set reason = ''rewritten''', 'rewriting an override');
  perform test_helpers.expect_denied('delete from public.agent_turns', 'deleting agent turns');

  -- Composite keys: a child can't claim another fund than its parent.
  perform test_helpers.expect_error(
    'insert into public.sources (fund_id, deal_id, type, tier, content_hash) values (''00000000-0000-0000-0000-00000000000b'', ''00000000-0000-0000-0000-00000000d00a'', ''news'', 3, repeat(''c'', 64))',
    'foreign key', 'source in deal A tagged fund B', 'CRITICAL');
  perform test_helpers.expect_error(
    'insert into public.findings (fund_id, deal_id, dimension, type, title, explanation, source_ids, analyzer) values (''00000000-0000-0000-0000-00000000000a'', ''00000000-0000-0000-0000-00000000d00a'', ''risk'', ''strength'', ''t'', ''e'', array[''00000000-0000-0000-0000-00000000500b''::uuid], ''x'')',
    'not in this deal', 'finding cites fund B source', 'CRITICAL');
  perform test_helpers.expect_error(
    'insert into public.findings (fund_id, deal_id, dimension, type, title, explanation, source_ids, analyzer) values (''00000000-0000-0000-0000-00000000000a'', ''00000000-0000-0000-0000-00000000d00a'', ''risk'', ''strength'', ''t'', ''e'', ''{}'', ''x'')',
    'check constraint', 'finding without evidence');

  -- Positive control.
  insert into public.findings (fund_id, deal_id, dimension, type, title, explanation, source_ids, analyzer)
  values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000d00a', 'risk', 'strength', 't', 'e',
          array['00000000-0000-0000-0000-00000000500a'::uuid], 'x');
  raise notice 'PASS: service-role writes and guards';
end $$;

-- ---- Erasure removes the whole deal, including append-only children --------
do $$ begin
  if not public.erase_deal('00000000-0000-0000-0000-00000000d00a', 'founder request') then raise exception 'FAIL: erase_deal'; end if;
  if exists (select 1 from public.agent_turns where deal_id = '00000000-0000-0000-0000-00000000d00a')
     or exists (select 1 from public.finding_overrides where deal_id = '00000000-0000-0000-0000-00000000d00a')
     or exists (select 1 from public.chunks where deal_id = '00000000-0000-0000-0000-00000000d00a')
     or exists (select 1 from public.mentions where deal_id = '00000000-0000-0000-0000-00000000d00a') then
    raise exception 'FAIL: erase_deal left rows behind';
  end if;
  if not exists (select 1 from public.agent_turns where deal_id = '00000000-0000-0000-0000-00000000d00b') then
    raise exception 'CRITICAL: erase_deal touched fund B';
  end if;
  -- Outside erase_deal, the append-only guard is back on.
  perform test_helpers.expect_denied('delete from public.agent_turns', 'delete after erasure');
  raise notice 'PASS: erasure';
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
do $$ begin
  perform test_helpers.expect_denied('select public.erase_deal(''00000000-0000-0000-0000-00000000d00b'', ''x'')', 'client calls erase_deal');
  raise notice 'PASS: erase_deal is server-only';
end $$;
reset role;

rollback;
