-- fixtures.sql — committed once after the migrations; every test runs inside
-- begin … rollback on top of it. Fixed, readable ids:
--   fund A = …000a, fund B = …000b
--   users: a1 owner A, a2 analyst A, a3 viewer A, a4 partner A, b1 owner B,
--          x1 no fund, 5f staff (no fund)
--   per fund: company c00?, deal d00?, source 500?, finding f00?, score 5c0?,
--             question 9a0?, request e00?, connection cc0?, scan 5ca?, profile 9f0?
-- All names are synthetic. Never put a real company or person in a fixture.

create schema if not exists test_helpers;
grant usage on schema test_helpers to anon, authenticated, service_role;

create or replace function test_helpers.try(stmt text) returns text
language plpgsql as $$
begin
  execute stmt;
  return '';
exception when others then
  return coalesce(nullif(sqlerrm, ''), 'error ' || sqlstate);
end $$;

-- A write by a client must be refused by the grants (or RLS). Success = CRITICAL.
create or replace function test_helpers.expect_denied(stmt text, label text) returns void
language plpgsql as $$
declare msg text := test_helpers.try(stmt);
begin
  if msg = '' then
    raise exception 'CRITICAL: % was allowed (%)', label, stmt;
  end if;
  if msg !~* '(permission denied|row-level security|not allowed|append-only|cannot change|write-once)' then
    raise exception 'FAIL: % refused for an unexpected reason: %', label, msg;
  end if;
end $$;

-- A statement that must fail with a specific error (functional rule).
create or replace function test_helpers.expect_error(stmt text, pattern text, label text, level text default 'FAIL')
returns void language plpgsql as $$
declare msg text := test_helpers.try(stmt);
begin
  if msg = '' then
    raise exception '%: % succeeded but must fail', level, label;
  end if;
  if msg !~* pattern then
    raise exception 'FAIL: % failed for an unexpected reason: %', label, msg;
  end if;
end $$;

-- Rows visible in a table for a fund, as the current role. An error counts as 0
-- (anon has no grants at all).
create or replace function test_helpers.visible(tbl text, fund uuid) returns bigint
language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from %s where fund_id = $1', tbl) into n using fund;
  return n;
exception when insufficient_privilege then
  return 0;
end $$;

create or replace function test_helpers.visible_all(tbl text) returns bigint
language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from %s', tbl) into n;
  return n;
exception when insufficient_privilege then
  return 0;
end $$;

-- Own rows visible (else the test is vacuous), the other fund's invisible.
create or replace function test_helpers.assert_isolated(tbl text, own uuid, other uuid, who text) returns void
language plpgsql as $$
declare n_own bigint; n_other bigint; n_all bigint;
begin
  n_own := test_helpers.visible(tbl, own);
  n_other := test_helpers.visible(tbl, other);
  n_all := test_helpers.visible_all(tbl);
  if n_other <> 0 or n_all <> n_own then
    raise exception 'CRITICAL: % can read another fund''s rows in % (other=%, all=%, own=%)', who, tbl, n_other, n_all, n_own;
  end if;
  if n_own = 0 then
    raise exception 'FAIL: % sees no own rows in % (fixture missing; test would be vacuous)', who, tbl;
  end if;
end $$;

create or replace function test_helpers.assert_sees_nothing(tbl text, who text) returns void
language plpgsql as $$
declare n bigint := test_helpers.visible_all(tbl);
begin
  if n <> 0 then
    raise exception 'CRITICAL: % can read % row(s) in %', who, n, tbl;
  end if;
end $$;

-- Client writes on a table are refused: insert, update, delete, truncate.
create or replace function test_helpers.assert_no_client_writes(tbl text, who text) returns void
language plpgsql as $$
begin
  perform test_helpers.expect_denied(format('insert into %s (fund_id) values (''00000000-0000-0000-0000-00000000000a'')', tbl), who || ' insert ' || tbl);
  perform test_helpers.expect_denied(format('update %s set fund_id = fund_id', tbl), who || ' update ' || tbl);
  perform test_helpers.expect_denied(format('delete from %s', tbl), who || ' delete ' || tbl);
  perform test_helpers.expect_denied(format('truncate %s', tbl), who || ' truncate ' || tbl);
