"""A var node between a Context Loop and a Context keeps frame 0's payload true.

Toggles, Injector and Model Info copy their upstream internals, so without
`carry_frame0` the `__wp_frame0__` payload a later Context reads would lack
their writes, and a held module there would resolve frame 0 against a ctx
with no $rating (or model vars): frames 2+ print a different held pick
from frame 1.
"""
import json
import sys
from pathlib import Path
from types import SimpleNamespace

from wp_nodes.context_loop import WPContextLoop
from wp_nodes.context_node import WPContext
from wp_nodes.injector_node import WPContextInjector
from wp_nodes.model_info_node import WPModelInfo
from wp_nodes.toggles_node import WPToggles
from wp_nodes.types import FRAME0_KEY

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "example_workflows"))
from packs import Bundle, O, constraint, context_value, wildcard  # noqa: E402

PICK = {"version": 1, "mode": "one", "group_var": "rating", "pick_required": True, "rows": [
    {"id": f"0000000{i}", "kind": "toggle", "name": r, "var": f"rating_{r}", "value": r,
     "on": r == "spicy", "pin": False, "out": 0, "style": "chip"}
    for i, r in enumerate(("mild", "spicy"))]}


def _frames(count=3):
    return WPContextLoop.execute(seed=5, count=count, wp_context_loop_config="{}").values[0]


def _toggles(up):
    WPToggles.hidden = SimpleNamespace(unique_id="2")
    try:
        return WPToggles.execute(upstream=up, wp_toggles=json.dumps(PICK)).values[0]
    finally:
        del WPToggles.hidden


def test_toggles_write_into_frame_zero_payload():
    for up in _frames()[1:]:
        f0 = _toggles(up).internals[FRAME0_KEY]
        assert f0["context"]["rating"] == "spicy"
        assert f0["context"]["iteration"] == "1"
        assert f0["internals"]["__wp_loop_index__"] == 0
        assert FRAME0_KEY not in f0["internals"]


def test_frame_zero_itself_carries_no_frame_zero_payload():
    assert FRAME0_KEY not in _toggles(_frames()[0]).internals


def test_injector_writes_into_frame_zero_payload():
    rows = json.dumps({"version": 1, "rows": [
        {"_uid": "r1", "kind": "socket", "slot_name": "input_0", "binding": "words",
         "enabled": True}]})
    out = WPContextInjector.execute(rows, upstream=_frames()[2], input_0="red hat").values[0]
    assert out.internals[FRAME0_KEY]["context"]["words"] == "red hat"


def test_model_info_writes_into_frame_zero_payload():
    cfg = json.dumps({"version": 1, "rules": [], "family": "sdxl", "variant": "pony",
                      "name": "", "internal": {}})
    WPModelInfo.hidden = SimpleNamespace(unique_id="9", prompt=None)
    try:
        out = WPModelInfo.execute(upstream=_frames()[1], wp_model_info=cfg).values[0]
    finally:
        del WPModelInfo.hidden
    assert out.internals[FRAME0_KEY]["context"]["model_variant"] == "pony"


def test_held_pick_follows_a_toggle_on_every_frame():
    mirror = wildcard("Rating mirror", "r_mirror",
                      [O("mild", tags=["mild"], fb=True), O("spicy", tags=["spicy"])],
                      internal=True)
    mirror.instance["match_variable"] = "rating"
    dish = wildcard("Dish", "dish", [O(f"{h} {n}", tags=[h]) for h in ("mild", "spicy")
                                     for n in ("soup", "stew", "curry", "noodles")], hold=True)
    rule = constraint("Rating → Dish", mirror, dish,
                      {"mild": {"mild": ("only", 1)}, "spicy": {"spicy": ("only", 1)}})
    modules = context_value(Bundle("Menu", "#888888", [mirror, rule, dish]))
    for seed in range(12):
        dishes = {
            WPContext.execute(seed, modules, upstream=_toggles(up)).values[0].context["dish"]
            for up in _frames(4)
        }
        assert len(dishes) == 1, (seed, dishes)
        assert next(iter(dishes)).startswith("spicy")
