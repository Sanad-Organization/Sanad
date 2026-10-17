"""The claim → run → complete/fail loop.

One job per slot. Each job runs in its own thread under a deadline while the
slot heartbeats its lease. Errors reach the queue as a class name or a code,
never a message.

Two rules keep a job from running twice at once:
- A lost lease means another worker owns the job: we signal cancel and stop
  touching it (no complete, no fail).
- A job past its deadline is cancelled. If its thread stops within the grace
  period it is failed back for retry; if not, we keep the lease *unreleased*
  (it expires on its own), and this worker claims nothing more until the
  stuck thread is gone.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from .handlers import Context, PermanentError, Registry, run_handler
from .log import Logger, error_fields
from .store import Job, Store, StoreError

DEFAULT_DEADLINE_SECONDS = 15 * 60
DEADLINES: dict[str, int] = {"scan.repo": 30 * 60}
CANCEL_GRACE_SECONDS = 30.0


@dataclass
class Worker:
    store: Store
    registry: Registry
    log: Logger
    worker_id: str = "worker"
    slots: int = 2
    lease_seconds: int = 600
    killed: Callable[[], bool] = lambda: False
    deadlines: dict[str, int] = field(default_factory=lambda: dict(DEADLINES))
    heartbeat_every: float | None = None  # default lease/3
    cancel_grace: float = CANCEL_GRACE_SECONDS
    _stop: threading.Event = field(default_factory=threading.Event)
    _stuck: set[threading.Thread] = field(default_factory=set)

    def stop(self) -> None:
        self._stop.set()

    def stuck_jobs(self) -> int:
        self._stuck = {t for t in self._stuck if t.is_alive()}
        return len(self._stuck)

    def run_once(self) -> int:
        """Claim up to ``slots`` jobs and run them. Returns how many were claimed."""
        if self.killed():
            self.log.warn("worker_paused", worker=self.worker_id)
            return 0
        if self.stuck_jobs():
            self.log.error("worker_draining", worker=self.worker_id, count=len(self._stuck))
            return 0
        jobs = self.store.claim(self.worker_id, self.slots, self.lease_seconds)
        if not jobs:
            return 0
        with ThreadPoolExecutor(max_workers=len(jobs), thread_name_prefix="slot") as pool:
            list(pool.map(self.process, jobs))
        return len(jobs)

    def run_forever(self, idle_seconds: float) -> None:
        self.log.info("worker_started", worker=self.worker_id, slots=self.slots)
        while not self._stop.is_set():
            try:
                claimed = self.run_once()
            except Exception as err:  # noqa: BLE001 - the loop must survive a store outage
                self.log.error("claim_failed", **error_fields(err))
                claimed = 0
            if claimed == 0:
                self._stop.wait(idle_seconds)
        self.log.info("worker_stopped", worker=self.worker_id)

    # -- one job -------------------------------------------------------------
    def process(self, job: Job) -> str:
        log = self.log.child(f"job:{job.id}")
        base = {"kind": job.kind, "job_id": job.id, "attempt": job.attempts, "fund_id": job.fund_id}
        started = time.monotonic()
        lease_lost = threading.Event()

        def heartbeat() -> bool:
            try:
                ok = self.store.heartbeat(job, self.lease_seconds)
            except StoreError as err:
                # One blip is not fatal: the lease still has two thirds left; try next tick.
                log.warn("heartbeat_failed", **base, **error_fields(err))
                return True
            if not ok:
                lease_lost.set()
                ctx.cancelled.set()
            return ok

        ctx = Context(store=self.store, log=log, heartbeat=heartbeat)
        outcome: dict[str, BaseException | None] = {"error": None}

        def target() -> None:
            try:
                run_handler(self.registry, job, ctx)
            except BaseException as err:  # noqa: BLE001 - reported below
                outcome["error"] = err

        def end(result: str, level: str = "info", **fields) -> str:
            ms = int((time.monotonic() - started) * 1000)
            getattr(log, level)("job_end", **base, outcome=result, duration_ms=ms, **fields)
            return result

        def settle(call: Callable[[], object]) -> object | None:
            try:
                return call()
            except StoreError as err:
                end("store_error", "error", **error_fields(err))
                return None

        log.info("job_start", **base)
        t = threading.Thread(target=target, name=f"job-{job.id}", daemon=True)
        t.start()
        deadline = started + self.deadlines.get(job.kind, DEFAULT_DEADLINE_SECONDS)
        every = self.heartbeat_every or max(self.lease_seconds / 3, 1)
        while True:
            t.join(timeout=min(every, max(deadline - time.monotonic(), 0)))
            if not t.is_alive() or lease_lost.is_set() or time.monotonic() >= deadline:
                break
            heartbeat()

        if lease_lost.is_set():
            if t.is_alive():
                self._stuck.add(t)
            return end("lease_lost", "warn")

        if t.is_alive():
            ctx.cancelled.set()
            t.join(timeout=self.cancel_grace)
            if t.is_alive():
                # Keep the lease unreleased so nobody re-runs it while this thread lives.
                self._stuck.add(t)
                return end("abandoned", "error", reason="deadline")
            if settle(lambda: self.store.fail(job, "deadline")) is None:
                return "store_error"
            return end("deadline", "error")

        err = outcome["error"]
        if err is None:
            done = settle(lambda: self.store.complete(job))
            if done is None:
                return "store_error"
            return end("done") if done else end("lease_lost", "warn")
        if isinstance(err, PermanentError):
            status = settle(lambda: self.store.fail(job, err.code, permanent=True))
            if status is None:
                return "store_error"
            return end("permanent", "error", code=err.code, status=str(status))
        status = settle(lambda: self.store.fail(job, type(err).__name__))
        if status is None:
            return "store_error"
        result = "retry" if status == "pending" else str(status)
        return end(result, "error" if status == "failed" else "warn", status=str(status), **error_fields(err))
