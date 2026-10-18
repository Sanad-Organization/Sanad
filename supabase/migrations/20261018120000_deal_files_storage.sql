-- 20261018120000_deal_files_storage.sql
--
-- Context:   SPEC-collect-web slice 1. Funds upload decks and other files for a
--            deal; the worker parses them (files.parse). ADR 0002: browsers never
--            write tables, so the upload itself is the only client write, and it
--            lands in Storage under the fund's own prefix.
-- Changes:   private bucket `deal-files` (PDF, PPTX, XLSX, ≤ 50 MB);
--            storage.objects policies: members READ their fund's prefix;
--            owner/partner/analyst INSERT at <fund_id>/<deal_id>/<uuid>.<ext> for a
--            deal of that fund. No update or delete policy: an upload is evidence
--            and can't be overwritten or removed by a client (erasure goes
--            through erase_deal + the worker).
--            RPC register_file(deal, path, sha256, title) turns an uploaded
--            object into a tier-4 source and enqueues files.parse.
-- Not here:  parsing (worker), erasing the stored objects of an erased deal
--            (worker job, COLLECT-WEB slice 2; until then the erase runbook
--            deletes the folder after erase_deal). Downloads: the deal room
--            mints short-lived signed URLs server-side (COLLECT-WEB slice 2).
-- Pre-check: none (new bucket and policies).
-- Test:      supabase/tests/20261018120000_deal_files_storage.test.sql

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('deal-files', 'deal-files', false, 52428800, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Object names: <fund uuid>/<deal uuid>/<file uuid>.<pdf|pptx|xlsx>, lowercase.
create function app_auth.deal_file_parts(p_name text)
returns uuid[] language plpgsql immutable set search_path = '' as $$
declare m text[];
begin
  m := regexp_match(p_name,
    '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|pptx|xlsx)$');
  if m is null then return null; end if;
  return array[m[1]::uuid, m[2]::uuid];
end $$;

-- Readable only while the deal exists: after erase_deal, nobody reads its files
-- even before the worker removes the objects.
create function app_auth.can_read_deal_file(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p[1] = any (app_auth.my_fund_ids())
       and exists (select 1 from public.deals d where d.id = p[2] and d.fund_id = p[1])
      from (select app_auth.deal_file_parts(p_name) as p) x
     where p is not null), false)
$$;

create function app_auth.can_upload_deal_file(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select app_auth.has_role(p[1], array['owner','partner','analyst'])
       and exists (select 1 from public.deals d where d.id = p[2] and d.fund_id = p[1])
      from (select app_auth.deal_file_parts(p_name) as p) x
     where p is not null), false)
$$;

revoke all on function app_auth.deal_file_parts(text), app_auth.can_read_deal_file(text),
  app_auth.can_upload_deal_file(text) from public;
-- Policies run as the caller, so the helpers must stay executable by signed-in users.
grant execute on function app_auth.deal_file_parts(text), app_auth.can_read_deal_file(text),
  app_auth.can_upload_deal_file(text) to authenticated, service_role;

create policy deal_files_member_read on storage.objects for select to authenticated
  using (bucket_id = 'deal-files' and app_auth.can_read_deal_file(name));
-- owner_id is set by the Storage API from the JWT; checking it as well means a
-- client can never attribute an upload to someone else.
create policy deal_files_member_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'deal-files' and owner_id = (select auth.uid())::text
              and app_auth.can_upload_deal_file(name));

-- One source per stored object.
create unique index sources_deal_storage_path_key on public.sources (deal_id, storage_path)
  where storage_path is not null;

-- Uploaded object → source (tier 4: files a fund receives carry the founder's
-- claims) → files.parse. The caller supplies the SHA-256 of the bytes; the
-- worker recomputes it in files.parse and fails the job permanently on a
-- mismatch. Idempotent per object: registering the same path again returns the
-- same source; the same bytes under a second path are refused (23505).
create function public.register_file(p_deal uuid, p_path text, p_sha256 text, p_title text default null)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_fund uuid; v_parts uuid[]; v_source uuid; v_hash text; v_storage text; v_title text;
begin
  select fund_id into v_fund from public.deals where id = p_deal;
  perform app_auth.require_role(v_fund, array['owner','partner','analyst']);

  v_parts := app_auth.deal_file_parts(p_path);
  if v_parts is null or v_parts[1] <> v_fund or v_parts[2] <> p_deal then
    raise exception 'invalid file path' using errcode = '22023';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid sha256' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'deal-files' and o.name = p_path) then
    raise exception 'file not uploaded' using errcode = '22023';
  end if;
  v_storage := 'deal-files/' || p_path;

  select s.id, s.content_hash into v_source, v_hash from public.sources s
   where s.deal_id = p_deal and s.storage_path = v_storage;
  if v_source is not null then
    if v_hash <> p_sha256 then
      raise exception 'file already registered with another hash' using errcode = '22023';
    end if;
    return v_source;
  end if;

  -- Titles often come from file names, which the founder chose: strip control
  -- and bidi characters so they can't spoof the deal room; keep the rest as data.
  v_title := nullif(left(btrim(regexp_replace(coalesce(p_title, ''),
               '[[:cntrl:]\u200e\u200f\u202a-\u202e\u2066-\u2069]', '', 'g')), 500), '');

  begin
    insert into public.sources (fund_id, deal_id, type, tier, title, storage_path, content_hash)
    values (v_fund, p_deal, 'file', 4, v_title, v_storage, p_sha256)
    returning id into v_source;
  exception when unique_violation then
    raise exception 'this file is already in the deal' using errcode = '23505';
  end;

  perform app_jobs.enqueue('files.parse', jsonb_build_object('deal_id', p_deal, 'storage_path', v_storage),
                           v_fund, 'file:' || v_source);
  perform app_auth.audit(v_fund, 'file.registered', 'sources', v_source::text);
  return v_source;
end $$;

revoke all on function public.register_file(uuid, text, text, text) from public, anon;
grant execute on function public.register_file(uuid, text, text, text) to authenticated, service_role;
