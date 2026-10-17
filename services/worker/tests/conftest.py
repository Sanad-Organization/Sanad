import json

import pytest

from sanad_worker.log import Logger


class Captured(list):
    def events(self, name):
        return [e for e in self if e["event"] == name]


@pytest.fixture
def logs():
    lines = Captured()
    return lines, Logger("test", lambda line: lines.append(json.loads(line)))
