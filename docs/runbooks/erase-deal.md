# Runbook — Erase a deal

**When:** a fund asks to delete a deal, or a founder's deletion request reaches Sanad through the fund.
**Who:** the owner. ADR 0005.

## Steps

1. Confirm the request in writing (fund owner's email) and note the deal id and reason.
2. If a repository connection is still active, wait for or trigger `github.revoke_expired` for it first
   (the worker removes Sanad's installation).
3. Delete the deal's files: in Storage, bucket `deal-files`, folder `<fund_id>/<deal_id>/`.
4. In the SQL editor: `select public.erase_deal('<deal id>', '<reason, max 200 chars>');` → `true`.

## Verify

- `select count(*) from public.sources where deal_id = '<deal id>'` → 0 (same for `mentions`, `agent_turns`).
- `audit_log` has one `deal.erased` row for the fund.
- Langfuse: delete traces tagged with the deal id (retention 30 days otherwise).

## Record

Add a line to PROGRESS "Decisions Made": date, fund id, deal id, reason (no names).
