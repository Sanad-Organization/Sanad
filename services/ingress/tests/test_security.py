import hashlib
import hmac

import pytest

from sanad_ingress.security import (
    MAX_SCAN_TOKEN_TTL_SECONDS,
    bearer_token,
    sign_scan_token,
    verify_github_signature,
    verify_scan_token,
)

SECRET = b"s" * 32
SCAN = "00000000-0000-0000-0000-0000000005ca"
NOW = 1_800_000_000


def gh_sig(body: bytes, secret: bytes = SECRET) -> str:
    return "sha256=" + hmac.new(secret, body, hashlib.sha256).hexdigest()


def test_github_signature_accepts_the_right_mac():
    assert verify_github_signature(SECRET, b'{"action":"created"}', gh_sig(b'{"action":"created"}'))


@pytest.mark.parametrize(
    "header",
    [
        None,
        "",
        "sha1=abc",
        gh_sig(b"other body"),
        gh_sig(b'{"action":"created"}', b"x" * 32),
        gh_sig(b'{"action":"created"}').upper(),
        "sha256=" + "é" * 64,
    ],
)
def test_github_signature_refuses_everything_else(header):
    assert not verify_github_signature(SECRET, b'{"action":"created"}', header)


def test_github_signature_refuses_an_empty_secret():
    assert not verify_github_signature(b"", b"x", gh_sig(b"x", b""))


def test_scan_token_round_trip():
    token = sign_scan_token(SECRET, SCAN, NOW + 600)
    assert verify_scan_token(SECRET, token, SCAN, NOW)


@pytest.mark.parametrize(
    "token, scan, now",
    [
        (sign_scan_token(SECRET, SCAN, NOW + 600), SCAN, NOW + 600),  # expired
        (sign_scan_token(SECRET, SCAN, NOW + 600), "00000000-0000-0000-0000-0000000005cb", NOW),  # other scan
        (sign_scan_token(b"x" * 32, SCAN, NOW + 600), SCAN, NOW),  # other secret
        (sign_scan_token(SECRET, SCAN, NOW + MAX_SCAN_TOKEN_TTL_SECONDS + 1), SCAN, NOW),  # too long-lived
        (
            sign_scan_token(SECRET, SCAN, NOW + 600).replace(str(NOW + 600), str(NOW + 900)),
            SCAN,
            NOW,
        ),  # tampered
        ("v1.garbage", SCAN, NOW),
        ("", SCAN, NOW),
        (None, SCAN, NOW),
    ],
)
def test_scan_token_refusals(token, scan, now):
    assert not verify_scan_token(SECRET, token, scan, now)


def test_scan_token_needs_a_scan_id():
    with pytest.raises(ValueError):
        sign_scan_token(SECRET, "../etc", NOW)


def test_bearer_token():
    assert bearer_token("Bearer abc") == "abc"
    assert bearer_token("bearer abc") is None
    assert bearer_token("Bearer ") is None
    assert bearer_token(None) is None


def test_scan_tokens_are_canonical():
    token = sign_scan_token(SECRET, SCAN, NOW + 600)
    prefix, exp, mac = token.rsplit(".", 2)
    for variant in (token + "\n", f"{prefix}.0{exp}.{mac}", f"{prefix}.00{exp}.{mac}", " " + token):
        assert not verify_scan_token(SECRET, variant, SCAN, NOW), repr(variant)


def test_sign_refuses_bad_expiry():
    for bad in (0, -1, 10**12):
        with pytest.raises(ValueError):
            sign_scan_token(SECRET, SCAN, bad)
