# Incident — Possible cross-fund data exposure

**Severity:** page. **Trigger:** any report or alert that a user saw another fund's data.

1. **Contain:** turn the affected surface's flag off (`flags.md`); if unclear which, turn `app-shell` off
   for all funds.
2. **Preserve:** note the trace id, user id, fund ids, time window. Do not delete logs.
3. **Check:** run `scripts/db-test.sh` and `scripts/db-canaries.sh` against a copy of the schema; run the
   catalogue sweep on production (read-only queries from `zz_catalogue_sweep.test.sql`).
4. **Fix** in a database-first PR with a new isolation test reproducing the leak, plus a canary.
5. **Tell** the affected funds (owner; HUMAN ONLY wording).
6. **Record** a post-incident note in `docs/incidents/` and a line in PROGRESS.
