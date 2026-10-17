import json

import httpx
import pytest

from sanad_worker.store import RestStore, StoreError


def store(handler):
    return RestStore("https://x.supabase.co", "svc-key", httpx.Client(transport=httpx.MockTransport(handler)))


def test_calls_the_rpc_with_service_role_headers():
    seen = {}

    def h(req: httpx.Request):
        seen["url"] = str(req.url)
        seen["auth"] = req.headers["authorization"]
        seen["body"] = json.loads(req.content)
        return httpx.Response(200, json=[])

    assert store(h).claim("w1", 2, 600) == []
    assert seen["url"] == "https://x.supabase.co/rest/v1/rpc/jobs_claim"
    assert seen["auth"] == "Bearer svc-key"
    assert seen["body"] == {"p_worker": "w1", "p_n": 2, "p_lease_seconds": 600}


def test_client_errors_raise_with_the_postgres_code_only():
    s = store(lambda r: httpx.Response(400, json={"code": "23514", "message": "secret detail"}))
    with pytest.raises(StoreError) as e:
        s.rpc("jobs_enqueue", {})
    assert e.value.code == "23514" and "secret detail" not in str(e.value)


def test_server_errors_retry_then_give_up():
    calls = []

    def h(r):
        calls.append(1)
        return httpx.Response(503)

    with pytest.raises(StoreError) as e:
        store(h).rpc("jobs_reconcile")
    assert len(calls) == 3 and e.value.code == "unavailable"


def test_claim_is_not_retried():
    calls = []

    def h(r):
        calls.append(1)
        return httpx.Response(503)

    with pytest.raises(StoreError):
        store(h).claim("w", 1, 60)
    assert len(calls) == 1
