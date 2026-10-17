-- 20261013090200_deals_evidence.sql
--
-- Context:   Architecture plan §9 (one evidence store per fund; evidence first:
--            no finding without a source). ADR 0002 write paths, ADR 0005
--            untrusted content.
-- Changes:   enums; companies, deals, sources, chunks (vector + full text),
--            claims, findings, finding_overrides (append-only), scores
--            (write-once approval), questions, agent_turns (append-only).
--            Composite (…, fund_id) foreign keys tie every child to its fund.
--            A trigger checks uuid[] source lists belong to the same deal.
--            User RPCs: create_deal, set_deal_status, request_rescore,
--            override_finding, approve_score, set_question_status,
--            log_agent_turn. Read helper: search_evidence (security invoker).
-- Not here:  repository scans (090300) and social data (090400).
--            Erasure of a deal: deleting the deal cascades everything except
--            audit_log, which holds ids only (ADR 0005).
-- Pre-check: none (new tables).
-- Test:      supabase/tests/20261013090200_deals_evidence.test.sql

create type public.deal_status  as enum ('screening','diligence','approved','passed','portfolio');
create type public.source_type  as enum ('website','repository','social','app_store','news','file',
                                         'security_check','patent','paper','live');
create type public.finding_type as enum ('strength','verified','contradicted','red_flag','risk');
create type public.dimension    as enum ('tech_reality','defensibility','reliability','unit_economics',
                                         'architecture','team','risk','traction');

-- Validators (immutable; coalesce inside bool_and so a NULL element can't pass).
create function app_auth.valid_github_urls(p text[]) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(bool_and(coalesce(u ~ '^https://github\.com/[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$', false)), true)
  from unnest(p) u
$$;
grant execute on function app_auth.valid_github_urls(text[]) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds (id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  website text check (website ~ '^https?://[^\s/$.?#].[^\s]*$' and length(website) <= 500),
  sector text check (length(sector) <= 100),
  country text check (country ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, fund_id)
);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds (id) on delete cascade,
  company_id uuid not null,
  status public.deal_status not null default 'screening',
  round text check (round in ('pre_seed','seed','series_a','series_b','other')),
  github_urls text[] not null default '{}'
    check (cardinality(github_urls) <= 5 and app_auth.valid_github_urls(github_urls)),
  owner_id uuid references auth.users (id) on delete set null,
  -- Stage progress written by the worker: {"social": "done", "scan": "running", …}
  pipeline jsonb not null default '{}' check (jsonb_typeof(pipeline) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, fund_id),
  foreign key (company_id, fund_id) references public.companies (id, fund_id) on delete cascade
);
create index deals_fund_idx on public.deals (fund_id, created_at desc);

-- Every piece of evidence. Content from sources is UNTRUSTED (ADR 0005): it is
-- data for the models, never instructions.
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null,
  deal_id uuid not null,
  type public.source_type not null,
  tier smallint not null check (tier between 1 and 4),   -- 1 = Sanad's own measurement … 4 = founder claim
  title text check (length(title) <= 500),
  url text check (length(url) <= 2000),
  storage_path text check (storage_path ~ '^[a-z0-9-]+/[A-Za-z0-9._/-]+$' and storage_path !~ '\.\.' and storage_path !~ '//' and length(storage_path) <= 512),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (deal_id, content_hash),
  unique (id, deal_id, fund_id),
  foreign key (deal_id, fund_id) references public.deals (id, fund_id) on delete cascade
);

