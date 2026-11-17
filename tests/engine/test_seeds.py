"""engine/seeds.py: WP Seeds rows (named, per frame, locks, outputs)."""
import json
from pathlib import Path

from engine import seeds
from engine.seed_derive import MAX_SAFE_SEED

CORPUS = Path(__file__).resolve().parents[1] / "fixtures" / "seeds-corpus.json"


def _row(**kw):
    base = {"id": "00000001", "kind": "seed", "name": "Direction", "mode": "follow"}
    base.update(kw)
    return base


def test_parse_drops_bad_rows_and_labels():
    cfg = seeds.parse_config(json.dumps({"rows": [
        {"id": "l", "kind": "label", "name": "Contexts"},
        _row(),
        {"kind": "seed", "name": "   "},
        "junk",
        _row(id="2", name="Act", mode="nope", per_frame="weird", value="12",
             locks={"1": 5, "x": 3, "2": -1}, pin=True, out=0),
    ]}))
    assert [r.name for r in cfg.rows] == ["Direction", "Act"]
    act = cfg.rows[1]
    assert act.mode == "follow" and act.per_frame == "new"
    assert act.value == 12 and act.locks == {1: 5}
    assert act.pin is True and act.out is None


def test_parse_never_raises():
    for raw in (None, "", "{", "[]", 5, {"rows": "x"}):
        assert seeds.parse_config(raw).rows == []


def test_follow_rows_are_named_not_ordered():
    a = seeds.parse_config({"rows": [_row(name="Stage"), _row(id="2", name="Act")]})
    b = seeds.parse_config({"rows": [_row(id="9", name="New one"), _row(id="2", name="Act"),
                                     _row(name="Stage")]})
    ra, rb = seeds.resolve(a, 42, 0), seeds.resolve(b, 42, 0)
    assert ra["stage"] == rb["stage"] and ra["act"] == rb["act"]
    assert ra["stage"]["seed"] != ra["act"]["seed"]
    # The base seed moves them; a name match ignores case and spaces.
    assert seeds.resolve(a, 43, 0)["stage"] != ra["stage"]
    assert seeds.named_seed(42, "  stage ") == seeds.named_seed(42, "Stage")


def test_frames_new_same_and_locks():
    cfg = seeds.parse_config({"rows": [
        _row(mode="fixed", value=1000, locks={"2": 77}),
        _row(id="2", name="Same", mode="fixed", value=5, per_frame="same"),
    ]})
    row, same = cfg.rows
    assert seeds.row_seed(row, 0, 0) == 1000  # frame 0 is the base
    f1 = seeds.row_seed(row, 0, 1)
    assert f1 != 1000 and 0 <= f1 <= MAX_SAFE_SEED
    assert seeds.row_seed(row, 0, 2) == 77
    assert [seeds.row_seed(same, 0, i) for i in range(3)] == [5, 5, 5]
    assert seeds.resolve(cfg, 0, 2)["direction"] == {"seed": 77, "frame0": 1000}


def test_first_of_a_shared_name_wins():
    cfg = seeds.parse_config(
        {"rows": [_row(mode="fixed", value=1), _row(id="2", mode="fixed", value=2)]}
    )
    assert seeds.resolve(cfg, 0, 0)["direction"]["seed"] == 1


def test_output_slots():
    cfg = seeds.parse_config({"rows": [
        _row(mode="fixed", value=1, pin=True, out=3),
        _row(id="2", name="B", mode="fixed", value=2, pin=True),
        _row(id="3", name="C", mode="fixed", value=3, pin=True, out=3),
        _row(id="4", name="D", mode="fixed", value=4),
    ]})
    vals = seeds.output_values(cfg, 0, 0)
    assert len(vals) == seeds.MAX_OUTPUTS
    assert vals[:4] == [2, 3, 1, 0]


def test_corpus_matches():
    corpus = json.loads(CORPUS.read_text())
    for case in corpus["named"]:
        assert seeds.named_seed(case["base"], case["name"]) == case["seed"], case
    for case in corpus["frames"]:
        assert seeds.frame_seed(case["base"], case["index"]) == case["seed"], case


def test_node_base_reads_the_loop_only_when_asked():
    on = seeds.parse_config({"rows": [], "base_from_loop": True})
    off = seeds.parse_config({"rows": []})
    loop = {seeds.seed_derive.LOOP_SEED_KEY: {"seed": 9, "frame0": 9, "base": 77}}
    assert on.base_from_loop and not off.base_from_loop
    assert seeds.node_base(on, 42, loop) == 77
    assert seeds.node_base(off, 42, loop) == 42
    assert seeds.node_base(on, 42, {}) == 42
    # An older Loop payload without "base" falls back to the widget.
    old = {seeds.seed_derive.LOOP_SEED_KEY: {"seed": 9, "frame0": 9}}
    assert seeds.node_base(on, 42, old) == 42
