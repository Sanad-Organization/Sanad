-- 20261018090000_reaper_truncate_fk_indexes.sql
--
-- Context:   PROGRESS "SQL follow-up" and advisor follow-up DB-FK-INDEXES.
-- Changes:   1. public.jobs_claim: the lease reaper truncates last_error to
--               2000 characters. Before, appending " | lease expired" to a
--               2000-character error broke the CHECK and stopped every claim.
--               Same signature, security definer, search_path = '', grants.
--               An error already at 2000 characters keeps its text and loses
--               the " | lease expired" marker; status and attempts still show
--               the reap.
--            2. A covering index for every foreign key that had none (30, the
--               advisor's list), each in the foreign key's column order:
--                 app_jobs.jobs         (fund_id)
--                 companies             (fund_id)
--                 deals                 (company_id, fund_id), (owner_id)
--                 sources               (deal_id, fund_id)
--                 chunks                (source_id, deal_id, fund_id)
--                 claims                (source_id, deal_id, fund_id)
--                 findings              (deal_id, fund_id)
--                 finding_overrides     (finding_id, deal_id, fund_id), (created_by)
--                 scores                (deal_id, fund_id), (approved_by)
--                 questions             (deal_id, fund_id), (finding_id, deal_id, fund_id)
--                 agent_turns           (deal_id, fund_id), (user_id)
--                 repo_access_requests  (deal_id, fund_id), (created_by)
--                 repo_connections      (deal_id, fund_id), (request_id, deal_id, fund_id)
--                 scans                 (connection_id, deal_id, fund_id)
--                 code_issues           (deal_id, fund_id), (scan_id, deal_id, fund_id)
--                 social_profiles       (deal_id, fund_id), (decided_by)
--                 profile_snapshots     (profile_id, deal_id, fund_id), (source_id, deal_id, fund_id)
--                 mentions              (deal_id, fund_id), (profile_id, deal_id, fund_id)
--                 social_summaries      (deal_id, fund_id)
-- Not here:  no table, policy or grant changes.
-- Pre-check: none. The tables hold pilot-scale data, so plain (non-concurrent)
--            CREATE INDEX inside the migration transaction is brief.
-- Test:      supabase/tests/20261018090000_reaper_truncate_fk_indexes.test.sql

-- ---------------------------------------------------------------------------
-- 1. Reaper truncates last_error.
-- ---------------------------------------------------------------------------
create or replace function public.jobs_claim(p_worker text, p_n int default 1, p_lease_seconds int default 600)
returns setof app_jobs.jobs language plpgsql volatile security definer set search_path = '' as $$
begin
  -- Expired leases: back to pending, or failed if out of attempts.
  update app_jobs.jobs j
     set status = case when j.attempts >= j.max_attempts then 'failed' else 'pending' end,
         finished_at = case when j.attempts >= j.max_attempts then now() end,
         last_error = left(coalesce(j.last_error || ' | ', '') || 'lease expired', 2000),
         lease_token = null, locked_until = null, locked_by = null,
         run_after = now()
   where j.status = 'running' and j.locked_until < now();

  return query
  update app_jobs.jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         lease_token = gen_random_uuid(),
         locked_until = now() + make_interval(secs => least(greatest(p_lease_seconds, 30), 3600)),
         locked_by = left(p_worker, 100)
   where j.id in (
     select c.id from app_jobs.jobs c
      where c.status = 'pending' and c.run_after <= now()
      order by c.run_after
      limit least(greatest(p_n, 1), 20)
      for update skip locked)
  returning j.*;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.jobs_claim(text, int, int)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Covering indexes for foreign keys (column order of each foreign key).
-- ---------------------------------------------------------------------------
create index jobs_fund_id_idx on app_jobs.jobs (fund_id);
create index companies_fund_id_idx on public.companies (fund_id);
create index deals_company_id_fund_id_idx on public.deals (company_id, fund_id);
create index deals_owner_id_idx on public.deals (owner_id);
create index sources_deal_id_fund_id_idx on public.sources (deal_id, fund_id);
create index chunks_source_id_deal_id_fund_id_idx on public.chunks (source_id, deal_id, fund_id);
create index claims_source_id_deal_id_fund_id_idx on public.claims (source_id, deal_id, fund_id);
create index findings_deal_id_fund_id_idx on public.findings (deal_id, fund_id);
create index finding_overrides_finding_id_deal_id_fund_id_idx on public.finding_overrides (finding_id, deal_id, fund_id);
create index finding_overrides_created_by_idx on public.finding_overrides (created_by);
create index scores_deal_id_fund_id_idx on public.scores (deal_id, fund_id);
create index scores_approved_by_idx on public.scores (approved_by);
create index questions_deal_id_fund_id_idx on public.questions (deal_id, fund_id);
create index questions_finding_id_deal_id_fund_id_idx on public.questions (finding_id, deal_id, fund_id);
create index agent_turns_deal_id_fund_id_idx on public.agent_turns (deal_id, fund_id);
create index agent_turns_user_id_idx on public.agent_turns (user_id);
create index repo_access_requests_deal_id_fund_id_idx on public.repo_access_requests (deal_id, fund_id);
create index repo_access_requests_created_by_idx on public.repo_access_requests (created_by);
create index repo_connections_deal_id_fund_id_idx on public.repo_connections (deal_id, fund_id);
create index repo_connections_request_id_deal_id_fund_id_idx on public.repo_connections (request_id, deal_id, fund_id);
create index scans_connection_id_deal_id_fund_id_idx on public.scans (connection_id, deal_id, fund_id);
create index code_issues_deal_id_fund_id_idx on public.code_issues (deal_id, fund_id);
create index code_issues_scan_id_deal_id_fund_id_idx on public.code_issues (scan_id, deal_id, fund_id);
create index social_profiles_deal_id_fund_id_idx on public.social_profiles (deal_id, fund_id);
create index social_profiles_decided_by_idx on public.social_profiles (decided_by);
create index profile_snapshots_profile_id_deal_id_fund_id_idx on public.profile_snapshots (profile_id, deal_id, fund_id);
create index profile_snapshots_source_id_deal_id_fund_id_idx on public.profile_snapshots (source_id, deal_id, fund_id);
create index mentions_deal_id_fund_id_idx on public.mentions (deal_id, fund_id);
create index mentions_profile_id_deal_id_fund_id_idx on public.mentions (profile_id, deal_id, fund_id);
create index social_summaries_deal_id_fund_id_idx on public.social_summaries (deal_id, fund_id);
