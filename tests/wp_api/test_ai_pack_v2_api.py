"""Pack builder v2 routes: decisions, hand edits, one-item changes, web
search, reference images, sub-bundle install; and model answers that need
repair."""
from __future__ import annotations

import pytest

from engine.ai import config as ai_config
from tests.wp_api._ai_fakes import ANSWER  # noqa: F401 - shared fakes
from tests.wp_api.test_ai_images import _png
from wp_api import _ai_chat, _ai_client


def _on(fake_llm, model="m1"):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": model})


def _item(**kw):
    base = {"kind": "wildcard", "name": "", "var": "", "section": "", "about": "",
            "count": 6, "tags": [], "source": "", "target": "", "use": ""}
    return {**base, **kw}


PLAN = {
    "title": "Seasons", "summary": "Seasonal outfits.", "rating": "safe", "style": "tags",
    "model": "", "anchor": "season", "assumptions": ["outdoor only"], "research": [],
    "inputs": [], "sections": [],
    "questions": [
        {"header": "Seasons", "question": "Which seasons should it cover?", "multi": True,
         "choices": ["winter", "summer", "spring", "autumn"]},
        {"header": "People", "question": "One person or groups?", "multi": False,
         "choices": ["one", "groups"]},
    ],
    "items": [
        _item(name="Season", var="season", tags=["cold", "warm"]),
        _item(name="Outfit", var="outfit", tags=["cold", "warm"]),
        _item(kind="constraint", name="Season → Outfit", source="season", target="outfit",
              about="#cold gets #cold"),
        _item(kind="template", name="Scene", about="$season, $outfit"),
    ],
}


async def _plan(wp_client, **body):
    resp = await wp_client.post("/wp/api/ai/pack/plan", json={"instruction": "seasons", **body})
    assert resp.status == 200, await resp.text()
    return await resp.json()


