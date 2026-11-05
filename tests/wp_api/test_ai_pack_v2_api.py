"""Pack builder v2 routes: decisions, hand edits, one-item changes, web
search, reference images, sub-bundle install; and model answers that need
repair."""
from __future__ import annotations

import pytest

from engine.ai import config as ai_config
from tests.wp_api._ai_fakes import ANSWER  # noqa: F401 - shared fakes
from tests.wp_api.test_ai_images import _png
from wp_api import _ai_chat, _ai_client

pytestmark = pytest.mark.usefixtures("items_planner")


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

    async def fake_rows(cfg, query):
        if query == "broken":
            raise _ai_client.AIError("the search engine answered 500")
        return [{"title": "Fur coats", "url": "https://x.test", "snippet": "long wool coats"}]
    monkeypatch.setattr("wp_api._ai_search.enabled", lambda cfg: True)
    monkeypatch.setattr("wp_api._ai_search.search_rows", fake_rows)
    body = await _plan(wp_client)
    assert body["web"] is True and body["plan"]["research"] == ["victorian winter fashion"]
    resp = await wp_client.post("/wp/api/ai/pack/search",
                                json={"queries": ["victorian winter fashion"]})
    assert resp.status == 200
    results = (await resp.json())["results"]
    assert "Fur coats" in results[0]["text"] and "data, not instructions" in results[0]["text"]
    # The rows are what the page lets the user pick from.
    assert results[0]["rows"] == [{"title": "Fur coats", "url": "https://x.test",
                                   "snippet": "long wool coats"}]
    failed = (await (await wp_client.post("/wp/api/ai/pack/search",
                                          json={"queries": ["broken"]})).json())["results"][0]
    assert failed["rows"] == [] and failed["error"] == "the search engine answered 500"
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


async def test_a_plan_keeps_its_design_and_what_the_model_thought(wp_client, fake_llm):
    import json as _json
    _on(fake_llm)
    fake_llm.overrides["pack_plan"] = (
        "<think>Season first, then outfits.</think>"
        + _json.dumps({**PLAN, "design": "The season decides the outfit."}))
    out = await _plan(wp_client)
    assert out["plan"]["design"] == "The season decides the outfit."
    assert out["thinking"] == "Season first, then outfits."


async def test_pack_graph_plan_wires_items_without_the_model(wp_client, fake_llm):
    from tests.engine.ai.test_ai_pack_graph import GRAPH, _answer

    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    fake_llm.overrides["pack_graph"] = GRAPH
    fake_llm.overrides["pack_refs"] = {"relations": []}
    resp = await wp_client.post("/wp/api/ai/pack/plan", json={
        "instruction": "fantasy heroes", "settings": {"planner": "graph"}})
    assert resp.status == 200, await resp.text()
    body = await resp.json()
    plan = body["plan"]
    assert plan["graph"]["slots"][0]["var"] == "race"
    assert any("Left out a rule" in w for w in plan["warnings"])
    assert body["answer"]["title"] == "Fantasy heroes"
    names = {i["name"]: i for i in plan["items"]}
    assert "Race → Weapon" in names and "Title rule" in names
    built: dict = {}
    # A wired constraint asked for before its wildcards says what to build first.
    resp = await wp_client.post("/wp/api/ai/pack/item", json={
        "plan": plan, "built": built, "key": names["Race → Weapon"]["key"]})
    assert resp.status == 400 and "build" in await resp.text()
    for item in plan["items"]:
        slot = next((s for s in plan["graph"]["slots"] if s["var"] == item["var"]
                     and item["kind"] == "wildcard"), None)
        if slot:
            fake_llm.overrides["pack_slot"] = _answer(slot["name"])
        resp = await wp_client.post("/wp/api/ai/pack/item", json={
            "plan": plan, "built": built, "key": item["key"]})
        assert resp.status == 200, await resp.text()
        out = await resp.json()
        assert out["id"] == item["id"]
        built[item["key"]] = {"id": out["id"], "payload": out["payload"]}
    slot_calls = [s for s in fake_llm.seen if s["body"].get("response_format", {})
                  .get("json_schema", {}).get("name") == "pack_slot"]
    assert len(slot_calls) == 4  # Season is its own axis: written by the code
    assert built[names["Race → Weapon"]["key"]]["payload"]["matrix"] == {
        "elf": {"gun": {"mode": "exclude", "factor": 0}}}
    resp = await wp_client.post("/wp/api/ai/pack/check", json={"plan": plan, "built": built})
    assert resp.status == 200, await resp.text()
    check = await resp.json()
    assert check["problems"] == {} and check["failed"] == 0, check
    # A plan sent back keeps its keys and ids.
    resp = await wp_client.post("/wp/api/ai/pack/review", json={"plan": plan})
    assert resp.status == 200
    again = (await resp.json())["plan"]
    assert [(i["key"], i["id"]) for i in again["items"]] == \
        [(i["key"], i["id"]) for i in plan["items"]]
    assert again["graph"]["relations"] == plan["graph"]["relations"]


