"""Phase 8: the permission settings, the chat's delete tool following them,
and the create routes taking back an id (Undo on a delete card)."""
from __future__ import annotations

import json

from engine.ai import config as ai_config
from tests.wp_api.test_ai_api import _chat, _two_wildcards


def _on(fake_llm, **extra):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1",
                      # The one-ask step; split steps have their own tests.
                      "model_size": "large", **extra})


async def _json(resp, status=200):
    assert resp.status == status, await resp.text()
    return await resp.json()


def _last_prompt(fake_llm) -> tuple[str, str]:
    """(system prompt, last user message) of the last chat step sent."""
    msgs = fake_llm.seen[-1]["body"]["messages"]
    users = [m["content"] for m in msgs if m["role"] == "user"]
    last = users[-1] if isinstance(users[-1], str) else json.dumps(users[-1])
    return msgs[0]["content"], last


async def test_permissions_are_off_by_default_and_saved(wp_client):
    view = await _json(await wp_client.get("/wp/api/ai/config"))
    assert view["allow_delete"] is False and view["auto_apply"] is False
    view = await _json(await wp_client.put("/wp/api/ai/config",
                                           json={"allow_delete": True, "auto_apply": True}))
    assert view["allow_delete"] is True and view["auto_apply"] is True
    await _json(await wp_client.put("/wp/api/ai/config", json={"allow_delete": "yes"}), 400)


async def test_delete_tool_follows_the_setting_mid_chat(wp_client, fake_llm):
    _src, tgt = await _two_wildcards(wp_client)
    _on(fake_llm)
    fake_llm.chat_steps.append({"message": "Hi.", "calls": []})
    first = await _chat(wp_client, "hello")
    system, _ = _last_prompt(fake_llm)
    assert "- delete_items " not in system and "- edit_tags " in system

    # Called anyway (JSON models can): refused, nothing proposed.
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "delete_items",
                                   "args": json.dumps({"items": [tgt]})}]},
        {"message": "It is off.", "calls": []}])
    out = await _chat(wp_client, "delete Weapon", chat_id=first["chat_id"])
    assert out["proposals"] == []

    ai_config.update({"allow_delete": True, "auto_apply": True})
    # A card ends the answer when nothing else needs saying.
    fake_llm.chat_steps.append(
        {"message": "", "calls": [{"tool": "delete_items",
                                   "args": json.dumps({"items": [tgt]})}]})
    out = await _chat(wp_client, "delete Weapon now", chat_id=first["chat_id"])
    (card,) = out["proposals"]
    assert card["op"]["op"] == "delete" and card["op"]["items"][0]["id"] == tgt
    system, tail = _last_prompt(fake_llm)
    assert "- delete_items " in system
    assert "turned on deleting" in tail and "turned on auto-apply" in tail

    # Told once: the next message doesn't repeat it.
    fake_llm.chat_steps.append({"message": "Ok.", "calls": []})
    await _chat(wp_client, "and the next one", chat_id=first["chat_id"])
    _, tail = _last_prompt(fake_llm)
    assert "turned on" not in tail

    ai_config.update({"allow_delete": False})
    fake_llm.chat_steps.append({"message": "Ok.", "calls": []})
    await _chat(wp_client, "and now?", chat_id=first["chat_id"])
    system, _ = _last_prompt(fake_llm)
    said = json.dumps(fake_llm.seen[-1]["body"]["messages"][1:])
    assert "- delete_items " not in system and "turned off deleting" in said


async def test_a_new_chat_with_auto_apply_on_is_told_in_its_first_message(wp_client, fake_llm):
    _on(fake_llm, auto_apply=True, allow_delete=True)
    fake_llm.chat_steps.append({"message": "Hi.", "calls": []})
    await _chat(wp_client, "hello")
    system, tail = _last_prompt(fake_llm)
    assert "- delete_items " in system
    assert "turned on auto-apply" in tail and "turned on deleting" not in tail


async def test_undo_brings_items_back_at_their_ids(wp_client):
    # Bundle and template creates take an 8-hex id once, then refuse it.
    b = await _json(await wp_client.post("/wp/api/bundles", json={
        "name": "Kit", "id": "abcd0001", "children": []}), 201)
    assert b["id"] == "abcd0001"
    await _json(await wp_client.post("/wp/api/bundles", json={"name": "K2", "id": "abcd0001"}),
                409)
    await _json(await wp_client.post("/wp/api/bundles", json={"name": "K3", "id": "ZZ"}), 400)
    t = await _json(await wp_client.post("/wp/api/templates", json={
        "name": "Portrait", "id": "abcd0002", "template_string": "$a"}), 201)
    assert t["id"] == "abcd0002"
    await _json(await wp_client.post("/wp/api/templates", json={
        "name": "P2", "id": "abcd0002"}), 409)
    await _json(await wp_client.post("/wp/api/templates", json={"name": "P3", "id": 5}), 400)


async def test_a_module_back_at_its_id_clears_the_orphan_flags(wp_client):
    mod = {"type": "fixed_values", "name": "Light", "payload": {
        "values": [{"id": "v1", "name": "light", "value": "soft"}]}}
    m = await _json(await wp_client.post("/wp/api/modules", json=mod), 201)
    snap = {"id": m["id"], "type": "fixed_values", "name": "Light", "payload": m["payload"]}
    b = await _json(await wp_client.post("/wp/api/bundles", json={
        "name": "Kit", "children": [snap]}), 201)
    assert (await wp_client.delete(f"/wp/api/modules/{m['id']}")).status == 204
    got = await _json(await wp_client.get(f"/wp/api/bundles/{b['id']}"))
    assert got["children"][0]["meta"]["orphaned"] is True
    await _json(await wp_client.post("/wp/api/modules", json={**mod, "id": m["id"]}), 201)
    got = await _json(await wp_client.get(f"/wp/api/bundles/{b['id']}"))
    assert "orphaned" not in (got["children"][0].get("meta") or {})


async def test_a_delete_of_an_item_the_user_never_named_is_refused(wp_client, fake_llm):
    # Bench W23: "Delete the Hairstyle wildcard" (none) proposed deleting another item.
    src, _tgt = await _two_wildcards(wp_client)
    _on(fake_llm, allow_delete=True)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "delete_items",
                                   "args": json.dumps({"items": [src]})}]},
        {"message": "There is no Hairstyle wildcard. Did you mean Class?", "calls": []}])
    out = await _chat(wp_client, "Delete the Hairstyle wildcard.")
    assert out["proposals"] == []
    said = json.dumps(fake_llm.seen[-1]["body"]["messages"])
    assert "the user didn't name" in said
    # No "(No wildcard card came…)" note under a delete answer (bench W23, F6).
    assert "card came" not in out["message"]


async def test_deleting_off_says_where_to_turn_it_on(wp_client, fake_llm):
    # Bench W22: the reply never said deleting is off in Settings.
    await _two_wildcards(wp_client)
    _on(fake_llm)
    fake_llm.chat_steps.append({"message": "There's no Hairstyle; maybe Class?", "calls": []})
    out = await _chat(wp_client, "Delete the Hairstyle wildcard.")
    assert "Settings › AI assistant › Permissions" in out["message"]
    fake_llm.chat_steps.append({"message": "Done thinking.", "calls": []})
    out = await _chat(wp_client, "Remove the warm options from Weapon.")
    assert "Permissions" not in out["message"]