async def test_answered_questions_never_come_back_and_hand_edits_are_replayed(
        wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.overrides["pack_plan"] = PLAN
    first = await _plan(wp_client, settings={"negatives": "template", "count": 20})
    plan = first["plan"]
    assert [q["multi"] for q in plan["questions"]] == [True, False]
    assert plan["assumptions"] == ["outdoor only"] and plan["settings"]["count"] == 20
    sent = fake_llm.seen[-1]["body"]["messages"][1]["content"]
    assert "only the template's standing negative" in sent and "Web search is off" in sent
    # The user answers one question and renames an item by hand.
    edited = {**plan, "items": [dict(i, about="cold and warm seasons")
                                if i["name"] == "Season" else i for i in plan["items"]]}
    decisions = [{"question": "Which seasons should it cover?", "answer": "winter, summer"}]
    again = await _plan(wp_client, instruction="Answers given",
                        history=[{"instruction": "seasons", "answer": first["answer"]}],
                        decisions=decisions, previous=edited,
                        settings={"negatives": "template"})
    messages = fake_llm.seen[-1]["body"]["messages"]
    assert "cold and warm seasons" in messages[2]["content"]  # the replayed answer is the edit
    assert "winter, summer" in messages[3]["content"]
    assert "never ask them again" in messages[3]["content"]
    assert [q["header"] for q in again["plan"]["questions"]] == ["People"]
    assert again["plan"]["decisions"] == decisions
    assert [(i["key"], i["id"]) for i in again["plan"]["items"]] == [
        (i["key"], i["id"]) for i in plan["items"]]


async def test_change_one_item(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.overrides["pack_plan"] = PLAN
    plan = (await _plan(wp_client))["plan"]
    outfit = next(i for i in plan["items"] if i["name"] == "Outfit")
    fake_llm.overrides["pack_change"] = {"items": [
        _item(name="Outfit", var="outfit", tags=["cold", "warm", "formal"],
              about="formal wear too")]}
    resp = await wp_client.post("/wp/api/ai/pack/change", json={
        "plan": plan, "key": outfit["key"], "instruction": "add formal wear"})
    assert resp.status == 200, await resp.text()
    new = (await resp.json())["plan"]
    o2 = next(i for i in new["items"] if i["name"] == "Outfit")
    assert o2["id"] == outfit["id"] and "formal" in o2["tags"]
    assert "add formal wear" in fake_llm.seen[-1]["body"]["messages"][1]["content"]
    bad = await wp_client.post("/wp/api/ai/pack/change", json={
        "plan": plan, "key": "i99", "instruction": "x"})
    assert bad.status == 400


async def test_web_search_needs_the_setting(wp_client, fake_llm, monkeypatch):
    _on(fake_llm)
    fake_llm.overrides["pack_plan"] = {**PLAN, "research": ["victorian winter fashion"]}
    body = await _plan(wp_client)
    assert body["web"] is False and body["plan"]["research"] == []
    resp = await wp_client.post("/wp/api/ai/pack/search", json={"queries": ["x"]})
    assert resp.status == 400

    async def fake_search(cfg, query, urls=None):
        return f'Web results for "{query}": [1] Fur coats: https://x.test'
    monkeypatch.setattr("wp_api._ai_search.enabled", lambda cfg: True)
    monkeypatch.setattr("wp_api._ai_search.search", fake_search)
    body = await _plan(wp_client)
    assert body["web"] is True and body["plan"]["research"] == ["victorian winter fashion"]
    resp = await wp_client.post("/wp/api/ai/pack/search",
                                json={"queries": ["victorian winter fashion"]})
    assert resp.status == 200
    results = (await resp.json())["results"]
    assert "Fur coats" in results[0]["text"]
    again = await _plan(wp_client, instruction="use the results",
                        history=[{"instruction": "seasons", "answer": PLAN}],
                        web=results, searched=["victorian winter fashion"])
    assert "Fur coats" in fake_llm.seen[-1]["body"]["messages"][-1]["content"]
    assert again["plan"]["research"] == []
    too_many = await wp_client.post("/wp/api/ai/pack/search", json={"queries": ["a", "b", "c"]})
    assert too_many.status == 400


async def test_reference_images_go_to_a_model_that_can_see(wp_client, fake_llm):
    _ai_chat._vision.clear()
    _on(fake_llm, "blind")
    fake_llm.overrides["pack_plan"] = PLAN
    resp = await wp_client.post("/wp/api/ai/pack/plan", json={
        "instruction": "like this", "images": [_png()]})
    assert resp.status == 400 and "can't see images" in (await resp.json())["error"]
    _ai_chat._vision.clear()
    _on(fake_llm, "eyes")
    await _plan(wp_client, images=[_png(), _png()])
    content = fake_llm.seen[-1]["body"]["messages"][1]["content"]
    assert [p["type"] for p in content] == ["text", "image_url", "image_url"]
    assert "attached 2 reference images" in content[0]["text"]


async def test_sectioned_pack_installs_as_sub_bundles(wp_client, fake_llm):
    _on(fake_llm)
    raw = {**PLAN, "sections": [{"name": "When", "about": ""}, {"name": "Wear", "about": ""}],
           "items": [
               _item(name="Outfit", var="outfit", tags=["cold", "warm"], section="Wear"),
               _item(name="Shoes", var="shoes", section="Wear"),
               _item(kind="constraint", name="Season → Outfit", source="season",
                     target="outfit", about="#cold gets #cold"),
               _item(name="Season", var="season", tags=["cold", "warm"], section="When"),
               _item(name="Weather", var="weather", section="When"),
               _item(name="Time", var="time", section="When"),
               _item(kind="template", name="Scene", about="$season, $outfit, $shoes"),
           ]}
    fake_llm.overrides["pack_plan"] = raw
    plan = (await _plan(wp_client))["plan"]
    built: dict = {}
    for i in plan["items"]:
        if i["kind"] == "wildcard":
            tags = i["tags"] or ["x"]
            fake_llm.overrides["wildcard"] = {"options": [
                {"text": f"{i['var']} {n}", "weight": 1, "tags": [tags[n % len(tags)]],
                 "negative": ""} for n in range(4)]}
            resp = await wp_client.post("/wp/api/ai/pack/item", json={
                "plan": plan, "built": built, "key": i["key"]})
            assert resp.status == 200, await resp.text()
            out = await resp.json()
            assert out["id"] == i["id"]
            built[i["key"]] = {"id": out["id"], "payload": out["payload"]}
    resp = await wp_client.post("/wp/api/ai/pack/install", json={"plan": plan, "built": built})
    assert resp.status == 200, await resp.text()
    done = await resp.json()
    assert [b["name"] for b in done["sub_bundles"]] == ["Seasons · When", "Seasons · Wear"]
    outer = await (await wp_client.get(f"/wp/api/bundles/{done['bundle_id']}")).json()
    assert [c["type"] for c in outer["children"]] == ["bundle", "bundle"]


def test_json_repair_and_think_blocks():
    assert _ai_client._parse_text_json('<think>{"no": 1}</think>{"a": [1, 2,],}') == {"a": [1, 2]}
    assert _ai_client._parse_text_json('{"options": [{"t": "a"}, {"t": "b"') == {
        "options": [{"t": "a"}, {"t": "b"}]}
    assert _ai_client._parse_text_json('{"options": [{"t": "a"}, {"t": "b", "w') == {
        "options": [{"t": "a"}, {"t": "b"}]}
    with pytest.raises(_ai_client.AIError, match="cut off"):
        _ai_client._parse_text_json('{"options": [{"t": "a', cut_off=True)
    with pytest.raises(_ai_client.AIError, match="wasn't valid JSON"):
        _ai_client._parse_text_json("no json here")


async def test_cut_off_answers_say_so(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.overrides["pack_plan"] = '{"title": "x", "items": [{"kind": "wild'
    fake_llm.overrides["_finish"] = "length"
    resp = await wp_client.post("/wp/api/ai/pack/plan", json={"instruction": "x"})
    assert resp.status == 502
    assert "cut off" in (await resp.json())["error"]


async def test_extend_a_bundle_plans_into_it_and_installs_with_one_undo(wp_client, fake_llm):
    from tests.wp_api.test_ai_api import _two_wildcards

    _on(fake_llm)
    src, tgt = await _two_wildcards(wp_client)
    snaps = []
    for mid in (src, tgt):
        m = await (await wp_client.get(f"/wp/api/modules/{mid}")).json()
        snaps.append({"id": m["id"], "type": "wildcard", "name": m["name"],
                      "payload": m["payload"]})
    resp = await wp_client.post("/wp/api/bundles", json={"name": "Hero", "children": snaps})
    assert resp.status == 201
    bundle = await resp.json()
    fake_llm.overrides["pack_plan"] = {**PLAN, "anchor": "", "items": [
        _item(kind="library", name="Class", var="class"),       # already in it: ignored
        _item(name="Weapon", var="weapon"),                     # sets a variable it has
        _item(name="Armor", var="armor", tags=["heavy"], section="Gear"),
    ]}
    out = await _plan(wp_client, bundle_id=bundle["id"])
    plan = out["plan"]
    assert "EXTENDING the bundle \"Hero\"" in fake_llm.seen[-1]["body"]["messages"][1]["content"]
    assert [(i["key"], i.get("existing", False)) for i in plan["items"]] == [
        ("e1", True), ("e2", True), (plan["items"][2]["key"], False)]
    assert plan["items"][2]["name"] == "Armor"
    assert any("already set by the bundle's Weapon" in w for w in plan["warnings"])
    assert plan["base"]["name"] == "Hero"
    # The review knows the bundle's variables and doesn't ask for a template.
    resp = await wp_client.post("/wp/api/ai/pack/review", json={
        "plan": plan, "bundle_id": bundle["id"]})
    assert not any("no template" in f["text"] for f in (await resp.json())["findings"])

    built: dict = {}
    fake_llm.overrides["wildcard"] = {"options": [
        {"text": f"armor {n}", "weight": 1, "tags": ["heavy"], "negative": ""} for n in range(4)]}
    for i in plan["items"]:
        resp = await wp_client.post("/wp/api/ai/pack/item", json={
            "plan": plan, "built": built, "key": i["key"], "bundle_id": bundle["id"]})
        assert resp.status == 200, await resp.text()
        got = await resp.json()
        built[i["key"]] = {"id": got["id"], "payload": got["payload"]}
    resp = await wp_client.post("/wp/api/ai/pack/check", json={
        "plan": plan, "built": built, "bundle_id": bundle["id"]})
    report = await resp.json()
    assert {v["var"] for v in report["variables"]} >= {"class", "weapon", "armor"}

    resp = await wp_client.post("/wp/api/ai/pack/install", json={
        "plan": plan, "built": built, "bundle_id": bundle["id"]})
    assert resp.status == 200, await resp.text()
    done = await resp.json()
    assert done["bundle_id"] == bundle["id"]
    assert [b["name"] for b in done["sub_bundles"]] == ["Hero · Gear"]
    after = await (await wp_client.get(f"/wp/api/bundles/{bundle['id']}")).json()
    assert [c["type"] for c in after["children"]] == ["wildcard", "wildcard", "bundle"]
    assert after["children"][2]["children"][0]["meta"]["name"] == "Armor"
    resp = await wp_client.post("/wp/api/import/undo",
                                json={"undo_entry_id": done["undo_entry_id"]})
    assert resp.status == 200, await resp.text()
    back = await (await wp_client.get(f"/wp/api/bundles/{bundle['id']}")).json()
    assert [c["id"] for c in back["children"]] == [src, tgt]


async def test_extend_refuses_a_missing_bundle(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.overrides["pack_plan"] = PLAN
    resp = await wp_client.post("/wp/api/ai/pack/plan", json={
        "instruction": "x", "bundle_id": "deadbeef"})
    assert resp.status == 404


async def test_split_a_bundle_groups_neighbours_only(wp_client, fake_llm):
    _on(fake_llm)
    kids = [{"id": f"0000000{n}", "type": "wildcard", "meta": {"name": name},
             "payload": {"var_binding": name.lower(), "options": []}}
            for n, name in enumerate(["Hair", "Eyes", "Shirt", "Shoes", "Sky"])]
    kids.insert(4, {"id": "bbbbbbbb", "type": "bundle", "name": "Extras"})
    fake_llm.overrides["bundle_split"] = {
        "sections": [{"name": "Body", "about": "the person"}, {"name": "Wear", "about": ""}],
        "children": [{"index": 0, "section": "Body"}, {"index": 1, "section": "Body"},
                     {"index": 2, "section": "Wear"}, {"index": 3, "section": "Wear"},
                     {"index": 4, "section": "Wear"}, {"index": 5, "section": "Wear"}]}
    resp = await wp_client.post("/wp/api/ai/bundle/split", json={
        "name": "Look", "children": kids, "instruction": "by body part"})
    assert resp.status == 200, await resp.text()
    groups = (await resp.json())["groups"]
    assert groups == [{"name": "Body", "about": "the person", "start": 0, "end": 1},
                      {"name": "Wear", "about": "", "start": 2, "end": 3}]
    sent = fake_llm.seen[-1]["body"]["messages"][1]["content"]
    assert "4. bundle Extras (already a sub-bundle)" in sent and "by body part" in sent
    fake_llm.overrides["bundle_split"] = {"sections": [], "children": []}
    resp = await wp_client.post("/wp/api/ai/bundle/split", json={"name": "Look", "children": kids})
    assert resp.status == 502
    resp = await wp_client.post("/wp/api/ai/bundle/split", json={"name": "L", "children": kids[:2]})
    assert resp.status == 400


async def test_a_template_that_fails_twice_is_written_plain_and_the_check_tidies(
        wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.overrides["pack_plan"] = {**PLAN, "questions": []}
    plan = (await _plan(wp_client))["plan"]
    built: dict = {}
    for i in plan["items"]:
        if i["kind"] == "wildcard":
            fake_llm.overrides["wildcard"] = {"options": [
                {"text": f"{i['var']} {n}, sunny day", "weight": 1,
                 "tags": [["cold", "warm"][n % 2]], "negative": ""} for n in range(4)]}
            resp = await wp_client.post("/wp/api/ai/pack/item", json={
                "plan": plan, "built": built, "key": i["key"]})
            out = await resp.json()
            built[i["key"]] = {"id": out["id"], "payload": out["payload"]}
    tpl = next(i for i in plan["items"] if i["kind"] == "template")
    fake_llm.overrides["template"] = {"text": "no template key"}
    first = await wp_client.post("/wp/api/ai/pack/item", json={
        "plan": plan, "built": built, "key": tpl["key"]})
    assert first.status == 502
    why = (await first.json())["error"]
    resp = await wp_client.post("/wp/api/ai/pack/item", json={
        "plan": plan, "built": built, "key": tpl["key"],
        "note": f"your last answer failed: {why}"})
    assert resp.status == 200, await resp.text()
    out = await resp.json()
    assert out["payload"]["template_string"] == "$season, $outfit"
    assert "plain template" in out["warnings"][0]
    built[tpl["key"]] = {"id": out["id"], "payload": out["payload"]}
    resp = await wp_client.post("/wp/api/ai/pack/check", json={"plan": plan, "built": built})
    assert resp.status == 200, await resp.text()
    report = await resp.json()
    # Both picks said "sunny day": the later one (Outfit) no longer does.
    outfit = next(i for i in plan["items"] if i["name"] == "Outfit")
    assert list(report["tidied"]) == [outfit["key"]]
    assert all("sunny" not in o["value"]
               for o in report["tidied"][outfit["key"]]["payload"]["options"])
    assert all(p["text"].count("sunny day") == 1 for p in report["prompts"])


async def test_a_plan_with_no_wildcards_is_asked_for_once_more(wp_client, fake_llm):
    _on(fake_llm)
    empty = {**PLAN, "items": [PLAN["items"][-1]]}
    fake_llm.overrides["pack_plan"] = [empty, PLAN]
    out = await _plan(wp_client)
    assert [i["name"] for i in out["plan"]["items"]][:2] == ["Season", "Outfit"]
    retry = fake_llm.seen[-1]["body"]
    assert "Your last plan couldn't be used" in retry["messages"][-1]["content"]
    assert retry["temperature"] <= 0.2
    # Twice wrong: the error comes back.
    fake_llm.overrides["pack_plan"] = [empty]
    resp = await wp_client.post("/wp/api/ai/pack/plan", json={"instruction": "seasons"})
    assert resp.status == 502 and "no wildcards" in await resp.text()
