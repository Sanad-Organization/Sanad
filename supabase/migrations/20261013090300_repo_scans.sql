-- 20261013090300_repo_scans.sql
--
-- Context:   ADR 0003 (Sanad scans the default branch from GitHub in a
--            short-lived sandbox; founders never run a scanner).
-- Changes:   issue_category enum; repo_access_requests (only the SHA-256 of
--            the link token is stored), repo_connections, scans, code_issues
--            with composite (…, deal_id, fund_id) keys; read-only RLS.
--            RPCs: request_repo_access (user), ingress_claim_access_request
--            and redact_old_founder_emails (service role only).
-- Not here:  the GitHub App itself, the sandbox, and removing the installation
--            after access_ends_at (worker job 'github.revoke_expired').
--            code_issues deliberately has NO column for code snippets or
--            secret values; a test fails if one appears.
-- Pre-check: none (new tables).
-- Test:      supabase/tests/20261013090300_repo_scans.test.sql

create type public.issue_category as enum
  ('vulnerability','secret','code_pattern','misconfiguration','licence','external');

-- The access link sent to the founder.
create table public.repo_access_requests (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null,
  deal_id uuid not null,
  -- Personal data: nulled 30 days after the request closes (redact_old_founder_emails).
  founder_email text check (founder_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(founder_email) <= 254),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'sent' check (status in ('sent','granted','declined','expired')),
  requested_at timestamptz not null default now(),   -- commits after this time are flagged
  expires_at timestamptz not null default now() + interval '14 days',
  granted_at timestamptz,
  closed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  check ((status = 'granted') = (granted_at is not null)),
  check ((status = 'sent') = (closed_at is null)),
  unique (id, deal_id, fund_id),
  foreign key (deal_id, fund_id) references public.deals (id, fund_id) on delete cascade
);
-- One open link per deal: a new request expires the previous one.
create unique index repo_access_requests_one_open on public.repo_access_requests (deal_id) where status = 'sent';

-- One row per repository Sanad may read (public, or granted through the GitHub App).
create table public.repo_connections (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null,
  deal_id uuid not null,
  request_id uuid,
  installation_id bigint,                 -- null for public repositories
  repo_id bigint not null,
  repo_full_name text not null check (repo_full_name ~ '^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$'),
  visibility text not null check (visibility in ('public','private')),
  default_branch text not null check (length(default_branch) <= 255),
  connected_at timestamptz not null default now(),
  access_ends_at timestamptz,             -- Sanad removes its installation after this (30 days)
  revoked_at timestamptz,
  unique (deal_id, repo_id),
  unique (id, deal_id, fund_id),
  check (visibility = 'public' or (installation_id is not null and access_ends_at is not null)),
  foreign key (deal_id, fund_id) references public.deals (id, fund_id) on delete cascade,
  foreign key (request_id, deal_id, fund_id) references public.repo_access_requests (id, deal_id, fund_id) on delete set null (request_id)
);

-- One row per scanned commit. 'before_request' = the repository as it stood when access was requested.
create table public.scans (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null,
  deal_id uuid not null,
  connection_id uuid not null,
  scanned_ref text not null check (scanned_ref in ('head','before_request')),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  committed_at timestamptz,
  tool_versions jsonb check (tool_versions is null or jsonb_typeof(tool_versions) = 'object'),
  vuln_db_date date,
  languages jsonb not null default '{}' check (jsonb_typeof(languages) = 'object'),
  lines_of_code int check (lines_of_code >= 0),
  history jsonb not null default '{}' check (jsonb_typeof(history) = 'object'),
  ai_usage jsonb not null default '{}' check (jsonb_typeof(ai_usage) = 'object'),
  services jsonb not null default '[]' check (jsonb_typeof(services) = 'array'),
  sandbox_id text check (length(sandbox_id) <= 100),
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  error text check (length(error) <= 2000),
  queued_at timestamptz not null default now(),
  finished_at timestamptz,
  sandbox_destroyed_at timestamptz,
  unique (connection_id, scanned_ref, commit_sha),
  unique (id, deal_id, fund_id),
  -- No result without proof the sandbox (and the code in it) is gone.
  constraint scans_done_needs_sandbox_destroyed check (status <> 'done' or sandbox_destroyed_at is not null),
  check (status <> 'done' or (tool_versions is not null and vuln_db_date is not null)),
  check ((status in ('done','failed')) = (finished_at is not null)),
  foreign key (connection_id, deal_id, fund_id) references public.repo_connections (id, deal_id, fund_id) on delete cascade
);

