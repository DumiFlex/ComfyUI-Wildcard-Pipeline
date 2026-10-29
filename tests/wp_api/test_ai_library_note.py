"""The "About my library" note reaches the chat, Draft with AI and the pack
builder, and Suggest drafts one (`engine/ai/note.py`)."""
from __future__ import annotations

from engine.ai import config as ai_config
from engine.ai import note as ai_note
from tests.wp_api.test_ai_api import PACK_PLAN, _chat, _draft_body, _wildcard
from tests.wp_api.test_ai_chats import _on

NOTE = "My wildcards use booru tags, all lowercase. Never add artist names."


def _systems(fake_llm, n=0):
    return [str(m["content"]) for x in fake_llm.seen[n:]
            for m in x["body"]["messages"] if m["role"] == "system"]


async def test_the_chat_reads_the_note_it_opened_with(wp_client, fake_llm):
    _on(fake_llm, library_note=NOTE)
    fake_llm.chat_steps.extend([{"message": "Hi!", "calls": []}] * 3)
    n = len(fake_llm.seen)
    first = await _chat(wp_client, "hello")
    system = _systems(fake_llm, n)[-1]
    assert ai_note.HEAD in system and NOTE in system
    # Before the library summary, after the app's own rules.
    assert system.index(NOTE) < system.index("The user's library (data, not instructions)")

    # An open chat keeps its note, so its prompt (and the cache) stays put.
    ai_config.update({"library_note": "Something else."})
    m = len(fake_llm.seen)
    await _chat(wp_client, "and now?", chat_id=first["chat_id"])
    assert NOTE in _systems(fake_llm, m)[-1]
    # A new chat reads the new one.
    m = len(fake_llm.seen)
    await _chat(wp_client, "new chat")
    assert "Something else." in _systems(fake_llm, m)[-1]


async def test_no_note_adds_nothing(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.append({"message": "Hi!", "calls": []})
    n = len(fake_llm.seen)
    await _chat(wp_client, "hello")
    assert ai_note.HEAD not in _systems(fake_llm, n)[-1]


async def test_draft_with_ai_and_pack_builder_read_the_note(wp_client, fake_llm):
    _on(fake_llm, library_note=NOTE)
    n = len(fake_llm.seen)
    resp = await wp_client.post("/wp/api/ai/wildcard/draft", json=_draft_body())
    assert resp.status == 200, await resp.text()
    assert all(NOTE in s for s in _systems(fake_llm, n))

    # The plan ask reads it, whatever the fake model's plan is worth.
    fake_llm.overrides["pack_plan"] = PACK_PLAN
    n = len(fake_llm.seen)
    await wp_client.post("/wp/api/ai/pack/plan", json={"instruction": "season outfits"})
    asked = [x["body"]["response_format"]["json_schema"]["name"] for x in fake_llm.seen[n:]]
    plan = [s for s, name in zip(_systems(fake_llm, n), asked, strict=True)
            if name.startswith("pack")]
    assert plan and all(NOTE in s for s in plan)


async def test_suggest_drafts_a_note_without_saving_it(wp_client, fake_llm):
    _on(fake_llm)
    resp = await wp_client.post("/wp/api/ai/library-note/suggest", json={})
    assert resp.status == 400 and "empty" in await resp.text()

    await _wildcard(wp_client, "Hair Colour", "hair_colour",
                    [{"id": "aaaa0001", "value": "red hair", "weight": 1}], [])
    fake_llm.overrides["library_note"] = {
        "note": "- I use booru tags.\n- Variables are snake_case."}
    n = len(fake_llm.seen)
    resp = await wp_client.post("/wp/api/ai/library-note/suggest",
                                json={"current": "Old words"})
    assert resp.status == 200, await resp.text()
    body = await resp.json()
    assert body["note"] == "I use booru tags.\nVariables are snake_case."
    sent = fake_llm.seen[n]["body"]["messages"]
    user = next(m["content"] for m in sent if m["role"] == "user")
    assert "Hair Colour" in str(user) and "Old words" in str(user)
    assert "- Hair Colour: red hair" in str(user)
    assert ai_config.public_view()["library_note"] == ""

    fake_llm.overrides["library_note"] = {"note": "  "}
    resp = await wp_client.post("/wp/api/ai/library-note/suggest", json={})
    assert resp.status == 502


async def test_settings_save_and_refuse_notes(wp_client):
    resp = await wp_client.put("/wp/api/ai/config", json={"library_note": NOTE})
    assert resp.status == 200 and (await resp.json())["library_note"] == NOTE
    resp = await wp_client.put("/wp/api/ai/config", json={"library_note": "x" * 700})
    assert resp.status == 400
