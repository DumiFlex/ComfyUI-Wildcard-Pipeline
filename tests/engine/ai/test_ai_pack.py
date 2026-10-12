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
            if schema_name in ("options",) and f"Wildcard: {name}" in user:
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
