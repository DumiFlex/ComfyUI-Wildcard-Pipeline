"""`tests/fixtures/node-sockets.json` must match the nodes' schemas.

The docs field registry is checked against that file
(`src/manager/docs/__tests__/node-fields.test.ts`), so a stale file would
let a new socket go undocumented. Regenerate with
`python scripts/dump_node_sockets.py`.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _dump_module():
    script = ROOT / "scripts" / "dump_node_sockets.py"
    spec = importlib.util.spec_from_file_location("dump_node_sockets", script)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_node_sockets_fixture_is_current():
    committed = (ROOT / "tests" / "fixtures" / "node-sockets.json").read_text(encoding="utf-8")
    assert _dump_module().render() == committed, "run: python scripts/dump_node_sockets.py"
