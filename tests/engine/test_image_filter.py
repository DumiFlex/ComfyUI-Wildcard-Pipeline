"""engine/image_filter.py — picks, the shapes each slot follows, answers."""

from __future__ import annotations

import threading

from engine import image_filter as f


class FakeBatch:
    """Tensor stand-in: ``shape`` + list indexing, like torch/numpy."""

    def __init__(self, tag: str, rows: list):
        self.tag = tag
        self.rows = list(rows)
        self.shape = (len(self.rows), 8)

    def __getitem__(self, idx):
        return FakeBatch(self.tag, [self.rows[i] for i in idx])

    def __eq__(self, other):
        return isinstance(other, FakeBatch) and (self.tag, self.rows) == (other.tag, other.rows)

    def __repr__(self):
        return f"FakeBatch({self.tag!r}, {self.rows!r})"


def batch(tag: str, n: int) -> FakeBatch:
    return FakeBatch(tag, list(range(n)))


# ------------------------------------------------------------------ config ---


def test_parse_config_defaults_and_recovery():
    assert f.parse_config("") == f.DEFAULT_CONFIG
    assert f.parse_config("not json") == f.DEFAULT_CONFIG
    assert f.parse_config("[1]") == f.DEFAULT_CONFIG
    cfg = f.parse_config(
        '{"mode": "reuse", "nothing_picked": "keep_all", "send_as": "per_image",'
        ' "timeout": 30, "on_timeout": "stop", "junk": 1}'
    )
    assert cfg == {
        "mode": "reuse", "nothing_picked": "keep_all", "send_as": "per_image",
        "timeout": 30, "on_timeout": "stop",
    }


def test_parse_config_bad_values_fall_back_per_key():
    cfg = f.parse_config({"mode": "nope", "timeout": True, "send_as": "per_image"})
    assert cfg["mode"] == "pause"
    assert cfg["timeout"] == f.DEFAULT_CONFIG["timeout"]
    assert cfg["send_as"] == "per_image"
    assert f.parse_config({"timeout": -5})["timeout"] == 0
    assert f.parse_config({"timeout": 10**9})["timeout"] == f.MAX_TIMEOUT


# ------------------------------------------------------------------- picks ---


def test_normalize_picks_drops_out_of_range_bad_and_duplicate():
    sizes = [2, 3]
    raw = [[1, 2], [0, 0], [0, 0], [0, 2], [2, 0], ["0", 1], [True, 0], [1], 5]
    assert f.normalize_picks(raw, sizes) == [(0, 0), (1, 2)]
    assert f.normalize_picks("x", sizes) == []


def test_plan_output_same_shape_and_per_image():
    picks = [(1, 1), (0, 0), (1, 0)]
    assert f.plan_output(picks) == [(0, [0]), (1, [0, 1])]
    assert f.plan_output(picks, "per_image") == [(0, [0]), (1, [0]), (1, [1])]
    assert f.plan_output([]) == []


def test_format_picks_is_one_based():
    assert f.format_picks([(1, 0), (0, 2)]) == "1:3, 2:1"


# --------------------------------------------------------------- following ---


def test_single_batch_slices_images_latent_and_mask():
    sizes = [4]
    plan = f.plan_output([(0, 1), (0, 3)])
    images = [batch("img", 4)]
    latent = [{"samples": batch("lat", 4), "batch_index": [10, 11, 12, 13]}]
    masks = [batch("mask", 4)]
    assert f.follow_slot(images, plan, sizes) == [FakeBatch("img", [1, 3])]
    (out_latent,) = f.follow_slot(latent, plan, sizes)
    assert out_latent["samples"] == FakeBatch("lat", [1, 3])
    assert out_latent["batch_index"] == [11, 13]
    assert f.follow_slot(masks, plan, sizes) == [FakeBatch("mask", [1, 3])]


def test_batch_one_conditioning_and_strings_pass_untouched():
    sizes = [4]
    plan = f.plan_output([(0, 2)])
    cond = [[batch("cond", 1), {"pooled_output": batch("pool", 1)}]]
    assert f.follow_slot([cond], plan, sizes) == [cond]
    assert f.follow_slot(["a red fox"], plan, sizes) == ["a red fox"]


