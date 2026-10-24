"""request_needs: what a request asks the graph for, clause by clause
(cases from the 9B smoke run, 2026-10-24)."""
from __future__ import annotations

import copy

from engine.ai import pack
from engine.ai.pack.request_needs import request_needs
from tests.engine.ai.test_ai_pack_graph import DRAWN, GRAPH


def _graph(raw, request=""):
    return pack.compile_graph_plan(raw, library=[], request=request)["graph"]


def _types(raw, request):
    return [(n["type"], n["refs"]) for n in request_needs(_graph(raw, request), request)]


def _slot(name, var, show="prompt", axes=(), **kw):
    return {"name": name, "var": var, "what": name.lower(), "section": "", "count": 4,
            "show": show, "pick": "", "hold": False, "sweep": False, "sometimes_none": 0,
            "axes": [{"name": a, "values": v} for a, v in axes], **kw}


def _rel(kind, fs, fa, fv, ts, ta="", tv="", words=()):
    return {"kind": kind, "from_slot": fs, "from_axis": fa, "from_value": fv, "to_slot": ts,
            "to_axis": ta, "to_value": tv, "factor": 0, "var": "", "text": "",
            "otherwise": "", "words": list(words)}


def test_a_rule_the_request_names_between_two_slots_with_no_relation():
    raw = copy.deepcopy(DRAWN)
    raw["slots"][0]["axes"] = [{"name": "tone", "values": ["vibrant", "pastel", "earthy"]}]
    raw["slots"][2]["axes"] = [{"name": "season", "values": ["winter", "summer"]}]
    raw["relations"] = [raw["relations"][0]]  # the draw only
    req = "Shirts by season, the colour from one shared list; winter never gets pastel colours."
    assert ("rule_unlinked", ["Colors", "Season"]) in _types(raw, req)
    # With the rule: quiet.
    raw["relations"].append(_rel("exclude", "Season", "season", "winter", "Colors", "tone",
                                 "pastel"))
    assert not [t for t in _types(raw, req) if t[0] == "rule_unlinked"]


def test_the_fantasy_graph_satisfies_its_own_rules():
    req = ("A fantasy character pack: race, class, an outfit and a weapon that fit the class. "
           "Elves never use guns.")
    assert _types(GRAPH, req) == []


def test_the_code_lands_a_share_a_hold_and_a_hidden_subject():
    raw = copy.deepcopy(GRAPH)
    raw["slots"].append(_slot("Hat", "hat"))
    plan = pack.compile_graph_plan(raw, library=[], request="a hat about 30% of the time")
    hat = next(s for s in plan["graph"]["slots"] if s["name"] == "Hat")
    assert hat["sometimes_none"] == 70
    assert any("Hat comes out empty in 70%" in a for a in plan["applied"])
    assert _types(raw, "a hat about 30% of the time") == []
    # No number: left to the planner as a finding.
    assert ("sometimes_none", ["Hat"]) in _types(raw, "sometimes a hat")

    raw = copy.deepcopy(GRAPH)
    raw["run"] = {"mode": "story", "frames": 4}
    plan = pack.compile_graph_plan(raw, library=[], request="The same race in every frame.")
    assert next(s for s in plan["graph"]["slots"] if s["name"] == "Race")["hold"]

    raw = copy.deepcopy(GRAPH)
    raw["slots"][4]["show"] = "internal"
    raw["template"]["order"] = [v for v in raw["template"]["order"] if v != "Outfit"]
    plan = pack.compile_graph_plan(raw, library=[], request="Outfits by season: warm ones.")
    out = next(s for s in plan["graph"]["slots"] if s["name"] == "Outfit")
    assert out["show"] == "prompt" and "outfit" in plan["graph"]["template"]["order"]
    # A driver the code fills from its own axis stays internal.
    plan = pack.compile_graph_plan(GRAPH, library=[], request="Seasons: outfits for each.")
    assert next(s for s in plan["graph"]["slots"] if s["name"] == "Season")["show"] == \
        "internal"


def test_a_vague_fit_is_no_rule():
    raw = copy.deepcopy(GRAPH)
    raw["slots"] += [_slot("Background", "background"), _slot("Lighting", "lighting")]
    assert _types(raw, "Portraits with a background and lighting that suit a portrait.") == []


def test_review_files_a_missing_rule_as_a_fix():
    raw = copy.deepcopy(DRAWN)
    raw["slots"][0]["axes"] = [{"name": "tone", "values": ["vibrant", "pastel"]}]
    raw["slots"][2]["axes"] = [{"name": "season", "values": ["winter", "summer"]}]
    raw["relations"] = [raw["relations"][0]]
    req = "winter never gets pastel colours"
    plan = pack.compile_graph_plan(raw, library=[], request=req)
    found = [f for f in pack.review_plan(plan, [], request=req) if f["type"] == "rule_unlinked"]
    assert found and found[0]["level"] == "fix"


def test_a_rule_keyed_on_a_drawn_list_is_flagged():
    from engine.ai.pack.request_needs import list_reads

    raw = copy.deepcopy(DRAWN)
    raw["relations"].append({**_rel("derive", "Colors", "warmth", "warm", ""),
                             "var": "mood", "text": "vivid"})
    found = list_reads(_graph(raw))
    assert [f["refs"] for f in found] == [["Colors"]] and "Shirt" in found[0]["text"]
    assert list_reads(_graph(DRAWN)) == []


