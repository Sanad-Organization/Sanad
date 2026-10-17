import httpx
import pytest

from sanad_worker.config import Config, ConfigError
from sanad_worker.flags import flag_on, read_flag
from sanad_worker.log import error_fields


def test_logger_drops_non_allowlisted_fields(logs):
    lines, log = logs
    log.info(
        "x", email="a@example.test", payload={"company": "Synthetic Co A"}, message="boom", kind="ops.sweep"
    )
    line = str(lines[0])
    for leaked in ("example.test", "Synthetic", "boom"):
        assert leaked not in line
    assert lines[0]["kind"] == "ops.sweep" and lines[0]["trace_id"] == "test"


def test_error_fields_never_include_the_message():
    err = ValueError("token=abc user@example.test")
    assert error_fields(err) == {"error_name": "ValueError"}


def test_config_refuses_to_start_without_required_vars():
    with pytest.raises(ConfigError) as e:
        Config.from_env({"SUPABASE_URL": "https://x.supabase.co"})
    assert e.value.name == "SUPABASE_SERVICE_ROLE_KEY"
    with pytest.raises(ConfigError):
        Config.from_env({"SUPABASE_URL": "http://insecure.test", "SUPABASE_SERVICE_ROLE_KEY": "k"})
    with pytest.raises(ConfigError):
        Config.from_env({"SUPABASE_URL": "https://x", "SUPABASE_SERVICE_ROLE_KEY": "k", "WORKER_SLOTS": "99"})


def test_config_repr_hides_the_key():
    cfg = Config.from_env(
        {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "very-secret"}
    )
    assert "very-secret" not in repr(cfg)


def client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_flags_fail_closed():
    assert read_flag({"flags": {"worker-kill": {"enabled": True}}}, "worker-kill") is True
    for body in (
        {"flags": {"worker-kill": {"enabled": "true"}}},
        {},
        None,
        [],
        {"featureFlags": {"worker-kill": 1}},
    ):
        assert read_flag(body, "worker-kill") is False
    assert (
        read_flag(
            {"errorsWhileComputingFlags": True, "flags": {"worker-kill": {"enabled": True}}}, "worker-kill"
        )
        is False
    )
    assert flag_on("worker-kill", None, "k") is False
    assert flag_on("worker-kill", "https://f.test", "k", client(lambda r: httpx.Response(500))) is False

    def down(_r):
        raise httpx.ConnectError("down")

    assert flag_on("worker-kill", "https://f.test", "k", client(down)) is False
    assert (
        flag_on("worker-kill", "https://f.test", "k", client(lambda r: httpx.Response(200, text="<html>")))
        is False
    )


def test_outside_local_the_kill_switch_config_is_required():
    env = {
        "SUPABASE_URL": "https://x.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "k",
        "SANAD_ENV": "production",
    }
    with pytest.raises(ConfigError) as e:
        Config.from_env(env)
    assert e.value.name == "POSTHOG_HOST"
    Config.from_env({**env, "POSTHOG_HOST": "https://f.test", "POSTHOG_PROJECT_KEY": "phc_x"})


def test_flag_errors_are_reported():
    reasons = []
    flag_on("worker-kill", None, None, on_error=reasons.append)
    flag_on(
        "worker-kill", "https://f.test", "k", client(lambda r: httpx.Response(502)), on_error=reasons.append
    )
    assert reasons == ["no_config", "http"]


def test_error_fields_reject_free_text_codes():
    class E(Exception):
        code = "contains a sentence with data"

    assert error_fields(E())["code"] == "invalid_code"
