"""Configuration from the environment. A missing required variable refuses start."""

from __future__ import annotations

import os
import socket
from dataclasses import dataclass


class ConfigError(Exception):
    def __init__(self, name: str) -> None:
        super().__init__(name)
        self.name = name
        self.code = "config_missing"


def _require(env: dict[str, str], name: str) -> str:
    value = env.get(name, "").strip()
    if not value:
        raise ConfigError(name)
    return value


def _int(env: dict[str, str], name: str, default: int, lo: int, hi: int) -> int:
    raw = env.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ConfigError(name) from None
    if not lo <= value <= hi:
        raise ConfigError(name)
    return value


@dataclass(frozen=True)
class Config:
    supabase_url: str
    service_role_key: str = ""  # never logged; repr hides it below
    worker_id: str = "worker"
    slots: int = 2
    lease_seconds: int = 600
    idle_sleep_seconds: int = 5
    posthog_host: str | None = None
    posthog_project_key: str | None = None
    sentry_dsn: str | None = None
    environment: str = "local"

    def __repr__(self) -> str:  # keep the key out of any accidental print
        return f"Config(supabase_url={self.supabase_url!r}, worker_id={self.worker_id!r}, slots={self.slots})"

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> Config:
        e = dict(os.environ if env is None else env)
        url = _require(e, "SUPABASE_URL")
        if not url.startswith("https://") and not url.startswith("http://localhost"):
            raise ConfigError("SUPABASE_URL")
        return cls(
            supabase_url=url.rstrip("/"),
            service_role_key=_require(e, "SUPABASE_SERVICE_ROLE_KEY"),
            worker_id=(e.get("WORKER_ID") or f"worker-{socket.gethostname()}")[:100],
            slots=_int(e, "WORKER_SLOTS", 2, 1, 20),
            lease_seconds=_int(e, "WORKER_LEASE_SECONDS", 600, 30, 3600),
            idle_sleep_seconds=_int(e, "WORKER_IDLE_SECONDS", 5, 1, 300),
            posthog_host=e.get("POSTHOG_HOST") or None,
            posthog_project_key=e.get("POSTHOG_PROJECT_KEY") or None,
            sentry_dsn=e.get("SENTRY_DSN") or None,
            environment=e.get("SANAD_ENV", "local"),
        )
