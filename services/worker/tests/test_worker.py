import threading
import time

from sanad_worker.handlers import PermanentError, Registry, default_registry
from sanad_worker.store import FakeStore
from sanad_worker.worker import Worker

DEAL = "00000000-0000-4000-8000-000000000001"


def make(logs, registry=None, **kw):
    _, log = logs
    store = FakeStore()
    w = Worker(store=store, registry=registry or Registry(), log=log, slots=2, lease_seconds=60, **kw)
    return store, w


def test_done_job_completes(logs):
    reg = Registry()
    seen = []
    reg.add("deal.collect", lambda job, ctx: seen.append(job.payload["deal_id"]))
    store, w = make(logs, reg)
    jid = store.enqueue("deal.collect", {"deal_id": DEAL}, fund_id=DEAL)
    assert w.run_once() == 1
    assert seen == [DEAL]
    assert store.rows[jid].status == "done"


def test_unknown_kind_fails_permanently(logs):
    store, w = make(logs)
    jid = store.enqueue("deal.collect", {"deal_id": DEAL})
    w.run_once()
    assert store.rows[jid].status == "failed"
    assert store.rows[jid].last_error == "no_handler"
    assert store.rows[jid].attempts == 1


def test_invalid_payload_fails_permanently_before_the_handler(logs):
    reg = Registry()
    called = []
    reg.add("deal.collect", lambda job, ctx: called.append(1))
    store, w = make(logs, reg)
    jid = store.enqueue("deal.collect", {"deal_id": "not-a-uuid", "extra": 1})
    w.run_once()
    assert called == []
    assert (store.rows[jid].status, store.rows[jid].last_error) == ("failed", "invalid_payload")


def test_transient_error_retries_with_backoff_then_fails(logs):
    reg = Registry()

    def boom(job, ctx):
        raise TimeoutError("upstream said something with user data in it")

    reg.add("deal.collect", boom)
    store, w = make(logs, reg)
    jid = store.enqueue("deal.collect", {"deal_id": DEAL})
    for attempt in range(1, 6):
        w.run_once()
        row = store.rows[jid]
        assert row.attempts == attempt
        assert row.last_error == "TimeoutError"  # class name only, never the message
        store.make_ready()
    assert store.rows[jid].status == "failed"
    lines, _ = logs
    assert all("user data" not in str(line) for line in lines)


def test_handler_permanent_error(logs):
    reg = Registry()

    def refuse(job, ctx):
        raise PermanentError("check_violation")

    reg.add("deal.collect", refuse)
    store, w = make(logs, reg)
    jid = store.enqueue("deal.collect", {"deal_id": DEAL})
    w.run_once()
    assert (store.rows[jid].status, store.rows[jid].last_error) == ("failed", "check_violation")


def test_lost_lease_never_completes_or_fails(logs):
    reg = Registry()
    store_ref = {}

    def slow(job, ctx):
        store_ref["s"].expire_leases()
        store_ref["s"].claim("other-worker", 1, 60)  # reaps and re-claims: new owner
        assert ctx.heartbeat() is False

    reg.add("deal.collect", slow)
    store, w = make(logs, reg)
    store_ref["s"] = store
    jid = store.enqueue("deal.collect", {"deal_id": DEAL})
    assert w.run_once() == 1
    row = store.rows[jid]
    assert row.status == "running" and row.attempts == 2  # still the other worker's
    lines, _ = logs
    assert lines.events("job_end")[-1]["outcome"] == "lease_lost"


def test_idempotent_rerun_after_lost_lease(logs):
    """A job that runs twice (first worker lost its lease) leaves one result."""
    results: dict[str, int] = {}
    reg = Registry()

    def write_once(job, ctx):
        results.setdefault(job.payload["deal_id"], job.id)  # upsert by natural key

    reg.add("deal.collect", write_once)
    store, w = make(logs, reg)
    jid = store.enqueue("deal.collect", {"deal_id": DEAL})
    first = store.claim("dead-worker", 1, 60)[0]
    write_once(first, None)  # the dead worker got halfway, then vanished
    store.expire_leases()
    w.run_once()
    assert store.rows[jid].status == "done"
    assert results == {DEAL: jid}
    assert store.complete(first) is False  # the old lease can't complete it


def test_dedupe_of_outstanding_work():
    store = FakeStore()
    a = store.enqueue("deal.collect", {"deal_id": DEAL}, dedupe=f"deal:{DEAL}")
    b = store.enqueue("deal.collect", {"deal_id": DEAL}, dedupe=f"deal:{DEAL}")
    assert a == b


