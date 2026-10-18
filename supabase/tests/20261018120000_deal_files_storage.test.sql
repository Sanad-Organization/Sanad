-- Tests for 20261018120000_deal_files_storage.sql
-- Fixture ids: fund A …000a (deal …d00a), fund B …000b (deal …d00b);
-- a1 owner A, a2 analyst A, a3 viewer A, b1 owner B, x1 no fund.
begin;

-- Objects as the storage server would write them (it inserts with the caller's role;
-- seeded here as the table owner so reads can be tested).
insert into storage.objects (bucket_id, name, owner) values
  ('deal-files', '00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-00000000d00a/11111111-1111-4111-8111-111111111111.pdf', '00000000-0000-0000-0000-0000000000a2'),
  ('deal-files', '00000000-0000-0000-0000-00000000000b/00000000-0000-0000-0000-00000000d00b/22222222-2222-4222-8222-222222222222.pdf', '00000000-0000-0000-0000-0000000000b1');

-- ---- Bucket ------------------------------------------------------------------
do $$ begin
  if (select public from storage.buckets where id = 'deal-files') then
    raise exception 'CRITICAL: deal-files bucket is public';
  end if;
  raise notice 'PASS: bucket is private';
end $$;

-- ---- Read isolation ----------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
do $$ declare n int; begin
  select count(*) into n from storage.objects where bucket_id = 'deal-files' and name like '00000000-0000-0000-0000-00000000000b/%';
  if n <> 0 then raise exception 'CRITICAL: viewer A sees % file(s) of fund B', n; end if;
  select count(*) into n from storage.objects where bucket_id = 'deal-files' and name like '00000000-0000-0000-0000-00000000000a/%';
  if n <> 1 then raise exception 'FAIL: viewer A sees % own file(s), expected 1', n; end if;
  raise notice 'PASS: viewer A reads only fund A files';
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
do $$ declare n int; begin
  select count(*) into n from storage.objects where name like '00000000-0000-0000-0000-00000000000a/%';
  if n <> 0 then raise exception 'CRITICAL: owner B sees % file(s) of fund A', n; end if;
  raise notice 'PASS: owner B reads no fund A files';
end $$;
reset role;

set local role anon;
select set_config('request.jwt.claims', '', true);
do $$ declare n int; begin
  select count(*) into n from storage.objects where bucket_id = 'deal-files';
  if n <> 0 then raise exception 'CRITICAL: anon sees % deal file(s)', n; end if;
  perform test_helpers.expect_denied(
    $q$insert into storage.objects (bucket_id, name) values ('deal-files', '00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-00000000d00a/33333333-3333-4333-8333-333333333333.pdf')$q$,
    'anon upload');
  raise notice 'PASS: anon reads and uploads nothing';
end $$;
reset role;

-- ---- Upload rules ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
do $$ begin
  -- analyst A may upload under fund A / deal A
  perform test_helpers.try($q$insert into storage.objects (bucket_id, name, owner) values ('deal-files', '00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-00000000d00a/44444444-4444-4444-8444-444444444444.pdf', '00000000-0000-0000-0000-0000000000a2')$q$);
  if not exists (select 1 from storage.objects where name like '%44444444-4444-4444-8444-444444444444.pdf') then
    raise exception 'FAIL: analyst A could not upload to own deal';
  end if;
  -- …but not under fund B, nor fund A with fund B's deal, nor a bad name, nor another bucket
  perform test_helpers.expect_denied($q$insert into storage.objects (bucket_id, name) values ('deal-files', '00000000-0000-0000-0000-00000000000b/00000000-0000-0000-0000-00000000d00b/55555555-5555-4555-8555-555555555555.pdf')$q$, 'analyst A upload to fund B');
  perform test_helpers.expect_denied($q$insert into storage.objects (bucket_id, name) values ('deal-files', '00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-00000000d00b/55555555-5555-4555-8555-555555555555.pdf')$q$, 'analyst A upload with fund B deal');
  perform test_helpers.expect_denied($q$insert into storage.objects (bucket_id, name) values ('deal-files', '00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-00000000d00a/../x.pdf')$q$, 'path traversal name');
  perform test_helpers.expect_denied($q$insert into storage.objects (bucket_id, name) values ('deal-files', '00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-00000000d00a/55555555-5555-4555-8555-555555555555.exe')$q$, 'disallowed extension');
  -- no overwrite, no delete
  perform test_helpers.try($q$update storage.objects set name = name || 'x' where bucket_id = 'deal-files'$q$);
  perform test_helpers.try($q$delete from storage.objects where bucket_id = 'deal-files'$q$);
  if (select count(*) from storage.objects where bucket_id = 'deal-files' and name like '00000000-0000-0000-0000-00000000000a/%' and name not like '%x') <> 2 then
    raise exception 'CRITICAL: analyst A changed or deleted a stored file';
  end if;
  raise notice 'PASS: analyst A uploads only under own fund and deal; no overwrite or delete';
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
do $$ begin
  perform test_helpers.expect_denied($q$insert into storage.objects (bucket_id, name) values ('deal-files', '00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-00000000d00a/66666666-6666-4666-8666-666666666666.pdf')$q$, 'viewer A upload');
  raise notice 'PASS: viewers cannot upload';
