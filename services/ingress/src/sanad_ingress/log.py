"""Structured JSON logs (bootstrap §9), the same shape as the worker's.

One line per event with a trace_id. Only allow-listed scalar fields are written,
so PII, payloads, signatures and error messages can't leak through a careless call.
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
        "method",
        "route",
        "status",
        "duration_ms",
        "outcome",
        "reason",
        "error_name",
        "code",
        "name",
        "count",
    }
)
MAX_STRING = 200
_CODE = re.compile(r"^[A-Za-z0-9_]{1,64}$")
_IDENTIFIERS = frozenset({"reason", "code", "name", "outcome"})

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
            # Reasons and codes are identifiers, never fragments of headers or tokens.
            out[k] = v if k not in _IDENTIFIERS or _CODE.match(v) else "invalid_code"
            out[k] = out[k][:MAX_STRING]
    return out


def error_fields(err: BaseException) -> dict[str, Any]:
    """Class name and an explicit code only; never str(err)."""
    out: dict[str, Any] = {"error_name": type(err).__name__}
    code = getattr(err, "code", None)
    if isinstance(code, str):
        out["code"] = code if _CODE.match(code) else "invalid_code"
    return out


class Logger:
    def __init__(self, trace_id: str = "ingress", sink: Sink = _stdout) -> None:
        self.trace_id = trace_id
        self._sink = sink

    def child(self, trace_id: str) -> Logger:
        return Logger(trace_id, self._sink)

    def _write(self, level: str, event: str, fields: dict[str, Any]) -> None:
        line = {
            "ts": datetime.now(UTC).isoformat(timespec="milliseconds"),
            "level": level,
            "service": "ingress",
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
