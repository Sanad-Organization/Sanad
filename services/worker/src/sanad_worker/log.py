"""Structured JSON logs (bootstrap §9).

One line per event with a trace_id. Only allow-listed scalar fields are written,
so PII, payloads and error messages can't leak through a careless call.
The trace id is the job chain: ``job:<id>`` (and ``job:<parent>/<id>`` when a
handler enqueues follow-up work and passes its trace on).
"""

from __future__ import annotations

import json
import re
import sys
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

ALLOWED_FIELDS = frozenset(
    {
        "kind",
        "job_id",
        "attempt",
        "outcome",
        "status",
        "duration_ms",
        "error_name",
        "code",
        "reason",
        "worker",
        "fund_id",
        "deal_id",
        "count",
        "slots",
        "name",
        "failed_24h",
        "overdue_pending",
        "stuck_running",
        "open_dead_letters",
    }
)
MAX_STRING = 200
_CODE = re.compile(r"^[A-Za-z0-9_]{1,64}$")  # Postgres codes, http_503, no_handler

Sink = Callable[[str], None]


def _stdout(line: str) -> None:
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def clean(fields: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in fields.items():
        if k not in ALLOWED_FIELDS:
            continue
        if v is None or isinstance(v, bool | int | float):
            out[k] = v
        elif isinstance(v, str):
            out[k] = v[:MAX_STRING]
    return out


def error_fields(err: BaseException) -> dict[str, Any]:
    """Class name and an explicit code only; never str(err)."""
    out: dict[str, Any] = {"error_name": type(err).__name__}
    code = getattr(err, "code", None)
    if isinstance(code, str):
        out["code"] = code if _CODE.match(code) else "invalid_code"
    return out


class Logger:
    def __init__(self, trace_id: str = "worker", sink: Sink = _stdout) -> None:
        self.trace_id = trace_id
        self._sink = sink

    def child(self, trace_id: str) -> Logger:
        return Logger(trace_id, self._sink)

    def _write(self, level: str, event: str, fields: dict[str, Any]) -> None:
        line = {
            "ts": datetime.now(UTC).isoformat(timespec="milliseconds"),
            "level": level,
            "service": "worker",
            "event": event[:100],
            "trace_id": self.trace_id,
            **clean(fields),
        }
        self._sink(json.dumps(line, separators=(",", ":")))

    def debug(self, event: str, **fields: Any) -> None:
        self._write("debug", event, fields)

    def info(self, event: str, **fields: Any) -> None:
        self._write("info", event, fields)

    def warn(self, event: str, **fields: Any) -> None:
        self._write("warn", event, fields)

    def error(self, event: str, **fields: Any) -> None:
        self._write("error", event, fields)
