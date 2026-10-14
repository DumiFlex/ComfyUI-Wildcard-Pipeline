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

    async def fake_search(cfg, query):
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
