"""engine/ai/pack.py — the planning smarts: library reuse, run order by reads,
consumer briefs, style, the plan review, variety checks and repair notes;
engine/ai/patterns.py — the library's conventions."""
from __future__ import annotations

import pytest

from engine.ai import pack, patterns
from engine.db.repositories import BundleRepository, ModuleRepository
from engine.importer import commit_import

HAIR = {"id": "aaaa0001", "type": "wildcard", "name": "Hair", "description": "",
        "payload": {"var_binding": "hair", "sub_categories": ["long", "short"], "options": [
            {"id": f"h{n}", "value": v, "weight": 1, "sub_categories": [t]}
            for n, (v, t) in enumerate([("long hair, red hair", "long"),
                                        ("short hair, black hair", "short"),
                                        ("ponytail, blonde hair", "long"),
                                        ("bob cut, brown hair", "short"),
                                        ("twintails, pink hair", "long"),
                                        ("pixie cut, white hair", "short")])]}}


def _item(**kw):
    base = {"kind": "wildcard", "name": "", "var": "", "about": "", "count": 6, "tags": [],
            "source": "", "target": "", "use": ""}
    return {**base, **kw}


def test_library_items_are_reused_not_rebuilt(wp_db):
    ModuleRepository(wp_db).create(type="wildcard", name="Hair", description="",
                                   category_id=None, tags=[], payload=HAIR["payload"],
                                   id=HAIR["id"])
    library = [ModuleRepository(wp_db).get(HAIR["id"])]
    raw = {"title": "Girls", "summary": "", "style": "tags", "anchor": "hair", "items": [
        _item(kind="library", name="hair"),
        _item(kind="library", name="Nope"),
        _item(name="Eyes", var="eyes", about="eye colours"),
        _item(kind="template", name="T", about="$hair, $eyes"),
    ]}
    plan = pack.compile_plan(raw, library=library)
    lib = plan["items"][0]
    assert (lib["kind"], lib["name"], lib["var"], lib["library_id"]) == (
        "library", "Hair", "hair", HAIR["id"])
    assert lib["tags"] == ["long", "short"]
    # Not in the library: made new (a wildcard $nope) instead of left out.
    assert any("Made Nope new" in w for w in plan["warnings"])
    by_name = {i["name"]: i for i in plan["items"]}
    assert by_name["Nope"]["kind"] == "wildcard" and by_name["Nope"]["var"] == "nope"
    with pytest.raises(pack.PlanError):
        pack.item_request(plan, lib["key"], {})
    out = pack.library_item(plan, lib["key"], library)
    assert out["id"] == HAIR["id"] and out["kind"] == "library"
    built = {lib["key"]: {"id": out["id"], "payload": out["payload"]}}
    eyes = by_name["Eyes"]
    answer = {"options": [{"text": t, "weight": 1, "tags": [], "negative": ""}
                          for t in ("blue eyes", "green eyes", "red eyes", "grey eyes")]}
    e = pack.compile_item(plan, eyes["key"], built, answer, library=library)
    built[eyes["key"]] = {"id": e["id"], "payload": e["payload"]}
    t = by_name["T"]
    tpl = pack.compile_item(plan, t["key"], built, {"template": "$hair, $eyes", "negative": ""},
                            library=library)
    built[t["key"]] = {"id": tpl["id"], "payload": tpl["payload"]}
    assert pack.parse_built(plan, built).keys() == built.keys()
    report = pack.check_pack(plan, built, seeds=30, library=library)
    assert report["failed"] == 0 and "hair" in report["prompts"][0]["text"]
    ops = pack.install_ops(plan, built, taken={HAIR["id"]}, template_ids=set(),
                           bundle_ids=set())
    # The library wildcard isn't added again and keeps its id in the bundle.
    assert [a["entity"]["name"] for a in ops["adds"] if a["kind"] == "wildcard"] == ["Eyes"]
    assert commit_import(wp_db, {"adds": ops["adds"]})["ok"]
    kids = BundleRepository(wp_db).get(ops["bundle_id"])["children"]
    assert kids[0]["id"] == HAIR["id"] and kids[0]["type"] == "wildcard"