-- Every issue from a scan or from the outside-in check.
-- Deliberately no column for code snippets or secret values.
create table public.code_issues (
  id bigint generated always as identity primary key,
  fund_id uuid not null,
  deal_id uuid not null,
  scan_id uuid,
  category public.issue_category not null,
  tool text not null check (tool ~ '^[a-z_-]+$'),
  rule_id text not null check (length(rule_id) <= 200),
  severity smallint not null check (severity between 1 and 5),
  cwe text check (cwe ~ '^CWE-[0-9]{1,5}$'),
  cve text check (cve ~ '^(CVE-[0-9]{4}-[0-9]{4,7}|GHSA(-[23456789cfghjmpqrvwx]{4}){3})$'),
  package text check (length(package) <= 300),
  version text check (length(version) <= 100),
  fixed_version text check (length(fixed_version) <= 100),
  file_path text check (length(file_path) <= 1000),
  line int check (line >= 0),
  commit_date timestamptz,                -- for secrets found in history
  title text not null check (length(title) <= 300),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (deal_id, fingerprint),
  check ((category = 'external') = (scan_id is null)),
  foreign key (deal_id, fund_id) references public.deals (id, fund_id) on delete cascade,
  foreign key (scan_id, deal_id, fund_id) references public.scans (id, deal_id, fund_id) on delete cascade
);
create index code_issues_deal_idx on public.code_issues (deal_id, severity desc);

do $$
declare t text;
begin
  foreach t in array array['repo_access_requests','repo_connections','scans','code_issues'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (fund_id = any ((select app_auth.my_fund_ids())::uuid[]))',
                   t || '_member_read', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
-- The token hash is useless without the token, but there's no reason to serve it.
revoke select on public.repo_access_requests from authenticated;
grant select (id, fund_id, deal_id, founder_email, status, requested_at, expires_at, granted_at, closed_at, created_by)
  on public.repo_access_requests to authenticated;

-- ---------------------------------------------------------------------------
-- User RPC: create the access link. Returns the raw token ONCE; only its
-- SHA-256 is stored. The app builds the GitHub install URL with state=<token>.
-- ---------------------------------------------------------------------------
create function public.request_repo_access(p_deal uuid, p_founder_email text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare v_fund uuid; v_token text; v_id uuid;
begin
  select fund_id into v_fund from public.deals where id = p_deal;
  perform app_auth.require_role(v_fund, array['owner','partner','analyst']);
  -- 2 × uuid v4 = 244 random bits from the server's CSPRNG.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update public.repo_access_requests set status = 'expired', closed_at = now()
   where deal_id = p_deal and status = 'sent';
  insert into public.repo_access_requests (fund_id, deal_id, founder_email, token_hash, created_by)
  values (v_fund, p_deal, lower(btrim(p_founder_email)), encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid())
  returning id into v_id;
  perform app_auth.audit(v_fund, 'repo.access_requested', 'repo_access_requests', v_id::text);
  return v_token;
end $$;
revoke all on function public.request_repo_access(uuid, text) from public, anon;
grant execute on function public.request_repo_access(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Service-role RPCs (ingress service and worker).
-- ---------------------------------------------------------------------------
-- GitHub install callback: marks a request granted, once, if still valid.
-- The ingress hashes the state value; the raw token never reaches the database.
create function public.ingress_claim_access_request(p_token_hash text)
returns setof public.repo_access_requests
language sql volatile security definer set search_path = '' as $$
  update public.repo_access_requests
     set status = 'granted', granted_at = now(), closed_at = now()
   where token_hash = p_token_hash
     and status = 'sent'
     and expires_at > now()
  returning *;
$$;

-- Daily sweep: close expired links, then drop founder emails 30 days after close.
create function public.redact_old_founder_emails()
returns int language plpgsql volatile security definer set search_path = '' as $$
declare n int;
begin
  update public.repo_access_requests set status = 'expired', closed_at = now()
   where status = 'sent' and expires_at <= now();
  update public.repo_access_requests set founder_email = null
   where founder_email is not null and closed_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.ingress_claim_access_request(text), public.redact_old_founder_emails()
  from public, anon, authenticated;
grant execute on function public.ingress_claim_access_request(text), public.redact_old_founder_emails()
  to service_role;
