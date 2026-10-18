"""Signed-request helpers. Every comparison is constant time; every failure is just False.

- GitHub webhooks: ``X-Hub-Signature-256: sha256=<hex HMAC of the raw body>``.
- Sandbox result uploads (ADR 0009): ``Authorization: Bearer v1.<scan id>.<expiry>.<hex HMAC>``,
  an HMAC of the scan id and expiry with the scan-upload signing secret. One token is good for
  one scan until it expires. Single use is enforced in the database, keyed on the scan id, when the
  upload route lands (SCAN-SANDBOX); this module only proves the token was minted by Sanad for this
  scan. Tokens are canonical: exactly one string verifies for a given scan and expiry.
"""

from __future__ import annotations

import hashlib
import hmac
import re

MAX_SCAN_TOKEN_TTL_SECONDS = 2 * 60 * 60
_SCAN_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_TOKEN = re.compile(r"v1\.([0-9a-f-]{36})\.([1-9][0-9]{0,11})\.([0-9a-f]{64})")


def _mac(secret: bytes, message: bytes) -> str:
    return hmac.new(secret, message, hashlib.sha256).hexdigest()


def verify_github_signature(secret: bytes, body: bytes, header: str | None) -> bool:
    if not secret or not header or not header.isascii() or not header.startswith("sha256="):
        return False
    expected = "sha256=" + _mac(secret, body)
    return hmac.compare_digest(expected.encode(), header.encode())


def sign_scan_token(secret: bytes, scan_id: str, expires_at: int) -> str:
    if not secret or not _SCAN_ID.fullmatch(scan_id) or not 0 < expires_at < 10**12:
        raise ValueError("bad scan token input")
    return f"v1.{scan_id}.{expires_at}.{_mac(secret, f'scan:{scan_id}:{expires_at}'.encode())}"


def verify_scan_token(secret: bytes, token: str | None, scan_id: str, now: int) -> bool:
    if not secret or not token or not token.isascii():
        return False
    m = _TOKEN.fullmatch(token)
    if not m:
        return False
    token_scan, expiry_raw, mac = m.groups()
    expires_at = int(expiry_raw)
    expected = _mac(secret, f"scan:{token_scan}:{expiry_raw}".encode())
    mac_ok = hmac.compare_digest(expected.encode(), mac.encode())
    scan_ok = hmac.compare_digest(token_scan.encode(), scan_id.encode()) if scan_id.isascii() else False
    fresh = now < expires_at <= now + MAX_SCAN_TOKEN_TTL_SECONDS
    return mac_ok and scan_ok and fresh


def bearer_token(header: str | None) -> str | None:
    if not header or not header.startswith("Bearer "):
        return None
    token = header[len("Bearer ") :].strip()
    return token or None