def test_rules_run_after_what_they_read():
    plan = pack.compile_plan({"title": "x", "items": [
        _item(name="Race", var="race"),
        _item(kind="derivation", name="Title", var="title", about="if $look has elf, set $title"),
        _item(kind="combine", name="Look", var="look", about="$race and $hair"),
        _item(name="Hair", var="hair"),
        _item(kind="combine", name="Full", var="full", about="$title $look"),
    ]})
    name = {i["key"]: i["name"] for i in plan["items"]}
    assert [name[k] for k in pack.chain_order(plan)][-3:] == ["Look", "Title", "Full"]
    # Built payloads decide over the plan's words.
    keys = {i["name"]: i["key"] for i in plan["items"]}
    built = {keys["Title"]: {"id": "x", "payload": {"rules": [{"branches": [{
        "condition": {"var": "race", "op": "equals", "value": "elf"},
        "action": {"target_var": "title", "mode": "replace", "value": "Lord"}}]}]}}}
    assert [name[k] for k in pack.chain_order(plan, built)][-3:] == ["Title", "Look", "Full"]


def test_wildcards_hear_what_reads_them_and_the_style():
    plan = pack.compile_plan({"title": "Seasons", "summary": "s", "style": "sentences",
                              "model": "flux", "anchor": "season", "items": [
        _item(name="Season", var="season", tags=["winter"]),
        _item(name="Outfit", var="outfit", tags=["warm"]),
        _item(kind="constraint", name="S2O", source="season", target="outfit",
              about="#winter gets only #warm"),
        _item(kind="derivation", name="Scarf", var="extra",
              about="when $season is winter, set $extra to scarf"),
    ]})
    req = pack.item_request(plan, plan["items"][0]["key"], {})
    assert "it is the pack's anchor" in req["user"]
    assert "Used by: constraint S2O uses it as its source" in req["user"]
    assert "derivation Scarf: when $season is winter" in req["user"]
    assert "short natural phrase" in req["user"] and "flux" in req["user"]
    assert plan["style"] == "sentences" and plan["anchor"] == "season"
    bad = pack.compile_plan({"title": "x", "anchor": "nothing", "items": [
        _item(name="A", var="a")]})
    # Kept: the review offers the fix instead of dropping it silently.
    assert bad["anchor"] == "nothing" and bad["style"] == "tags"
    fix = [f for f in pack.review_plan(bad) if "anchor" in f["text"]]
    assert fix and fix[0]["level"] == "fix"
    assert fix[0]["patch"] == {"op": "plan", "set": {"anchor": ""}, "label": "Clear it"}


def test_the_anchor_check_knows_runtime_canvas_and_stand_ins():
    def plan(anchor, **kw):
        return pack.compile_plan({"title": "x", "anchor": anchor, "items": [
            _item(name="Background Setting", var="scene"), _item(name="Pose", var="pose")]},
            **kw)
    for ok in ("model_variant", "iteration", "scene"):
        assert not [f for f in pack.review_plan(plan(ok)) if "anchor" in f["text"]], ok
    canvas = [{"name": "page", "source": "loop"}, {"name": "lora_trigger",
                                                  "source": "injector", "about": "x"},
              {"name": "bad", "source": "browser"}]
    p = plan("page", canvas=canvas)
    assert [c["name"] for c in p["canvas"]] == ["page", "lora_trigger"]
    assert not [f for f in pack.review_plan(p) if "anchor" in f["text"]]
    assert pack.pins(p) == {"lora_trigger": "lora trigger"}
    assert "$page: the WP Context Loop" in pack.review_prompt(p, [])
    # $setting isn't set, but the Background Setting wildcard means the same.
    [f] = [f for f in pack.review_plan(plan("setting")) if "anchor" in f["text"]]
    assert f["patch"] == {"op": "plan", "set": {"anchor": "scene"}, "label": "Use $scene"}
    # A plan sent back keeps its canvas unless the request brings new ones.
    again = pack.compile_plan(p)
    assert again["canvas"] == p["canvas"]
    assert pack.compile_plan(p, canvas=[])["canvas"] == []


