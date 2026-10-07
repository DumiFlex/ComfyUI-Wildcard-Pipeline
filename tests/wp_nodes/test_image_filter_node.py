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

    async def fake_ask(images, contexts, sizes, config, node_id):
        asked["sizes"] = sizes
        return f.Answer("picks", ((0, 1),))

    monkeypatch.setattr(WPImageFilter, "_ask", staticmethod(fake_ask))
    out = await WPImageFilter.execute(
        images=[FakeBatch("a", [0, 1])], wp_image_filter=cfg(mode="reuse"),
    )
    assert asked["sizes"] == [2]
    assert out.values[0] == [FakeBatch("a", [1])]
    assert f.LAST_PICKS["12"] == [(0, 1)]


async def test_nothing_picked_keep_all(monkeypatch):
    async def fake_ask(*_a):
        return f.Answer("picks", ())

    monkeypatch.setattr(WPImageFilter, "_ask", staticmethod(fake_ask))
    out = await WPImageFilter.execute(
        images=[FakeBatch("a", [0, 1])], wp_image_filter=cfg(nothing_picked="keep_all"),
    )
    assert out.values[0] == [FakeBatch("a", [0, 1])]


async def test_stop_blocks_every_output(monkeypatch):
    class Blocker:
        def __init__(self, message):
            self.message = message

    fake = types.ModuleType("comfy_execution.graph_utils")
    fake.ExecutionBlocker = Blocker
    monkeypatch.setitem(sys.modules, "comfy_execution", types.ModuleType("comfy_execution"))
    monkeypatch.setitem(sys.modules, "comfy_execution.graph_utils", fake)

    async def fake_ask(*_a):
        return f.Answer("stop")

    monkeypatch.setattr(WPImageFilter, "_ask", staticmethod(fake_ask))
    out = await WPImageFilter.execute(images=[FakeBatch("a", [0])], wp_image_filter=cfg())
    assert len(out.values) == node_mod._OUTPUT_COUNT
    assert all(isinstance(v, Blocker) and v.message is None for v in out.values)


def test_frame_labels_read_loop_index_and_sweep_pins():
    ctx = types.SimpleNamespace(internals={
        "__wp_loop_index__": 3,
        "__wp_pin_overrides__": {"ab12cd34": "opt-red"},
    })
    assert node_mod._frame_labels([ctx], 2) == [
        {"loop_index": 3, "pins": {"ab12cd34": "opt-red"}},
        {"loop_index": 3, "pins": {"ab12cd34": "opt-red"}},
    ]
    assert node_mod._frame_labels(None, 1) == [{}]
