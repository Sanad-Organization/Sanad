"""The ingress app: health, uniform errors and request logs.

Routes for the GitHub webhook, the install callback and scan results arrive with
GITHUB-ACCESS and SCAN-SANDBOX; they use ``security`` and ``body`` from here.
Responses never say why a request was refused: 403 is always the same body.
"""

from __future__ import annotations

import re
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from .body import BadRequest, BodyTimeout, BodyTooLarge
from .config import Config
from .log import Logger, error_fields

_REQUEST_ID = re.compile(r"[A-Za-z0-9-]{8,64}")
NO_STORE = {"cache-control": "no-store"}


class Forbidden(Exception):
    """Refuse with the generic 403. ``reason`` goes to the log only."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _error(status: int, error: str) -> JSONResponse:
    return JSONResponse({"error": error}, status_code=status, headers=NO_STORE)


def _route(request: Request) -> str:
    route = request.scope.get("route")
    return getattr(route, "path", "unmatched")


def create_app(cfg: Config, log: Logger | None = None) -> FastAPI:
    base = log or Logger("ingress")
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def observe(request: Request, call_next):
        incoming = request.headers.get("x-request-id", "")
        trace_id = incoming if _REQUEST_ID.fullmatch(incoming) else str(uuid.uuid4())
        request.state.log = base.child(trace_id)
        started = time.monotonic()
        try:
            response = await call_next(request)
        except Exception as err:  # noqa: BLE001 — anything unhandled is a 503, never a stack trace
            request.state.log.error("request_failed", route=_route(request), **error_fields(err))
            if cfg.sentry_dsn:
                import sentry_sdk

                sentry_sdk.capture_exception(err)
            response = _error(503, "unavailable")
        response.headers["x-request-id"] = trace_id
        request.state.log.info(
            "request_end",
            method=request.method,
            route=_route(request),
            status=response.status_code,
            duration_ms=int((time.monotonic() - started) * 1000),
        )
        return response

    @app.exception_handler(Forbidden)
    async def forbidden(request: Request, exc: Forbidden):
        request.state.log.warn("request_refused", route=_route(request), reason=exc.reason)
        return _error(403, "forbidden")

    @app.exception_handler(BodyTooLarge)
    async def too_large(_request: Request, _exc: BodyTooLarge):
        return _error(413, "too_large")

    @app.exception_handler(BodyTimeout)
    async def body_timeout(_request: Request, _exc: BodyTimeout):
        return _error(408, "timeout")

    @app.exception_handler(BadRequest)
    @app.exception_handler(RequestValidationError)
    async def bad_request(_request: Request, _exc: Exception):
        # FastAPI's default 422 echoes the input; this never does.
        return _error(400, "bad_request")

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException):
        return _error(exc.status_code, "not_found" if exc.status_code == 404 else "refused")

    @app.get("/health")
    async def health():
        return JSONResponse({"status": "ok", "commit": cfg.commit}, headers=NO_STORE)

    return app
