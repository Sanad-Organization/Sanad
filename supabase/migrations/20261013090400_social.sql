-- 20261013090400_social.sql
--
-- Context:   ADR 0004 (social overview from official APIs and public,
--            logged-out data; authors are never stored by name).
-- Changes:   platform enum; social_profiles, profile_snapshots, mentions,
--            social_summaries with composite (…, deal_id, fund_id) keys;
--            read-only RLS; snapshots and mentions append-only.
--            User RPC: set_profile_status (confirm or reject a found profile).
-- Not here:  collection and analysis (worker jobs social.discover,
--            social.collect, social.analyze).
-- Pre-check: none (new tables).
-- Test:      supabase/tests/20261013090400_social.test.sql

create type public.platform as enum
  ('website','x','instagram','facebook','tiktok','linkedin','reddit','app_store','google_play','news','web');

-- Profiles Sanad found for a company. Only 'confirmed' profiles are analysed.
create table public.social_profiles (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null,
  deal_id uuid not null,
  platform public.platform not null,
  handle text check (length(handle) <= 200),
  url text not null check (url ~ '^https://' and length(url) <= 1000),
  status text not null default 'proposed' check (status in ('proposed','confirmed','rejected')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id, platform, url),
  unique (id, deal_id, fund_id),
  check ((status = 'proposed') = (decided_at is null)),
  foreign key (deal_id, fund_id) references public.deals (id, fund_id) on delete cascade
);

-- A snapshot per run, so growth over time is exact from the first run onward.
create table public.profile_snapshots (
  id bigint generated always as identity primary key,
  fund_id uuid not null,
  deal_id uuid not null,
  profile_id uuid not null,
  captured_at timestamptz not null default now(),
  followers int check (followers >= 0),
  following int check (following >= 0),
  posts int check (posts >= 0),
  engagement_rate numeric check (engagement_rate >= 0),   -- average interactions per post / followers
  rating numeric check (rating between 0 and 5),
  ratings_count int check (ratings_count >= 0),
  installs_range text check (installs_range ~ '^[0-9,]+\+$'),   -- e.g. '10,000+' from Google Play
  source_id uuid,
  foreign key (profile_id, deal_id, fund_id) references public.social_profiles (id, deal_id, fund_id) on delete cascade,
  foreign key (source_id, deal_id, fund_id) references public.sources (id, deal_id, fund_id) on delete cascade   -- append-only: no SET NULL update
);
create index profile_snapshots_profile_idx on public.profile_snapshots (profile_id, captured_at);

