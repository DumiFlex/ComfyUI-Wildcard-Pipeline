"""The WP Context nodes that run after this one, for backward rules.

Backward rules (``engine/modules/_backward.py``) look down the chain from a
source wildcard for constraints whose target is narrowed. A target in a LATER
WP Context node is out of sight of this node's own module list, so the node
reads ComfyUI's API prompt (``{id: {class_type, inputs}}``, links as
``[origin_id, slot]``) and follows its ``context`` output down a straight line
of WP nodes, collecting each WP Context's ``wp_modules`` widget value.

Only a straight line is followed: a branch (two WP nodes reading the same
context) or a Loop / Image Filter (whose frames are their own) ends it, since
reach counts and frame numbers would no longer match one chain. Pass-through
WP nodes (Injector, Toggles, Sliders, Seeds, Model Info) are stepped over;
the variables they set are not known here, so a target that reads one only
counts as narrowed where something else narrows it.
"""
from __future__ import annotations

from typing import Any

#: How many later WP Context nodes are looked at.
MAX_NODES = 4
#: Nodes whose frames are their own: the line ends at them.
_STOP = frozenset({"WP_ContextLoop", "WP_ImageFilter"})


def _is_link(v: Any) -> bool:
    return isinstance(v, list) and len(v) == 2 and isinstance(v[1], int)


def _consumers(prompt: dict[str, Any], node_id: str) -> list[tuple[str, dict[str, Any]]]:
    """WP nodes with an input wired to ``node_id``'s first output (every WP
    node's ``context``)."""
    out: list[tuple[str, dict[str, Any]]] = []
    for nid, node in prompt.items():
        if not isinstance(node, dict) or not str(node.get("class_type", "")).startswith("WP_"):
            continue
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        if any(_is_link(v) and str(v[0]) == node_id and v[1] == 0 for v in inputs.values()):
            out.append((str(nid), node))
    return out


def downstream_modules(prompt: Any, node_id: Any, limit: int = MAX_NODES) -> list[Any]:
    """The ``wp_modules`` values of the WP Context nodes after ``node_id``,
    nearest first (at most ``limit``), or ``[]``."""
    if not isinstance(prompt, dict) or node_id is None:
        return []
    found: list[Any] = []
    seen = {str(node_id)}
    cur = str(node_id)
    while len(found) < limit:
        nxt = _consumers(prompt, cur)
        if len(nxt) != 1:
            break
        nid, node = nxt[0]
        if nid in seen or node.get("class_type") in _STOP:
            break
        seen.add(nid)
        if node.get("class_type") == "WP_Context":
            raw = (node.get("inputs") or {}).get("wp_modules")
            if raw is not None and not _is_link(raw):
                found.append(raw)
        cur = nid
    return found
