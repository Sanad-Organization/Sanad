"""Entry point: ``python -m sanad_ingress`` (Render web service)."""

from __future__ import annotations

import os

from .app import create_app
from .config import Config, ConfigError
from .log import Logger


def scrub(event, _hint):
    """Sentry gets the exception type and stack only: no request, values, variables or messages."""
    for key in ("request", "user", "extra", "breadcrumbs"):
        event.pop(key, None)
    for ex in (event.get("exception") or {}).get("values") or []:
        ex.pop("value", None)
        for frame in (ex.get("stacktrace") or {}).get("frames") or []:
            frame.pop("vars", None)
    event.pop("message", None)
    event.pop("logentry", None)
    return event


def init_sentry(cfg: Config) -> None:
    if not cfg.sentry_dsn:
        return
    import sentry_sdk

    sentry_sdk.init(
        dsn=cfg.sentry_dsn,
        environment=cfg.environment,
        send_default_pii=False,
        include_local_variables=False,
        max_breadcrumbs=0,
        traces_sample_rate=0,
        default_integrations=False,
        before_send=scrub,
    )


def main() -> int:
    log = Logger("ingress")
    try:
        cfg = Config.from_env()
    except ConfigError as err:
        log.error("config_missing", name=err.name)
        return 1
    try:
        port = int(os.environ.get("PORT", "8000"))
    except ValueError:
        log.error("config_missing", name="PORT")
        return 1
    init_sentry(cfg)
    import logging

    import uvicorn

    # uvicorn's own loggers would print tracebacks (with messages) to stderr; our JSON lines replace them.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        quiet = logging.getLogger(name)
        quiet.handlers = [logging.NullHandler()]
        quiet.propagate = False

    uvicorn.run(
        create_app(cfg, log),
        host="0.0.0.0",  # noqa: S104 — Render routes to the container port
        port=port,
        access_log=False,  # request_end lines replace uvicorn's access log
        log_config=None,
        proxy_headers=True,
        server_header=False,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
