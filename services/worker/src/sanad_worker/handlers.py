"""Handler registry: ``kind -> handler``. Unknown kinds fail permanently.

Every payload is validated against ``packages/types/schemas/jobs/<kind>.json``
(the same files the TypeScript side uses) before the handler runs; an invalid
payload fails permanently. Handlers must be idempotent: a job can run again
after a lost lease.
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from .log import Logger
from .store import Job, Store


class PermanentError(Exception):
    """Retrying cannot help (bad payload, unknown kind, CHECK refusal on replay)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass
class Context:
    store: Store
    log: Logger
    heartbeat: Callable[[], bool]


Handler = Callable[[Job, Context], None]


def schemas_dir() -> Path:
    env = os.environ.get("SANAD_SCHEMAS_DIR")
    if env:
        return Path(env)
    # services/worker/src/sanad_worker -> repo root
    return Path(__file__).resolve().parents[4] / "packages" / "types" / "schemas" / "jobs"


@cache
def validator(kind: str) -> Draft202012Validator:
    path = schemas_dir() / f"{kind}.json"
    if not path.is_file():
        raise PermanentError("no_schema")
    schema = json.loads(path.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def validate_payload(job: Job) -> None:
    if next(validator(job.kind).iter_errors(job.payload), None) is not None:
        raise PermanentError("invalid_payload")


class Registry:
    def __init__(self) -> None:
        self._handlers: dict[str, Handler] = {}

    def register(self, kind: str) -> Callable[[Handler], Handler]:
        def deco(fn: Handler) -> Handler:
            if kind in self._handlers:
                raise ValueError(f"duplicate handler for {kind}")
            self._handlers[kind] = fn
            return fn

        return deco

    def add(self, kind: str, fn: Handler) -> None:
        self.register(kind)(fn)

    def get(self, kind: str) -> Handler:
        fn = self._handlers.get(kind)
        if fn is None:
            raise PermanentError("no_handler")
        return fn

    def kinds(self) -> set[str]:
        return set(self._handlers)


def run_handler(registry: Registry, job: Job, ctx: Context) -> None:
    handler = registry.get(job.kind)
    validate_payload(job)
    handler(job, ctx)


# ---------------------------------------------------------------------------
# Built-in ops handlers.
# ---------------------------------------------------------------------------
RECONCILE_ALARMS = ("failed_24h", "stuck_running", "open_dead_letters", "overdue_pending")


def ops_sweep(job: Job, ctx: Context) -> None:
    """Every minute: retention. Idempotent (redaction is a no-op the second time)."""
    redacted = ctx.store.rpc("redact_old_founder_emails")
    ctx.log.info("ops.sweep", count=int(redacted or 0))


def ops_reconcile(job: Job, ctx: Context) -> None:
    """Daily: counts only. Any alarm counter > 0 logs at error level (alert rules in runbooks/jobs.md)."""
    counts: dict[str, Any] = ctx.store.rpc("jobs_reconcile") or {}
    fields = {k: int(counts.get(k, 0)) for k in RECONCILE_ALARMS}
    if any(fields.values()):
        ctx.log.error("jobs_reconcile_alarm", **fields)
    else:
        ctx.log.info("jobs_reconcile_ok", **fields)


def default_registry() -> Registry:
    r = Registry()
    r.add("ops.sweep", ops_sweep)
    r.add("ops.reconcile", ops_reconcile)
    return r