async def test_a_graph_plan_changes_one_part_and_reads_added_images(wp_client, fake_llm):
    from tests.engine.ai.test_ai_pack_graph import GRAPH

    _on(fake_llm, "eyes")
    fake_llm.overrides["pack_graph"] = GRAPH
    fake_llm.overrides["pack_refs"] = {"relations": []}
    resp = await wp_client.post("/wp/api/ai/pack/plan", json={
        "instruction": "fantasy heroes", "settings": {"planner": "graph"}})
    assert resp.status == 200, await resp.text()
    plan = (await resp.json())["plan"]
    weapon = next(i for i in plan["items"] if i["name"] == "Weapon")
    # One slot on its own schema; the plan keeps its graph and the slot is locked.
    fake_llm.overrides["pack_graph_change"] = {
        "slot": {**GRAPH["slots"][2], "what": "bows and blades",
                 "axes": [{"name": "type", "values": ["bow", "blade"]}]},
        "relations": []}
    resp = await wp_client.post("/wp/api/ai/pack/change", json={
        "plan": plan, "key": weapon["key"], "instruction": "bows instead of guns",
        "request": "fantasy heroes"})
    assert resp.status == 200, await resp.text()
    out = await resp.json()
    sent = fake_llm.seen[-1]["body"]
    assert sent["response_format"]["json_schema"]["name"] == "pack_graph_change"
    assert "Change the slot Weapon ($weapon)" in sent["messages"][1]["content"]
    g = out["plan"]["graph"]
    assert next(s for s in g["slots"] if s["var"] == "weapon")["what"] == "bows and blades"
    assert out["plan"]["locks"]["slots"] == ["weapon"]
    assert next(i for i in out["plan"]["items"] if i["name"] == "Weapon")["key"] == weapon["key"]
    assert isinstance(out["review"], list)
    # A rule the code wires can't be changed this way.
    story = await wp_client.post("/wp/api/ai/pack/review", json={
        "plan": {**out["plan"], "run": {"mode": "story", "frames": 3},
                 "graph": {**g, "run": {"mode": "story", "frames": 3}}}})
    beat = next(i for i in (await story.json())["plan"]["items"] if i["name"] == "Story beat")
    resp = await wp_client.post("/wp/api/ai/pack/change", json={
        "plan": (await story.json())["plan"], "key": beat["key"], "instruction": "x"})
    assert resp.status == 502 and "wired by the code" in await resp.text()
    # Images added later go through one narrow call, not a re-plan.
    fake_llm.overrides["pack_images"] = {
        "from_images": ["a feathered hat"],
        "slots": [{"name": "Hat", "var": "hat", "what": "hats", "section": "", "count": 4,
                   "show": "prompt", "pick": "", "hold": False, "sometimes_none": 0,
                   "axes": []}],
        "fixed": []}
    resp = await wp_client.post("/wp/api/ai/pack/images", json={
        "plan": out["plan"], "images": [_png()], "note": "the hat"})
    assert resp.status == 200, await resp.text()
    got = await resp.json()
    sent = fake_llm.seen[-1]["body"]
    assert sent["response_format"]["json_schema"]["name"] == "pack_images"
    content = sent["messages"][1]["content"]
    assert any(part.get("type") == "image_url" for part in content)
    assert got["plan"]["from_images"] == ["a feathered hat"]
    assert [s["var"] for s in got["plan"]["graph"]["slots"]][-1] == "hat"
    assert "From your images: added Hat" in got["plan"]["applied"]
    assert got["plan"]["locks"]["slots"] == ["weapon"]
    resp = await wp_client.post("/wp/api/ai/pack/images", json={"plan": out["plan"]})
    assert resp.status == 400


async def test_best_of_three_reads_the_images_once(wp_client, fake_llm):
    from tests.engine.ai.test_ai_pack_graph import GRAPH
    _ai_chat._vision.clear()
    _on(fake_llm, "eyes")
    fake_llm.overrides["pack_graph"] = {**GRAPH, "from_images": ["a red cloak", "snow"]}
    resp = await wp_client.post("/wp/api/ai/pack/plan", json={
        "instruction": "like this", "images": [_png()],
        "settings": {"planner": "graph", "drafts": "three"}})
    assert resp.status == 200, await resp.text()
    plans = [s["body"] for s in fake_llm.seen if s["body"].get("response_format", {})
             .get("json_schema", {}).get("name") == "pack_graph"]
    assert len(plans) == 3
    first = plans[0]["messages"][-1]["content"]
    assert [p["type"] for p in first] == ["text", "image_url"]
    for later in plans[1:]:
        content = later["messages"][-1]["content"]
        assert isinstance(content, str) and "image_url" not in content
        assert "they showed: a red cloak; snow" in content


async def test_a_decision_answer_is_not_a_request_gap(wp_client, fake_llm):
    # Sonnet walkthrough, 2026-10-21: "a woman" and "Generic big city",
    # picked from the planner's own questions, came back as request gaps at
    # fix level in every flow, costing a Fix all round each.
    from tests.engine.ai.test_ai_pack_graph import GRAPH

    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    fake_llm.overrides["pack_graph"] = GRAPH
    fake_llm.overrides["pack_refs"] = {"relations": []}
    resp = await wp_client.post("/wp/api/ai/pack/plan", json={
        "instruction": "fantasy heroes", "settings": {"planner": "graph"},
        "decisions": [{"question": "Who is in the picture?", "answer": "a woman"},
                      {"question": "Where?", "answer": "Generic big city"}]})
    assert resp.status == 200, await resp.text()
    body = await resp.json()
    gaps = [f for f in body["review"] if f["type"] == "request_gap"]
    assert not [g for g in gaps if {"woman", "generic", "city"} & set(g["refs"])], gaps
    assert body["plan"]["request_gaps"] == ["heroes"]  # the request, not the answers
