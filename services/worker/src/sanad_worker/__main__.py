"""Entry point: ``python -m sanad_worker [run|once|reconcile]``."""

from __future__ import annotations

import signal
import sys

from .config import Config, ConfigError
from .flags import flag_on
from .handlers import Context, default_registry, ops_reconcile
from .log import Logger, error_fields
from .store import Job, RestStore
from .worker import Worker


def init_sentry(cfg: Config) -> None:
    if not cfg.sentry_dsn:
        return
    import sentry_sdk

    def scrub(event, _hint):
        for key in ("request", "user", "extra", "breadcrumbs"):
            event.pop(key, None)
        for ex in (event.get("exception") or {}).get("values") or []:
            ex.pop("value", None)
            for frame in (ex.get("stacktrace") or {}).get("frames") or []:
                frame.pop("vars", None)
        event.pop("message", None)
        event.pop("logentry", None)
        return event

    sentry_sdk.init(
        dsn=cfg.sentry_dsn,
        environment=cfg.environment,
        send_default_pii=False,
        include_local_variables=False,
        max_breadcrumbs=0,
        traces_sample_rate=0,
        before_send=scrub,
    )


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    cmd = args[0] if args else "run"
    log = Logger("worker")
    try:
        cfg = Config.from_env()
    except ConfigError as err:
        log.error("config_missing", name=err.name)
        return 1
    from .handlers import schemas_dir

    if not schemas_dir().is_dir():
        log.error("config_missing", name="SANAD_SCHEMAS_DIR")
        return 1
    init_sentry(cfg)
    store = RestStore(cfg.supabase_url, cfg.service_role_key)

    if cmd == "reconcile":
        # Daily Render cron. Logs at error level when any counter is above zero.
        try:
            ops_reconcile(Job(0, "ops.reconcile", {}, None, 1, 1, ""), Context(store, log, lambda: True))
        except Exception as err:  # noqa: BLE001
            log.error("reconcile_failed", **error_fields(err))
            return 1
        return 0
    if cmd == "sweep":
        # Minute cron: enqueue, deduped so overlapping crons never stack up.
        store.enqueue("ops.sweep", {}, dedupe="ops.sweep")
        return 0

    worker = Worker(
        store=store,
        registry=default_registry(),
        log=log,
        worker_id=cfg.worker_id,
        slots=cfg.slots,
        lease_seconds=cfg.lease_seconds,
        killed=lambda: flag_on(
            "worker-kill",
            cfg.posthog_host,
            cfg.posthog_project_key,
            on_error=lambda reason: log.warn("flag_unavailable", name="worker-kill", reason=reason),
        ),
    )
    if cmd == "once":
        worker.run_once()
        return 0
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: worker.stop())
    worker.run_forever(cfg.idle_sleep_seconds)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