def test_a_rule_inside_the_list_and_its_drawer_does_not_answer_another_slots_rule():
    raw = copy.deepcopy(DRAWN)
    raw["slots"][0]["axes"] = [{"name": "tone", "values": ["vibrant", "pastel", "earthy"]}]
    raw["slots"][1]["axes"] = [{"name": "fabric", "values": ["wool", "linen"]}]
    raw["slots"][2]["axes"] = [{"name": "season", "values": ["winter", "summer"]}]
    raw["relations"] = [raw["relations"][0],
                        _rel("exclude", "Colors", "tone", "earthy", "Shirt", "fabric", "linen")]
    req = "Shirts by season, the colour from one shared list; winter never gets pastel colours."
    assert any(t == "rule_unlinked" and "Season" in refs for t, refs in _types(raw, req))


def test_a_draw_between_two_ruled_slots_is_no_constraint_cell():
    from engine.ai.pack import graph as pg
    from engine.modules.constraint_handler import ConstraintHandler
    raw = copy.deepcopy(DRAWN)
    raw["slots"][0]["axes"] = [{"name": "tone", "values": ["warm", "cool"]}]
    raw["slots"][1]["axes"] = [{"name": "fabric", "values": ["wool", "linen"]}]
    raw["relations"] = [_rel("draw", "Colors", "", "warm", "Shirt"),
                        _rel("exclude", "Colors", "tone", "warm", "Shirt", "fabric", "linen")]
    plan = pack.compile_graph_plan(raw, library=[], request="")
    built = {i["key"]: {"id": f"{n:08x}"} for n, i in enumerate(plan["items"], 1)
             if i["kind"] == "wildcard"}
    key = next(i["key"] for i in plan["items"] if i["kind"] == "constraint")
    payload = pg._wired(plan, key, built)["payload"]
    ConstraintHandler.validate_payload(payload)
    assert payload["matrix"] == {"warm": {"linen": {"mode": "exclude", "factor": 0}}}


def _shirts():
    raw = copy.deepcopy(DRAWN)
    raw["slots"] = [
        _slot("Season", "season", show="internal", axes=[("season", ["winter", "summer"])],
              self_axis="season"),
        _slot("Color List", "color_list", show="internal",
              axes=[("palette", ["warm", "cool", "neutral"])]),
        _slot("Shirt Type", "shirt_type", axes=[("season", ["winter", "summer"])]),
        _slot("Shirt Color", "shirt_color", axes=[("palette", ["warm", "cool", "neutral"])])]
    derive = _rel("derive", "Season", "season", "winter", "")
    derive.update(var="color_rule", text="exclude pastels", otherwise="include pastels")
    raw["relations"] = [_rel("agree", "Season", "season", "", "Shirt Type", "season"),
                        _rel("draw", "Color List", "palette", "warm", "Shirt Color"), derive]
    raw["template"]["order"] = ["shirt_type", "shirt_color", "color_rule"]
    return raw


def test_a_rule_on_one_side_of_the_cue_only_is_still_missing():
    req = ("Shirts by season, the colour drawn from one shared colour list; winter never gets "
           "pastel colours.")
    assert "rule_unlinked" in [t for t, _ in _types(_shirts(), req)]


def test_a_rule_written_as_prompt_text_is_left_out():
    plan = pack.compile_graph_plan(_shirts(), library=[], request="")
    assert not [r for r in plan["graph"]["relations"] if r.get("var") == "color_rule"]
    assert "color_rule" not in plan["graph"]["template"]["order"]


def test_a_doubled_dollar_in_the_lead_is_a_read():
    raw = copy.deepcopy(DRAWN)
    raw["template"]["lead"] = "$$shirt, 1girl, solo"
    t = pack.compile_graph_plan(raw, library=[], request="")["graph"]["template"]
    assert t["lead"].startswith("$shirt,") and "shirt" not in t["order"]


def test_an_unasked_multi_pick_between_rules_picks_one():
    raw = copy.deepcopy(DRAWN)
    raw["slots"][0]["pick"] = "2"
    req = "shirts, each in a colour from one colour list, colours fit the season"
    plan = pack.compile_graph_plan(raw, library=[], request=req)
    assert next(s for s in plan["graph"]["slots"] if s["name"] == "Colors")["pick"] == ""
    plan = pack.compile_graph_plan(raw, library=[], request="shirts in 2 colors that fit "
                                   "the season")
    assert next(s for s in plan["graph"]["slots"] if s["name"] == "Colors")["pick"] == "2"


def test_a_variable_name_printed_as_written_is_a_problem():
    from engine.ai.pack.check import _literal_names
    owned = [{"key": "i1", "var": "hero"}, {"key": "i2", "var": "scene"}]
    runs = [{"hero": "a knight, $style", "scene": "rain"}]
    prompts = [{"text": "comic, a knight, $style, rain"}]
    assert list(_literal_names(owned, runs, prompts, "t", set())) == ["i1"]
    # Printed by the template itself: filed there; an unset read is reported already.
    assert list(_literal_names(owned, [{"hero": "x"}], prompts, "t", set())) == ["t"]
    assert _literal_names(owned, [{"hero": "x"}], prompts, "t", {"style"}) == {}
