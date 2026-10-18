"""Configuration from the environment. A missing or weak required variable refuses start."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from urllib.parse import urlsplit

MIN_SECRET_LENGTH = 32


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


def _secret(env: dict[str, str], name: str) -> bytes:
    value = _require(env, name)
    if len(value) < MIN_SECRET_LENGTH:
        raise ConfigError(name)
    return value.encode()


@dataclass(frozen=True)
class Config:
    supabase_url: str
    # Never logged: excluded from repr (and the class repr below names safe fields only).
    service_role_key: str = field(default="", repr=False)
    github_webhook_secret: bytes = field(default=b"", repr=False)
    scan_upload_secret: bytes = field(default=b"", repr=False)
    sentry_dsn: str | None = None
    environment: str = "local"
    commit: str = "unknown"

    def __repr__(self) -> str:
        return f"Config(supabase_url={self.supabase_url!r}, environment={self.environment!r})"

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> Config:
        e = dict(os.environ if env is None else env)
        url = _require(e, "SUPABASE_URL")
        environment = e.get("SANAD_ENV", "local")
        parts = urlsplit(url)
        local_http = parts.scheme == "http" and parts.hostname in ("localhost", "127.0.0.1")
        if not parts.hostname or not (parts.scheme == "https" or (local_http and environment == "local")):
            raise ConfigError("SUPABASE_URL")
        webhook = _secret(e, "GITHUB_WEBHOOK_SECRET")
        upload = _secret(e, "SCAN_UPLOAD_SECRET")
        if webhook == upload:  # one key, one job
            raise ConfigError("SCAN_UPLOAD_SECRET")
        commit = e.get("RENDER_GIT_COMMIT", "").strip()
        return cls(
            supabase_url=url.rstrip("/"),
            service_role_key=_require(e, "SUPABASE_SERVICE_ROLE_KEY"),
            github_webhook_secret=webhook,
            scan_upload_secret=upload,
            sentry_dsn=e.get("SENTRY_DSN") or None,
            environment=environment,
            commit=commit[:40] if commit.isalnum() else "unknown",
        )
