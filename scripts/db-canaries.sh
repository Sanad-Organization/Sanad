#!/usr/bin/env bash
# db-canaries.sh — prove the security tests can still see.
#
# For each protection: switch it off, run the matching test, and require the
# test to FAIL with a CRITICAL line. A pass, or a failure without CRITICAL,
# means the test has gone blind, and this script fails. The protection is
# restored after each canary. Run after scripts/db-test.sh (same database).
#
# Every new security test gets a canary here (bootstrap §9.7).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${SANAD_TEST_DB:-sanad_test}"
HOST="${PGHOST:-localhost}"
case "$HOST" in localhost|127.0.0.1|::1|/*) ;; *) echo "refusing non-local PGHOST" >&2; exit 2 ;; esac
case "$DB" in *_test) ;; *) echo "database name must end in _test" >&2; exit 2 ;; esac

PSQL=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$DB")
T="$ROOT/supabase/tests"
F0="$T/20261013090000_tenancy_foundation.test.sql"
F1="$T/20261013090100_jobs_queue.test.sql"
F2="$T/20261013090200_deals_evidence.test.sql"
F3="$T/20261013090300_repo_scans.test.sql"
F4="$T/20261013090400_social.test.sql"
F5="$T/20261018090000_reaper_truncate_fk_indexes.test.sql"
FS="$T/zz_catalogue_sweep.test.sql"

failures=0
canary() {  # name, break-sql, test-file, restore-sql
  local name="$1" brk="$2" test="$3" fix="$4" out
  "${PSQL[@]}" -c "$brk" >/dev/null 2>&1 || { echo "BROKEN  $name: could not apply the break"; failures=$((failures+1)); return; }
  if out=$("${PSQL[@]}" -f "$test" 2>&1); then
    echo "BLIND   $name: $(basename "$test") passed with the protection off"
    failures=$((failures+1))
  elif ! grep -q 'CRITICAL' <<<"$out"; then
    echo "BLIND   $name: $(basename "$test") failed without a CRITICAL line"
    grep -m1 -E 'ERROR|FAIL' <<<"$out" | sed 's/^/        /'
    failures=$((failures+1))
  else
    echo "caught  $name"
  fi
  "${PSQL[@]}" -c "$fix" >/dev/null 2>&1 || { echo "RESTORE FAILED for $name; database is now unsafe to reuse" >&2; exit 1; }
}

canary "RLS off on deals" \
  "alter table public.deals disable row level security" "$F2" \
  "alter table public.deals enable row level security"

canary "memberships policy opened" \
  "drop policy memberships_member_read on public.memberships; create policy memberships_member_read on public.memberships for select using (true)" "$F0" \
  "drop policy memberships_member_read on public.memberships; create policy memberships_member_read on public.memberships for select using (fund_id = any ((select app_auth.my_fund_ids())::uuid[]))"

canary "client update grant on findings" \
  "grant update on public.findings to authenticated" "$F2" \
  "revoke update on public.findings from authenticated"

canary "staff read policy on findings" \
  "create policy findings_staff_read on public.findings for select using ((select app_auth.is_staff()))" "$F2" \
  "drop policy findings_staff_read on public.findings"

canary "audit_log append-only trigger" \
  "drop trigger audit_log_append_only on public.audit_log" "$F0" \
  "create trigger audit_log_append_only before update or delete on public.audit_log for each row execute function app_auth.forbid_mutation()"

canary "composite FK on sources" \
  "alter table public.sources drop constraint sources_deal_id_fund_id_fkey cascade; alter table public.sources add constraint sources_deal_only_fkey foreign key (deal_id) references public.deals (id)" "$F2" \
  "alter table public.sources drop constraint sources_deal_only_fkey; alter table public.sources add constraint sources_deal_id_fund_id_fkey foreign key (deal_id, fund_id) references public.deals (id, fund_id) on delete cascade"

canary "source-id trigger on findings" \
  "drop trigger findings_source_ids on public.findings" "$F2" \
  "create trigger findings_source_ids before insert or update of source_ids on public.findings for each row execute function app_auth.check_source_ids('source_ids')"

canary "approved scores write-once" \
  "drop trigger scores_write_once on public.scores" "$F2" \
  "create trigger scores_write_once before update on public.scores for each row execute function app_auth.scores_write_once()"

canary "queue RPC opened to users" \
  "grant execute on function public.jobs_claim(text, int, int) to authenticated" "$F1" \
  "revoke execute on function public.jobs_claim(text, int, int) from authenticated"

canary "token hashes readable" \
  "grant select on public.repo_access_requests to authenticated" "$F3" \
  "revoke select on public.repo_access_requests from authenticated; grant select (id, fund_id, deal_id, founder_email, status, requested_at, expires_at, granted_at, closed_at, created_by) on public.repo_access_requests to authenticated"

canary "ingress claim opened to users" \
  "grant execute on function public.ingress_claim_access_request(text) to authenticated" "$F3" \
  "revoke execute on function public.ingress_claim_access_request(text) from authenticated"

canary "scan done before sandbox destroyed" \
  "alter table public.scans drop constraint scans_done_needs_sandbox_destroyed" "$F3" \
  "alter table public.scans add constraint scans_done_needs_sandbox_destroyed check (status <> 'done' or sandbox_destroyed_at is not null)"

canary "code_issues gains a snippet column" \
  "alter table public.code_issues add column snippet text" "$F3" \
  "alter table public.code_issues drop column snippet"

canary "mentions enrich-only trigger" \
  "drop trigger mentions_enrich_only on public.mentions" "$F4" \
  "create trigger mentions_enrich_only before update or delete on public.mentions for each row execute function app_auth.mentions_enrich_only()"

canary "foreign key without a covering index" \
  "drop index public.sources_deal_id_fund_id_idx" "$F5" \
  "create index sources_deal_id_fund_id_idx on public.sources (deal_id, fund_id)"

canary "definer RPC opened to anon" \
  "grant execute on function public.create_deal(uuid, text, text, text, text, text, text[]) to anon" "$FS" \
  "revoke execute on function public.create_deal(uuid, text, text, text, text, text, text[]) from anon"

canary "write policy added" \
  "create policy deals_member_write on public.deals for update using (true)" "$FS" \
  "drop policy deals_member_write on public.deals"

if [ "$failures" -gt 0 ]; then
  echo "$failures canary problem(s)" >&2
  exit 1
fi
echo "all canaries caught"
