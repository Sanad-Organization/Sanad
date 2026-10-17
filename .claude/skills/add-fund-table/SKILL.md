---
name: add-fund-table
description: Add a new fund-scoped table (or RPC) to Sanad's database with RLS, grants, composite keys, tests and a canary in one migration. Use for any schema change touching fund data.
---

1. `supabase migration new <name>` (timestamped). Start the file with the header from
   `docs/private/engineering-bootstrap.md` §19.4 (Context · Changes · Not here · Pre-check · Test).
2. Table recipe:
   ```sql
   create table public.<t> (
     id uuid primary key default gen_random_uuid(),
     fund_id uuid not null,
     deal_id uuid not null,
     ...,                                   -- every column has a CHECK on size/format
     created_at timestamptz not null default now(),
     unique (id, deal_id, fund_id),
     foreign key (deal_id, fund_id) references public.deals (id, fund_id) on delete cascade
   );
   alter table public.<t> enable row level security;
   create policy <t>_member_read on public.<t> for select
     using (fund_id = any ((select app_auth.my_fund_ids())::uuid[]));
   revoke insert, update, delete, truncate on public.<t> from anon, authenticated;
   revoke all on public.<t> from anon;
   ```
   Append-only? Add the `app_auth.forbid_mutation()` row trigger (update, delete) AND statement trigger
   (truncate), and `app_auth.stamp_created_at()`. `uuid[]` of sources? Add `app_auth.check_source_ids('<col>')`.
3. User action needed? A `security definer set search_path = ''` RPC that derives `fund_id` from the row,
   calls `app_auth.require_role(...)`, writes, calls `app_auth.audit(...)`; then
   `revoke all … from public, anon; grant execute … to authenticated;` and add its name to the whitelist in
   `supabase/tests/zz_catalogue_sweep.test.sql` (check 6).
4. New enum value? Its own migration, before the one that uses it.
5. Tests in `supabase/tests/<same timestamp>_<name>.test.sql`: fixtures for funds A and B in
   `support/fixtures.sql`; `assert_isolated` both directions; `assert_no_client_writes`; anon sees nothing;
   RPC role checks (`CRITICAL:` on security failures, `FAIL:` on functional); positive control as service role.
6. Add a canary to `scripts/db-canaries.sh` for each new protection; run `scripts/db-test.sh` then
   `scripts/db-canaries.sh` — all green, all caught.
7. Constraint on existing data? Put the hosted pre-check query (must return 0 rows) in the header and the PR.
8. Database PR goes alone, first. Ask the `security-review` subagent.
