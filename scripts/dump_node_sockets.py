"""Write every V3 node's sockets to tests/fixtures/node-sockets.json.

The docs field registry (`src/manager/docs/node-fields.ts`) must name every
input and output a node declares, so a new socket can't go undocumented.
This script reads each node's `define_schema()` (through the test stub of
`comfy_api`, so no ComfyUI is needed) and writes the names, types and
whether each input is optional. `node-fields.test.ts` checks the registry
against it, and `tests/test_node_sockets_fixture.py` fails when the file is
stale.

USAGE
    python scripts/dump_node_sockets.py
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "tests" / "fixtures" / "node-sockets.json"


def _install_stub() -> None:
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    if "comfy_api" in sys.modules:
        return
    from tests.stubs import comfy_api_stub as stub

    sys.modules["comfy_api"] = stub
    sys.modules["comfy_api.latest"] = stub
    sys.modules["comfy_api.latest._io"] = stub.io._io


def build() -> dict[str, dict[str, list[dict[str, object]]]]:
    _install_stub()
    spec = importlib.util.spec_from_file_location(
        "wildcard_pipeline_root", ROOT / "__init__.py", submodule_search_locations=[str(ROOT)]
    )
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules["wildcard_pipeline_root"] = mod
    spec.loader.exec_module(mod)
    nodes = asyncio.run(mod.WildcardPipelineExtension().get_node_list())
    out: dict[str, dict[str, list[dict[str, object]]]] = {}
    for cls in nodes:
        schema = cls.define_schema()
        out[schema.node_id] = {
            "inputs": [
                {"name": s.name, "type": s.type_name, "optional": bool(s.optional)}
                for s in schema.inputs
            ],
            "outputs": [
                {"name": s.name or s.display_name or s.type_name, "type": s.type_name}
                for s in schema.outputs
            ],
        }
    return dict(sorted(out.items()))


def render() -> str:
    return json.dumps(build(), indent=2, sort_keys=False) + "\n"


if __name__ == "__main__":
    FIXTURE.write_text(render(), encoding="utf-8")
    print(f"wrote {FIXTURE.relative_to(ROOT)}")
