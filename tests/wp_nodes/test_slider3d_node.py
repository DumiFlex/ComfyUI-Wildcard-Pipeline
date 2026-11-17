"""Node-level tests for WP_Slider3D (three axes + an optional phrase row)."""
import json
from types import SimpleNamespace

from engine import sliders
from wp_nodes.slider3d_node import WPSlider3D, axes_and_phrase

SIDE = [
    {"upto": -157.5, "word": "back"}, {"upto": -112.5, "word": "back-left"},
    {"upto": -67.5, "word": "left side"}, {"upto": -22.5, "word": "front-left"},
    {"upto": 22.5, "word": "front"}, {"upto": 67.5, "word": "front-right"},
    {"upto": 112.5, "word": "right side"}, {"upto": 157.5, "word": "back-right"},
    {"word": "back"},
]
CFG = {"version": 1, "pad": {"style": "orbit"}, "rows": [
    {"id": "0000000x", "kind": "slider", "name": "Around", "var": "view_side", "value": -45,
     "min": -180, "max": 180, "step": 15, "decimals": 0, "mode": "words", "words": SIDE,
     "internal": True, "pin": True, "out": 1},
    {"id": "0000000y", "kind": "slider", "name": "Height", "var": "view_height", "value": 30,
     "min": -45, "max": 90, "step": 5, "decimals": 0, "mode": "words", "internal": True,
     "words": [{"upto": 15, "word": "eye level"}, {"upto": 60, "word": "high angle"},
               {"word": "top-down"}],
     "pin": True, "out": 2},
    {"id": "0000000z", "kind": "slider", "name": "Distance", "var": "view_shot", "value": 0.5,
     "decimals": 2, "mode": "words", "internal": True, "pin": True, "out": 3,
     "words": [{"upto": 0.3, "word": "close-up"}, {"upto": 0.7, "word": "medium shot"},
               {"word": "wide shot"}]},
    {"id": "0000000p", "kind": "slider", "name": "View", "var": "view", "mode": "text",
     "text": "$view_side view, $view_height, $view_shot"},
]}


def _run(config=CFG, **kwargs):
    WPSlider3D.hidden = SimpleNamespace(unique_id="7")
    try:
        return WPSlider3D.execute(wp_sliders=json.dumps(config), **kwargs)
    finally:
        del WPSlider3D.hidden


def test_schema():
    s = WPSlider3D.define_schema()
    assert s.node_id == "WP_Slider3D"
    assert s.category == "wildcard-pipeline"
    assert [i.name for i in s.inputs] == ["upstream", "wp_sliders"]
    assert [o.name for o in s.outputs] == ["context", "x", "y", "z"]


def test_orbit_words_and_the_phrase():
    payload, x, y, z = _run().values
    assert (x, y, z) == (-45, 30, 0.5)
    assert payload.context["view"] == "front-left view, high angle, medium shot"
    assert payload.context["view_side"] == "front-left"
    assert payload.internals[sliders.NUMS_KEY]["view_side"] == "-45"
    trace = {t["binding"]: t for t in payload.debug["__wp_trace__"]}
    assert trace["view"]["node"] == "WP_Slider3D" and trace["view"]["node_id"] == "7"


def test_back_at_both_ends_of_the_turn():
    for v in (-180, 180, 165):
        cfg = json.loads(json.dumps(CFG))
        cfg["rows"][0]["value"] = v
        payload, *_ = _run(cfg).values
        assert payload.context["view_side"] == "back"


def test_only_one_text_row_after_the_axes_counts():
    cfg = {"rows": [*CFG["rows"], {"id": "q", "kind": "slider", "var": "extra", "value": 3},
                    {"id": "r", "kind": "slider", "var": "second", "mode": "text", "text": "x"}]}
    kept = axes_and_phrase(sliders.parse_config(cfg))
    assert [s.var for s in kept.sliders] == ["view_side", "view_height", "view_shot", "view"]
    payload, x, y, z = _run({"rows": CFG["rows"][:2]}).values
    assert z == 0 and "view" not in payload.context
