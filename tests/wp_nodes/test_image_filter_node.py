"""WP_ImageFilter — schema shape and the paths that don't need a live server."""
from __future__ import annotations

import json
import sys
import types

import pytest

from engine import image_filter as f
from wp_nodes import image_filter_node as node_mod
from wp_nodes.image_filter_node import WPImageFilter


class FakeBatch:
    def __init__(self, tag, rows):
        self.tag, self.rows = tag, list(rows)
        self.shape = (len(self.rows), 4)

    def __getitem__(self, idx):
        return FakeBatch(self.tag, [self.rows[i] for i in idx])

    def __eq__(self, other):
        return isinstance(other, FakeBatch) and (self.tag, self.rows) == (other.tag, other.rows)


def cfg(**kw):
    return [json.dumps(kw)]


@pytest.fixture(autouse=True)
def _clean_state(monkeypatch):
    monkeypatch.setattr(f, "LAST_PICKS", {})
    hidden = types.SimpleNamespace(unique_id="12")
    monkeypatch.setattr(WPImageFilter, "hidden", hidden, raising=False)


def test_schema_is_list_in_list_out_and_counts_match():
    schema = WPImageFilter.define_schema()
    assert schema.node_id == "WP_ImageFilter"
    assert schema.category == "wildcard-pipeline"
    assert schema.is_input_list is True
    assert schema.not_idempotent is True
    assert len(schema.outputs) == node_mod._OUTPUT_COUNT
    # Every follower output is a list; `picks` is one summary string.
    assert all(o.is_output_list for o in schema.outputs[:-1])
    assert schema.outputs[-1].is_output_list is False
    names = [i.name for i in schema.inputs]
    assert names[:10] == [
        "images", "latent", "masks", "positive", "negative",
        "positive_text", "negative_text", "context", "extra_1", "extra_2",
    ]


async def test_pass_all_keeps_everything_lined_up():
    images = [FakeBatch("a", [0, 1]), FakeBatch("b", [0, 1])]
    out = await WPImageFilter.execute(
        images=images,
        positive_text=["red", "blue"],
        wp_image_filter=cfg(mode="pass_all"),
    )
    assert out.values[0] == images
    assert out.values[5] == ["red", "blue"]
    assert out.values[10] == "1:1, 1:2, 2:1, 2:2"
    assert f.LAST_PICKS == {}  # pass-all doesn't overwrite the remembered picks


async def test_reuse_uses_stored_picks_and_per_image():
    f.LAST_PICKS["12"] = [(1, 0)]
    images = [FakeBatch("a", [0, 1]), FakeBatch("b", [0, 1])]
    out = await WPImageFilter.execute(
        images=images,
        positive=["cond-a", "cond-b"],
        wp_image_filter=cfg(mode="reuse"),
    )
    assert out.values[0] == [FakeBatch("b", [0])]
    assert out.values[3] == ["cond-b"]
    assert out.ui["wp_image_filter"][0]["mode"] == "reuse"


async def test_reuse_without_stored_picks_asks(monkeypatch):
    asked = {}

    async def fake_ask(images, labels, sizes, config, node_id, **_k):
        asked["sizes"] = sizes
        return f.Answer("picks", ((0, 1),))

    monkeypatch.setattr(WPImageFilter, "_ask", staticmethod(fake_ask))
    out = await WPImageFilter.execute(
        images=[FakeBatch("a", [0, 1])], wp_image_filter=cfg(mode="reuse"),
    )
    assert asked["sizes"] == [2]
    assert out.values[0] == [FakeBatch("a", [1])]
    assert f.LAST_PICKS["12"] == [(0, 1)]


def _fake_blocker(monkeypatch):
    class Blocker:
        def __init__(self, message):
            self.message = message

    fake = types.ModuleType("comfy_execution.graph_utils")
    fake.ExecutionBlocker = Blocker
    monkeypatch.setitem(sys.modules, "comfy_execution", types.ModuleType("comfy_execution"))
    monkeypatch.setitem(sys.modules, "comfy_execution.graph_utils", fake)
    return Blocker


