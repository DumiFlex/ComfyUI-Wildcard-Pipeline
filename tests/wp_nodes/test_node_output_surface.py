"""Node code reads ``NodeOutput.args``, the real ComfyUI field.

The test stub also offers ``values`` for the tests' convenience; real
ComfyUI has no such field, so a node reading it fails only in ComfyUI
(WP Model Info threw "'NodeOutput' object has no attribute 'values'").
"""
import re
from pathlib import Path

NODES = Path(__file__).resolve().parents[2] / "wp_nodes"
# `.values` not followed by `(`: a dict's .values() is fine.
FIELD = re.compile(r"\.values\b(?!\s*\()")


def test_no_node_reads_node_output_values():
    hits = [f"{p.name}:{i}: {line.strip()}"
            for p in sorted(NODES.glob("*.py"))
            for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1)
            if FIELD.search(line)]
    assert not hits, "read NodeOutput.args, not .values:\n" + "\n".join(hits)
