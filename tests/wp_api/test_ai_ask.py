"""The chat's `ask` tool: questions that pause the turn until the user
answers them, settled answers, and editing the last message."""
from __future__ import annotations

import json

from engine.ai import config as ai_config
from tests.wp_api.test_ai_api import _chat, _two_wildcards


def _on(fake_llm, **extra):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1", **extra})


async def _json(resp, status=200):
    assert resp.status == status, await resp.text()
    return await resp.json()


async def _resume(wp_client, chat_id, results, status=200):
    return await _json(await wp_client.post("/wp/api/ai/chat", json={
        "chat_id": chat_id, "results": results}), status)


QUESTIONS = {"questions": [
    {"header": "Style", "question": "Which art style should the pack use?",
     "choices": ["Anime", "Realistic: photo-like", "Painterly (oil and brush)"]},
    {"q": "Add negatives to options?", "options": ["Yes", "No"]},
    {"header": "Extras", "question": "Which extras?", "multi": True,
     "choices": [{"label": "Hats"}, {"label": "Glasses", "hint": "round or square"}, "Scarves"]},
]}


def _ask_step(args=None, message=""):
    return {"message": message, "calls": [
        {"tool": "ask", "args": json.dumps(args or QUESTIONS)}]}


def _last_user(fake_llm) -> str:
    return fake_llm.seen[-1]["body"]["messages"][-1]["content"]


async def test_ask_pauses_and_the_answers_carry_the_turn_on(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.extend([_ask_step(), {"message": "Building it.", "calls": []}])
    first = await _chat(wp_client, "make me a fantasy character pack")
    assert [c["tool"] for c in first["pending"]] == ["ask"]
    call = first["pending"][0]
    assert call["label"] == "Asked 3 questions"
    style, neg, extras = call["args"]["questions"]
    assert style == {"header": "Style", "question": "Which art style should the pack use?",
                     "multi": False, "choices": [
                         {"label": "Anime"}, {"label": "Realistic", "hint": "photo-like"},
                         {"label": "Painterly", "hint": "oil and brush"}]}
    # Aliases (q, options) are read, and a missing header comes from the question.
    assert neg["header"] == "Add negatives to" and neg["question"].startswith("Add")
    assert extras["multi"] is True and extras["choices"][1] == {
        "label": "Glasses", "hint": "round or square"}
    chat = await _json(await wp_client.get(f"/wp/api/ai/chats/{first['chat_id']}"))
    assert chat["waiting"] is True

    # Only numbers come back; labels are the server's own.
    done = await _resume(wp_client, first["chat_id"], [{"id": call["id"], "answers": [
        {"q": 0, "picked": [0]}, {"q": 1, "decide": True},
        {"q": 2, "picked": [0, 1, 9]}, {"q": 7, "picked": [0]}]}])
    assert done["message"] == "Building it." and done["pending"] == []
    back = _last_user(fake_llm)
    assert ("ask: The user answered: Style → Anime; Add negatives to → you decide "
            "(choose, and say what you chose); Extras → Hats, Glasses") in back

    # A reopened chat shows the answers under the questions.
    chat = await _json(await wp_client.get(f"/wp/api/ai/chats/{first['chat_id']}"))
    assert chat["waiting"] is False
    asked = chat["turns"][1]["view"]
    assert asked["pending"][0]["tool"] == "ask"
    assert asked["answered"] == {call["id"]: {"answers": [
        {"header": "Style", "answer": "Anime"},
        {"header": "Add negatives to", "answer": "you decide"},
        {"header": "Extras", "answer": "Hats, Glasses"}]}}

    # Settled: asking Style again is answered at once, without a pause.
    fake_llm.chat_steps.extend([
        _ask_step({"questions": [{"header": "style", "question": "Anime or realistic?",
                                  "choices": ["Anime", "Realistic"]}]}),
        {"message": "Anime it is.", "calls": []}])
    again = await _chat(wp_client, "now the outfits", chat_id=first["chat_id"])
    assert again["pending"] == [] and again["message"] == "Anime it is."
    assert "ask: already answered: Style → Anime" in _last_user(fake_llm)

    # Partly settled: the rest is asked, and the model hears what was settled.
    fake_llm.chat_steps.extend([
        _ask_step({"questions": [
            {"header": "Style", "question": "Style?", "choices": ["A", "B"]},
            {"header": "Palette", "question": "Which palette?", "choices": ["Warm", "Cool"]}]}),
        {"message": "ok", "calls": []}])
    part = await _chat(wp_client, "colours too", chat_id=first["chat_id"])
    pcall = part["pending"][0]
    assert [q["header"] for q in pcall["args"]["questions"]] == ["Palette"]
    await _resume(wp_client, part["chat_id"], [{"id": pcall["id"], "answers": [
        {"q": 0, "other": "pastel only"}]}])
    assert ('Palette → "pastel only" (their own words). Already answered before: '
            "Style → Anime") in _last_user(fake_llm)


async def test_bad_asks_are_refused_with_a_reason(wp_client, fake_llm):
    _src, tgt = await _two_wildcards(wp_client)
    _on(fake_llm)
    one_choice = {"questions": [{"header": "X", "question": "Which?", "choices": ["Only"]}]}
    generic = {"questions": [{"header": "More", "question": "Anything else you'd like?",
                              "choices": ["No", "Yes"]}]}
    permission = {"questions": [{"header": "Go", "question": "Do you want me to add them?",
                                 "choices": ["Yes", "No"]}]}
    too_many = {"questions": [{"question": f"Q{i}?", "choices": ["a", "b"]} for i in range(5)]}
    fake_llm.chat_steps.extend([_ask_step(a) for a in (too_many, one_choice, generic, permission)]
                               + [{"message": "fine", "calls": []}])
    out = await _chat(wp_client, "make a pack")
    assert out["pending"] == []
    notes = [s["note"] for s in out["steps"] if not s["ok"]]
    assert "at most 4 questions" in notes[0]
    assert "give 2-5" in notes[1]
    assert "too general" in notes[2]
    assert "asks permission" in notes[3]

    # Never with change tools, and last in its step.
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [
            {"tool": "ask", "args": json.dumps(QUESTIONS)},
            {"tool": "update_info", "args": json.dumps({"id": tgt, "tags_add": ["gear"]})}]},
        {"message": "", "calls": [
            {"tool": "ask", "args": json.dumps(QUESTIONS)},
            {"tool": "read", "args": json.dumps({"id": tgt})}]},
        {"message": "done", "calls": []},
    ])
    out = await _chat(wp_client, "tag it", chat_id=out["chat_id"])
    assert out["pending"] == []
    notes = [s["note"] for s in out["steps"] if not s["ok"]]
    assert "ask first, then propose" in notes[0]
    assert "put ask last" in notes[1]


