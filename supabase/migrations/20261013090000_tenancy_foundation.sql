-- 20261013090000_tenancy_foundation.sql
--
-- Context:   ADR 0002 (tenant = fund; browsers never write tables). Every later
--            migration builds on the helpers defined here.
-- Changes:   private schema app_auth with the RLS helpers and generic triggers;
--            tables funds, memberships, staff, audit_log; read-only RLS on all.
-- Not here:  membership management. In the pilot, Sanad staff add funds and
--            members with the service role (runbook docs/runbooks/add-fund.md);
--            a self-serve invite flow is BACKLOG item TEAM-INVITES.
--            Staff get NO read access to fund data (ADR 0002): staff only see
--            operational tables (jobs, dead letters).
-- Pre-check: none (new tables).
-- Test:      supabase/tests/20261013090000_tenancy_foundation.test.sql

-- ---------------------------------------------------------------------------
-- Private schema for definer helpers. Not exposed by the REST layer.
-- ---------------------------------------------------------------------------
create schema app_auth;
revoke all on schema app_auth from public;
grant usage on schema app_auth to anon, authenticated, service_role;

-- Generic triggers -----------------------------------------------------------
create function app_auth.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Append-only: used as a BEFORE UPDATE OR DELETE row trigger AND a BEFORE
-- TRUNCATE statement trigger (row triggers never see TRUNCATE).
-- The one exception: erasure (ADR 0005). public.erase_deal / erase_fund set
-- sanad.erasure = 'on' for their own transaction so a cascade can remove the
-- rows. Clients can't reach it: they have no DELETE grant on any table.
create function app_auth.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('sanad.erasure', true) = 'on' then
    return old;
  end if;
  raise exception 'append-only table %: % is not allowed', tg_table_name, tg_op
    using errcode = '42501';
end $$;

-- Server-stamped created_at on append-only rows: the caller can't backdate.
create function app_auth.stamp_created_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_at := now();
  return new;
end $$;

revoke all on function app_auth.set_updated_at(), app_auth.forbid_mutation(),
  app_auth.stamp_created_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.funds (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  -- pilot | licence | per_deal (ADR 0001 pricing; billing itself is not in the MVP)
  plan text not null default 'pilot' check (plan in ('pilot','licence','per_deal')),
  -- Founders may answer a self-assessment only if the fund allows it (decision 3).
  allow_founder_self_assessment boolean not null default false,
  region text not null default 'mena' check (region in ('mena','africa','both')),
  -- Score weights per dimension, e.g. {"tech_reality": 0.2}. Empty = Sanad defaults.
  -- Parsed with a schema in the worker before use (jsonb without a type CHECK).
  weights jsonb not null default '{}' check (jsonb_typeof(weights) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  fund_id uuid not null references public.funds (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- owner: manages the fund; partner: approves scores and decisions;
  -- analyst: runs deals; viewer: reads only.
  role text not null check (role in ('owner','partner','analyst','viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (fund_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

-- Sanad operators. Lives in app_auth: nobody outside the server can list staff.
create table app_auth.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
revoke all on app_auth.staff from public, anon, authenticated;

-- Audit log: append-only, server-stamped, ids only (no personal data, so
-- erasure never has to touch it; ADR 0005).
create table public.audit_log (
  id bigint generated always as identity primary key,
  fund_id uuid not null references public.funds (id) on delete cascade,
  actor uuid,                               -- null = Sanad worker
  action text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  target_table text not null check (target_table ~ '^[a-z_]+$'),
  target_id text not null check (length(target_id) <= 64),
  detail jsonb not null default '{}' check (octet_length(detail::text) <= 4096),
  created_at timestamptz not null default now()
);
create index audit_log_fund_idx on public.audit_log (fund_id, created_at desc);

create trigger audit_log_stamp before insert on public.audit_log
  for each row execute function app_auth.stamp_created_at();
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function app_auth.forbid_mutation();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app_auth.forbid_mutation();

create trigger funds_updated_at before update on public.funds
  for each row execute function app_auth.set_updated_at();
create trigger memberships_updated_at before update on public.memberships
  for each row execute function app_auth.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS helpers: language sql stable security definer set search_path = ''.
-- Policies call them as (select fn()) so they run once per statement.
-- Never revoke EXECUTE on these from anon/authenticated: policies run as the
-- caller and every query would break.
-- ---------------------------------------------------------------------------
create function app_auth.my_fund_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(m.fund_id), '{}')
  from public.memberships m
  where m.user_id = auth.uid()
$$;

create function app_auth.has_role(p_fund uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.fund_id = p_fund and m.user_id = auth.uid() and m.role = any (p_roles)
  )
$$;

create function app_auth.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app_auth.staff s where s.user_id = auth.uid())
$$;

grant execute on function app_auth.my_fund_ids(), app_auth.has_role(uuid, text[]),
  app_auth.is_staff() to anon, authenticated, service_role;

-- Used inside user RPCs: raise unless the caller holds one of the roles.
create function app_auth.require_role(p_fund uuid, p_roles text[]) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not app_auth.has_role(p_fund, p_roles) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end $$;
revoke all on function app_auth.require_role(uuid, text[]) from public, anon;
grant execute on function app_auth.require_role(uuid, text[]) to authenticated, service_role;

-- Writes an audit row. Only callable from definer RPCs and the service role.
create function app_auth.audit(p_fund uuid, p_action text, p_table text, p_id text,
                               p_detail jsonb default '{}')
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.audit_log (fund_id, actor, action, target_table, target_id, detail)
  values (p_fund, auth.uid(), p_action, p_table, p_id, coalesce(p_detail, '{}'))
$$;
revoke all on function app_auth.audit(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function app_auth.audit(uuid, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- RLS: read-only for members; no insert/update/delete policies at all.
-- ---------------------------------------------------------------------------
alter table public.funds enable row level security;
alter table public.memberships enable row level security;
alter table public.audit_log enable row level security;

create policy funds_member_read on public.funds for select
  using (id = any ((select app_auth.my_fund_ids())::uuid[]));
create policy memberships_member_read on public.memberships for select
  using (fund_id = any ((select app_auth.my_fund_ids())::uuid[]));
-- Partners and owners read their fund's audit log.
create policy audit_log_partner_read on public.audit_log for select
  using (fund_id = any ((select app_auth.my_fund_ids())::uuid[])
         and app_auth.has_role(fund_id, array['owner','partner']));

revoke insert, update, delete, truncate on public.funds, public.memberships, public.audit_log
  from anon, authenticated;
revoke all on public.funds, public.memberships, public.audit_log from anon;
