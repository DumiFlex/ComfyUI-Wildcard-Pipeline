"""engine/ai/pack.py — plan, build, check, install."""
from __future__ import annotations

import pytest

from engine.ai import pack
from engine.db.repositories import BundleRepository, ModuleRepository, TemplateRepository
from engine.importer import commit_import

PLAN = {
    "title": "Fantasy Characters", "summary": "Fantasy character portraits.",
    "rating": "safe",
    "questions": [{"question": "Outfits by race too?", "choices": ["Yes", "No, class only"]},
                  {"question": "Bad", "choices": ["only one"]}],
    "items": [
        {"kind": "template", "name": "Portrait", "var": "", "about": "uses $character",
         "count": 0, "tags": [], "source": "", "target": ""},
        {"kind": "constraint", "name": "Class → Weapon", "var": "", "about": "casters get staves",
         "count": 0, "tags": [], "source": "class", "target": "weapon"},
        {"kind": "wildcard", "name": "Weapon", "var": "weapon", "about": "weapons", "count": 3,
         "tags": ["Staff", "blade"], "source": "", "target": ""},
        {"kind": "wildcard", "name": "Class", "var": "$class", "about": "classes", "count": 99,
         "tags": ["caster", "martial"], "source": "", "target": ""},
        {"kind": "derivation", "name": "Title", "var": "title", "about": "mages are Archmage",
         "count": 0, "tags": [], "source": "", "target": ""},
        {"kind": "combine", "name": "Character", "var": "character", "about": "joins",
         "count": 0, "tags": [], "source": "", "target": ""},
        {"kind": "wildcard", "name": "Dup", "var": "class", "about": "x", "count": 5,
         "tags": [], "source": "", "target": ""},
        {"kind": "constraint", "name": "Bad", "var": "", "about": "x", "count": 0,
         "tags": [], "source": "race", "target": "weapon"},
        {"kind": "template", "name": "Second", "var": "", "about": "x", "count": 0,
         "tags": [], "source": "", "target": ""},
    ],
}

ANSWERS = {
    "Weapon": {"options": [
        {"text": "oak staff", "weight": 1, "tags": ["staff"], "negative": ""},
        {"text": "longsword", "weight": 1, "tags": ["blade"], "negative": ""},
        {"text": "dagger", "weight": 1, "tags": ["blade"], "negative": ""},
        {"text": "war axe", "weight": 1, "tags": [], "negative": ""},
    ]},
    "Class": {"options": [
        {"text": "mage", "weight": 1, "tags": ["caster"], "negative": ""},
        {"text": "warrior", "weight": 1, "tags": ["martial"], "negative": ""},
    ]},
    "Title": {"rules": [{"summary": "mage title", "branches": [{"match": "all",
        "conditions": [{"var": "class", "op": "equals", "value": "Mage"}],
        "actions": [{"target_var": "title", "mode": "replace", "value": "Archmage"}]}],
        "else_actions": [{"target_var": "title", "mode": "replace", "value": "Hero"}]}]},
    "Character": {"template": "$title, $class"},
    "Class → Weapon": {"rules": [
        {"source": "#caster", "target": "#blade", "effect": "exclude", "factor": 0, "reason": ""},
        {"source": "#martial", "target": "#staff", "effect": "exclude", "factor": 0, "reason": ""},
    ]},
    "Portrait": {"template": "portrait of $character holding $weapon, $missing",
                 "negative": "blurry"},
}


def _build():
    plan = pack.compile_plan(PLAN)
    built: dict = {}
    taken: set[str] = set()
    results = {}
    for key in pack.build_order(plan):
        item = next(i for i in plan["items"] if i["key"] == key)
        req = pack.item_request(plan, key, built)
        assert req["schema"] and req["user"]
        out = pack.compile_item(plan, key, built, ANSWERS[item["name"]], taken=taken)
        built[key] = {"id": out["id"], "payload": out["payload"]}
        results[item["name"]] = out
    return plan, built, results


