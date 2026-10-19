"""engine/ai/pack/graph_change.py — narrow model calls on a graph plan."""
from __future__ import annotations

import pytest

from engine.ai import pack
from engine.ai.pack import graph_change as gc
from tests.engine.ai.test_ai_pack_graph import GRAPH, _graph


def _plan():
    return pack.compile_graph_plan(_graph(), request="fantasy heroes")


def _key(plan, name):
    return next(i["key"] for i in plan["items"] if i["name"] == name)


def test_every_item_maps_to_its_part_of_the_graph():
    plan = pack.compile_graph_plan(_graph(run={"mode": "story", "frames": 3}))
    assert gc.change_target(plan, "") == ("add", "")
    assert gc.change_target(plan, _key(plan, "Weapon")) == ("slot", "weapon")
    assert gc.change_target(plan, _key(plan, "Quality")) == ("fixed", "quality")
    assert gc.change_target(plan, _key(plan, "Race → Weapon")) == ("relations", "Race|Weapon")
    assert gc.change_target(plan, _key(plan, "Title rule")) == ("relations", "$title")
    assert gc.change_target(plan, _key(plan, "Fantasy heroes")) == ("template", "")
    with pytest.raises(pack.PlanError, match="wired by the code"):
        gc.change_target(plan, _key(plan, "Story beat"))
    with pytest.raises(pack.PlanError, match="no such item"):
        gc.change_target(plan, "nope")
    # Each part gets its own schema, and the prompt names the part.
    assert set(gc.change_schema(plan, _key(plan, "Weapon"))["properties"]) == {"slot", "relations"}
    assert set(gc.change_schema(plan, _key(plan, "Quality"))["properties"]) == {"fixed"}
    assert set(gc.change_schema(plan, "")["properties"]) == {"slots", "fixed", "relations"}
    prompt = gc.change_prompt(plan, _key(plan, "Weapon"), "add bows")
    assert "Change the slot Weapon ($weapon)" in prompt and "The user asks: add bows" in prompt
    assert "- Weapon ($weapon): weapons · 5 options, prompt · type: gun, blade, staff" in prompt
    assert "Relations:" in prompt and "Race elf never gets Weapon gun (musket)" in prompt
    assert "the relations from Race to Weapon" in gc.change_prompt(
        plan, _key(plan, "Race → Weapon"), "allow guns")
    assert "the rule writing $title" in gc.change_prompt(plan, _key(plan, "Title rule"), "x")


def test_a_slot_change_lands_with_its_relations_and_is_locked():
    plan = _plan()
    key = _key(plan, "Weapon")
    answer = {"slot": {"name": "Arms", "var": "arms", "what": "weapons and shields", "section": "",
                       "count": 6, "show": "prompt", "pick": "", "hold": False,
                       "sometimes_none": 0,
                       "axes": [{"name": "type", "values": ["gun", "blade", "staff", "shield"]}]},
              "relations": [{"kind": "exclude", "from_slot": "Race", "from_axis": "kind",
                             "from_value": "dwarf", "to_slot": "Arms", "to_axis": "type",
                             "to_value": "shield", "factor": 0, "var": "", "text": "",
                             "otherwise": "", "words": []}]}
    new = gc.apply_change(plan, key, answer, request="fantasy heroes")
    g = new["graph"]
    arms = next(s for s in g["slots"] if s["var"] == "weapon")  # the variable stays
    assert arms["name"] == "Arms" and arms["what"] == "weapons and shields"
    assert arms["axes"][0]["values"] == ["gun", "blade", "staff", "shield"]
    # The relations that touched Weapon were replaced; the others stayed.
    words = [pack.graph._slot_rel_words(r) for r in g["relations"]]
    assert "Race dwarf never gets Arms shield" in words
    assert not any("gun" in w for w in words) and any("Archmage" in w for w in words)
    assert "weapon" in g["template"]["order"]
    assert "weapon" in new["locks"]["slots"]
    # Its item keeps its key, so the user's view doesn't jump.
    assert _key(new, "Arms") == key
    # A re-plan that drops Arms gets it back from the lock.
    again = pack.compile_graph_plan(
        _graph(slots=[dict(s) for s in GRAPH["slots"] if s["var"] != "weapon"],
               relations=[r for r in GRAPH["relations"] if r["to_slot"] != "Weapon"]),
        previous=new)
    assert next(s for s in again["graph"]["slots"] if s["var"] == "weapon")["name"] == "Arms"
    assert "Kept your Arms slot" in again["applied"]