end $$;

-- Run a statement as the table owner (tests only): for setting up states such
-- as an expired lease, and for proving triggers hold even for the owner.
create or replace function test_helpers.owner_exec(stmt text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  execute stmt;
end $$;

grant execute on all functions in schema test_helpers to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner-a@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'analyst-a@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'viewer-a@example.test'),
  ('00000000-0000-0000-0000-0000000000a4', 'partner-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'owner-b@example.test'),
  ('00000000-0000-0000-0000-0000000000f1', 'nobody@example.test'),
  ('00000000-0000-0000-0000-00000000005f', 'staff@example.test');

insert into public.funds (id, name, region) values
  ('00000000-0000-0000-0000-00000000000a', 'Fund A (synthetic)', 'mena'),
  ('00000000-0000-0000-0000-00000000000b', 'Fund B (synthetic)', 'africa');

insert into public.memberships (fund_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'analyst'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', 'viewer'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a4', 'partner'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'owner');

insert into app_auth.staff (user_id) values ('00000000-0000-0000-0000-00000000005f');

do $$
declare
  f text; fid uuid; e extensions.vector := array_fill(0.01, array[1024])::real[]::extensions.vector;
begin
  foreach f in array array['a','b'] loop
    fid := ('00000000-0000-0000-0000-00000000000' || f)::uuid;
    insert into public.audit_log (fund_id, actor, action, target_table, target_id)
      values (fid, null, 'fixture.created', 'funds', fid::text);
    insert into public.companies (id, fund_id, name, website, country)
      values (('00000000-0000-0000-0000-00000000c00' || f)::uuid, fid, 'Synthetic Co ' || upper(f), 'https://example.test/' || f, 'AE');
    insert into public.deals (id, fund_id, company_id, github_urls)
      values (('00000000-0000-0000-0000-00000000d00' || f)::uuid, fid, ('00000000-0000-0000-0000-00000000c00' || f)::uuid,
              array['https://github.com/synthetic-' || f || '/app']);
    insert into public.sources (id, fund_id, deal_id, type, tier, title, url, content_hash)
      values (('00000000-0000-0000-0000-00000000500' || f)::uuid, fid, ('00000000-0000-0000-0000-00000000d00' || f)::uuid,
              'website', 3, 'Home page', 'https://example.test/' || f, repeat(f, 64));
    insert into public.chunks (fund_id, deal_id, source_id, ord, text, embedding)
      values (fid, ('00000000-0000-0000-0000-00000000d00' || f)::uuid, ('00000000-0000-0000-0000-00000000500' || f)::uuid,
              0, 'We use machine learning for credit scoring in fund ' || f, e);
    insert into public.claims (fund_id, deal_id, source_id, statement, category)
      values (fid, ('00000000-0000-0000-0000-00000000d00' || f)::uuid, ('00000000-0000-0000-0000-00000000500' || f)::uuid,
              'Proprietary AI model', 'ai');
    insert into public.findings (id, fund_id, deal_id, dimension, type, severity, title, explanation, source_ids, analyzer)
      values (('00000000-0000-0000-0000-00000000f00' || f)::uuid, fid, ('00000000-0000-0000-0000-00000000d00' || f)::uuid,
              'tech_reality', 'red_flag', 4, 'AI claim is an API wrapper', 'Calls a hosted model only.',
              array[('00000000-0000-0000-0000-00000000500' || f)::uuid], 'ai_usage');
    insert into public.finding_overrides (fund_id, deal_id, finding_id, action, reason, created_by)
      values (fid, ('00000000-0000-0000-0000-00000000d00' || f)::uuid, ('00000000-0000-0000-0000-00000000f00' || f)::uuid,
              'confirm', 'Checked by hand', ('00000000-0000-0000-0000-0000000000' || f || '1')::uuid);
    insert into public.scores (id, fund_id, deal_id, version, dimensions, overall, confidence, verdict, model)
      values (('00000000-0000-0000-0000-000000005c0' || f)::uuid, fid, ('00000000-0000-0000-0000-00000000d00' || f)::uuid,
              1, '{}', 61, 'medium', 'conditional', 'claude-sonnet-5-5');
    insert into public.questions (id, fund_id, deal_id, finding_id, text)
      values (('00000000-0000-0000-0000-000000009a0' || f)::uuid, fid, ('00000000-0000-0000-0000-00000000d00' || f)::uuid,
              ('00000000-0000-0000-0000-00000000f00' || f)::uuid, 'Which model do you train yourselves?');
    insert into public.agent_turns (fund_id, deal_id, user_id, question, answer, cited_source_ids, model)
      values (fid, ('00000000-0000-0000-0000-00000000d00' || f)::uuid, ('00000000-0000-0000-0000-0000000000' || f || '1')::uuid,
              'Is the AI real?', 'It wraps a hosted model.', array[('00000000-0000-0000-0000-00000000500' || f)::uuid], 'claude-sonnet-5-5');

    insert into public.repo_access_requests (id, fund_id, deal_id, founder_email, token_hash)
      values (('00000000-0000-0000-0000-00000000e00' || f)::uuid, fid, ('00000000-0000-0000-0000-00000000d00' || f)::uuid,
              'founder-' || f || '@example.test', encode(sha256(convert_to('fixture-token-' || f, 'UTF8')), 'hex'));
    insert into public.repo_connections (id, fund_id, deal_id, repo_id, repo_full_name, visibility, default_branch)
      values (('00000000-0000-0000-0000-00000000cc0' || f)::uuid, fid, ('00000000-0000-0000-0000-00000000d00' || f)::uuid,
              case f when 'a' then 1001 else 1002 end, 'synthetic-' || f || '/app', 'public', 'main');
    insert into public.scans (id, fund_id, deal_id, connection_id, scanned_ref, commit_sha, status)
      values (('00000000-0000-0000-0000-000000005ca' || f)::uuid, fid, ('00000000-0000-0000-0000-00000000d00' || f)::uuid,
              ('00000000-0000-0000-0000-00000000cc0' || f)::uuid, 'head', repeat(f, 40), 'running');
    insert into public.code_issues (fund_id, deal_id, scan_id, category, tool, rule_id, severity, title, fingerprint)
      values (fid, ('00000000-0000-0000-0000-00000000d00' || f)::uuid, ('00000000-0000-0000-0000-000000005ca' || f)::uuid,
              'secret', 'gitleaks', 'aws-access-token', 5, 'Cloud key in history', repeat(f, 64));

    insert into public.social_profiles (id, fund_id, deal_id, platform, handle, url)
      values (('00000000-0000-0000-0000-000000009f0' || f)::uuid, fid, ('00000000-0000-0000-0000-00000000d00' || f)::uuid,
              'x', 'synthetic_' || f, 'https://x.com/synthetic_' || f);
    insert into public.profile_snapshots (fund_id, deal_id, profile_id, followers)
      values (fid, ('00000000-0000-0000-0000-00000000d00' || f)::uuid, ('00000000-0000-0000-0000-000000009f0' || f)::uuid, 1200);
    insert into public.mentions (fund_id, deal_id, profile_id, platform, external_id, kind, text)
      values (fid, ('00000000-0000-0000-0000-00000000d00' || f)::uuid, ('00000000-0000-0000-0000-000000009f0' || f)::uuid,
              'x', 'post-' || f, 'post', 'The app keeps crashing at checkout');
    insert into public.social_summaries (fund_id, deal_id, version, items_analyzed, sentiment, pain_points, praise, traction, model)
      values (fid, ('00000000-0000-0000-0000-00000000d00' || f)::uuid, 1, 1, '{}', '[]', '[]', '[]', 'claude-haiku-4-5');
  end loop;
end $$;
