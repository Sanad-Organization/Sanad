"""Against a local database built by scripts/db-test.sh (skipped without one).

    PGHOST=/var/run/postgresql PGPORT=5432 PGUSER=postgres SANAD_TEST_DB=sanad_test \
      uv run pytest tests/test_integration_db.py

The worker's real RPCs, called as service_role through a thin SQL store.
"""

import os
import threading

import pytest

from sanad_worker.handlers import Registry
from sanad_worker.store import Job
from sanad_worker.worker import Worker

psycopg = pytest.importorskip("psycopg")
DB = os.environ.get("SANAD_TEST_DB", "")
pytestmark = pytest.mark.skipif(
    not DB.endswith("_test") or not os.environ.get("PGHOST"), reason="no local test DB"
)
DEAL = "00000000-0000-4000-8000-0000000000aa"


class SqlStore:
    """Same calls as RestStore, made in SQL as service_role."""

    def __init__(self, dsn: str) -> None:
        self.conn = psycopg.connect(dsn, autocommit=True)
        self.lock = threading.Lock()
        self.conn.execute("set role service_role")

    def _one(self, sql, args):
        with self.lock:
            return self.conn.execute(sql, args).fetchone()[0]

    def claim(self, worker, n, lease_seconds):
        with self.lock:
            cur = self.conn.execute("select * from public.jobs_claim(%s, %s, %s)", (worker, n, lease_seconds))
            cols = [c.name for c in cur.description]
            return [Job.from_row(dict(zip(cols, r, strict=True))) for r in cur.fetchall()]

    def complete(self, job):
        return self._one("select public.jobs_complete(%s, %s)", (job.id, job.lease_token))

    def fail(self, job, error, permanent=False):
        return self._one(
            "select public.jobs_fail(%s, %s, %s, %s)", (job.id, job.lease_token, error, permanent)
        )

    def heartbeat(self, job, lease_seconds):
        return self._one("select public.jobs_heartbeat(%s, %s, %s)", (job.id, job.lease_token, lease_seconds))

    def enqueue(self, kind, payload, fund_id=None, dedupe=None, delay_seconds=0):
        return self._one(
            "select public.jobs_enqueue(%s, %s::jsonb, %s, %s, %s)",
            (kind, psycopg.types.json.Jsonb(payload), fund_id, dedupe, delay_seconds),
        )

    def rpc(self, fn, args=None):
        raise NotImplementedError


@pytest.fixture
def db():
    dsn = f"dbname={DB}"
    admin = psycopg.connect(dsn, autocommit=True)
    admin.execute("drop table if exists public.worker_it_results")
    admin.execute("create table public.worker_it_results (deal_id text primary key, job_id bigint not null)")
    admin.execute("grant insert, select on public.worker_it_results to service_role")
    admin.execute("delete from app_jobs.jobs where kind = 'deal.collect'")
    yield dsn, admin
    admin.execute("drop table if exists public.worker_it_results")
    admin.close()


def test_killed_worker_lease_expires_and_a_second_worker_finishes_once(db, logs):
    dsn, admin = db
    _, log = logs
    results = psycopg.connect(dsn, autocommit=True)

    def write_result(job, _ctx):  # idempotent by natural key
        results.execute(
            "insert into public.worker_it_results values (%s, %s) on conflict (deal_id) do nothing",
            (job.payload["deal_id"], job.id),
        )

    reg = Registry()
    reg.add("deal.collect", write_result)
    a, b = SqlStore(dsn), SqlStore(dsn)
    jid = a.enqueue("deal.collect", {"deal_id": DEAL}, dedupe=f"deal:{DEAL}")

    # Worker A claims, writes its result, then dies before completing.
    job_a = a.claim("worker-a", 1, 30)[0]
    write_result(job_a, None)
    a.conn.close()

    # Its lease runs out.
    admin.execute("update app_jobs.jobs set locked_until = now() - interval '1 second' where id = %s", (jid,))

    # Worker B reaps it and finishes the job.
    w = Worker(store=b, registry=reg, log=log, worker_id="worker-b", slots=1, lease_seconds=30)
    assert w.run_once() == 1

    status, attempts, last_error = admin.execute(
        "select status, attempts, last_error from app_jobs.jobs where id = %s", (jid,)
    ).fetchone()
    assert (status, attempts) == ("done", 2)
    assert "lease expired" in last_error
    assert admin.execute("select count(*) from public.worker_it_results").fetchone()[0] == 1
    # A's stale lease can no longer complete or fail it.
    assert b.complete(job_a) is False
    assert b.fail(job_a, "late") == "lease_lost"
    results.close()


def test_invalid_payload_is_failed_permanently_in_the_database(db, logs):
    dsn, admin = db
    _, log = logs
    s = SqlStore(dsn)
    reg = Registry()
    reg.add("deal.collect", lambda job, ctx: None)
    jid = s.enqueue("deal.collect", {"deal_id": "nope"})
    Worker(store=s, registry=reg, log=log, slots=1, lease_seconds=30).run_once()
    row = admin.execute("select status, last_error from app_jobs.jobs where id = %s", (jid,)).fetchone()
    assert row == ("failed", "invalid_payload")
