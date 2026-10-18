import asyncio
import json

import pytest
from fastapi import Request

from sanad_ingress.app import Forbidden
from sanad_ingress.body import BodyTimeout, read_capped


def test_health_reports_the_commit(client, logs):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "commit": "abc123"}
    assert r.headers["cache-control"] == "no-store"
    end = logs[0].events("request_end")[-1]
    assert end["route"] == "/health" and end["status"] == 200 and end["method"] == "GET"


def test_no_docs_or_schema_routes(client):
    for path in ("/docs", "/redoc", "/openapi.json"):
        r = client.get(path)
        assert r.status_code == 404
        assert r.json() == {"error": "not_found"}


def test_request_id_is_reused_only_when_well_formed(client, logs):
    assert client.get("/health", headers={"x-request-id": "req-12345678"}).headers["x-request-id"] == (
        "req-12345678"
    )
    bad = client.get("/health", headers={"x-request-id": "<script>"}).headers["x-request-id"]
    assert bad != "<script>" and len(bad) == 36
    assert logs[0][-1]["trace_id"] == bad


def test_forbidden_is_generic_and_the_reason_is_logged_only(app, client, logs):
    @app.post("/t/forbidden/{reason}")
    async def refuse(reason: str):
        raise Forbidden(reason)

    a = client.post("/t/forbidden/bad_signature")
    b = client.post("/t/forbidden/expired_token")
    assert a.status_code == b.status_code == 403
    assert a.content == b.content == b'{"error":"forbidden"}'
    assert [e["reason"] for e in logs[0].events("request_refused")] == ["bad_signature", "expired_token"]


def test_unhandled_errors_are_503_without_detail(app, client, logs):
    @app.get("/t/boom")
    async def boom():
        raise RuntimeError("secret detail from a payload")

    r = client.get("/t/boom")
    assert r.status_code == 503
    assert r.json() == {"error": "unavailable"}
    text = json.dumps(list(logs[0]))
    assert "secret detail" not in text
    failed = logs[0].events("request_failed")[0]
    assert failed["error_name"] == "RuntimeError" and failed["level"] == "error"
    assert logs[0].events("request_end")[-1]["status"] == 503


def test_body_cap_on_declared_length(app, client):
    @app.post("/t/body")
    async def body(request: Request):
        return {"n": len(await read_capped(request, 10))}

    assert client.post("/t/body", content=b"x" * 10).json() == {"n": 10}
    r = client.post("/t/body", content=b"x" * 11)
    assert r.status_code == 413 and r.json() == {"error": "too_large"}


def test_body_cap_on_the_stream_without_a_length(app, client):
    @app.post("/t/body")
    async def body(request: Request):
        return {"n": len(await read_capped(request, 10))}

    def chunks():
        for _ in range(5):
            yield b"xxxx"

    r = client.post("/t/body", content=chunks())
    assert r.status_code == 413


def test_bad_content_length_is_400(app, client):
    @app.post("/t/body")
    async def body(request: Request):
        return {"n": len(await read_capped(request, 10))}

    r = client.post("/t/body", content=b"x", headers={"content-length": "abc"})
    assert r.status_code == 400 and r.json() == {"error": "bad_request"}


def test_validation_errors_never_echo_input(app, client):
    @app.get("/t/num")
    async def num(n: int):
        return {"n": n}

    r = client.get("/t/num", params={"n": "founder@example.com"})
    assert r.status_code == 400
    assert r.json() == {"error": "bad_request"}


def test_slow_body_times_out():
    async def receive():
        await asyncio.sleep(1)
        return {"type": "http.request", "body": b"x", "more_body": False}

    request = Request({"type": "http", "method": "POST", "headers": []}, receive)

    async def run():
        await read_capped(request, 10, seconds=0.05)

    with pytest.raises(BodyTimeout):
        asyncio.run(run())


def test_timeout_maps_to_408(app, client):
    @app.post("/t/slow")
    async def slow():
        raise BodyTimeout()

    r = client.post("/t/slow")
    assert r.status_code == 408 and r.json() == {"error": "timeout"}
