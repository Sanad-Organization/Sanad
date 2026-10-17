# 0002 — Tenancy = fund; how data is written

**Status:** accepted — 2026-10-13 (owner, engineering bootstrap §9; Sanad specifics below).

## Context

Funds compete with each other; a leak of one fund's pipeline or of a founder's code to another fund would
end the product. The bootstrap requires deny-by-default RLS, no browser writes and the service-role key
only in server jobs. Sanad has users in more than one fund (advisors), and Sanad staff who operate the
system.

## Decision

1. **The tenant is the fund.** Every table except `funds` has `fund_id NOT NULL`. Children reference their
   parent with composite keys `(parent_id, deal_id, fund_id)`, so a row can't claim another fund than its
   parent. Where a key is impossible (`uuid[]` source lists), the trigger `app_auth.check_source_ids`
   checks every id belongs to the same deal and fund.
2. **Reads:** one `select` policy per table: `fund_id = any ((select app_auth.my_fund_ids())::uuid[])`.
   A user in two funds sees both; the app always filters by the fund in view.
3. **Writes by people** go through `SECURITY DEFINER` RPCs in `public` that derive the fund from the row
   they touch and check the caller's role with `app_auth.require_role`. Only `create_deal` takes a fund id,
   and it checks membership. The reviewed list is pinned in `supabase/tests/zz_catalogue_sweep.test.sql`.
   Role rights: viewer = read + ask the agent; analyst = + create deals, request repo access, confirm
   profiles, override findings, answer questions, rescore; partner = + deal status, approve scores;
   owner = partner (+ team management later).
4. **Writes by the system** go through the worker and ingress with the service-role key (REST + RPCs). The
   web app never holds that key.
5. **Staff have no read policy on fund data.** Staff see the job queue and dead letters (through
   service-role tooling) and nothing else. Support access to a fund's data, if ever needed, will be an
   explicit, time-boxed, audited grant by the fund owner (not built).
6. **No insert, update or delete policies exist anywhere** (sweep check 2), and anon/authenticated hold no
   write grants (sweep check 3).

## Consequences

- Every user action is an RPC: more SQL to write, but each one is small, audited and tested.
- Members are added by staff with the service role in the pilot (`docs/runbooks/add-fund.md`);
  self-serve invites are BACKLOG `TEAM-INVITES`.
- A canary per protection proves the tests can still see (`scripts/db-canaries.sh`).