def test_plan_checks_items():
    plan = pack.compile_plan(PLAN)
    kinds = [(i["kind"], i["name"]) for i in plan["items"]]
    assert kinds == [("template", "Portrait"), ("constraint", "Class → Weapon"),
                     ("wildcard", "Weapon"), ("wildcard", "Class"),
                     ("derivation", "Title"), ("combine", "Character")]
    assert [q["question"] for q in plan["questions"]] == ["Outfits by race too?"]
    weapon = plan["items"][2]
    assert weapon["count"] == pack.MIN_COUNT and weapon["tags"] == ["staff", "blade"]
    assert plan["items"][3]["var"] == "class" and plan["items"][3]["count"] == pack.MAX_COUNT
    assert len({i["key"] for i in plan["items"]}) == 6
    assert any("already set" in w for w in plan["warnings"])
    assert any("$race isn't a wildcard" in w for w in plan["warnings"])
    assert any("second template" in w for w in plan["warnings"])
    # Sent back by the manager: keys kept.
    again = pack.compile_plan(plan)
    assert [i["key"] for i in again["items"]] == [i["key"] for i in plan["items"]]
    with pytest.raises(pack.PlanError):
        pack.compile_plan({"items": [{"kind": "template", "name": "x"}]})


def test_orders():
    plan = pack.compile_plan(PLAN)
    name = {i["key"]: i["name"] for i in plan["items"]}
    assert [name[k] for k in pack.build_order(plan)] == [
        "Weapon", "Class", "Title", "Character", "Class → Weapon", "Portrait"]
    assert [name[k] for k in pack.chain_order(plan)] == [
        "Class", "Class → Weapon", "Weapon", "Title", "Character"]


def test_build_check_install(wp_db):
    plan, built, results = _build()
    w = results["Weapon"]
    assert len(w["payload"]["options"]) == pack.MIN_COUNT  # count caps the options
    assert w["payload"]["sub_categories"] == ["staff", "blade"]
    assert results["Title"]["payload"]["rules"][0]["branches"][0]["condition"]["value"] == "mage"
    c = results["Class → Weapon"]["payload"]
    assert c["source_wildcard_id"] == results["Class"]["id"]
    assert c["matrix"]["caster"]["blade"]["mode"] == "exclude"
    assert results["Character"]["payload"]["input_vars"] == ["title", "class"]
    assert "Reads $missing" in results["Portrait"]["warnings"][0]

    assert pack.parse_built(plan, built) == built
    tampered = {**built, "zz": built[next(iter(built))]}
    assert "zz" not in pack.parse_built(plan, tampered)

    report = pack.check_pack(plan, built, seeds=40)
    assert report["runs"] == 40 and report["failed"] == 0
    tkey = next(i["key"] for i in plan["items"] if i["kind"] == "template")
    assert any("$missing" in p for p in report["problems"][tkey])
    assert len(report["prompts"]) == pack.SAMPLE_PROMPTS
    for p in report["prompts"]:
        assert p["text"].startswith("portrait of ") and p["negative"] == "blurry"
        if "Archmage" in p["text"]:
            assert "longsword" not in p["text"] and "dagger" not in p["text"]
    assert {v["var"] for v in report["variables"]} >= {"class", "weapon", "title"}

    # A clash with an existing id is swapped, and the constraint follows.
    cls = results["Class"]["id"]
    ModuleRepository(wp_db).create(type="wildcard", name="Old", description="", category_id=None,
                                   tags=[], payload={"options": []}, id=cls)
    ops = pack.install_ops(plan, built, taken={cls}, template_ids=set(), bundle_ids=set())
    new_cls = ops["ids"][next(i["key"] for i in plan["items"] if i["name"] == "Class")]
    assert new_cls != cls
    result = commit_import(wp_db, {"adds": ops["adds"]})
    assert result["ok"], result
    con = ModuleRepository(wp_db).get(ops["ids"][next(
        i["key"] for i in plan["items"] if i["kind"] == "constraint")])
    assert con["payload"]["source_wildcard_id"] == new_cls and con["tags"] == ["fantasy-characters"]
    bundle = BundleRepository(wp_db).get(ops["bundle_id"])
    assert [ch["meta"]["name"] for ch in bundle["children"]] == [
        "Class", "Class → Weapon", "Weapon", "Title", "Character"]
    tpl = TemplateRepository(wp_db).get(ops["template_id"])
    assert tpl["template_string"].startswith("portrait of")


