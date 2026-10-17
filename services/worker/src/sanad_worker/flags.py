"""Server-side flags for the worker. Anything but an explicit ``true`` is OFF.

``worker-kill`` is an inverse flag: ON pauses claiming. It is global, so it is
evaluated for the fixed distinct id ``sanad-worker`` (no fund data is sent).
"""

from __future__ import annotations

import httpx

TIMEOUT_SECONDS = 1.5
GLOBAL_ID = "sanad-worker"


def flag_on(flag: str, host: str | None, project_key: str | None, client: httpx.Client | None = None) -> bool:
    if not host or not project_key:
        return False
    c = client or httpx.Client(timeout=TIMEOUT_SECONDS)
    try:
        res = c.post(
            f"{host.rstrip('/')}/flags?v=2",
            json={"api_key": project_key, "distinct_id": GLOBAL_ID, "flag_keys_to_evaluate": [flag]},
            timeout=TIMEOUT_SECONDS,
        )
        if res.status_code != 200:
            return False
        body = res.json()
    except (httpx.HTTPError, ValueError):
        return False
    return read_flag(body, flag)


def read_flag(body: object, flag: str) -> bool:
    if not isinstance(body, dict) or body.get("errorsWhileComputingFlags") is True:
        return False
    flags = body.get("flags")
    if isinstance(flags, dict):
        entry = flags.get(flag)
        return isinstance(entry, dict) and entry.get("enabled") is True
    legacy = body.get("featureFlags")
    if isinstance(legacy, dict):
        return legacy.get(flag) is True
    return False