-- Reviews, comments, posts and third-party mentions. Authors are salted hashes, never names.
create table public.mentions (
  id bigint generated always as identity primary key,
  fund_id uuid not null,
  deal_id uuid not null,
  profile_id uuid,                         -- null for mentions elsewhere on the web
  platform public.platform not null,
  external_id text not null check (length(external_id) <= 200),
  url text check (url ~ '^https://' and length(url) <= 1000),
  kind text not null check (kind in ('review','comment','post','mention','article')),
  posted_at timestamptz,
  author_hash text check (author_hash ~ '^[0-9a-f]{64}$'),
  rating smallint check (rating between 1 and 5),
  language text check (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
  text text not null check (length(text) between 1 and 2000),
  sentiment text check (sentiment in ('positive','neutral','negative')),
  topics text[] not null default '{}' check (cardinality(topics) <= 10),
  is_complaint boolean,
  created_at timestamptz not null default now(),
  unique (deal_id, platform, external_id),
  foreign key (deal_id, fund_id) references public.deals (id, fund_id) on delete cascade,
  foreign key (profile_id, deal_id, fund_id) references public.social_profiles (id, deal_id, fund_id) on delete set null (profile_id)
);
create index mentions_deal_idx on public.mentions (deal_id, posted_at);

-- The analysed overview, versioned like scores. Figures from fewer than 30
-- items are shown as low confidence (the app reads items_analyzed).
create table public.social_summaries (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null,
  deal_id uuid not null,
  version int not null check (version >= 1),
  generated_at timestamptz not null default now(),
  items_analyzed int not null check (items_analyzed >= 0),
  date_from date, date_to date,
  sentiment jsonb not null check (jsonb_typeof(sentiment) = 'object'),     -- {platform: {positive, neutral, negative, n}}
  pain_points jsonb not null check (jsonb_typeof(pain_points) = 'array'),  -- [{theme, share_of_negative, mention_ids}]
  praise jsonb not null check (jsonb_typeof(praise) = 'array'),
  traction jsonb not null check (jsonb_typeof(traction) = 'array'),        -- [{proxy, value, source_ids}]
  fake_signals jsonb not null default '[]' check (jsonb_typeof(fake_signals) = 'array'),
  model text not null check (length(model) <= 100),
  check (date_from is null or date_to is null or date_from <= date_to),
  unique (deal_id, version),
  foreign key (deal_id, fund_id) references public.deals (id, fund_id) on delete cascade
);

-- Snapshots are append-only. Mentions are append-only except the analysis
-- fields the worker fills in after collection (write-once enrichment).
create trigger profile_snapshots_append_only before update or delete on public.profile_snapshots
  for each row execute function app_auth.forbid_mutation();
create trigger profile_snapshots_no_truncate before truncate on public.profile_snapshots
  for each statement execute function app_auth.forbid_mutation();

create function app_auth.mentions_enrich_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('sanad.erasure', true) = 'on' then return old; end if;
    raise exception 'mentions are append-only' using errcode = '42501';
  end if;
  if (new.fund_id, new.deal_id, new.profile_id, new.platform, new.external_id, new.url, new.kind,
      new.posted_at, new.author_hash, new.rating, new.text, new.created_at)
     is distinct from
     (old.fund_id, old.deal_id, old.profile_id, old.platform, old.external_id, old.url, old.kind,
      old.posted_at, old.author_hash, old.rating, old.text, old.created_at)
     -- profile_id may go to null only through the FK's ON DELETE SET NULL
     and not (new.profile_id is null and old.profile_id is not null
              and (new.fund_id, new.deal_id, new.platform, new.external_id, new.url, new.kind,
                   new.posted_at, new.author_hash, new.rating, new.text, new.created_at)
                  is not distinct from
                  (old.fund_id, old.deal_id, old.platform, old.external_id, old.url, old.kind,
                   old.posted_at, old.author_hash, old.rating, old.text, old.created_at)) then
    raise exception 'mentions are append-only: only sentiment, topics, is_complaint and language may change'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function app_auth.mentions_enrich_only() from public, anon, authenticated;
create trigger mentions_enrich_only before update or delete on public.mentions
  for each row execute function app_auth.mentions_enrich_only();
create trigger mentions_no_truncate before truncate on public.mentions
  for each statement execute function app_auth.forbid_mutation();

create trigger social_profiles_updated_at before update on public.social_profiles
  for each row execute function app_auth.set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['social_profiles','profile_snapshots','mentions','social_summaries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (fund_id = any ((select app_auth.my_fund_ids())::uuid[]))',
                   t || '_member_read', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- User RPC: confirm or reject a profile Sanad proposed. Confirming queues collection.
create function public.set_profile_status(p_profile uuid, p_status text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_fund uuid; v_deal uuid;
begin
  if p_status not in ('confirmed','rejected') then
    raise exception 'status must be confirmed or rejected' using errcode = '22023';
  end if;
  select fund_id, deal_id into v_fund, v_deal from public.social_profiles where id = p_profile;
  perform app_auth.require_role(v_fund, array['owner','partner','analyst']);
  update public.social_profiles
     set status = p_status, decided_by = auth.uid(), decided_at = now()
   where id = p_profile;
  if p_status = 'confirmed' then
    perform app_jobs.enqueue('social.collect', jsonb_build_object('profile_id', p_profile), v_fund, 'social:' || p_profile);
  end if;
  perform app_auth.audit(v_fund, 'profile.' || p_status, 'social_profiles', p_profile::text);
end $$;
revoke all on function public.set_profile_status(uuid, text) from public, anon;
grant execute on function public.set_profile_status(uuid, text) to authenticated;