def test_fixed_relations_template_and_additions_change_in_place():
    plan = _plan()
    new = gc.apply_change(plan, _key(plan, "Quality"), {"fixed": {
        "name": "Quality", "var": "q", "text": "score_9", "negative": "worst quality"}})
    assert new["graph"]["fixed"][0] == {"name": "Quality", "var": "quality", "text": "score_9",
                                        "negative": "worst quality"}
    new = gc.apply_change(plan, _key(plan, "Race → Weapon"), {"relations": [
        {"kind": "only", "from_slot": "Race", "from_axis": "kind", "from_value": "elf",
         "to_slot": "Weapon", "to_axis": "type", "to_value": "blade", "factor": 0, "var": "",
         "text": "", "otherwise": "", "words": []}]})
    words = [pack.graph._slot_rel_words(r) for r in new["graph"]["relations"]]
    assert "Race elf only gets Weapon blade" in words and not any("gun" in w for w in words)
    new = gc.apply_change(plan, _key(plan, "Title rule"), {"relations": [
        {"kind": "derive", "from_slot": "Class", "from_axis": "role", "from_value": "martial",
         "to_slot": "", "to_axis": "", "to_value": "", "factor": 0, "var": "title",
         "text": "Champion", "otherwise": "Novice", "words": []}]})
    words = [pack.graph._slot_rel_words(r) for r in new["graph"]["relations"]]
    assert any("Champion" in w for w in words) and not any("Archmage" in w for w in words)
    new = gc.apply_change(plan, _key(plan, "Fantasy heroes"), {"template": {
        "lead": "1boy", "order": ["Race", "Weapon"], "tail": "cinematic", "negative": ""}})
    assert new["graph"]["template"]["lead"] == "1boy"
    # The code keeps every prompt slot in the order, after the ones named.
    assert new["graph"]["template"]["order"][:2] == ["race", "weapon"]
    assert new["graph"]["template"]["tail"] == "cinematic"
    # Additions: a slot the graph has already is skipped, a new one joins
    # the template order and is locked.
    new = gc.apply_change(plan, "", {
        "slots": [{"name": "Race", "var": "race2", "what": "x", "section": "", "count": 4,
                   "show": "prompt", "pick": "", "hold": False, "sometimes_none": 0, "axes": []},
                  {"name": "Mount", "var": "mount", "what": "what they ride", "section": "",
                   "count": 4, "show": "prompt", "pick": "", "hold": False, "sometimes_none": 0,
                   "axes": [{"name": "kind", "values": ["horse", "beast"]}]}],
        "fixed": [], "relations": []})
    assert [s["var"] for s in new["graph"]["slots"]][-1] == "mount"
    assert sum(s["name"] == "Race" for s in new["graph"]["slots"]) == 1
    assert new["graph"]["template"]["order"][-1] == "mount"
    assert new["locks"]["slots"] == ["mount"]
    for bad in ({}, {"slot": 1}, "x"):
        with pytest.raises(pack.PlanError):
            gc.apply_change(plan, _key(plan, "Weapon"), bad)
    with pytest.raises(pack.PlanError, match="added nothing"):
        gc.apply_change(plan, "", {"slots": [], "fixed": [], "relations": []})


def test_images_add_what_the_graph_lacks():
    plan = _plan()
    prompt = gc.images_prompt(plan, "the hat matters")
    assert "The user added the attached reference images" in prompt
    assert "The user says: the hat matters" in prompt
    new = gc.apply_images(plan, {
        "from_images": ["a wide-brimmed hat", "warm palette"],
        "slots": [{"name": "Hat", "var": "hat", "what": "hats", "section": "", "count": 4,
                   "show": "prompt", "pick": "", "hold": False, "sometimes_none": 0, "axes": []},
                  {"name": "Weapon", "var": "weapon", "what": "x", "section": "", "count": 4,
                   "show": "prompt", "pick": "", "hold": False, "sometimes_none": 0, "axes": []}],
        "fixed": [{"name": "Palette", "var": "palette", "text": "warm palette", "negative": ""}],
    })
    assert new["from_images"] == ["a wide-brimmed hat", "warm palette"]
    assert [s["var"] for s in new["graph"]["slots"]][-1] == "hat"
    assert sum(s["var"] == "weapon" for s in new["graph"]["slots"]) == 1
    assert new["graph"]["fixed"][-1]["var"] == "palette"
    assert new["applied"][-1] == "From your images: added Hat"
    assert new["locks"]["slots"] == []
    # Nothing new: the lines are kept, nothing else moves.
    again = gc.apply_images(new, {"from_images": ["warm palette"], "slots": [], "fixed": []})
    assert again["from_images"] == new["from_images"]
    assert len(again["graph"]["slots"]) == len(new["graph"]["slots"])
    assert "From your images" not in " ".join(again["applied"])
