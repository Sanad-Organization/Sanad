"""The worker's only view of the database: the jobs RPCs (ADR 0006).

``RestStore`` calls them over PostgREST with the service-role key.
``FakeStore`` reproduces their semantics in memory for unit tests.
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

import httpx


@dataclass(frozen=True)
class Job:
    id: int
    kind: str
    payload: dict[str, Any]
    fund_id: str | None
    attempts: int
    max_attempts: int
    lease_token: str

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> Job:
        return cls(
            id=int(row["id"]),
            kind=str(row["kind"]),
            payload=dict(row.get("payload") or {}),
            fund_id=row.get("fund_id"),
            attempts=int(row["attempts"]),
            max_attempts=int(row["max_attempts"]),
            lease_token=str(row["lease_token"]),
        )


class Store(Protocol):
    def claim(self, worker: str, n: int, lease_seconds: int) -> list[Job]: ...
    def complete(self, job: Job) -> bool: ...
    def fail(self, job: Job, error: str, permanent: bool = False) -> str: ...
    def heartbeat(self, job: Job, lease_seconds: int) -> bool: ...
    def enqueue(
        self,
        kind: str,
        payload: dict[str, Any],
        fund_id: str | None = None,
        dedupe: str | None = None,
        delay_seconds: int = 0,
    ) -> int: ...
    def rpc(self, fn: str, args: dict[str, Any] | None = None) -> Any: ...


class StoreError(Exception):
    """A store call failed; carries the HTTP status / Postgres code, never the body."""

    def __init__(self, fn: str, code: str) -> None:
        super().__init__(f"{fn}: {code}")
        self.code = code


class RestStore:
    TIMEOUT = httpx.Timeout(10.0, connect=5.0)

    def __init__(self, supabase_url: str, service_role_key: str, client: httpx.Client | None = None) -> None:
        self._base = f"{supabase_url}/rest/v1/rpc/"
        self._client = client or httpx.Client(timeout=self.TIMEOUT)
        self._headers = {
            "apikey": service_role_key,
            "authorization": f"Bearer {service_role_key}",
            "content-type": "application/json",
        }

    def rpc(self, fn: str, args: dict[str, Any] | None = None, retries: int = 2) -> Any:
        # complete/fail/heartbeat are safe to repeat (they need the lease token).
        # claim and enqueue-without-dedupe are called with retries=0: a lost
        # response after a commit must not claim or insert twice.
        last: Exception | None = None
        for _ in range(retries + 1):
            try:
                res = self._client.post(self._base + fn, json=args or {}, headers=self._headers)
            except httpx.TransportError as err:
                last = err
                continue
            if res.status_code >= 500:
                last = StoreError(fn, f"http_{res.status_code}")
                continue
            if res.status_code >= 400:
                code = f"http_{res.status_code}"
                try:
                    body = res.json()
                    if isinstance(body, dict) and isinstance(body.get("code"), str):
                        code = body["code"]
                except ValueError:
                    pass
                raise StoreError(fn, code)
            return res.json() if res.content else None
        raise StoreError(fn, "unavailable") from last

    def claim(self, worker: str, n: int, lease_seconds: int) -> list[Job]:
        rows = self.rpc(
            "jobs_claim", {"p_worker": worker, "p_n": n, "p_lease_seconds": lease_seconds}, retries=0
        )
        return [Job.from_row(r) for r in rows or []]

    def complete(self, job: Job) -> bool:
        return bool(self.rpc("jobs_complete", {"p_id": job.id, "p_lease": job.lease_token}))

    def fail(self, job: Job, error: str, permanent: bool = False) -> str:
        args = {"p_id": job.id, "p_lease": job.lease_token, "p_error": error[:2000], "p_permanent": permanent}
        return str(self.rpc("jobs_fail", args))

    def heartbeat(self, job: Job, lease_seconds: int) -> bool:
        args = {"p_id": job.id, "p_lease": job.lease_token, "p_lease_seconds": lease_seconds}
        return bool(self.rpc("jobs_heartbeat", args))

    def enqueue(self, kind, payload, fund_id=None, dedupe=None, delay_seconds=0) -> int:
        args = {"p_kind": kind, "p_payload": payload, "p_fund": fund_id, "p_dedupe": dedupe}
        args["p_delay_seconds"] = delay_seconds
        return int(self.rpc("jobs_enqueue", args, retries=0 if dedupe is None else 2))


# ---------------------------------------------------------------------------
# In-memory fake with the same rules as the SQL functions.
# ---------------------------------------------------------------------------
@dataclass
class _Row:
    id: int
    kind: str
    payload: dict[str, Any]
    fund_id: str | None
    dedupe: str | None
    run_after: datetime
    status: str = "pending"
    attempts: int = 0
    max_attempts: int = 5
    lease_token: str | None = None
    locked_until: datetime | None = None
    last_error: str | None = None
    finished_at: datetime | None = None


@dataclass
class FakeStore:
    now: Callable[[], datetime] = field(default=lambda: datetime.now(UTC))
    rows: dict[int, _Row] = field(default_factory=dict)
    rpcs: dict[str, Callable[[dict[str, Any]], Any]] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def enqueue(self, kind, payload, fund_id=None, dedupe=None, delay_seconds=0) -> int:
        with self._lock:
            if dedupe is not None:
                for r in self.rows.values():
                    if r.kind == kind and r.dedupe == dedupe and r.status in ("pending", "running"):
                        return r.id
            rid = len(self.rows) + 1
            run_after = self.now() + timedelta(seconds=max(delay_seconds, 0))
            self.rows[rid] = _Row(rid, kind, dict(payload or {}), fund_id, dedupe, run_after)
            return rid

    def claim(self, worker: str, n: int, lease_seconds: int) -> list[Job]:
        with self._lock:
            now = self.now()
            for r in self.rows.values():
                if r.status == "running" and r.locked_until is not None and r.locked_until < now:
                    r.status = "failed" if r.attempts >= r.max_attempts else "pending"
                    r.finished_at = now if r.status == "failed" else None
                    r.last_error = ((r.last_error + " | ") if r.last_error else "") + "lease expired"
                    r.lease_token, r.locked_until, r.run_after = None, None, now
            ready = sorted(
                (r for r in self.rows.values() if r.status == "pending" and r.run_after <= now),
                key=lambda r: r.run_after,
            )[: min(max(n, 1), 20)]
            out = []
            for r in ready:
                r.status, r.attempts = "running", r.attempts + 1
                r.lease_token = str(uuid.uuid4())
                r.locked_until = now + timedelta(seconds=min(max(lease_seconds, 30), 3600))
                out.append(
                    Job(r.id, r.kind, dict(r.payload), r.fund_id, r.attempts, r.max_attempts, r.lease_token)
                )
            return out

    def _held(self, job: Job) -> _Row | None:
        r = self.rows.get(job.id)
        return r if r and r.status == "running" and r.lease_token == job.lease_token else None

    def complete(self, job: Job) -> bool:
        with self._lock:
            r = self._held(job)
            if not r:
                return False
            r.status, r.finished_at, r.lease_token, r.locked_until = "done", self.now(), None, None
            return True

    def fail(self, job: Job, error: str, permanent: bool = False) -> str:
        with self._lock:
            r = self._held(job)
            if not r:
                return "lease_lost"
            final = permanent or r.attempts >= r.max_attempts
            r.status = "failed" if final else "pending"
            r.finished_at = self.now() if final else None
            r.run_after = self.now() + timedelta(seconds=2 ** min(r.attempts, 10))
            r.last_error, r.lease_token, r.locked_until = error[:2000], None, None
            return r.status

    def heartbeat(self, job: Job, lease_seconds: int) -> bool:
        with self._lock:
            r = self._held(job)
            if not r:
                return False
            r.locked_until = self.now() + timedelta(seconds=min(max(lease_seconds, 30), 3600))
            return True

    def rpc(self, fn: str, args: dict[str, Any] | None = None) -> Any:
        return self.rpcs[fn](args or {})

    def expire_leases(self) -> None:
        """Test helper: make every running lease already expired."""
        with self._lock:
            for r in self.rows.values():
                if r.status == "running":
                    r.locked_until = self.now() - timedelta(seconds=1)

    def make_ready(self) -> None:
        """Test helper: skip backoff."""
        with self._lock:
            for r in self.rows.values():
                if r.status == "pending":
                    r.run_after = self.now()
