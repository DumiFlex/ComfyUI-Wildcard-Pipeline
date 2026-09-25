"""The committed engine-parity fixtures must match what the engine produces.

`scripts/dump_engine_shapes.py` writes one engine-validated row per module
subtype to `src/validators/fixtures/engine-parity/`, and the vitest parity
suite checks the TS validators accept them. That only guards anything if
the fixtures are current: a handler shape change that nobody re-dumped
leaves the TS side testing a stale shape. This test re-runs the dump logic
in memory, so a stale fixture or a sample the handler now rejects fails
pytest in CI instead of waiting for someone to remember the script.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parent.parent
_SCRIPT = _ROOT / "scripts" / "dump_engine_shapes.py"


def _load_script():
    spec = importlib.util.spec_from_file_location("dump_engine_shapes", _SCRIPT)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_DUMP = _load_script()


@pytest.mark.parametrize("type_id", sorted(_DUMP._SAMPLES))
def test_committed_fixture_matches_engine_sample(type_id: str) -> None:
    handler, payload = _DUMP._SAMPLES[type_id]
    handler.validate_payload(payload)  # engine authority; raises on drift
    committed = json.loads(
        (_DUMP._OUT_DIR / f"{type_id}.json").read_text(encoding="utf-8")
    )
    assert committed == _DUMP._engine_row(type_id, payload), (
        f"{type_id}.json is stale: run `python scripts/dump_engine_shapes.py` "
        "and commit the regenerated fixtures"
    )


def test_every_fixture_has_a_sample() -> None:
    on_disk = {p.stem for p in _DUMP._OUT_DIR.glob("*.json")}
    assert on_disk == set(_DUMP._SAMPLES)
