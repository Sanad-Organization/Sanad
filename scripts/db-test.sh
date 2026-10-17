#!/usr/bin/env bash
# db-test.sh — apply every migration to a fresh LOCAL database and run the SQL tests.
#
#   PGHOST=/var/run/postgresql PGPORT=5432 PGUSER=postgres scripts/db-test.sh
#
# Uses a throwaway database (default sanad_test) that it drops and recreates.
# Refuses any host that is not local: the hosted database is the owner's job.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${SANAD_TEST_DB:-sanad_test}"
HOST="${PGHOST:-localhost}"

case "$HOST" in
  localhost|127.0.0.1|::1|/*) ;;
  *) echo "db-test: refusing non-local PGHOST '$HOST'" >&2; exit 2 ;;
esac
case "$DB" in
  *_test) ;;
  *) echo "db-test: database name must end in _test" >&2; exit 2 ;;
esac

PSQL=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc)

"${PSQL[@]}" -d postgres -c "drop database if exists \"$DB\" with (force)" >/dev/null
"${PSQL[@]}" -d postgres -c "create database \"$DB\"" >/dev/null

"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests/support/local_stub.sql" >/dev/null

for m in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d "$DB" -f "$m" >/dev/null || { echo "MIGRATION FAILED: $(basename "$m")" >&2; exit 1; }
  echo "applied  $(basename "$m")"
done

# Fixtures used by every test (fixed, readable ids).
"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests/support/fixtures.sql" >/dev/null

status=0
for t in "$ROOT"/supabase/tests/*.test.sql; do
  if out=$("${PSQL[@]}" -d "$DB" -f "$t" 2>&1); then
    echo "$out" | grep -E '^(psql:.*)?(NOTICE:  )?PASS' | sed 's/^.*PASS/  PASS/' || true
    echo "ok       $(basename "$t")"
  else
    echo "$out" | grep -E 'CRITICAL|FAIL|ERROR' >&2 || echo "$out" >&2
    echo "FAILED   $(basename "$t")" >&2
    status=1
  fi
done
exit $status