def test_bad_answers():
    plan = pack.compile_plan(PLAN)
    key = pack.build_order(plan)[0]
    with pytest.raises(ValueError):
        pack.compile_item(plan, key, {}, {"options": []})
    ckey = next(i["key"] for i in plan["items"] if i["kind"] == "constraint")
    with pytest.raises(pack.PlanError):
        pack.item_request(plan, ckey, {})
    tkey = next(i["key"] for i in plan["items"] if i["kind"] == "template")
    with pytest.raises(ValueError):
        pack.compile_item(plan, tkey, {}, {"template": "@{abcdef12}", "negative": ""})
    assert pack.collection_tag("  Élan & Co!! ") == "lan-co"


async def test_run_pack_and_eval_report():
    import importlib.util
    from pathlib import Path

    spec = importlib.util.spec_from_file_location(
        "ai_pack_evals", Path(__file__).resolve().parents[3] / "scripts" / "ai_pack_evals.py")
    evals = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(evals)
    assert len(evals.REQUESTS) >= 30

    by_name = {i["name"]: i for i in PLAN["items"]}

    async def complete(*, system, user, schema, schema_name, temperature):
        if schema_name == "pack_plan":
            return PLAN
        for name, answer in ANSWERS.items():
            item = by_name[name]
            if schema_name == "wildcard" and f"Wildcard: {name}" in user:
                return answer
            if schema_name == "derivation_rules" and item["kind"] == "derivation":
                return answer
            if schema_name == "constraint_rules" and item["kind"] == "constraint":
                return answer
            if schema_name == "combine" and item["kind"] == "combine":
                return answer
            if schema_name == "template" and item["kind"] == "template":
                return {"template": "portrait of $character holding $weapon", "negative": ""}
        raise RuntimeError("no answer")

    rows = await evals.evaluate(complete, ["fantasy"], seeds=20)
    [row] = rows
    assert row["plan"] and row["built"] == row["items"] == 6 and row["clean"], row
    text = evals.report(rows, "fake")
    assert "Packs with a clean test run: 1 / 1" in text and "portrait of" in text

    async def broken(**_kw):
        raise RuntimeError("down")

    [bad] = await evals.evaluate(broken, ["x"], seeds=5)
    assert bad["plan"] is False and "down" in bad["error"]


PLAN2 = {
    "title": "Winter Looks", "summary": "Winter outfits.", "rating": "safe", "questions": [],
    "inputs": [{"var": "subject", "about": "who it is", "example": "a red-haired knight"}],
    "items": [
        {"kind": "wildcard", "name": "Colors", "var": "", "about": "colours", "count": 6,
         "tags": ["warm", "cool"], "source": "", "target": "", "use": "pick 2"},
        {"kind": "wildcard", "name": "Scarf", "var": "scarf", "about": "scarves", "count": 4,
         "tags": [], "source": "", "target": "", "use": "pick 1-2; hold; nonsense"},
        {"kind": "fixed_values", "name": "Quality", "var": "quality", "about": "quality tags",
         "count": 0, "tags": [], "source": "", "target": "", "use": ""},
        {"kind": "template", "name": "Look", "var": "", "about": "the prompt", "count": 0,
         "tags": [], "source": "", "target": "", "use": ""},
    ],
}
ANSWERS2 = {
    "Colors": {"axes": [], "null_weight": 0, "options": [
        {"text": t, "weight": 1, "tags": [tag], "negative": "", "fallback": False}
        for t, tag in (("red", "warm"), ("amber", "warm"), ("blue", "cool"), ("teal", "cool"))]},
    "Scarf": {"axes": [], "null_weight": 0, "options": [
        {"text": "a @{Colors:warm} wool scarf", "weight": 1, "tags": [], "negative": "",
         "fallback": False},
        {"text": "a {knitted|woven} @{Colors} scarf", "weight": 1, "tags": [],
         "negative": "@{Colors:cool}", "fallback": True},
        {"text": "a @{Colours} scarf", "weight": 1, "tags": [], "negative": "", "fallback": False},
    ]},
    "Quality": {"values": [{"name": "quality", "value": "masterpiece, best quality",
                            "negative": "lowres"}, {"name": "bad name!", "value": "x",
                                                    "negative": ""}]},
    "Look": {"template": "$subject wearing $scarf, $quality", "negative": "$negatives, blurry"},
}


