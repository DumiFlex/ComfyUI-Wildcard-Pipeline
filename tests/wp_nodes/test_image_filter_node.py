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
    monkeypatch.setattr(f, "LAST_LABELS", {})
    hidden = types.SimpleNamespace(unique_id="12")
    monkeypatch.setattr(WPImageFilter, "hidden", hidden, raising=False)


def test_schema_is_list_in_list_out_and_counts_match():
    schema = WPImageFilter.define_schema()
    assert schema.node_id == "WP_ImageFilter"
    assert schema.category == "wildcard-pipeline"
    assert schema.is_input_list is True
    assert schema.not_idempotent is True
    assert len(schema.outputs) == node_mod._OUTPUT_COUNT
    # Every follower output is a list; `picks` is one summary string and
    # `labels` (added last, so old links keep their slots) one per item.
    assert [o.name for o in schema.outputs[-2:]] == ["picks", "labels"]
    assert all(o.is_output_list for o in schema.outputs[:-2])
    assert schema.outputs[-2].is_output_list is False
    assert schema.outputs[-1].is_output_list is True
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
    assert out.values[11] == ["#1 · 1\n#1 · 2", "#2 · 1\n#2 · 2"]
    assert f.LAST_PICKS == {}  # pass-all doesn't overwrite the remembered picks


async def test_labels_follow_the_picks_with_the_pickers_names(monkeypatch):
    async def fake_ask(*_a, **_k):
        return f.Answer("picks", ((0, 1), (1, 0)), {}, {(0, 1): "hero"})

    monkeypatch.setattr(WPImageFilter, "_ask", staticmethod(fake_ask))
    loop = [types.SimpleNamespace(internals={"__wp_loop_index__": i}) for i in (4, 5)]
    out = await WPImageFilter.execute(
        images=[FakeBatch("a", [0, 1]), FakeBatch("b", [0])],
        context=loop,
        wp_image_filter=cfg(send_as="per_image"),
    )
    # A frame of one image has no image number; the loop index names the frame.
    assert out.values[11] == ["hero", "#6"]
    assert f.LAST_LABELS["12"] == {(0, 1): "hero"}
    # Reuse keeps the names given at the last pause.
    again = await WPImageFilter.execute(
        images=[FakeBatch("a", [0, 1]), FakeBatch("b", [0])],
        context=loop,
        wp_image_filter=cfg(mode="reuse"),
    )
    assert again.values[11] == ["hero", "#6"]


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


def _fake_server(monkeypatch, reply=None, interrupt=False):
    """ComfyUI's PromptServer and interrupt check, and no preview files. The
    picker answers `reply` as soon as the request goes out."""
    sent = []

    class Server:
        def send_sync(self, event, data):
            sent.append((event, data))
            if event == node_mod.EVENT_REQUEST and reply is not None:
                f.PENDING.answer(data["token"], reply)

    srv = types.ModuleType("server")
    srv.PromptServer = types.SimpleNamespace(instance=Server())
    mm = types.ModuleType("comfy.model_management")

    def check():
        if interrupt:
            raise RuntimeError("interrupted")
    mm.throw_exception_if_processing_interrupted = check
    monkeypatch.setitem(sys.modules, "server", srv)
    monkeypatch.setitem(sys.modules, "comfy", types.ModuleType("comfy"))
    monkeypatch.setitem(sys.modules, "comfy.model_management", mm)
    monkeypatch.setattr(node_mod, "_save_previews", lambda images: [[{"filename": "x.png"}]])
    monkeypatch.setattr(node_mod, "POLL_SECONDS", 0.01)
    return sent


async def test_ask_waits_for_the_picker_and_closes_the_request(monkeypatch):
    sent = _fake_server(monkeypatch, reply={"action": "picks", "picks": [[0, 1]]})
    answer = await WPImageFilter._ask(
        [FakeBatch("a", [0, 1])], [{}], [2],
        {"timeout": 30, "send_as": "list", "on_timeout": "keep_all"}, "12")
    assert answer.action == "picks" and answer.picks == ((0, 1),)
    (ev, req), (done, info) = sent
    assert ev == node_mod.EVENT_REQUEST and req["frames"] == [[{"filename": "x.png"}]]
    assert done == node_mod.EVENT_DONE and info["token"] == req["token"]
    assert f.PENDING.pending() == []


async def test_ask_times_out_to_the_chosen_fallback(monkeypatch):
    sent = _fake_server(monkeypatch, reply={"action": "nonsense"})
    answer = await WPImageFilter._ask(
        [FakeBatch("a", [0, 1])], [{}], [2],
        {"timeout": 1, "send_as": "list", "on_timeout": "keep_first"}, "12")
    # The malformed answer was ignored; the timeout kept the first image.
    assert answer.action == "picks" and answer.picks == ((0, 0),)
    assert sent[-1][0] == node_mod.EVENT_DONE


async def test_cancelling_the_run_ends_the_wait(monkeypatch):
    sent = _fake_server(monkeypatch, interrupt=True)
    with pytest.raises(RuntimeError, match="interrupted"):
        await WPImageFilter._ask(
            [FakeBatch("a", [0])], [{}], [1],
            {"timeout": 0, "send_as": "list", "on_timeout": "keep_all"}, "12")
    assert sent[-1][0] == node_mod.EVENT_DONE and f.PENDING.pending() == []


def test_fingerprint_never_matches():
    fp = WPImageFilter.fingerprint_inputs()
    assert fp != fp
