"""Cross-language parity: TS INSTANCE_FIELDS_PER_KIND ↔ Python INSTANCE_SCHEMAS.

If either side is updated without the other, this test fails — surfaces
schema drift before it ships to users.

The TS side is read by parsing `_shell.ts` for the registry literal.
"""
import pathlib
import re

from engine.schemas.instance_schemas import INSTANCE_SCHEMAS

SHELL_TS = pathlib.Path(__file__).parent.parent / "src" / "components" / "context" / "editors" / "_shell.ts"


def _parse_ts_registry() -> dict[str, list[str]]:
    """Extract INSTANCE_FIELDS_PER_KIND from _shell.ts via regex.

    Brittle but the file is small + the registry is well-formed; production-grade
    parser overkill here. If the TS layout changes, update this regex.
    """
    src = SHELL_TS.read_text(encoding="utf-8")
    block = re.search(
        r"INSTANCE_FIELDS_PER_KIND[^=]*=\s*\{(.*?)\};",
        src, re.DOTALL,
    )
    assert block, "could not locate INSTANCE_FIELDS_PER_KIND block"
    body = block.group(1)
    out: dict[str, list[str]] = {}
    for entry in re.finditer(
        r'(\w+):\s*\[(.*?)\]', body, re.DOTALL,
    ):
        kind = entry.group(1)
        fields_raw = entry.group(2)
        fields = [m.group(1) for m in re.finditer(r'"(\w+)"', fields_raw)]
        out[kind] = fields
    return out


def test_ts_and_python_kinds_match():
    ts_kinds = set(_parse_ts_registry().keys())
    py_kinds = set(INSTANCE_SCHEMAS.keys())
    py_kinds_with_pipeline = py_kinds | {"pipeline"}
    assert ts_kinds == py_kinds_with_pipeline, (
        f"TS kinds: {ts_kinds}, Python kinds (+pipeline): {py_kinds_with_pipeline}"
    )


def test_ts_and_python_fields_match_per_kind():
    ts_registry = _parse_ts_registry()
    for kind, py_fields in INSTANCE_SCHEMAS.items():
        ts_fields = set(ts_registry.get(kind, []))
        assert ts_fields == set(py_fields.keys()), (
            f"kind={kind}: TS fields={ts_fields}, Python fields={set(py_fields.keys())}"
        )
