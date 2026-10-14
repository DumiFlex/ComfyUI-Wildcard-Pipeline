"""Reference images on the Draft with AI routes: sent with the newest
message, refused for a model that can't see them, checked like the chat's."""
from __future__ import annotations

from engine.ai import config as ai_config
from tests.wp_api._ai_fakes import ANSWER  # noqa: F401 - shared fakes
from tests.wp_api.test_ai_api import _draft_body, _two_wildcards
from tests.wp_api.test_ai_images import _png
from wp_api import _ai_chat


def _on(fake_llm, model):
    _ai_chat._vision.clear()
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": model})


async def _bodies(wp_client):
    src, tgt = await _two_wildcards(wp_client)
    return {
        "/wp/api/ai/wildcard/draft": _draft_body(),
        "/wp/api/ai/derivation/draft": {
            "instruction": "give mages a title", "derivation": {"name": "T", "rules": []}},
        "/wp/api/ai/constraint/draft": {
            "instruction": "mages never use swords",
            "constraint": {"source_wildcard_id": src, "target_wildcard_id": tgt}},
        "/wp/api/ai/text/draft": {
            "kind": "fixed_values", "instruction": "quality tags",
            "item": {"name": "Q", "payload": {"values": []}}},
    }


async def test_draft_routes_send_images_with_the_message(wp_client, fake_llm):
    bodies = await _bodies(wp_client)
    fake_llm.overrides["fixed_values"] = {"values": [{"name": "q", "value": "best"}]}
    _on(fake_llm, "eyes")
    for url, body in bodies.items():
        resp = await wp_client.post(url, json={**body, "images": [_png()]})
        assert resp.status == 200, (url, await resp.text())
        content = fake_llm.seen[-1]["body"]["messages"][-1]["content"]
        assert [p["type"] for p in content] == ["text", "image_url"], url
        assert "attached an image" in content[0]["text"], url


async def test_draft_without_images_stays_plain_text(wp_client, fake_llm):
    _on(fake_llm, "eyes")
    resp = await wp_client.post("/wp/api/ai/wildcard/draft", json=_draft_body())
    assert resp.status == 200
    assert isinstance(fake_llm.seen[-1]["body"]["messages"][-1]["content"], str)


async def test_draft_images_refused_for_a_blind_model_or_bad_data(wp_client, fake_llm):
    _on(fake_llm, "blind")
    resp = await wp_client.post("/wp/api/ai/wildcard/draft",
                                json={**_draft_body(), "images": [_png()]})
    assert resp.status == 400 and "can't see images" in (await resp.json())["error"]
    _on(fake_llm, "eyes")
    resp = await wp_client.post("/wp/api/ai/wildcard/draft",
                                json={**_draft_body(), "images": ["data:image/png;base64,AAAA"]})
    assert resp.status == 400