def test_conditioning_batched_like_images_is_sliced():
    sizes = [3]
    plan = f.plan_output([(0, 0), (0, 2)])
    cond = [[batch("cond", 3), {"pooled_output": batch("pool", 3), "strength": 1.0}]]
    ((tensor, extras),) = f.follow_slot([cond], plan, sizes)[0]
    assert tensor == FakeBatch("cond", [0, 2])
    assert extras["pooled_output"] == FakeBatch("pool", [0, 2])
    assert extras["strength"] == 1.0


def test_loop_list_of_batches_drops_frames_without_picks():
    # 3 frames of 2 images; picked: f0 i0, f1 i0 + i1. Frame 2 drops out
    # of every slot, so the outputs stay lined up for the next sampler.
    sizes = [2, 2, 2]
    plan = f.plan_output([(0, 0), (1, 0), (1, 1)])
    images = [batch("a", 2), batch("b", 2), batch("c", 2)]
    positive = ["cond-a", "cond-b", "cond-c"]
    texts = ["red", "blonde", "black"]
    assert f.follow_slot(images, plan, sizes) == [FakeBatch("a", [0]), batch("b", 2)]
    assert f.follow_slot(positive, plan, sizes) == ["cond-a", "cond-b"]
    assert f.follow_slot(texts, plan, sizes) == ["red", "blonde"]


def test_per_image_repeats_the_frame_value_for_each_pick():
    sizes = [2, 2]
    plan = f.plan_output([(1, 0), (1, 1)], "per_image")
    assert f.follow_slot(["p0", "p1"], plan, sizes) == ["p1", "p1"]
    assert f.follow_slot([batch("x", 2), batch("y", 2)], plan, sizes) == [
        FakeBatch("y", [0]), FakeBatch("y", [1]),
    ]


def test_short_slot_repeats_its_last_item_and_unwired_is_none():
    sizes = [1, 1, 1]
    plan = f.plan_output([(0, 0), (2, 0)])
    assert f.follow_slot(["shared"], plan, sizes) == ["shared", "shared"]
    assert f.follow_slot(None, plan, sizes) == [None, None]


def test_value_with_a_different_batch_passes_through():
    # One mask for a whole 4-image batch is not per image: keep it as is.
    sizes = [4]
    plan = f.plan_output([(0, 1)])
    one_mask = batch("mask", 1)
    assert f.follow_slot([one_mask], plan, sizes) == [one_mask]


# ----------------------------------------------------------------- answers ---


def test_parse_answer_actions():
    sizes = [2, 1]
    assert f.parse_answer({"action": "stop"}, sizes) == f.Answer("stop")
    assert f.parse_answer({"action": "keep_all"}, sizes).picks == ((0, 0), (0, 1), (1, 0))
    assert f.parse_answer({"action": "picks", "picks": [[1, 0], [9, 9]]}, sizes).picks == ((1, 0),)
    assert f.parse_answer({"action": "?"}, sizes) is None
    assert f.parse_answer("x", sizes) is None


def test_resolve_timeout():
    sizes = [2]
    assert f.resolve_timeout("stop", sizes).action == "stop"
    assert f.resolve_timeout("keep_first", sizes).picks == ((0, 0),)
    assert f.resolve_timeout("keep_all", sizes).picks == ((0, 0), (0, 1))


def test_pending_answers_round_trip_across_threads():
    store = f.PendingAnswers()
    assert store.answer("t1", {"action": "stop"}) is False  # nothing waiting
    store.open("t1", {"token": "t1"})
    assert store.pending() == [{"token": "t1"}]
    worker = threading.Thread(target=store.answer, args=("t1", {"action": "keep_all"}))
    worker.start()
    worker.join()
    assert store.take("t1") == {"action": "keep_all"}
    assert store.take("t1") is None
    store.close("t1")
    assert store.pending() == []
    assert store.answer("t1", {"action": "stop"}) is False


def test_reusable_picks_must_still_fit():
    assert f.reusable_picks([(0, 1)], [2]) == [(0, 1)]
    assert f.reusable_picks([(0, 3)], [2]) is None
    assert f.reusable_picks(None, [2]) is None
