"""Request bodies are read from the stream with a hard cap, never buffered whole first."""

from __future__ import annotations

import asyncio

from starlette.requests import Request

GITHUB_WEBHOOK_MAX_BYTES = 1024 * 1024  # GitHub caps payloads at 25 MB; install events are small
SCAN_RESULT_MAX_BYTES = 5 * 1024 * 1024


class BodyTooLarge(Exception):
    code = "body_too_large"


BODY_READ_SECONDS = 10.0


class BodyTimeout(Exception):
    code = "body_timeout"


class BadRequest(Exception):
    code = "bad_request"


async def read_capped(request: Request, limit: int, seconds: float = BODY_READ_SECONDS) -> bytes:
    declared = request.headers.get("content-length")
    if declared is not None:
        if not (declared.isascii() and declared.isdecimal() and len(declared) <= 12):
            raise BadRequest()
        if int(declared) > limit:
            raise BodyTooLarge()
    buf = bytearray()
    try:
        async with asyncio.timeout(seconds):  # a slow sender can't hold the connection open
            async for chunk in request.stream():
                buf += chunk
                if len(buf) > limit:
                    raise BodyTooLarge()
    except TimeoutError:
        raise BodyTimeout() from None
    return bytes(buf)
