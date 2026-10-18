-- Catalogue sweep: runs last, over the whole schema. Catches what per-table
-- tests can miss when a later migration forgets the recipe.
begin;

do $$ declare bad text; begin
  -- 1. Every table in exposed or private schemas has RLS on.
  select string_agg(n.nspname || '.' || c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r','p') and n.nspname in ('public','app_auth','app_jobs')
     and not c.relrowsecurity
     and not (n.nspname = 'app_auth' and c.relname = 'staff');   -- no grants at all; read by definer helpers only
  if bad is not null then raise exception 'CRITICAL: tables without RLS: %', bad; end if;

  -- 2. No write policies anywhere: writes go through RPCs and the service role.
  select string_agg(schemaname || '.' || tablename || '.' || policyname, ', ') into bad
    from pg_policies where schemaname in ('public','app_auth','app_jobs') and cmd <> 'SELECT';
  if bad is not null then raise exception 'CRITICAL: write policies exist: %', bad; end if;

  -- 3. Clients hold no write privilege on any table.
  select string_agg(distinct table_schema || '.' || table_name || ':' || grantee || ':' || privilege_type, ', ') into bad
    from information_schema.role_table_grants
   where table_schema in ('public','app_auth','app_jobs') and grantee in ('anon','authenticated')
     and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
  if bad is not null then raise exception 'CRITICAL: client write grants: %', bad; end if;

  -- 4. anon can read nothing.
  select string_agg(distinct table_schema || '.' || table_name, ', ') into bad
    from information_schema.role_table_grants
   where table_schema in ('public','app_auth','app_jobs') and grantee = 'anon';
  if bad is not null then raise exception 'CRITICAL: anon has table grants: %', bad; end if;

  -- 5. Leaked definers: no SECURITY DEFINER function in public is executable by anon.
  select string_agg(p.oid::regprocedure::text, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
  if bad is not null then raise exception 'CRITICAL: definer functions executable by anon: %', bad; end if;

  -- 6. Definers executable by signed-in users are exactly the reviewed user RPCs.
  select string_agg(p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')
     and p.proname not in ('create_deal','set_deal_status','request_rescore','override_finding','approve_score',
                           'set_question_status','log_agent_turn','request_repo_access','set_profile_status',
                           'register_file');
  if bad is not null then raise exception 'CRITICAL: unreviewed definer RPCs open to users: %', bad; end if;

  -- 7. Every definer function pins search_path to ''.
  select string_agg(n.nspname || '.' || p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','app_auth','app_jobs') and p.prosecdef
     and not coalesce(p.proconfig @> array['search_path=""'], false);
  if bad is not null then raise exception 'CRITICAL: definer functions without search_path='''': %', bad; end if;

  -- 8. Every table with fund_id has it NOT NULL (ops jobs excepted).
  select string_agg(table_schema || '.' || table_name, ', ') into bad
    from information_schema.columns
   where table_schema in ('public') and column_name = 'fund_id' and is_nullable = 'YES';
  if bad is not null then raise exception 'CRITICAL: nullable fund_id: %', bad; end if;

  -- 9. Every public table is tenant-scoped (has fund_id) or is funds itself.
  select string_agg(c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'funds'
     and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'fund_id' and not a.attisdropped);
  if bad is not null then raise exception 'CRITICAL: public tables without fund_id: %', bad; end if;

  -- 10. Storage: the only client policies on storage.objects are the reviewed
  --     deal-files read and insert; no client may update or delete an object.
  select string_agg(policyname || ':' || cmd, ', ') into bad
    from pg_policies where schemaname = 'storage' and tablename = 'objects'
     and (policyname, cmd) not in (('deal_files_member_read','SELECT'), ('deal_files_member_insert','INSERT'));
  if bad is not null then raise exception 'CRITICAL: unreviewed storage policies: %', bad; end if;

  -- 11. No bucket is public.
  select string_agg(id, ', ') into bad from storage.buckets where public;
  if bad is not null then raise exception 'CRITICAL: public storage buckets: %', bad; end if;

  raise notice 'PASS: catalogue sweep';
end $$;

rollback;
