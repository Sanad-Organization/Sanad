import json

import pytest
from fastapi.testclient import TestClient

from sanad_ingress.app import create_app
from sanad_ingress.config import Config
from sanad_ingress.log import Logger

SECRET = b"s" * 32


class Captured(list):
    def events(self, name):
        return [e for e in self if e["event"] == name]


@pytest.fixture
def logs():
    lines = Captured()
    return lines, Logger("test", lambda line: lines.append(json.loads(line)))


@pytest.fixture
def cfg():
    return Config(
        supabase_url="http://localhost:54321",
        service_role_key="test-service-role",
        github_webhook_secret=SECRET,
        scan_upload_secret=SECRET,
        commit="abc123",
    )


@pytest.fixture
def app(cfg, logs):
    return create_app(cfg, logs[1])


@pytest.fixture
def client(app):
    return TestClient(app, raise_server_exceptions=False)
