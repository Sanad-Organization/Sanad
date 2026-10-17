-- Tests for 20261013090300_repo_scans.sql
begin;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
do $$ declare t text; begin
  foreach t in array array['public.repo_connections','public.scans','public.code_issues'] loop
    perform test_helpers.assert_isolated(t, '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 'analyst A');
    perform test_helpers.assert_no_client_writes(t, 'analyst A');
  end loop;
  -- repo_access_requests: column grants, so count by hand.
  if (select count(*) from public.repo_access_requests where fund_id = '00000000-0000-0000-0000-00000000000b') <> 0 then
    raise exception 'CRITICAL: analyst A can read fund B access requests';
  end if;
  if (select count(id) from public.repo_access_requests) <> 1 then
    raise exception 'FAIL: analyst A cannot see own access request';
  end if;
  perform test_helpers.expect_denied('select token_hash from public.repo_access_requests', 'reading token hashes');
  perform test_helpers.expect_denied('update public.repo_access_requests set status = ''granted''', 'granting access by update');
  raise notice 'PASS: repo isolation and no client writes (A)';
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
do $$ declare t text; begin
  foreach t in array array['public.repo_connections','public.scans','public.code_issues'] loop
    perform test_helpers.assert_isolated(t, '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', 'owner B');
  end loop;
  raise notice 'PASS: repo isolation (B)';
end $$;
reset role;

-- ---- The access link ---------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
create temp table t_tok (tok text) on commit drop;
grant all on t_tok to authenticated, service_role;
do $$ declare tok text; tok2 text; begin
  tok := public.request_repo_access('00000000-0000-0000-0000-00000000d00a', 'Founder@Example.test');
  if tok !~ '^[0-9a-f]{64}$' then raise exception 'FAIL: token shape %', tok; end if;
  tok2 := public.request_repo_access('00000000-0000-0000-0000-00000000d00a', 'founder@example.test');
  if tok2 = tok then raise exception 'CRITICAL: tokens repeat'; end if;
  if (select count(*) from public.repo_access_requests where deal_id = '00000000-0000-0000-0000-00000000d00a' and status = 'sent') <> 1 then
    raise exception 'FAIL: more than one open link per deal';
  end if;
  insert into t_tok values (tok), (tok2);
  perform test_helpers.expect_denied('select public.request_repo_access(''00000000-0000-0000-0000-00000000d00b'', ''x@example.test'')', 'link for a fund B deal');
  perform test_helpers.expect_denied('select * from public.ingress_claim_access_request(repeat(''a'', 64))', 'client claims a link');
  perform test_helpers.expect_denied('select public.redact_old_founder_emails()', 'client runs redaction');
  raise notice 'PASS: access link creation';
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
do $$ begin
  perform test_helpers.expect_denied('select public.request_repo_access(''00000000-0000-0000-0000-00000000d00a'', ''x@example.test'')', 'viewer creates a link');
  raise notice 'PASS: viewer cannot request access';
end $$;
reset role;

set local role service_role;
do $$ declare n int; h_old text; h_new text; begin
  select encode(sha256(convert_to(tok, 'UTF8')), 'hex') into h_old from t_tok limit 1;
  select encode(sha256(convert_to(tok, 'UTF8')), 'hex') into h_new from t_tok offset 1 limit 1;
  if exists (select 1 from public.repo_access_requests r join t_tok t on r.token_hash = t.tok) then
    raise exception 'CRITICAL: a raw token is stored';
  end if;
  select count(*) into n from public.ingress_claim_access_request(h_old);
  if n <> 0 then raise exception 'CRITICAL: a replaced link still works'; end if;
  select count(*) into n from public.ingress_claim_access_request(h_new);
  if n <> 1 then raise exception 'FAIL: the current link does not work'; end if;
  select count(*) into n from public.ingress_claim_access_request(h_new);
  if n <> 0 then raise exception 'CRITICAL: a link works twice'; end if;
  select count(*) into n from public.ingress_claim_access_request(repeat('0', 64));
  if n <> 0 then raise exception 'CRITICAL: an unknown hash claimed a request'; end if;
  raise notice 'PASS: access link works once';
end $$;

-- Expired links don't work, and founder emails are dropped 30 days after close.
do $$ declare n int; begin
  perform test_helpers.owner_exec('update public.repo_access_requests set expires_at = now() - interval ''1 day'' where id = ''00000000-0000-0000-0000-00000000e00b''');
  select count(*) into n from public.ingress_claim_access_request(encode(sha256(convert_to('fixture-token-b', 'UTF8')), 'hex'));
  if n <> 0 then raise exception 'CRITICAL: an expired link works'; end if;
  perform public.redact_old_founder_emails();
  perform test_helpers.owner_exec('update public.repo_access_requests set closed_at = now() - interval ''31 days'' where id = ''00000000-0000-0000-0000-00000000e00b''');
  perform public.redact_old_founder_emails();
  if (select founder_email from public.repo_access_requests where id = '00000000-0000-0000-0000-00000000e00b') is not null then
    raise exception 'FAIL: founder email kept past 30 days';
  end if;
  raise notice 'PASS: expiry and email redaction';
end $$;

-- ---- Scans ------------------------------------------------------------------
do $$ begin
  perform test_helpers.expect_error(
    'update public.scans set status = ''done'', finished_at = now(), tool_versions = ''{}'', vuln_db_date = current_date where id = ''00000000-0000-0000-0000-000000005caa''',
    'check constraint', 'scan done before the sandbox is destroyed', 'CRITICAL');
  update public.scans set status = 'done', finished_at = now(), tool_versions = '{"trivy":"x"}', vuln_db_date = current_date,
                          sandbox_destroyed_at = now()
   where id = '00000000-0000-0000-0000-000000005caa';
  perform test_helpers.expect_error(
    'insert into public.repo_connections (fund_id, deal_id, repo_id, repo_full_name, visibility, default_branch) values (''00000000-0000-0000-0000-00000000000a'', ''00000000-0000-0000-0000-00000000d00a'', 9, ''x/y'', ''private'', ''main'')',
    'check constraint', 'private repo without an installation');
  perform test_helpers.expect_error(
    'insert into public.code_issues (fund_id, deal_id, scan_id, category, tool, rule_id, severity, title, fingerprint) values (''00000000-0000-0000-0000-00000000000a'', ''00000000-0000-0000-0000-00000000d00a'', ''00000000-0000-0000-0000-000000005cab'', ''secret'', ''gitleaks'', ''r'', 5, ''t'', repeat(''9'', 64))',
    'foreign key', 'issue on deal A pointing at scan B', 'CRITICAL');
  raise notice 'PASS: scan rules';
end $$;
reset role;

-- code_issues must never be able to hold code or secret values.
do $$ declare bad text; begin
  select string_agg(column_name, ', ') into bad
    from information_schema.columns
   where table_schema = 'public' and table_name = 'code_issues'
     and column_name ~* '(snippet|secret|match|code|value|content|line_text|raw)';
  if bad is not null then
    raise exception 'CRITICAL: code_issues has columns that could hold code or secrets: %', bad;
  end if;
  raise notice 'PASS: code_issues holds no code';
end $$;

rollback;
