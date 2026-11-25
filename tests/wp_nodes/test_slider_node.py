"""Node-level tests for WP_Slider."""
import json
from types import SimpleNamespace

from engine import negatives, sliders
from wp_nodes.slider_node import WPSlider
from wp_nodes.types import ContextPayload

WORDS = [{"upto": 0.3, "word": "close-up"}, {"upto": 0.7, "word": "medium shot"},
         {"word": "wide shot", "negative": "cropped"}]
CFG = {"version": 1, "rows": [
    {"id": "aaaa0000", "kind": "label", "name": "LoRAs", "color": 1},
    {"id": "00000001", "kind": "slider", "name": "Character LoRA", "var": "char_lora",
     "value": 0.85, "min": 0, "max": 1.5, "step": 0.05, "decimals": 2, "pin": True, "out": 1},
    {"id": "00000002", "kind": "slider", "name": "Steps", "var": "steps", "value": 28,
     "min": 1, "max": 60, "step": 1, "decimals": 0, "pin": True, "out": 2, "internal": True},
    {"id": "00000003", "kind": "slider", "name": "Camera", "var": "shot", "value": 0.9,
     "mode": "words", "words": WORDS},
    {"id": "00000004", "kind": "slider", "name": "Detail", "var": "detail", "value": 1.2,
     "max": 2, "decimals": 1, "mode": "text", "text": "(intricate details:$detail.num), $mood",
     "negative": "flat"},
]}


def _run(config=CFG, node_id="7", **kwargs):
    WPSlider.hidden = SimpleNamespace(unique_id=node_id)
    try:
        return WPSlider.execute(wp_sliders=json.dumps(config), **kwargs)
    finally:
        del WPSlider.hidden


def test_schema():
    s = WPSlider.define_schema()
    assert s.node_id == "WP_Slider"
    assert s.category == "wildcard-pipeline"
    assert [i.name for i in s.inputs] == ["upstream", "wp_sliders"]
    assert [o.name for o in s.outputs] == ["context"] + [f"value_{i}" for i in range(1, 17)]


def test_values_numbers_and_outputs():
    up = ContextPayload(
        context={"mood": "calm"},
        debug={},
        internals={negatives.NEG_KEY: {"mood": [{"text": "angry", "pick": None}]}},
    )
    payload, *vals = _run(upstream=up).values
    assert vals[:2] == [0.85, 28] and isinstance(vals[1], int)
    assert not any(vals[2:]) and len(vals) == 16
    assert payload.context == {
        "mood": "calm", "char_lora": "0.85", "steps": "28", "shot": "wide shot",
        "detail": "(intricate details:1.2), calm",
    }
    assert payload.internals[sliders.NUMS_KEY] == {
        "char_lora": "0.85", "steps": "28", "shot": "0.90", "detail": "1.2",
    }
    negs = payload.internals[negatives.NEG_KEY]
    assert [e["text"] for e in negs["shot"]] == ["cropped"]
    # The text read $mood, so mood's negatives come along, then its own.
    assert [e["text"] for e in negs["detail"]] == ["angry", "flat"]
    assert payload.internals["__wp_internal_flags__"] == {"steps": True}
    trace = {t["binding"]: t for t in payload.debug["__wp_trace__"]}
    assert trace["shot"]["num"] == "0.90" and trace["shot"]["node_id"] == "7"
    assert trace["detail"]["detail"]["raw"].startswith("(intricate details:$detail.num)")


def test_num_table_merges_upstream_and_a_write_clears_negatives():
    up = ContextPayload(
        context={"shot": "old"},
        debug={},
        internals={sliders.NUMS_KEY: {"zoom": "3"}, negatives.NEG_KEY: {"shot": ["x"]}},
    )
    cfg = {"rows": [{"id": "a", "kind": "slider", "var": "shot", "value": 0.2}]}
    payload, *_ = _run(cfg, upstream=up).values
    assert payload.internals[sliders.NUMS_KEY] == {"zoom": "3", "shot": "0.20"}
    assert payload.internals[negatives.NEG_KEY] == {}


def test_problems_warn():
    cfg = {"rows": [{"id": "a", "kind": "slider", "name": "A", "var": "1x", "min": 2, "max": 1}]}
    payload, *_ = _run(cfg).values
    msgs = [w["message"] for w in payload.debug["__wp_warnings__"]]
    assert any("max that is not above" in m for m in msgs)
    assert any("can't be used" in m for m in msgs)


def test_word_slot_reads_vars():
    up = ContextPayload(context={"mood": "calm", "kept": "upstream"}, debug={}, internals={})
    cfg = {"rows": [
        {"id": "a", "kind": "slider", "var": "shot", "value": 0.2, "mode": "words",
         "words": WORDS, "text": "{word}, $mood light"},
        {"id": "c", "kind": "slider", "var": "plain", "value": 0.9, "mode": "words",
         "words": WORDS, "text": "{word}"},
    ]}
    payload, *_ = _run(cfg, upstream=up).values
    assert payload.context["shot"] == "close-up, calm light"
    assert payload.context["kept"] == "upstream"
    assert payload.context["plain"] == "wide shot"


def test_negatives_add_up_and_read_earlier_rows():
    cfg = {"rows": [
        {"id": "a", "kind": "slider", "var": "shot", "value": 0.9, "mode": "words",
         "words": WORDS, "negative": "blurry"},
        {"id": "b", "kind": "slider", "var": "tilt", "value": 0.9, "mode": "words",
         "words": WORDS, "negative": "{neg}, tilted"},
        # A template with no negative of its own carries what it reads.
        {"id": "c", "kind": "slider", "var": "phrase", "value": 0, "mode": "text",
         "text": "$shot, $tilt"},
        # `$name.neg` reads an earlier row's negatives.
        {"id": "d", "kind": "slider", "var": "copy", "value": 0, "mode": "text",
         "text": "x", "negative": "$shot.neg, extra"},
    ]}
    payload, *_ = _run(cfg).values
    negs = {k: [e["text"] for e in v] for k, v in payload.internals[negatives.NEG_KEY].items()}
    assert negs["shot"] == ["blurry, cropped"]
    assert negs["tilt"] == ["cropped, tilted"]
    assert negs["phrase"] == ["blurry, cropped", "cropped, tilted"]
    assert negs["copy"] == ["blurry, cropped, extra"]
