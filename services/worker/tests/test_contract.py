"""TS ↔ Python contract: the same job kinds and payload schemas on both sides."""

import json
import re
from pathlib import Path

from sanad_worker.handlers import default_registry, schemas_dir

ROOT = Path(__file__).resolve().parents[3]


def ts_job_kinds() -> list[str]:
    src = (ROOT / "packages" / "types" / "src" / "jobs.ts").read_text()
    block = re.search(r"JOB_KINDS = \[(.*?)\] as const", src, re.S)
    assert block, "JOB_KINDS not found in jobs.ts"
    return re.findall(r"'([a-z]+\.[a-z_]+)'", block.group(1))


def test_every_ts_kind_has_a_schema_python_can_load():
    kinds = ts_job_kinds()
    assert len(kinds) >= 20
    for kind in kinds:
        schema = json.loads((schemas_dir() / f"{kind}.json").read_text())
        assert schema["additionalProperties"] is False, kind


def test_every_registered_handler_is_a_known_kind():
    assert default_registry().kinds() <= set(ts_job_kinds())