async def test_empty_picks_stop_the_branch(monkeypatch):
    blocker = _fake_blocker(monkeypatch)

    async def fake_ask(*_a, **_k):
        return f.Answer("picks", ())

    monkeypatch.setattr(WPImageFilter, "_ask", staticmethod(fake_ask))
    # An old workflow's `nothing_picked: keep_all` is ignored now.
    out = await WPImageFilter.execute(
        images=[FakeBatch("a", [0, 1])], wp_image_filter=cfg(nothing_picked="keep_all"),
    )
    assert all(isinstance(v, blocker) for v in out.values)


class FakeClip:
    def tokenize(self, text):
        return ["tok", text]

    def encode_from_tokens_scheduled(self, tokens):
        return [["cond", {"text": tokens[1]}]]


async def test_prompt_edits_replace_text_and_reencode_with_clip(monkeypatch):
    seen = {}

    async def fake_ask(images, labels, sizes, config, node_id, **k):
        seen["labels"], seen["has_clip"] = labels, k.get("has_clip")
        return f.Answer("picks", ((0, 0), (1, 1)), {(1, 1): {"positive": "blue, sharp"}})

    monkeypatch.setattr(WPImageFilter, "_ask", staticmethod(fake_ask))
    out = await WPImageFilter.execute(
        images=[FakeBatch("a", [0, 1]), FakeBatch("b", [0, 1])],
        positive=["cond-red", "cond-blue"],
        positive_text=["red", "blue"],
        negative_text=["ugly"],
        clip=[FakeClip()],
        wp_image_filter=cfg(),
    )
    assert seen["has_clip"] is True
    assert seen["labels"][1]["positive"] == "blue"
    assert seen["labels"][1]["negative"] == "ugly"
    assert out.values[5] == ["red", "blue, sharp"]
    assert out.values[3] == ["cond-red", [["cond", {"text": "blue, sharp"}]]]
    assert out.values[6] == ["ugly", "ugly"]
    assert out.ui["wp_image_filter"][0]["edited"] == 1


async def test_prompt_edits_without_clip_keep_the_conditioning(monkeypatch):
    async def fake_ask(*_a, **_k):
        return f.Answer("picks", ((0, 0),), {(0, 0): {"negative": "blurry"}})

    monkeypatch.setattr(WPImageFilter, "_ask", staticmethod(fake_ask))
    out = await WPImageFilter.execute(
        images=[FakeBatch("a", [0])], negative=["cond-n"], negative_text=["ugly"],
        wp_image_filter=cfg(),
    )
    assert out.values[6] == ["blurry"]
    assert out.values[4] == ["cond-n"]


async def test_stop_blocks_every_output(monkeypatch):
    Blocker = _fake_blocker(monkeypatch)

    async def fake_ask(*_a, **_k):
        return f.Answer("stop")

    monkeypatch.setattr(WPImageFilter, "_ask", staticmethod(fake_ask))
    out = await WPImageFilter.execute(images=[FakeBatch("a", [0])], wp_image_filter=cfg())
    assert len(out.values) == node_mod._OUTPUT_COUNT
    assert all(isinstance(v, Blocker) and v.message is None for v in out.values)


def test_frame_labels_read_loop_index_pins_seed_and_prompts():
    ctx = types.SimpleNamespace(internals={
        "__wp_loop_index__": 1,
        "__wp_pin_overrides__": {"ab12cd34": "opt-red"},
        "__wp_loop_seeds__": [11, 22, 33],
    })
    assert node_mod._frame_labels([ctx], ["red hair"], None, 2) == [
        {"loop_index": 1, "pins": {"ab12cd34": "opt-red"}, "seed": 22, "positive": "red hair"},
        {"loop_index": 1, "pins": {"ab12cd34": "opt-red"}, "seed": 22, "positive": "red hair"},
    ]
    over = types.SimpleNamespace(internals={"__wp_seed_override__": 7, "__wp_loop_seeds__": [1]})
    assert node_mod._frame_labels([over], None, None, 1) == [{"seed": 7}]
    assert node_mod._frame_labels(None, None, None, 1) == [{}]


def test_frame_labels_carry_the_frames_variables_as_text():
    ctx = types.SimpleNamespace(
        internals={},
        context={"hair": "red hair", "empty": " ", "__trace__": "x", "count": 3, "long": "y" * 500},
    )
    [label] = node_mod._frame_labels([ctx], None, None, 1)
    assert label["vars"]["hair"] == "red hair"
    assert "empty" not in label["vars"] and "__trace__" not in label["vars"]
    assert len(label["vars"]["long"]) == node_mod._MAX_VAR_TEXT