def test_review_finds_what_would_break_or_clash():
    plan = pack.compile_plan({"title": "x", "anchor": "season", "items": [
        _item(name="Season", var="season", tags=["winter", "summer"]),
        _item(name="Outfit", var="outfit", tags=["warm", "light"]),
        _item(name="Place", var="place"),
        _item(name="Mood", var="mood"),
        _item(kind="constraint", name="S2O", source="season", target="outfit",
              about="#winter excludes #light and #rain"),
        _item(kind="constraint", name="O2S", source="outfit", target="season",
              about="#warm boosts #winter"),
        _item(kind="template", name="T", about="$season $outfit $weather"),
    ]})
    found = pack.review_plan(plan)
    texts = " | ".join(f["text"] for f in found)
    assert "$weather, which nothing in the pack sets" in texts
    assert "#rain, which neither" in texts
    assert "never empty" in texts
    # The rule back the other way is left out at the plan (it never applies).
    assert "closes a loop" not in texts
    assert any("make a loop" in w for w in plan["warnings"])
    assert "don't follow the anchor $season" in texts
    assert {f["level"] for f in found} == {"fix", "tip"}
    assert pack.review_note(found).startswith("Revise the plan")
    lone = pack.compile_plan({"title": "x", "items": [
        _item(name="A", var="a"), _item(name="B", var="b"), _item(name="C", var="c")]})
    texts = " | ".join(f["text"] for f in pack.review_plan(lone))
    assert "Nothing links the picks" in texts and "no template" in texts
    model = pack.compile_review({"findings": [{"item": "a", "text": "Split it"}, {"x": 1}]}, lone)
    assert model == [{"id": "m1", "key": lone["items"][0]["key"], "level": "tip",
                      "text": "Split it", "by": "model"}]
    assert "A · $a" in pack.review_prompt(lone, [])


def test_variety_and_repair_notes():
    plan = pack.compile_plan({"title": "x", "items": [
        _item(name="Hat", var="hat", count=8), _item(kind="template", name="T", about="$hat")]})
    key = plan["items"][0]["key"]
    opts = [{"id": f"o{n}", "value": f"hat {n}", "weight": 1 if n else 60,
             "sub_categories": []} for n in range(8)]
    opts[7]["weight"] = 0.001
    built = {key: {"id": "abcd0001", "payload": {"var_binding": "hat", "options": opts}}}
    tkey = plan["items"][1]["key"]
    built[tkey] = {"id": "abcd0002", "payload": {"template_string": "$hat",
                                                  "negative_template": ""}}
    report = pack.check_pack(plan, built, seeds=60)
    texts = " | ".join(q["text"] for q in report["quality"])
    assert "never picked in 60 runs" in texts and "hat 7" in texts
    assert pack.repair_note(["$race has no option \"elf\"", "Kept 4 options"]) \
        == "$race has no option \"elf\""
    assert pack.repair_note(["fine"]) == ""


def test_plan_prompt_carries_a_sample_and_the_library():
    out = pack.plan_prompt("more like this", library_note="The user's library: x",
                           sample="1girl, red hair, beach, sunset")
    assert "1girl, red hair, beach, sunset" in out and "Split it into slots" in out
    assert out.endswith("The user's library: x")


def test_patterns_read_the_users_conventions():
    tpl = {"id": "t1", "name": "T", "template_string": "$hair",
           "negative_template": "lowres, watermark, $negatives"}
    bundle = {"id": "b1", "children": [{"payload": HAIR["payload"]}]}
    s = patterns.summarize([HAIR], [bundle], [tpl])
    assert s["style"] == "tags" and s["vars"] == ["hair"]
    assert s["negatives"] == ["lowres", "watermark"]
    assert s["reuse"][0]["name"] == "Hair" and "long" in s["tags"]
    note = patterns.note(s)
    assert "comma-separated tags" in note and "- Hair · $hair · 6" in note
    assert "Wildcards they have" not in patterns.note(s, reuse=False)
    assert patterns.note(patterns.summarize([])) == ""
    prose = [f"a woman with long flowing hair number {n}" for n in range(8)]
    assert patterns.option_style(prose) == "sentences"
