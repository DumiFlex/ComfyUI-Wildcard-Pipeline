"""Node-level tests for WP_Slider2D (an XY pad on WP_Slider's run)."""
import json
from types import SimpleNamespace

from engine import sliders
from wp_nodes.slider2d_node import WPSlider2D

CFG = {"version": 1, "pad": {"ratio": 1, "area": True}, "rows": [
    {"id": "0000000x", "kind": "slider", "name": "Width", "var": "width", "value": 1024,
     "min": 512, "max": 2048, "step": 64, "decimals": 0, "pin": True, "out": 1},
    {"id": "0000000y", "kind": "slider", "name": "Mood", "var": "mood", "value": 0.8,
     "decimals": 2, "mode": "words", "pin": True, "out": 2,
     "words": [{"upto": 0.5, "word": "calm"}, {"word": "wild", "negative": "serene"}]},
]}


def _run(config=CFG, **kwargs):
    WPSlider2D.hidden = SimpleNamespace(unique_id="9")
    try:
        return WPSlider2D.execute(wp_sliders=json.dumps(config), **kwargs)
    finally:
        del WPSlider2D.hidden


def test_schema():
    s = WPSlider2D.define_schema()
    assert s.node_id == "WP_Slider2D"
    assert s.category == "wildcard-pipeline"
    assert [i.name for i in s.inputs] == ["upstream", "wp_sliders"]
    assert [o.name for o in s.outputs] == ["context", "x", "y"]


def test_axes_write_like_sliders_and_feed_both_outputs():
    payload, x, y = _run().values
    assert (x, y) == (1024, 0.8) and isinstance(x, int)
    assert payload.context == {"width": "1024", "mood": "wild"}
    assert payload.internals[sliders.NUMS_KEY] == {"width": "1024", "mood": "0.80"}
    trace = {t["binding"]: t for t in payload.debug["__wp_trace__"]}
    assert trace["mood"]["node"] == "WP_Slider2D" and trace["mood"]["node_id"] == "9"
    assert trace["mood"]["negative"] == "serene"


def test_rows_past_two_are_ignored_and_a_missing_axis_reads_zero():
    three = {"rows": [*CFG["rows"], {"id": "z", "kind": "slider", "var": "z", "value": 5}]}
    payload, *_ = _run(three).values
    assert "z" not in payload.context
    payload, x, y = _run({"rows": CFG["rows"][:1]}).values
    assert (x, y) == (1024, 0)


def test_problems_name_the_node():
    cfg = {"rows": [{"id": "a", "kind": "slider", "name": "A", "var": "1x"}]}
    payload, *_ = _run(cfg).values
    assert all(w["message"].startswith("WP Slider 2D") for w in payload.debug["__wp_warnings__"])
