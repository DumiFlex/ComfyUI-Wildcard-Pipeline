"""engine/scenario.py — seeded scenario runs for the Test Runner."""
from __future__ import annotations

import random

import pytest

from engine.context import strip_engine_internals
from engine.pipeline import PipelineEngine
from engine.scenario import MAX_SEEDS, ScenarioError, resolve_seeds, run_scenario


def _wildcard(uuid: str, binding: str, options: list[dict], uid: str | None = None) -> dict:
    return {
        "id": uuid,
        "_uid": uid or uuid,
        "type": "wildcard",
        "enabled": True,
        "name": binding,
        "payload": {"var_binding": binding, "options": options},
        "instance": {},
    }


def _combine(uuid: str, template: str, out: str) -> dict:
    return {
        "id": uuid,
        "_uid": uuid,
        "type": "combine",
        "enabled": True,
        "name": out,
        "payload": {"template": template, "output_var": out},
        "instance": {},
    }


COLOR = _wildcard("c0000001", "color", [
    {"id": "o_red", "value": "red", "weight": 1},
    {"id": "o_blue", "value": "blue", "weight": 1},
    {"id": "o_green", "value": "green", "weight": 2},
])


# ── resolve_seeds ─────────────────────────────────────────────────────

def test_seed_range_is_consecutive():
    assert resolve_seeds({"from": 40, "count": 3}) == [40, 41, 42]


def test_seed_list_is_kept_in_order():
    assert resolve_seeds({"list": [9, 3, 9]}) == [9, 3, 9]


def test_random_seeds_are_distinct_and_js_safe():
    seeds = resolve_seeds({"random": True, "count": 50}, rng=random.Random(1))
    assert len(set(seeds)) == 50
    assert all(0 <= s <= 2**53 - 1 for s in seeds)


@pytest.mark.parametrize("spec", [
    None,
    {"count": 0},
    {"count": MAX_SEEDS + 1},
    {"from": "x", "count": 2},
    {"list": []},
    {"list": ["a"]},
    {"list": [-1]},
])
def test_bad_seed_specs_raise(spec):
    with pytest.raises(ScenarioError):
        resolve_seeds(spec)


# ── run_scenario ──────────────────────────────────────────────────────

def test_each_seed_matches_a_plain_pipeline_run():
    """The whole point: seed N here is seed N on the canvas."""
    modules = [COLOR, _combine("b0000001", "a $color car", "phrase")]
    out = run_scenario(modules, seeds=[5, 6, 7])
    for sample in out["samples"]:
        direct = strip_engine_internals(
            PipelineEngine().run([dict(m) for m in modules], seed=sample["seed"])
        )
        assert sample["vars"] == direct


def test_counts_cover_every_seed():
    out = run_scenario([COLOR], seeds=list(range(300)))
    counts = out["variables"]["color"]["counts"]
    assert sum(counts.values()) == 300
    assert set(counts) == {"red", "blue", "green"}
    # green carries half the weight
    assert counts["green"] > counts["red"]
    assert out["runs"] == 300 and out["failed"] == 0


def test_inline_choices_are_counted_by_expanded_value():
    """A single option `{a|b}` shows up as two values, not one bin."""
    wc = _wildcard("d0000001", "size", [{"id": "o1", "value": "{small|large}", "weight": 1}])
    out = run_scenario([wc], seeds=list(range(60)))
    assert set(out["variables"]["size"]["counts"]) == {"small", "large"}
    assert out["picks"]["d0000001"] == {"o1": 60}


def test_pick_counts_are_by_option_id():
    out = run_scenario([COLOR], seeds=list(range(100)))
    picks = out["picks"]["c0000001"]
    assert set(picks) == {"o_red", "o_blue", "o_green"}
    assert sum(picks.values()) == 100


def test_pins_act_like_upstream_values():
    out = run_scenario(
        [_combine("b0000001", "$subject in $place", "phrase")],
        seeds=[1, 2], pins={"subject": "a fox", "place": "snow"},
    )
    assert out["variables"]["phrase"]["counts"] == {"a fox in snow": 2}


def test_stack_module_overrides_a_pin_of_the_same_name():
    out = run_scenario([COLOR], seeds=[1], pins={"color": "pinned"})
    assert out["samples"][0]["vars"]["color"] != "pinned"


def test_sample_limit_caps_samples_not_counts():
    out = run_scenario([COLOR], seeds=list(range(50)), sample_limit=3)
    assert [s["seed"] for s in out["samples"]] == [0, 1, 2]
    assert sum(out["variables"]["color"]["counts"].values()) == 50


def test_value_limit_folds_the_tail_into_other():
    wc = _wildcard("e0000001", "n", [
        {"id": f"o{i}", "value": f"v{i}", "weight": 1} for i in range(20)
    ])
    out = run_scenario([wc], seeds=list(range(400)), value_limit=5)
    var = out["variables"]["n"]
    assert len(var["counts"]) == 5
    assert var["distinct"] == 20
    assert sum(var["counts"].values()) + var["other"] == 400


def test_trace_rows_carry_stack_names_and_writes():
    out = run_scenario([COLOR], seeds=[3])
    (row,) = out["samples"][0]["trace"]
    assert row["name"] == "color"
    assert row["_uid"] == "c0000001"
    assert row["writes"][0]["variable"] == "color"
    assert row["seed"] == 3


def test_warnings_are_grouped_with_their_seeds():
    """A constraint whose target never runs warns on every seed; the run
    reports it once with a count and the seeds it fired on."""
    constraint = {
        "id": "f0000001", "_uid": "f0000001", "type": "constraint", "enabled": True,
        "name": "orphan",
        "payload": {
            "source_wildcard_id": "c0000001",
            "target_wildcard_id": "99999999",
            "matrix": {}, "exceptions": [],
        },
        "instance": {},
    }
    out = run_scenario([COLOR, constraint], seeds=list(range(30)))
    groups = [g for g in out["warnings"] if g["type"] == "constraint_never_applied"]
    assert len(groups) == 1
    assert groups[0]["count"] == 30
    assert groups[0]["seeds"] == list(range(20))  # capped list, full count


def test_a_failing_seed_is_recorded_not_fatal(monkeypatch):
    real_run = PipelineEngine.run

    def flaky(self, modules, ctx=None, seed=0, **kw):
        if seed == 2:
            raise RuntimeError("boom")
        return real_run(self, modules, ctx=ctx, seed=seed, **kw)

    monkeypatch.setattr(PipelineEngine, "run", flaky)
    out = run_scenario([COLOR], seeds=[1, 2, 3])
    assert out["failed"] == 1
    assert sum(out["variables"]["color"]["counts"].values()) == 2
    bad = next(s for s in out["samples"] if s["seed"] == 2)
    assert bad["error"] == "RuntimeError: boom"


def test_stack_is_not_mutated_between_seeds():
    modules = [COLOR, _combine("b0000001", "$color", "x")]
    before = repr(modules)
    run_scenario(modules, seeds=list(range(10)))
    assert repr(modules) == before