end $$;
reset role;

-- ---- register_file -------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
do $$ declare s1 uuid; s2 uuid; h text := repeat('ab', 32); n int; begin
  s1 := public.register_file('00000000-0000-0000-0000-00000000d00a',
    '00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-00000000d00a/11111111-1111-4111-8111-111111111111.pdf', h, 'Pitch deck');
  s2 := public.register_file('00000000-0000-0000-0000-00000000d00a',
    '00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-00000000d00a/11111111-1111-4111-8111-111111111111.pdf', h, 'Pitch deck');
  if s1 is null or s1 <> s2 then raise exception 'FAIL: register_file is not idempotent'; end if;
  select count(*) into n from public.sources where id = s1 and type = 'file' and tier = 4
     and storage_path = 'deal-files/00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-00000000d00a/11111111-1111-4111-8111-111111111111.pdf';
  if n <> 1 then raise exception 'FAIL: register_file did not create a tier-4 file source'; end if;

  perform test_helpers.expect_error($q$select public.register_file('00000000-0000-0000-0000-00000000d00b', '00000000-0000-0000-0000-00000000000b/00000000-0000-0000-0000-00000000d00b/22222222-2222-4222-8222-222222222222.pdf', repeat('cd', 32))$q$,
    'not allowed', 'analyst A registers fund B file', 'CRITICAL');
  perform test_helpers.expect_error($q$select public.register_file('00000000-0000-0000-0000-00000000d00a', '00000000-0000-0000-0000-00000000000b/00000000-0000-0000-0000-00000000d00b/22222222-2222-4222-8222-222222222222.pdf', repeat('cd', 32))$q$,
    'invalid file path', 'own deal with fund B path', 'CRITICAL');
  perform test_helpers.expect_error($q$select public.register_file('00000000-0000-0000-0000-00000000d00a', '00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-00000000d00a/77777777-7777-4777-8777-777777777777.pdf', repeat('cd', 32))$q$,
    'file not uploaded', 'unknown object');
  perform test_helpers.expect_error($q$select public.register_file('00000000-0000-0000-0000-00000000d00a', '00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-00000000d00a/11111111-1111-4111-8111-111111111111.pdf', 'nothex')$q$,
    'invalid sha256', 'bad hash');
  raise notice 'PASS: register_file rules';
end $$;
reset role;

-- files.parse queued exactly once
do $$ declare n int; begin
  select count(*) into n from app_jobs.jobs where kind = 'files.parse'
     and payload ->> 'deal_id' = '00000000-0000-0000-0000-00000000d00a';
  if n <> 1 then raise exception 'FAIL: % files.parse job(s), expected 1', n; end if;
  raise notice 'PASS: files.parse enqueued once';
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
do $$ begin
  perform test_helpers.expect_error($q$select public.register_file('00000000-0000-0000-0000-00000000d00a', '00000000-0000-0000-0000-00000000000a/00000000-0000-0000-0000-00000000d00a/11111111-1111-4111-8111-111111111111.pdf', repeat('ef', 32))$q$,
    'not allowed', 'viewer register_file', 'CRITICAL');
  raise notice 'PASS: viewers cannot register files';
end $$;
reset role;

rollback;
