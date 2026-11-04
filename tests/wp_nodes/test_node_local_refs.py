"""A `@{}` ref resolves from the node's own rows first, switched-off ones
included, then the library (docs: WP Context → "Where @{} references look").

Pins the runtime half of that promise without any library: the catalog is
built from the widget value alone, so every ref below can only resolve from
the node.
"""
import json
from pathlib import Path

from engine.pipeline import PipelineEngine
from wp_nodes.types import deserialize_node_input

EXAMPLE = Path(__file__).resolve().parents[2] / "example_workflows" / "1 - One image.json"


def _wc(uid: str, binding: str, values: list[str], *, enabled=True, origin=None) -> dict:
    m = {
        "id": uid, "_uid": f"u{uid}", "type": "wildcard", "enabled": enabled,
        "meta": {"name": binding.title()},
        "payload": {
            "var_binding": binding,
            "options": [
                {"id": f"{uid}-{i}", "value": v, "weight": 1, "sub_categories": []}
                for i, v in enumerate(values)
            ],
        },
    }
    if origin:
        m["bundle_origin"] = origin
    return m


def _run(widget: dict | str, seed: int = 0) -> dict:
    modules, catalog, _ = deserialize_node_input(widget)
    ctx: dict = {"__wp_catalog__": catalog}
    PipelineEngine().run(modules, ctx, seed=seed)
    return ctx


def _warning_types(ctx: dict) -> list[str]:
    return [w.get("type") for w in ctx["__wp_warnings__"]]


def test_ref_resolves_from_a_switched_off_row():
    widget = {"version": 1, "modules": [
        _wc("aaaa0001", "hair", ["@{bbbb0002} hair"]),
        _wc("bbbb0002", "color", ["copper"], enabled=False),
    ]}
    ctx = _run(widget)
    assert ctx["hair"] == "copper hair"
    # Switched off: it lends its pool but does not bind its own variable.
    assert "color" not in ctx
    assert _warning_types(ctx) == []


def test_ref_resolves_from_a_row_in_a_switched_off_bundle():
    widget = {
        "version": 1,
        "bundles": [{"_uid": "shared", "enabled": False}],
        "modules": [
            _wc("aaaa0001", "hair", ["@{bbbb0002} hair"]),
            _wc("bbbb0002", "color", ["copper"], origin="shared"),
        ],
    }
    ctx = _run(widget)
    assert ctx["hair"] == "copper hair"
    assert "color" not in ctx
    assert _warning_types(ctx) == []


def test_nested_refs_resolve_from_the_node_at_every_level():
    # hair → @{color} → @{shade}: both targets switched off, none in a library.
    widget = {"version": 1, "modules": [
        _wc("aaaa0001", "hair", ["@{bbbb0002} hair"]),
        _wc("bbbb0002", "color", ["@{cccc0003} red"], enabled=False),
        _wc("cccc0003", "shade", ["dark"], enabled=False),
    ]}
    ctx = _run(widget)
    assert ctx["hair"] == "dark red hair"
    assert _warning_types(ctx) == []


def test_example_workflow_colors_resolve_from_the_shared_lists_bundle():
    data = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    node = next(n for n in data["nodes"] if n["type"] == "WP_Context" and n["id"] == 3)
    widget = next(w for w in node["widgets_values"] if isinstance(w, str) and w.startswith("{"))
    for seed in range(5):
        ctx = _run(widget, seed)
        assert "@{" not in ctx["hair"]
        assert "unknown_ref" not in _warning_types(ctx)
        # An unresolved ref would leave "short  hair" (empty colour).
        assert "  " not in ctx["hair"]
