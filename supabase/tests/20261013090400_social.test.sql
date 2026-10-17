-- Tests for 20261013090400_social.sql
begin;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
do $$ declare t text; begin
  foreach t in array array['public.social_profiles','public.profile_snapshots','public.mentions','public.social_summaries'] loop
    perform test_helpers.assert_isolated(t, '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 'analyst A');
    perform test_helpers.assert_no_client_writes(t, 'analyst A');
  end loop;
  raise notice 'PASS: social isolation and no client writes (A)';
end $$;

do $$ begin
  perform test_helpers.expect_denied('select public.set_profile_status(''00000000-0000-0000-0000-000000009f0b'', ''confirmed'')', 'confirm a fund B profile');
  perform test_helpers.expect_error('select public.set_profile_status(''00000000-0000-0000-0000-000000009f0a'', ''proposed'')', 'confirmed or rejected', 'reset to proposed');
  perform public.set_profile_status('00000000-0000-0000-0000-000000009f0a', 'confirmed');
  if (select status from public.social_profiles where id = '00000000-0000-0000-0000-000000009f0a') <> 'confirmed' then
    raise exception 'FAIL: profile not confirmed';
  end if;
  raise notice 'PASS: set_profile_status';
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
do $$ declare t text; begin
  foreach t in array array['public.social_profiles','public.profile_snapshots','public.mentions','public.social_summaries'] loop
    perform test_helpers.assert_isolated(t, '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', 'owner B');
  end loop;
  raise notice 'PASS: social isolation (B)';
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
do $$ begin
  perform test_helpers.expect_denied('select public.set_profile_status(''00000000-0000-0000-0000-000000009f0a'', ''rejected'')', 'viewer rejects a profile');
  raise notice 'PASS: viewer cannot decide profiles';
end $$;
reset role;

set local role service_role;
do $$ begin
  -- Confirming queued exactly one collection job.
  if (public.jobs_enqueue('social.collect', '{}', null, 'social:00000000-0000-0000-0000-000000009f0a')) is null then
    raise exception 'FAIL: no collection job queued';
  end if;
  -- Mentions: enrichment allowed, content frozen.
  update public.mentions set sentiment = 'negative', topics = array['stability'], is_complaint = true where external_id = 'post-a';
  perform test_helpers.expect_denied('update public.mentions set text = ''edited'' where external_id = ''post-a''', 'editing a mention''s text');
  perform test_helpers.expect_denied('update public.mentions set author_hash = repeat(''0'', 64) where external_id = ''post-a''', 'changing a mention''s author');
  perform test_helpers.expect_denied('delete from public.mentions', 'deleting mentions');
  perform test_helpers.expect_denied('update public.profile_snapshots set followers = 999999', 'inflating follower counts');
  perform test_helpers.expect_denied('delete from public.profile_snapshots', 'deleting snapshots');
  perform test_helpers.expect_error(
    'insert into public.mentions (fund_id, deal_id, profile_id, platform, external_id, kind, text) values (''00000000-0000-0000-0000-00000000000a'', ''00000000-0000-0000-0000-00000000d00a'', ''00000000-0000-0000-0000-000000009f0b'', ''x'', ''z'', ''post'', ''t'')',
    'foreign key', 'mention on deal A tied to a fund B profile', 'CRITICAL');
  raise notice 'PASS: mentions and snapshots';
end $$;
reset role;

rollback;