def test_vocabulary_refs_fixed_values_inputs_and_use(wp_db):
    plan = pack.compile_plan(PLAN2)
    assert plan["inputs"] == [{"var": "subject", "about": "who it is",
                               "example": "a red-haired knight"}]
    colors = plan["items"][0]
    assert colors["var"] == "" and colors["use"] == ""  # a vocabulary has no use line
    order = pack.build_order(plan)
    assert order[0] == colors["key"]
    built, results = {}, {}
    for key in order:
        item = next(i for i in plan["items"] if i["key"] == key)
        req = pack.item_request(plan, key, built)
        if item["name"] == "Scarf":
            assert "@{Colors} tags: warm, cool" in req["user"]
        out = pack.compile_item(plan, key, built, ANSWERS2[item["name"]])
        built[key] = {"id": out["id"], "payload": out["payload"]}
        results[item["name"]] = out
    cid = results["Colors"]["id"]
    scarf = results["Scarf"]
    assert [o["value"] for o in scarf["payload"]["options"]] == [
        f"a @{{{cid}#Colors:warm}} wool scarf", f"a {{knitted|woven}} @{{{cid}#Colors}} scarf"]
    assert any("Colours" in w for w in scarf["warnings"])
    assert any("nonsense" in w for w in scarf["warnings"])
    assert results["Quality"]["payload"]["values"][0]["negative"] == "lowres"
    assert pack.chain_order(plan)[0] == plan["items"][2]["key"]  # fixed values first
    assert colors["key"] not in pack.chain_order(plan)

    report = pack.check_pack(plan, built, seeds=30)
    assert report["problems"] == {} and report["notes"] == [], report
    p = report["prompts"][0]
    assert p["text"].startswith("a red-haired knight wearing a ") and "@{" not in p["text"]
    assert p["negative"].endswith(", blurry") and "lowres" in p["negative"]

    # A clashing vocabulary id moves, and the refs to it follow.
    ops = pack.install_ops(plan, built, taken={cid}, template_ids=set(), bundle_ids=set())
    new_cid = ops["ids"][colors["key"]]
    assert new_cid != cid
    result = commit_import(wp_db, {"adds": ops["adds"]})
    assert result["ok"], result
    sc = ModuleRepository(wp_db).get(ops["ids"][plan["items"][1]["key"]])
    assert all(cid not in o["value"] for o in sc["payload"]["options"])
    assert f"@{{{new_cid}#Colors:warm}}" in sc["payload"]["options"][0]["value"]
    bundle = BundleRepository(wp_db).get(ops["bundle_id"])
    assert [ch["meta"]["name"] for ch in bundle["children"]] == ["Quality", "Scarf"]
    assert bundle["children"][1]["instance"] == {"pick_min": 1, "pick_max": 2,
                                                 "seed_scope": "hold"}
    assert any("Injector" in n and "subject" in n for n in ops["notes"])


def test_template_with_a_pick_is_refused_and_braces_are_flagged():
    plan = pack.compile_plan(PLAN2)
    tkey = plan["items"][3]["key"]
    with pytest.raises(ValueError, match="Assembler doesn't pick"):
        pack.compile_item(plan, tkey, {}, {"template": "a {red|blue} $scarf", "negative": ""})


def test_eval_features_score_a_built_pack():
    import importlib.util
    from pathlib import Path

    spec = importlib.util.spec_from_file_location(
        "ai_pack_evals", Path(__file__).resolve().parents[3] / "scripts" / "ai_pack_evals.py")
    evals = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(evals)
    wants = {f for r in evals.REQUESTS if isinstance(r, tuple) for f in [r[1]]}
    assert wants == set(evals.FEATURES)
    result = {
        "plan": {"inputs": [{"var": "subject"}], "items": [
            {"key": "i1", "kind": "wildcard", "use": "pick 2-3; hold"},
            {"key": "i2", "kind": "fixed_values", "use": ""}]},
        "built": {
            "i1": {"payload": {"tag_group_kinds": {"SHOES": "accepts"}, "options": [
                {"value": "@{abcd1234#Colors:warm} scarf", "fallback": True},
                {"value": "", "is_null": True}]}},
            "i2": {"payload": {"values": [{"name": "q", "value": "x", "negative": "lowres"}]}},
        },
    }
    used = {f for f, check in evals.FEATURES.items() if check(result)}
    assert used == set(evals.FEATURES) - {"model"}