async def test_a_new_message_answers_the_ask_in_its_own_words(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.extend([_ask_step(), {"message": "Got it.", "calls": []}])
    first = await _chat(wp_client, "make a pack")
    call_id = first["pending"][0]["id"]
    await _chat(wp_client, "anime, no negatives", chat_id=first["chat_id"])
    last = _last_user(fake_llm)
    assert last.index("ask: the user answered in their own words in the next message") < \
        last.index("anime, no negatives")
    assert "not run" not in last
    chat = await _json(await wp_client.get(f"/wp/api/ai/chats/{first['chat_id']}"))
    assert chat["turns"][1]["view"]["answered"] == {call_id: {"own": True}}


async def test_at_most_two_asks_per_message(wp_client, fake_llm):
    _on(fake_llm)

    def q(head):
        return _ask_step({"questions": [{"header": head, "question": f"{head}?",
                                         "choices": ["a", "b"]}]})

    fake_llm.chat_steps.extend([q("One"), q("Two"), q("Three"), {"message": "ok", "calls": []}])
    first = await _chat(wp_client, "pack please")
    second = await _resume(wp_client, first["chat_id"], [
        {"id": first["pending"][0]["id"], "answers": [{"q": 0, "picked": [1]}]}])
    assert second["pending"][0]["args"]["questions"][0]["header"] == "Two"
    third = await _resume(wp_client, first["chat_id"], [
        {"id": second["pending"][0]["id"], "answers": []}])
    assert third["pending"] == [] and third["message"] == "ok"
    assert "decide yourself and say what you assumed" in _last_user(fake_llm)
    # A new message may ask again.
    fake_llm.chat_steps.extend([q("Four"), {"message": "ok", "calls": []}])
    fourth = await _chat(wp_client, "next", chat_id=first["chat_id"])
    assert fourth["pending"][0]["tool"] == "ask"


async def test_compaction_keeps_the_settled_answers(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.overrides["summary"] = {"summary": "What the user wants:\n- a pack"}
    fake_llm.chat_steps.extend([_ask_step(), {"message": "ok", "calls": []}])
    first = await _chat(wp_client, "pack")
    chat_id = first["chat_id"]
    await _resume(wp_client, chat_id, [{"id": first["pending"][0]["id"], "answers": [
        {"q": 0, "picked": [1]}]}])
    fake_llm.chat_steps.extend({"message": f"Answer {i}. " + "words " * 200, "calls": []}
                               for i in range(4))
    for word in ("two", "three", "four", "five"):
        await _chat(wp_client, word, chat_id=chat_id)
    meta = await _json(await wp_client.get(f"/wp/api/ai/chats/{chat_id}"))
    assert "Style → Realistic" in meta["summary"]
    assert "never ask them again" in meta["summary"]


async def test_editing_the_last_message_runs_the_new_text(wp_client, fake_llm):
    _src, tgt = await _two_wildcards(wp_client)
    _on(fake_llm)
    fake_llm.chat_steps.extend([{"message": "One.", "calls": []},
                                {"message": "Red.", "calls": []},
                                {"message": "Blue.", "calls": []}])
    first = await _chat(wp_client, "first")
    await _chat(wp_client, "make it red", chat_id=first["chat_id"])
    edited = await _chat(wp_client, "make it blue", chat_id=first["chat_id"], retry=True)
    assert edited["message"] == "Blue."
    users = [m["content"] for m in fake_llm.seen[-1]["body"]["messages"] if m["role"] == "user"]
    assert any("make it blue" in u for u in users)
    assert not any("make it red" in u for u in users)
    chat = await _json(await wp_client.get(f"/wp/api/ai/chats/{first['chat_id']}"))
    assert [t.get("text") or t["view"]["message"] for t in chat["turns"]] == [
        "first", "One.", "make it blue", "Blue."]

    # Refused like a retry once a card from that answer was applied.
    fake_llm.chat_steps.append({"message": "Here.", "calls": [
        {"tool": "update_info", "args": json.dumps({"id": tgt, "tags_add": ["gear"]})}]})
    out = await _chat(wp_client, "tag Weapon", chat_id=first["chat_id"])
    await _json(await wp_client.patch(f"/wp/api/ai/chats/{first['chat_id']}", json={
        "events": [{"pid": out["proposals"][0]["pid"], "status": "applied"}]}))
    refused = await _json(await wp_client.post("/wp/api/ai/chat", json={
        "message": "tag Class", "chat_id": first["chat_id"], "retry": True}), 409)
    assert "undo" in refused["error"]
