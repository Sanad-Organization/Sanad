"""The claim → run → complete/fail loop.

One job per slot. Each job runs in its own thread under a deadline while the
slot heartbeats its lease. A lost lease means another worker owns the job now:
we stop touching it (no complete, no fail). Errors reach the queue as a class
name or an explicit code, never a message.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from .handlers import Context, PermanentError, Registry, run_handler
from .log import Logger, error_fields
from .store import Job, Store

DEFAULT_DEADLINE_SECONDS = 15 * 60
DEADLINES: dict[str, int] = {"scan.repo": 30 * 60}


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
    _stop: threading.Event = field(default_factory=threading.Event)

    def stop(self) -> None:
        self._stop.set()

    def run_once(self) -> int:
        """Claim up to ``slots`` jobs and run them. Returns how many were claimed."""
        if self.killed():
            self.log.warn("worker_paused", worker=self.worker_id)
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
            ok = self.store.heartbeat(job, self.lease_seconds)
            if not ok:
                lease_lost.set()
            return ok

        ctx = Context(store=self.store, log=log, heartbeat=heartbeat)
        outcome: dict[str, BaseException | None] = {"error": None}

        def target() -> None:
            try:
                run_handler(self.registry, job, ctx)
            except BaseException as err:  # noqa: BLE001 - reported below
                outcome["error"] = err

        log.info("job_start", **base)
        t = threading.Thread(target=target, name=f"job-{job.id}", daemon=True)
        t.start()
        deadline = started + self.deadlines.get(job.kind, DEFAULT_DEADLINE_SECONDS)
        every = self.heartbeat_every or max(self.lease_seconds / 3, 1)
        while True:
            t.join(timeout=min(every, max(deadline - time.monotonic(), 0)))
            if not t.is_alive() or lease_lost.is_set():
                break
            if time.monotonic() >= deadline:
                break
            heartbeat()

        ms = int((time.monotonic() - started) * 1000)
        if lease_lost.is_set():
            log.warn("job_end", **base, outcome="lease_lost", duration_ms=ms)
            return "lease_lost"
        if t.is_alive():
            status = self.store.fail(job, "deadline")
            log.error("job_end", **base, outcome="deadline", status=status, duration_ms=ms)
            return "deadline"

        err = outcome["error"]
        if err is None:
            if self.store.complete(job):
                log.info("job_end", **base, outcome="done", duration_ms=ms)
                return "done"
            log.warn("job_end", **base, outcome="lease_lost", duration_ms=ms)
            return "lease_lost"
        if isinstance(err, PermanentError):
            status = self.store.fail(job, err.code, permanent=True)
            log.error("job_end", **base, outcome="permanent", code=err.code, status=status, duration_ms=ms)
            return "permanent"
        status = self.store.fail(job, type(err).__name__)
        level = log.error if status == "failed" else log.warn
        level(
            "job_end",
            **base,
            outcome="retry" if status == "pending" else status,
            status=status,
            duration_ms=ms,
            **error_fields(err),
        )
        return "retry" if status == "pending" else status
