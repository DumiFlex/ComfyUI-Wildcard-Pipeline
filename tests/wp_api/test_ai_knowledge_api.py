"""The AI routes know the user's canvas and vocabulary: canvas variables
count as set, the LoRA list reaches the planner, tag-style items are
checked against the tag list, and the chat offers `lookup` while it is on."""
from __future__ import annotations

import json

import pytest

from engine.ai import config as ai_config
from tests.wp_api._ai_fakes import ANSWER  # noqa: F401 - shared fakes
from wp_api import _ai_vocab
from wp_api import models as _models
from wp_api import tags as _tags
from wp_api._model_index import build_hits


def _on(fake_llm):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})


def _item(**kw):
    base = {"kind": "wildcard", "name": "", "var": "", "section": "", "about": "",
            "count": 6, "tags": [], "source": "", "target": "", "use": ""}
    return {**base, **kw}


@pytest.fixture
def vocab(tmp_path, monkeypatch):
    """A tag list and a LoRA folder, as autocomplete would see them."""
    csv = tmp_path / "tags.csv"
    csv.write_text("long_hair,0,900,\nred_hair,0,400,\nsmile,0,3000,\n1girl,0,5000,\n")
    monkeypatch.setattr(_tags, "tag_file_path", lambda: csv)
    _tags.reset_cache()
    monkeypatch.setitem(_models._cache, "loras", build_hits(
        ["styles/ink_wash.safetensors", "characters/aria_v2.safetensors"]))
    monkeypatch.setitem(_models._cache, "embeddings", [])
    yield
    _tags.reset_cache()


ON = {"tags": True, "loras": True, "embeddings": True}


def test_available_needs_the_switch_and_the_data(vocab):
    assert _ai_vocab.available(ON) == {"tags", "loras"}
    assert _ai_vocab.available({"tags": True}) == {"tags"}
    assert _ai_vocab.available(None) == set()
    assert _ai_vocab.lookup("tags", "long", 5)[0] == {
        "name": "long_hair", "matched": "long_hair", "count": 900, "category": "general"}
    assert [h["name"] for h in _ai_vocab.lookup("loras", "", 5)] == ["aria_v2", "ink_wash"]


async def test_plan_hears_canvas_and_loras_and_items_are_tag_checked(
        wp_client, fake_llm, vocab):
    _on(fake_llm)
    fake_llm.overrides["pack_plan"] = {
        "title": "Aria", "summary": "", "rating": "safe", "style": "tags", "model": "",
        "anchor": "page", "questions": [], "assumptions": [], "research": [], "inputs": [],
        "sections": [], "items": [
            _item(name="Hair", var="hair", about="long or red hair"),
            _item(kind="template", name="P", about="$hair, $lora_trigger")]}
    canvas = [{"name": "page", "source": "loop", "about": "frame number"},
              {"name": "lora_trigger", "source": "injector", "about": "from a wired socket"}]
    resp = await wp_client.post("/wp/api/ai/pack/plan", json={
        "instruction": "aria character pack", "vocab": ON, "canvas": canvas})
    assert resp.status == 200, await resp.text()
    out = await resp.json()
    sent = fake_llm.seen[-1]["body"]["messages"][1]["content"]
    assert "characters/aria_v2.safetensors" in sent
    assert "$lora_trigger: a WP Context Injector row" in sent
    plan = out["plan"]
    assert plan["anchor"] == "page" and [c["name"] for c in plan["canvas"]] == [
        "page", "lora_trigger"]
    # Nothing in the pack sets $page or $lora_trigger, and that's fine.
    assert not [f for f in out["review"] if f["level"] == "fix"]

    fake_llm.overrides["wildcard"] = {"options": [
        {"text": "long hair", "weight": 1, "tags": [], "negative": ""},
        {"text": "sparkly hair", "weight": 1, "tags": [], "negative": ""}]}
    hair = plan["items"][0]
    resp = await wp_client.post("/wp/api/ai/pack/item", json={
        "plan": plan, "built": {}, "key": hair["key"], "vocab": ON})
    assert resp.status == 200, await resp.text()
    got = await resp.json()
    assert "Not in your Danbooru tag list: sparkly_hair" in got["warnings"]
    assert got["repair"] == ""
    asked = fake_llm.seen[-1]["body"]["messages"][-1]["content"]
    assert "red_hair" in asked and "long_hair" in asked
    # Switched off in the browser: no list, no check.
    resp = await wp_client.post("/wp/api/ai/pack/item", json={
        "plan": plan, "built": {}, "key": hair["key"]})
    assert not [w for w in (await resp.json())["warnings"] if "Danbooru" in w]


async def test_chat_offers_lookup_and_hears_the_canvas(wp_client, fake_llm, vocab):
    _on(fake_llm)
    fake_llm.chat_steps.extend([
        {"message": "Checking.", "calls": [
            {"tool": "lookup", "args": json.dumps({"kind": "tags",
                                                   "query": "long hair, glowy hair"})}]},
        {"message": "long_hair is real; glowy_hair isn't.", "calls": []},
    ])
    resp = await wp_client.post("/wp/api/ai/chat", json={
        "message": "are these real tags?", "vocab": ON,
        "canvas": [{"name": "lora_trigger", "source": "injector"}]})
    assert resp.status == 200, await resp.text()
    body = await resp.json()
    assert [s["tool"] for s in body["steps"] if not s.get("say")] == ["lookup"]
    first, second = fake_llm.seen[-2:]
    system = first["body"]["messages"][0]["content"]
    assert "- lookup " in system and "WP Context Loop" in system
    assert "$lora_trigger: a WP Context Injector row" in first["body"]["messages"][-1]["content"]
    assert "glowy_hair: NOT in the tag list" in second["body"]["messages"][-1]["content"]
    # The next message with lookups off takes the tool away, once.
    fake_llm.chat_steps.append({"message": "ok", "calls": []})
    resp = await wp_client.post("/wp/api/ai/chat", json={
        # Not "thanks": a bare thank-you is answered without the model.
        "message": "what about blue_hair?", "chat_id": body["chat_id"], "vocab": {},
        "canvas": [{"name": "lora_trigger", "source": "injector"}]})
    last = fake_llm.seen[-1]["body"]["messages"]
    assert "- lookup " not in last[0]["content"] or "lookup is gone" in last[-1]["content"]
    assert "lookup is gone" in last[-1]["content"]
    assert "Injector" not in last[-1]["content"]  # unchanged canvas isn't told again
