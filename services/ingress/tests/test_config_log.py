import pytest

from sanad_ingress.__main__ import scrub
from sanad_ingress.config import Config, ConfigError
from sanad_ingress.log import Logger, error_fields

ENV = {
    "SUPABASE_URL": "https://example.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY": "k",
    "GITHUB_WEBHOOK_SECRET": "w" * 32,
    "SCAN_UPLOAD_SECRET": "u" * 32,
    "RENDER_GIT_COMMIT": "0123456789abcdef0123456789abcdef01234567",
}


def test_config_reads_the_environment():
    cfg = Config.from_env(ENV)
    assert cfg.commit == ENV["RENDER_GIT_COMMIT"]
    assert cfg.github_webhook_secret == b"w" * 32
    assert "k" not in repr(cfg).replace("supabase", "") and "w" * 32 not in repr(cfg)


@pytest.mark.parametrize(
    "name",
    ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GITHUB_WEBHOOK_SECRET", "SCAN_UPLOAD_SECRET"],
)
def test_missing_variable_refuses_start(name):
    env = {k: v for k, v in ENV.items() if k != name}
    with pytest.raises(ConfigError) as e:
        Config.from_env(env)
    assert e.value.name == name


def test_short_secret_and_plain_http_refuse_start():
    with pytest.raises(ConfigError):
        Config.from_env({**ENV, "GITHUB_WEBHOOK_SECRET": "short"})
    for url in (
        "http://example.supabase.co",
        "http://localhost.attacker.example",
        "ftp://localhost",
        "https://",
    ):
        with pytest.raises(ConfigError):
            Config.from_env({**ENV, "SUPABASE_URL": url})
    assert Config.from_env({**ENV, "SUPABASE_URL": "http://localhost:54321"}).supabase_url
    with pytest.raises(ConfigError):
        Config.from_env({**ENV, "SUPABASE_URL": "http://localhost:54321", "SANAD_ENV": "production"})


def test_the_two_secrets_must_differ():
    with pytest.raises(ConfigError):
        Config.from_env({**ENV, "SCAN_UPLOAD_SECRET": ENV["GITHUB_WEBHOOK_SECRET"]})


def test_odd_commit_is_unknown():
    assert Config.from_env({**ENV, "RENDER_GIT_COMMIT": "abc;rm"}).commit == "unknown"
    assert Config.from_env({k: v for k, v in ENV.items() if k != "RENDER_GIT_COMMIT"}).commit == "unknown"


def test_logger_drops_fields_not_on_the_allow_list():
    lines = []
    Logger("t", lines.append).info("x", route="/health", body="payload", email="a@b.c", status=200)
    assert '"body"' not in lines[0] and '"email"' not in lines[0]
    assert '"route":"/health"' in lines[0] and '"service":"ingress"' in lines[0]


def test_error_fields_never_carry_the_message():
    err = RuntimeError("founder@example.com")
    err.code = "bad code!"
    assert error_fields(err) == {"error_name": "RuntimeError", "code": "invalid_code"}


def test_reasons_and_codes_must_be_identifiers():
    lines = []
    Logger("t", lines.append).warn("x", reason="sha256=abc def", outcome="ok", code="42501")
    assert '"reason":"invalid_code"' in lines[0]
    assert '"outcome":"ok"' in lines[0] and '"code":"42501"' in lines[0]


def test_sentry_scrub_keeps_only_type_and_stack():
    event = {
        "request": {"data": "payload"},
        "user": {"email": "a@b.c"},
        "extra": {"x": 1},
        "breadcrumbs": [1],
        "message": "m",
        "logentry": {"message": "m"},
        "exception": {
            "values": [
                {
                    "type": "RuntimeError",
                    "value": "secret",
                    "stacktrace": {"frames": [{"function": "f", "vars": {"t": "x"}}]},
                }
            ]
        },
    }
    out = scrub(event, None)
    assert set(out) == {"exception"}
    ex = out["exception"]["values"][0]
    assert ex["type"] == "RuntimeError" and "value" not in ex
    assert ex["stacktrace"]["frames"] == [{"function": "f"}]
