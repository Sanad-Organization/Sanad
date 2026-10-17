# Runbook — Add a pilot fund and its members

**When:** a new design-partner fund joins (pilot only; replaced by TEAM-INVITES).
**Who:** the owner (hosted action). **Why the order matters:** sign-ups are off (`web-hosting.md`), so each
member's account is created by staff before the membership row can reference it.

## Steps

1. Supabase → Authentication → Users → **Add user** → "Create new user" with the member's email and
   **Auto confirm** on (no password needed; they sign in by magic link or Google).
2. In the Supabase SQL editor (production project), run, replacing placeholders:

   ```sql
   begin;
   insert into public.funds (name, region, plan) values ('<Fund name>', '<mena|africa|both>', 'pilot')
   returning id;                                   -- note the id
   insert into public.memberships (fund_id, user_id, role)
   select '<fund id>', id, '<owner|partner|analyst|viewer>' from auth.users where email = '<member email>';
   select app_auth.audit('<fund id>', 'fund.created', 'funds', '<fund id>');
   commit;
   ```
3. Turn the pilot flags on for this fund id (see `flags.md`).

## Verify

- The member reloads `/deals` and sees the fund name in the switcher.
- `select count(*) from public.memberships where fund_id = '<fund id>'` equals the number of members.

## If it goes wrong

| Symptom | Meaning | Fix |
| --- | --- | --- |
| insert into memberships inserts 0 rows | the member's account doesn't exist yet | step 1, then rerun |
| member gets no email | sign-in never creates accounts | check step 1 used the exact address |
| member sees another fund | **isolation incident** | page; follow `incident-isolation.md` |
