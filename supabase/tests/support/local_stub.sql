-- local_stub.sql
--
-- Makes a plain Postgres 16 (+ pgvector) look like a Supabase database for the
-- migration tests in CI and on a laptop: the auth schema, auth.uid(), the three
-- API roles, and Supabase's default grants (which give anon and authenticated
-- ALL on new public tables and EXECUTE on new public functions; the migrations
-- must revoke what they don't want, so the stub reproduces the danger).
--
-- Never run against a hosted Supabase project. scripts/db-test.sh refuses to.

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'auth')
     and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'auth' and p.proname = 'uid' and pg_get_functiondef(p.oid) not like '%local_stub%') then
    raise exception 'local_stub.sql: this looks like a real Supabase database; refusing';
  end if;
end $$;

do $$ begin
  create role anon nologin noinherit;
exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin noinherit;
exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin noinherit bypassrls;
exception when duplicate_object then null; end $$;

create schema if not exists extensions;
create extension if not exists vector with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key,
  email text unique
);

-- Same contract as Supabase: the caller's id comes from the request's JWT claims.
create or replace function auth.uid() returns uuid
language sql stable as $$
  -- local_stub
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;
create or replace function auth.role() returns text
language sql stable as $$
  -- local_stub
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
$$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Supabase Storage, the parts the migrations touch: buckets, objects (RLS on,
-- with Supabase's default ALL grants to anon and authenticated, so policies are
-- the only guard, as on the hosted project) and storage.foldername().
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;
create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  owner uuid,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
grant all on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare _parts text[];
begin
  -- local_stub (same result as Supabase's)
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end $$;
