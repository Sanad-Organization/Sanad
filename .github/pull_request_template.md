## Changes

<!-- what and why; link the spec and BACKLOG task -->

## Differences from the spec / design

<!-- each one, with its reason; "none" if none -->

## Checks

- [ ] `pnpm gate` green (paste the last lines)
- [ ] `scripts/db-test.sh` + `scripts/db-canaries.sh` (if `supabase/` changed)
- [ ] code-reviewer verdict:
- [ ] security-review verdict (migrations, RLS, RPCs, auth, keys, ingress, sandbox, guard):
- [ ] Behind flag `<key>`, default off; kill path verified
- [ ] Logging + alert named; no PII, payloads, code or evidence text in logs
- [ ] Synthetic names only

## Not done / follow-ups

## After merge (owner)

<!-- exact hosted steps: migrations (pre-check query → must return 0 rows), flags (which, value, targeting, when), secrets -->