create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null,
  deal_id uuid not null,
  source_id uuid not null,
  ord int not null check (ord >= 0),
  text text not null check (length(text) between 1 and 8000),
  embedding extensions.vector(1024),
  -- 'simple' config: content is English and Arabic; English stemming would mangle Arabic.
  tsv tsvector generated always as (to_tsvector('simple', text)) stored,
  unique (source_id, ord),
  foreign key (source_id, deal_id, fund_id) references public.sources (id, deal_id, fund_id) on delete cascade
);
create index chunks_embedding_idx on public.chunks using hnsw (embedding extensions.vector_cosine_ops);
create index chunks_tsv_idx on public.chunks using gin (tsv);
create index chunks_deal_idx on public.chunks (deal_id);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null,
  deal_id uuid not null,
  source_id uuid not null,                  -- where the founder made the claim
  statement text not null check (length(statement) between 1 and 1000),
  category text not null check (category in ('technology','ai','scale','security','team','traction','other')),
  status text not null default 'unchecked' check (status in ('unchecked','supported','contradicted','no_evidence')),
  evidence_source_ids uuid[] not null default '{}' check (cardinality(evidence_source_ids) <= 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('unchecked','no_evidence') or cardinality(evidence_source_ids) > 0),
  unique (id, deal_id, fund_id),
  foreign key (source_id, deal_id, fund_id) references public.sources (id, deal_id, fund_id) on delete cascade
);

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null,
  deal_id uuid not null,
  dimension public.dimension not null,
  type public.finding_type not null,
  severity smallint check (severity between 1 and 5),
  title text not null check (length(title) between 1 and 300),
  explanation text not null check (length(explanation) between 1 and 4000),
  fix_cost_usd int check (fix_cost_usd >= 0),
  fix_months numeric check (fix_months >= 0),
  source_ids uuid[] not null check (cardinality(source_ids) between 1 and 50),  -- no evidence, no finding
  analyzer text not null check (analyzer ~ '^[a-z_]+(@[0-9a-z.-]+)?$'),
  analysis_version int not null default 1 check (analysis_version >= 1),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  check (type not in ('red_flag','risk') or severity is not null),
  unique (id, deal_id, fund_id),
  foreign key (deal_id, fund_id) references public.deals (id, fund_id) on delete cascade
);
create index findings_deal_idx on public.findings (deal_id) where superseded_at is null;

-- A person's judgement on a finding. Append-only: the latest row wins; history stays.
create table public.finding_overrides (
  id bigint generated always as identity primary key,
  fund_id uuid not null,
  deal_id uuid not null,
  finding_id uuid not null,
  action text not null check (action in ('confirm','dismiss','change_severity')),
  severity smallint check (severity between 1 and 5),
  reason text not null check (length(reason) between 3 and 1000),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  check ((action = 'change_severity') = (severity is not null)),
  foreign key (finding_id, deal_id, fund_id) references public.findings (id, deal_id, fund_id) on delete cascade
);
create index finding_overrides_finding_idx on public.finding_overrides (finding_id, created_at desc);

create table public.scores (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null,
  deal_id uuid not null,
  version int not null check (version >= 1),
  dimensions jsonb not null check (jsonb_typeof(dimensions) = 'object'),  -- {dimension: {score, confidence, finding_ids}}
  overall smallint check (overall between 0 and 100),
  confidence text not null check (confidence in ('low','medium','high')),
  verdict text not null check (verdict in ('strong','conditional','concerns','do_not_proceed')),
  model text not null check (length(model) <= 100),
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check ((approved_by is null) = (approved_at is null)),
  unique (deal_id, version),
  foreign key (deal_id, fund_id) references public.deals (id, fund_id) on delete cascade
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null,
  deal_id uuid not null,
  finding_id uuid,
  text text not null check (length(text) between 1 and 1000),
  status text not null default 'draft' check (status in ('draft','asked','answered','dropped')),
  answer text check (length(answer) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'answered' or answer is not null),
  foreign key (deal_id, fund_id) references public.deals (id, fund_id) on delete cascade,
  foreign key (finding_id, deal_id, fund_id) references public.findings (id, deal_id, fund_id) on delete cascade
);