def test_kill_switch_claims_nothing(logs):
    store, w = make(logs, default_registry(), killed=lambda: True)
    jid = store.enqueue("ops.sweep", {})
    assert w.run_once() == 0
    assert store.rows[jid].status == "pending"
    lines, _ = logs
    assert lines.events("worker_paused")


def test_deadline_cancels_a_cooperative_handler_and_retries(logs):
    reg = Registry()
    reg.add("deal.collect", lambda job, ctx: ctx.cancelled.wait(5))
    store, w = make(logs, reg, deadlines={"deal.collect": 0}, heartbeat_every=0.01, cancel_grace=2)
    jid = store.enqueue("deal.collect", {"deal_id": DEAL})
    t0 = time.monotonic()
    w.run_once()
    assert time.monotonic() - t0 < 2
    assert (store.rows[jid].status, store.rows[jid].last_error) == ("pending", "deadline")


def test_stuck_handler_is_never_run_twice_at_once(logs):
    reg = Registry()
    release = threading.Event()
    running = []

    def stubborn(job, ctx):  # ignores cancel
        running.append(job.id)
        release.wait(5)

    reg.add("deal.collect", stubborn)
    store, w = make(logs, reg, deadlines={"deal.collect": 0}, heartbeat_every=0.01, cancel_grace=0.05)
    jid = store.enqueue("deal.collect", {"deal_id": DEAL})
    w.run_once()
    assert store.rows[jid].status == "running"  # lease kept, not released for a re-run
    store.make_ready()
    assert w.run_once() == 0  # draining: claims nothing while the thread lives
    assert running == [jid]
    lines, _ = logs
    assert lines.events("worker_draining")
    assert lines.events("job_end")[-1]["outcome"] == "abandoned"
    release.set()
    time.sleep(0.05)
    assert w.stuck_jobs() == 0


def test_store_errors_are_logged_as_job_end_not_raised(logs):
    from sanad_worker.store import StoreError

    reg = Registry()
    reg.add("deal.collect", lambda job, ctx: None)
    store, w = make(logs, reg)
    store.enqueue("deal.collect", {"deal_id": DEAL})

    def down(job):
        raise StoreError("jobs_complete", "unavailable")

    store.complete = down
    assert w.run_once() == 1
    lines, _ = logs
    end = lines.events("job_end")[-1]
    assert (end["outcome"], end["code"], end["job_id"]) == ("store_error", "unavailable", 1)


def test_a_heartbeat_blip_is_not_fatal(logs):
    from sanad_worker.store import StoreError

    reg = Registry()
    reg.add("deal.collect", lambda job, ctx: time.sleep(0.08))
    store, w = make(logs, reg, heartbeat_every=0.02)
    calls = []

    def flaky(job, s):
        calls.append(1)
        raise StoreError("jobs_heartbeat", "unavailable")

    store.heartbeat = flaky
    jid = store.enqueue("deal.collect", {"deal_id": DEAL})
    w.run_once()
    assert calls and store.rows[jid].status == "done"


def test_permanent_error_codes_are_never_free_text(logs):
    reg = Registry()

    def refuse(job, ctx):
        raise PermanentError("Founder Name said no")

    reg.add("deal.collect", refuse)
    store, w = make(logs, reg)
    jid = store.enqueue("deal.collect", {"deal_id": DEAL})
    w.run_once()
    assert store.rows[jid].last_error == "invalid_code"


def test_heartbeat_extends_the_lease_of_a_long_job(logs):
    reg = Registry()
    reg.add("deal.collect", lambda job, ctx: time.sleep(0.1))
    store, w = make(logs, reg, heartbeat_every=0.02)
    beats = []
    real = store.heartbeat
    store.heartbeat = lambda job, s: beats.append(1) or real(job, s)
    store.enqueue("deal.collect", {"deal_id": DEAL})
    w.run_once()
    assert len(beats) >= 2


def test_ops_handlers(logs):
    lines, log = logs
    store, w = make(logs, default_registry())
    store.rpcs["redact_old_founder_emails"] = lambda a: 3
    store.rpcs["jobs_reconcile"] = lambda a: {"failed_24h": 1, "stuck_running": 0}
    store.enqueue("ops.sweep", {})
    store.enqueue("ops.reconcile", {})
    w.run_once()
    assert lines.events("ops.sweep")[0]["count"] == 3
    alarm = lines.events("jobs_reconcile_alarm")[0]
    assert alarm["level"] == "error" and alarm["failed_24h"] == 1
