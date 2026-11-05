"""A "fits" constraint written from a pick list (engine/ai/fits.py)."""
from __future__ import annotations

import pytest

from engine.ai import fits, pack
from tests.engine.ai.test_ai_pack_v2 import _built, _raw


def _side(values):
    return {"options": [{"id": f"o{n}", "value": v, "weight": 1} for n, v in enumerate(values)]}


CLASS = _side(["mage", "warrior", "rogue"])
WEAPON = _side(["staff", "greatsword", "dagger", "wand"])


def test_ticks_become_only_rules_and_everything_fitting_gets_none():
    exc, said = fits.compile_answer({"fits": [
        {"source": 1, "targets": [1, 4]}, {"source": "2", "targets": [2]},
        {"source": 3, "targets": [1, 2, 3, 4]}]}, source=CLASS, target=WEAPON)
    assert [(e["source"], e["target"], e["mode"]) for e in exc] == [
        ("mage", "staff", "only"), ("mage", "wand", "only"), ("warrior", "greatsword", "only")]
    assert exc[0]["source_id"] == "o0" and exc[0]["target_id"] == "o0"
    assert said == []


def test_too_few_answers_and_answers_out_of_range_are_refused():
    with pytest.raises(ValueError, match="1 of 3"):
        fits.compile_answer({"fits": [{"source": 1, "targets": [1]},
                                      {"source": 9, "targets": [1]}]},
                            source=CLASS, target=WEAPON)
    exc, said = fits.compile_answer({"fits": [
        {"source": 1, "targets": [1]}, {"source": 2, "targets": [2, 99]}]},
        source=CLASS, target=WEAPON)
    assert len(exc) == 2 and '"rogue"' in said[0]


def test_a_fits_rule_in_a_pack_asks_the_pick_list_and_builds_only_exceptions():
    raw = _raw()
    raw["items"][1]["about"] = "each race gets only the outfit options that fit it"
    plan = pack.compile_plan(raw)
    built = _built(plan)
    key = next(i["key"] for i in plan["items"] if i["kind"] == "constraint")
    req = pack.item_request(plan, key, built)
    assert req["schema_name"] == "constraint_fits" and "1. race 0" in req["user"]
    out = pack.compile_item(plan, key, built, {"fits": [
        {"source": n, "targets": [1]} for n in range(1, 5)]})
    assert out["payload"]["matrix"] == {}
    assert {e["target"] for e in out["payload"]["exceptions"]} == {"outfit 0"}
    assert out["preview"][0] == "race 0 → only outfit 0"
    # A rule naming tags keeps the usual way.
    plan["items"][1]["about"] = "#elf gets #robe"
    assert pack.item_request(plan, key, built)["schema_name"] == "constraint_rules"