-- The agent's conversation log. Not evidence: never used as a source.
create table public.agent_turns (
  id bigint generated always as identity primary key,
  fund_id uuid not null,
  deal_id uuid not null,
  user_id uuid not null references auth.users (id),
  question text not null check (length(question) between 1 and 4000),
  answer text not null check (length(answer) <= 20000),
  cited_source_ids uuid[] not null default '{}' check (cardinality(cited_source_ids) <= 50),
  model text not null check (length(model) <= 100),
  input_tokens int not null default 0 check (input_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  created_at timestamptz not null default now(),
  foreign key (deal_id, fund_id) references public.deals (id, fund_id) on delete cascade
);
create index agent_turns_deal_idx on public.agent_turns (deal_id, created_at);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
-- uuid[] of sources can't have an FK: check every id belongs to the row's deal and fund.
-- tg_argv[0] = the array column name.
create function app_auth.check_source_ids() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; v_bad int;
begin
  v_ids := array(select jsonb_array_elements_text(to_jsonb(new) -> tg_argv[0])::uuid);
  select count(*) into v_bad
    from unnest(v_ids) s(id)
   where not exists (select 1 from public.sources x
                      where x.id = s.id and x.deal_id = new.deal_id and x.fund_id = new.fund_id);
  if v_bad > 0 then
    raise exception '%.%: % source id(s) not in this deal', tg_table_name, tg_argv[0], v_bad
      using errcode = '23503';
  end if;
  return new;
end $$;
revoke all on function app_auth.check_source_ids() from public, anon, authenticated;

create trigger findings_source_ids before insert or update of source_ids on public.findings
  for each row execute function app_auth.check_source_ids('source_ids');
create trigger claims_evidence_ids before insert or update of evidence_source_ids on public.claims
  for each row execute function app_auth.check_source_ids('evidence_source_ids');
create trigger agent_turns_cited_ids before insert on public.agent_turns
  for each row execute function app_auth.check_source_ids('cited_source_ids');

-- Append-only tables.
create trigger finding_overrides_stamp before insert on public.finding_overrides
  for each row execute function app_auth.stamp_created_at();
create trigger finding_overrides_append_only before update or delete on public.finding_overrides
  for each row execute function app_auth.forbid_mutation();
create trigger finding_overrides_no_truncate before truncate on public.finding_overrides
  for each statement execute function app_auth.forbid_mutation();
create trigger agent_turns_stamp before insert on public.agent_turns
  for each row execute function app_auth.stamp_created_at();
create trigger agent_turns_append_only before update or delete on public.agent_turns
  for each row execute function app_auth.forbid_mutation();
create trigger agent_turns_no_truncate before truncate on public.agent_turns
  for each statement execute function app_auth.forbid_mutation();
-- (A cascade from a deleted deal is a DELETE on these children, so erasure
--  goes through public.erase_deal, which sets sanad.erasure for its transaction.)

-- Scores: an approved score is frozen. Before approval, only approval may change.
create function app_auth.scores_write_once() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.approved_at is not null then
    raise exception 'scores: an approved score cannot change' using errcode = '42501';
  end if;
  if new.approved_at is not null and (
       new.dimensions is distinct from old.dimensions or new.overall is distinct from old.overall
    or new.confidence is distinct from old.confidence or new.verdict is distinct from old.verdict
    or new.version is distinct from old.version or new.deal_id is distinct from old.deal_id
    or new.fund_id is distinct from old.fund_id or new.model is distinct from old.model) then
    raise exception 'scores: approval cannot change the score' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function app_auth.scores_write_once() from public, anon, authenticated;
create trigger scores_write_once before update on public.scores
  for each row execute function app_auth.scores_write_once();

create trigger companies_updated_at before update on public.companies for each row execute function app_auth.set_updated_at();
create trigger deals_updated_at     before update on public.deals     for each row execute function app_auth.set_updated_at();
create trigger claims_updated_at    before update on public.claims    for each row execute function app_auth.set_updated_at();
create trigger questions_updated_at before update on public.questions for each row execute function app_auth.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: members read their fund's rows. No write policies.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['companies','deals','sources','chunks','claims','findings',
                           'finding_overrides','scores','questions','agent_turns'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (fund_id = any ((select app_auth.my_fund_ids())::uuid[]))',
                   t || '_member_read', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Erasure of a whole deal (owner request or founder request). Runs as the
-- service role only; cascades through append-only children on purpose.
-- ---------------------------------------------------------------------------
create function public.erase_deal(p_deal uuid, p_reason text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_fund uuid;
begin
  select fund_id into v_fund from public.deals where id = p_deal;
  if v_fund is null then return false; end if;
  perform set_config('sanad.erasure', 'on', true);
  delete from public.deals where id = p_deal;          -- cascades to every child table
  perform set_config('sanad.erasure', 'off', true);
  perform app_auth.audit(v_fund, 'deal.erased', 'deals', p_deal::text, jsonb_build_object('reason', left(p_reason, 200)));
  return true;
end $$;
revoke all on function public.erase_deal(uuid, text) from public, anon, authenticated;
grant execute on function public.erase_deal(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- User RPCs. Each derives the fund from the row it touches (never from the
-- body, except create_deal, which checks the caller's role in that fund).
-- ---------------------------------------------------------------------------
create function public.create_deal(p_fund uuid, p_company_name text, p_website text default null,
                                   p_sector text default null, p_country text default null,
                                   p_round text default null, p_github_urls text[] default '{}')
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_company uuid; v_deal uuid;
begin
  perform app_auth.require_role(p_fund, array['owner','partner','analyst']);
  insert into public.companies (fund_id, name, website, sector, country)
  values (p_fund, btrim(p_company_name), nullif(btrim(p_website), ''), p_sector, upper(p_country))
  returning id into v_company;
  insert into public.deals (fund_id, company_id, round, github_urls, owner_id)
  values (p_fund, v_company, p_round, coalesce(p_github_urls, '{}'), auth.uid())
  returning id into v_deal;
  perform app_jobs.enqueue('deal.collect', jsonb_build_object('deal_id', v_deal), p_fund, 'deal:' || v_deal);
  perform app_auth.audit(p_fund, 'deal.created', 'deals', v_deal::text);
  return v_deal;
end $$;

create function public.set_deal_status(p_deal uuid, p_status public.deal_status)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_fund uuid;
begin
  select fund_id into v_fund from public.deals where id = p_deal;
  perform app_auth.require_role(v_fund, array['owner','partner']);
  update public.deals set status = p_status where id = p_deal;
  perform app_auth.audit(v_fund, 'deal.status', 'deals', p_deal::text, jsonb_build_object('status', p_status));
end $$;

create function public.request_rescore(p_deal uuid)
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare v_fund uuid; v_job bigint;
begin
  select fund_id into v_fund from public.deals where id = p_deal;
  perform app_auth.require_role(v_fund, array['owner','partner','analyst']);
  v_job := app_jobs.enqueue('deal.analyze', jsonb_build_object('deal_id', p_deal), v_fund, 'analyze:' || p_deal);
  perform app_auth.audit(v_fund, 'deal.rescore', 'deals', p_deal::text);
  return v_job;
end $$;

create function public.override_finding(p_finding uuid, p_action text, p_reason text, p_severity smallint default null)
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare v_fund uuid; v_deal uuid; v_id bigint;
begin
  select fund_id, deal_id into v_fund, v_deal from public.findings where id = p_finding;
  perform app_auth.require_role(v_fund, array['owner','partner','analyst']);
  insert into public.finding_overrides (fund_id, deal_id, finding_id, action, severity, reason, created_by)
  values (v_fund, v_deal, p_finding, p_action, p_severity, btrim(p_reason), auth.uid())
  returning id into v_id;
  perform app_auth.audit(v_fund, 'finding.override', 'findings', p_finding::text,
                         jsonb_build_object('action', p_action, 'severity', p_severity));
  return v_id;
end $$;

-- Human sign-off: owner or partner, once.
create function public.approve_score(p_score uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_fund uuid;
begin
  select fund_id into v_fund from public.scores where id = p_score;
  perform app_auth.require_role(v_fund, array['owner','partner']);
  update public.scores set approved_by = auth.uid(), approved_at = now()
   where id = p_score and approved_at is null;
  if not found then
    raise exception 'score already approved' using errcode = '55000';
  end if;
  perform app_auth.audit(v_fund, 'score.approved', 'scores', p_score::text);
end $$;

create function public.set_question_status(p_question uuid, p_status text, p_answer text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_fund uuid;
begin
  select fund_id into v_fund from public.questions where id = p_question;
  perform app_auth.require_role(v_fund, array['owner','partner','analyst']);
  update public.questions set status = p_status, answer = coalesce(p_answer, answer) where id = p_question;
  perform app_auth.audit(v_fund, 'question.status', 'questions', p_question::text, jsonb_build_object('status', p_status));
end $$;

-- Called by the app server after the agent answers, with the user's JWT.
create function public.log_agent_turn(p_deal uuid, p_question text, p_answer text, p_cited uuid[],
                                      p_model text, p_input_tokens int, p_output_tokens int)
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare v_fund uuid; v_id bigint;
begin
  select fund_id into v_fund from public.deals where id = p_deal;
  perform app_auth.require_role(v_fund, array['owner','partner','analyst','viewer']);
  insert into public.agent_turns (fund_id, deal_id, user_id, question, answer, cited_source_ids, model, input_tokens, output_tokens)
  values (v_fund, p_deal, auth.uid(), p_question, p_answer, coalesce(p_cited, '{}'), p_model,
          coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0))
  returning id into v_id;
  return v_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_deal(uuid, text, text, text, text, text, text[])',
    'public.set_deal_status(uuid, public.deal_status)',
    'public.request_rescore(uuid)',
    'public.override_finding(uuid, text, text, smallint)',
    'public.approve_score(uuid)',
    'public.set_question_status(uuid, text, text)',
    'public.log_agent_turn(uuid, text, text, uuid[], text, int, int)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Hybrid search for the agent's search_evidence tool. SECURITY INVOKER: RLS
-- applies, so a caller only ever searches their own fund's chunks.
-- Reciprocal-rank fusion of vector and full-text results.
-- ---------------------------------------------------------------------------
create function public.search_evidence(p_deal uuid, p_query text, p_embedding extensions.vector(1024), p_k int default 12)
returns table (chunk_id uuid, source_id uuid, text text, score double precision)
language sql stable security invoker set search_path = '' as $$
  with v as (
    select c.id, row_number() over (order by c.embedding operator(extensions.<=>) p_embedding) as r
      from public.chunks c
     where c.deal_id = p_deal and c.embedding is not null
     order by c.embedding operator(extensions.<=>) p_embedding
     limit 50
  ), t as (
    select c.id, row_number() over (order by ts_rank(c.tsv, q) desc) as r
      from public.chunks c, websearch_to_tsquery('simple', p_query) q
     where c.deal_id = p_deal and c.tsv @@ q
     order by ts_rank(c.tsv, q) desc
     limit 50
  ), fused as (
    select id, sum(1.0 / (60 + r)) as s
      from (select id, r from v union all select id, r from t) u
     group by id
  )
  select c.id, c.source_id, c.text, f.s
    from fused f join public.chunks c on c.id = f.id
   order by f.s desc
   limit least(greatest(p_k, 1), 50)
$$;
revoke all on function public.search_evidence(uuid, text, extensions.vector, int) from public, anon;
grant execute on function public.search_evidence(uuid, text, extensions.vector, int) to authenticated, service_role;
