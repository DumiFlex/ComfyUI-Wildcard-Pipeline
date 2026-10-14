"""Stored chats (list, reopen, rename, pin, delete), Retry, the context
meter, compaction and streamed answers."""
from __future__ import annotations

import json

import pytest
from aiohttp import web

from engine.ai import config as ai_config
from tests.wp_api.test_ai_api import _chat, _two_wildcards
from wp_api import _ai_chat, _ai_client


def _on(fake_llm, **extra):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1", **extra})


async def _json(resp, status=200):
    assert resp.status == status, await resp.text()
    return await resp.json()


async def test_chats_are_listed_searched_renamed_pinned_and_deleted(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.extend([{"message": "Hi!", "calls": []},
                                {"message": "Sure.", "calls": []}])
    a = await _chat(wp_client, "Hey, can you help me with hair colours?")
    b = await _chat(wp_client, "make a cyberpunk pack")
    got = (await _json(await wp_client.get("/wp/api/ai/chats")))["chats"]
    assert [c["id"] for c in got] == [b["chat_id"], a["chat_id"]]
    assert got[1]["title"] == "Help me with hair colours"
    assert got[0]["turns"] == 1 and got[0]["pinned"] is False

    # Search looks at titles and at what was said.
    found = (await _json(await wp_client.get("/wp/api/ai/chats?q=Sure")))["chats"]
    assert [c["id"] for c in found] == [b["chat_id"]]
    assert (await _json(await wp_client.get("/wp/api/ai/chats?q=%25")))["chats"] == []
    # Only the words count, not the stored JSON around them.
    for q in ("kind", "proposals", "steps"):
        assert (await _json(await wp_client.get(f"/wp/api/ai/chats?q={q}")))["chats"] == []

    # Renaming and pinning don't make a chat newer, but pins come first.
    out = await _json(await wp_client.patch(f"/wp/api/ai/chats/{a['chat_id']}",
                                            json={"title": "Hair", "pinned": True}))
    assert out == {"id": a["chat_id"], "title": "Hair", "pinned": True}
    got = (await _json(await wp_client.get("/wp/api/ai/chats")))["chats"]
    assert [c["id"] for c in got] == [a["chat_id"], b["chat_id"]]
    await _json(await wp_client.patch(f"/wp/api/ai/chats/{a['chat_id']}", json={"title": " "}),
                400)
    await _json(await wp_client.patch(f"/wp/api/ai/chats/{a['chat_id']}",
                                      json={"pinned": "yes"}), 400)

    await _json(await wp_client.delete(f"/wp/api/ai/chats/{b['chat_id']}"))
    await _json(await wp_client.get(f"/wp/api/ai/chats/{b['chat_id']}"), 404)
    await _json(await wp_client.delete(f"/wp/api/ai/chats/{b['chat_id']}"), 404)
    await _json(await wp_client.patch("/wp/api/ai/chats/nope", json={"pinned": True}), 404)


async def test_a_reopened_chat_shows_what_the_user_saw(wp_client, fake_llm):
    _src, tgt = await _two_wildcards(wp_client)
    _on(fake_llm)
    fake_llm.chat_steps.append({"message": "Here.", "calls": [
        {"tool": "update_info", "args": json.dumps({"id": tgt, "tags_add": ["gear"]})}]})
    first = await _chat(wp_client, "tag Weapon as gear")
    assert first["context"]["window"] == 65536 and first["context"]["used"] > 0
    pid = first["proposals"][0]["pid"]
    await _json(await wp_client.patch(f"/wp/api/ai/chats/{first['chat_id']}", json={
        "events": [{"pid": pid, "status": "applied", "created": "abcd1234"},
                   {"pid": pid + "x", "status": "exploded"}, "junk"]}))
    chat = await _json(await wp_client.get(f"/wp/api/ai/chats/{first['chat_id']}"))
    assert chat["title"] == "Tag Weapon as gear" and chat["waiting"] is False
    user, reply = chat["turns"]
    assert user == {"role": "user", "text": "tag Weapon as gear"}
    assert reply["role"] == "assistant" and reply["view"]["message"] == "Here."
    assert reply["view"]["proposals"][0]["pid"] == pid
    assert reply["status"] == {pid: "applied"} and reply["created"] == {pid: "abcd1234"}
    assert chat["context"]["window"] == 65536


async def test_retry_runs_the_last_message_again(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.extend([{"message": "One.", "calls": []},
                                {"message": "Two.", "calls": []},
                                {"message": "Two, again.", "calls": []}])
    first = await _chat(wp_client, "first")
    await _chat(wp_client, "second", chat_id=first["chat_id"])
    again = await _chat(wp_client, "", chat_id=first["chat_id"], retry=True)
    assert again["message"] == "Two, again." and again["chat_id"] == first["chat_id"]
    sent = fake_llm.seen[-1]["body"]["messages"]
    users = [m["content"] for m in sent if m["role"] == "user"]
    # The old answer is gone and the message is asked once.
    assert sum("second" in u for u in users) == 1
    assert not any("Two." in str(m.get("content")) for m in sent if m["role"] == "assistant")
    chat = await _json(await wp_client.get(f"/wp/api/ai/chats/{first['chat_id']}"))
    assert [t.get("text") or t["view"]["message"] for t in chat["turns"]] == [
        "first", "One.", "second", "Two, again."]

    await _json(await wp_client.post("/wp/api/ai/chat", json={
        "message": "", "chat_id": "gone", "retry": True}), 404)


async def test_retry_is_refused_after_a_card_from_that_answer_was_applied(wp_client, fake_llm):
    _src, tgt = await _two_wildcards(wp_client)
    _on(fake_llm)
    fake_llm.chat_steps.append({"message": "Here.", "calls": [
        {"tool": "update_info", "args": json.dumps({"id": tgt, "tags_add": ["gear"]})}]})
    first = await _chat(wp_client, "tag Weapon")
    await _json(await wp_client.patch(f"/wp/api/ai/chats/{first['chat_id']}", json={
        "events": [{"pid": first["proposals"][0]["pid"], "status": "applied"}]}))
    out = await _json(await wp_client.post("/wp/api/ai/chat", json={
        "message": "", "chat_id": first["chat_id"], "retry": True}), 409)
    assert "undo" in out["error"]
    # Once undone, it may run again, and the card's pid is free again.
    await _json(await wp_client.patch(f"/wp/api/ai/chats/{first['chat_id']}", json={
        "events": [{"pid": first["proposals"][0]["pid"], "status": "undone"}]}))
    fake_llm.chat_steps.append({"message": "Again.", "calls": [
        {"tool": "update_info", "args": json.dumps({"id": tgt, "tags_add": ["kit"]})}]})
    again = await _chat(wp_client, "", chat_id=first["chat_id"], retry=True)
    assert again["message"] == "Again."


def _long_chat_steps(fake_llm, n):
    fake_llm.chat_steps.extend({"message": f"Answer {i}. " + "words " * 200, "calls": []}
                               for i in range(n))


async def test_a_long_chat_is_compacted_into_a_summary(wp_client, fake_llm):
    src, tgt = await _two_wildcards(wp_client)
    _on(fake_llm, context_max=4096)
    fake_llm.overrides["_ctx"] = 4096
    fake_llm.overrides["summary"] = {"summary": (
        "What the user wants:\n- a weapon list\nDecisions made:\nnone")}
    fake_llm.chat_steps.append({"message": "Read it.", "calls": [
        {"tool": "read", "args": json.dumps({"id": tgt})}]})
    _long_chat_steps(fake_llm, 6)
    out = await _chat(wp_client, "look at Weapon " + "please " * 300)
    chat_id = out["chat_id"]
    for i in range(4):
        out = await _chat(wp_client, f"turn {i} " + "more " * 300, chat_id=chat_id)
    assert out["context"]["compactions"] >= 1
    asks = [s["body"] for s in fake_llm.seen
            if (s["body"].get("response_format") or {}).get("json_schema", {}).get("name")
            == "summary"]
    assert asks and "look at Weapon" in asks[0]["messages"][-1]["content"]
    sent = fake_llm.seen[-1]["body"]["messages"]
    text = json.dumps(sent)
    assert "a weapon list" in text
    # The id the model used, missing from its summary, is listed after it.
    assert f"Items mentioned (ids): {tgt}" in text
    assert "look at Weapon" not in text


async def test_compact_now_and_its_refusals(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.overrides["_ctx"] = 4096
    fake_llm.overrides["summary"] = {"summary": "What the user wants:\n- short answers please"}
    _long_chat_steps(fake_llm, 5)
    out = await _chat(wp_client, "one")
    chat_id = out["chat_id"]
    out409 = await _json(await wp_client.post(f"/wp/api/ai/chats/{chat_id}/compact"), 409)
    assert "nothing to summarize" in out409["error"]
    for word in ("two", "three", "four"):
        last = await _chat(wp_client, word, chat_id=chat_id)
    # The fake server loads the model with 4k, so turns already compacted
    # as they went (down to the newest turn).
    had = last["context"]["compactions"]
    assert had >= 1 and last["context"]["summarised_turns"] == had
    for word in ("five", "six"):
        await _chat(wp_client, word, chat_id=chat_id)
    meta_before = await _json(await wp_client.get(f"/wp/api/ai/chats/{chat_id}"))
    before = len(fake_llm.seen)
    done = await _json(await wp_client.post(f"/wp/api/ai/chats/{chat_id}/compact"))
    assert done["compacted"] is True
    assert done["context"]["compactions"] == meta_before["context"]["compactions"] + 1
    assert "short answers please" in done["summary"]
    assert len(fake_llm.seen) == before + 1
    # Nothing new to fold in until another turn.
    await _json(await wp_client.post(f"/wp/api/ai/chats/{chat_id}/compact"), 409)
    await _json(await wp_client.post("/wp/api/ai/chats/nope/compact"), 404)


async def test_compact_says_so_when_the_model_writes_no_summary(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.overrides["summary"] = {"summary": "?"}
    _long_chat_steps(fake_llm, 4)
    out = await _chat(wp_client, "one")
    for word in ("two", "three", "four"):
        await _chat(wp_client, word, chat_id=out["chat_id"])
    await _json(await wp_client.post(f"/wp/api/ai/chats/{out['chat_id']}/compact"), 502)


async def _ndjson(resp):
    assert resp.status == 200, await resp.text()
    assert resp.headers["Content-Type"].startswith("application/x-ndjson")
    return [json.loads(line) for line in (await resp.text()).splitlines() if line.strip()]


async def test_a_streamed_turn_sends_events_then_the_answer(wp_client, fake_llm):
    _src, tgt = await _two_wildcards(wp_client)
    _on(fake_llm)
    fake_llm.chat_steps.extend([
        {"message": "Reading.", "calls": [{"tool": "read", "args": json.dumps({"id": tgt})}]},
        {"message": "It has two options.", "calls": []},
    ])
    events = await _ndjson(await wp_client.post("/wp/api/ai/chat", json={
        "message": "what is in Weapon?", "stream": True}))
    kinds = [e["type"] for e in events]
    assert kinds[0] == "step" and kinds[-1] == "done" and "tool" in kinds
    tools = [e["step"] for e in events if e["type"] == "tool"]
    # What it streamed before reading stays, as a "say" step ahead of the read.
    assert tools[0] == {"tool": "say", "note": "Reading.", "ok": True, "say": True}
    assert tools[1]["note"] == "Read Weapon"
    assert events[-1]["result"]["message"] == "It has two options."
    assert events[-1]["result"]["chat_id"]


async def test_a_streamed_turn_ends_with_an_error_event(wp_client, fake_llm):
    _on(fake_llm)
    events = await _ndjson(await wp_client.post("/wp/api/ai/chat", json={
        "message": "", "chat_id": "nope", "retry": True, "stream": True}))
    assert events == [{"type": "error", "status": 404, "message": "that chat is gone"}]


# ── the streaming client ────────────────────────────────────────────────


def _sse(*objs):
    return "".join(f"data: {json.dumps(o)}\n\n" for o in objs) + "data: [DONE]\n\n"


@pytest.fixture
async def streamer(aiohttp_server):
    """A server that answers with whatever stream the test sets."""
    state: dict = {"body": "", "ctype": "text/event-stream", "status": 200, "seen": []}

    async def handler(request):
        body = await request.json()
        state["seen"].append(body)
        if state["status"] != 200 and body.get("stream"):
            return web.json_response({"error": {"message": "no streaming here"}},
                                     status=state["status"])
        if not body.get("stream") or state["ctype"] == "application/json":
            return web.json_response(state.get("plain") or {"choices": [
                {"message": {"content": "plain"}}]})
        resp = web.StreamResponse(headers={"Content-Type": state["ctype"]})
        await resp.prepare(request)
        text = state["body"]
        # Split mid-line to check lines are joined across chunks.
        for i in range(0, len(text), 7):
            await resp.write(text[i:i + 7].encode())
        await resp.write_eof()
        return resp

    app = web.Application()
    app.router.add_post("/v1/chat/completions", handler)
    app.router.add_post("/api/chat", handler)
    app.router.add_post("/v1/messages", handler)
    app.router.add_post("/v1/responses", handler)
    server = await aiohttp_server(app)
    server.state = state
    return server


def _cfg(server, api="openai", model="m"):
    return {"api": api, "base_url": str(server.make_url("/v1" if api != "ollama" else "")),
            "model": model, "api_key": ""}


async def test_openai_stream_is_assembled_with_text_events(streamer):
    _ai_chat._NO_STREAM.clear()
    streamer.state["body"] = _sse(
        {"choices": [{"delta": {"reasoning_content": "hmm"}}]},
        {"choices": [{"delta": {"content": "<think>x</think>Hel"}}]},
        {"choices": [{"delta": {"content": "lo", "tool_calls": [
            {"index": 0, "id": "c1", "function": {"name": "re", "arguments": '{"id"'}}]}}]},
        {"choices": [{"delta": {"tool_calls": [
            {"index": 0, "function": {"name": "ad", "arguments": ': "a"}'}}]},
            "finish_reason": "tool_calls"}]},
        {"choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 2}},
    ) + ": keep-alive\n"
    events: list = []

    async def emit(e):
        events.append(e)

    data = await _ai_chat._post(_cfg(streamer), "/chat/completions", {"model": "m"},
                                kind="openai", emit=emit, show=True)
    msg = data["choices"][0]["message"]
    assert msg["content"] == "<think>x</think>Hello"
    assert msg["tool_calls"] == [{"id": "c1", "type": "function",
                                  "function": {"name": "read", "arguments": '{"id": "a"}'}}]
    assert data["choices"][0]["finish_reason"] == "tool_calls"
    assert data["usage"]["prompt_tokens"] == 10
    assert streamer.state["seen"][0]["stream"] is True
    assert streamer.state["seen"][0]["stream_options"] == {"include_usage": True}
    assert events[0] == {"type": "thinking"}
    assert events[-1] == {"type": "text", "v": "Hello"}


async def test_ollama_stream_is_assembled(streamer):
    _ai_chat._NO_STREAM.clear()
    streamer.state["ctype"] = "application/x-ndjson"
    lines = [
        {"message": {"role": "assistant", "content": "", "thinking": "hm"}},
        {"message": {"role": "assistant", "content": "Hi "}},
        {"message": {"role": "assistant", "content": "there", "tool_calls": [
            {"function": {"name": "read", "arguments": {"id": "a"}}}]}},
        {"done": True, "done_reason": "stop", "prompt_eval_count": 5, "eval_count": 2,
         "message": {"role": "assistant", "content": ""}},
    ]
    streamer.state["body"] = "".join(json.dumps(x) + "\n" for x in lines)
    data = await _ai_chat._post(_cfg(streamer, "ollama"), "/api/chat", {"model": "m"},
                                kind="ollama", emit=None, show=True)
    assert data["message"]["content"] == "Hi there"
    assert data["message"]["tool_calls"][0]["function"]["arguments"] == {"id": "a"}
    assert data["done_reason"] == "stop" and data["prompt_eval_count"] == 5


async def test_anthropic_stream_is_assembled(streamer):
    _ai_chat._NO_STREAM.clear()
    streamer.state["body"] = _sse(
        {"type": "message_start", "message": {"usage": {"input_tokens": 40,
                                                        "cache_read_input_tokens": 30}}},
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta",
                                                              "text": "Sure"}},
        {"type": "content_block_stop", "index": 0},
        {"type": "content_block_start", "index": 1, "content_block": {
            "type": "tool_use", "id": "t1", "name": "read", "input": {}}},
        {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta",
                                                              "partial_json": '{"id": '}},
        {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta",
                                                              "partial_json": '"a"}'}},
        {"type": "content_block_stop", "index": 1},
        {"type": "message_delta", "delta": {"stop_reason": "tool_use"},
         "usage": {"output_tokens": 7}},
    )
    data = await _ai_chat._post(_cfg(streamer, "anthropic"), "/messages", {"model": "m"},
                                kind="anthropic", emit=None, show=True)
    assert data["content"] == [{"type": "text", "text": "Sure"},
                               {"type": "tool_use", "id": "t1", "name": "read",
                                "input": {"id": "a"}}]
    assert data["stop_reason"] == "tool_use"
    assert data["usage"] == {"input_tokens": 40, "cache_read_input_tokens": 30,
                             "output_tokens": 7}


async def test_responses_stream_is_assembled(streamer):
    _ai_chat._NO_STREAM.clear()
    final = {"status": "completed", "usage": {"input_tokens": 50, "output_tokens": 4},
             "output": [
                 {"type": "reasoning", "id": "rs_1", "summary": [], "encrypted_content": "E"},
                 {"type": "message", "role": "assistant", "phase": "final_answer",
                  "content": [{"type": "output_text", "text": "Hello"}]},
                 {"type": "function_call", "call_id": "c1", "name": "read",
                  "arguments": '{"id": "a"}'}]}
    streamer.state["body"] = _sse(
        {"type": "response.created", "response": {"status": "in_progress"}},
        {"type": "response.reasoning_summary_text.delta", "delta": "hm"},
        {"type": "response.output_text.delta", "delta": "Hel"},
        {"type": "response.output_text.delta", "delta": "lo"},
        {"type": "response.function_call_arguments.delta", "delta": '{"id"'},
        {"type": "response.completed", "response": final},
    )
    events: list = []

    async def emit(e):
        events.append(e)

    data = await _ai_chat._post(_cfg(streamer), "/responses", {"model": "m"},
                                kind="responses", emit=emit, show=True)
    assert data["output"] == final["output"] and data["status"] == "completed"
    assert "_early" not in data
    assert events[0] == {"type": "thinking"} and events[-1] == {"type": "text", "v": "Hello"}


async def test_a_cut_responses_stream_keeps_finished_items(streamer):
    _ai_chat._NO_STREAM.clear()
    item = {"type": "message", "role": "assistant",
            "content": [{"type": "output_text", "text": "Part"}]}
    streamer.state["body"] = _sse(
        {"type": "response.output_item.done", "output_index": 0, "item": item})
    data = await _ai_chat._post(_cfg(streamer), "/responses", {"model": "m"},
                                kind="responses", emit=None, show=True)
    assert data["output"] == [item] and data["_early"] is True


async def test_an_error_event_in_a_responses_stream_raises(streamer):
    _ai_chat._NO_STREAM.clear()
    streamer.state["body"] = _sse({"type": "error", "code": "server_error",
                                   "message": "overloaded"})
    with pytest.raises(_ai_client.AIError, match="overloaded"):
        await _ai_chat._post(_cfg(streamer), "/responses", {"model": "m"},
                             kind="responses", emit=None, show=True)


async def test_an_error_inside_the_stream_raises(streamer):
    _ai_chat._NO_STREAM.clear()
    streamer.state["body"] = _sse({"error": {"message": "model crashed"}})
    with pytest.raises(_ai_client.AIError, match="model crashed"):
        await _ai_chat._post(_cfg(streamer), "/chat/completions", {"model": "m"},
                             kind="openai", emit=None, show=False)


async def test_a_server_that_ignores_stream_answers_plain_json(streamer):
    _ai_chat._NO_STREAM.clear()
    streamer.state["ctype"] = "application/json"
    data = await _ai_chat._post(_cfg(streamer), "/chat/completions", {"model": "m"},
                                kind="openai", emit=None, show=False)
    assert data["choices"][0]["message"]["content"] == "plain"


async def test_a_server_that_refuses_stream_is_asked_plainly_and_remembered(streamer):
    _ai_chat._NO_STREAM.clear()
    streamer.state["status"] = 400
    cfg = _cfg(streamer, model="strict")
    data = await _ai_chat._post(cfg, "/chat/completions", {"model": "strict"},
                                kind="openai", emit=None, show=False)
    assert data["choices"][0]["message"]["content"] == "plain"
    assert [b.get("stream") for b in streamer.state["seen"]] == [True, None]
    await _ai_chat._post(cfg, "/chat/completions", {"model": "strict"},
                         kind="openai", emit=None, show=False)
    # Remembered: no streamed attempt the second time.
    assert [b.get("stream") for b in streamer.state["seen"]] == [True, None, None]
    _ai_chat._NO_STREAM.clear()


async def test_an_auth_error_is_not_retried_without_streaming(streamer):
    _ai_chat._NO_STREAM.clear()
    streamer.state["status"] = 401
    with pytest.raises(_ai_client.AIError):
        await _ai_chat._post(_cfg(streamer), "/chat/completions", {"model": "m"},
                             kind="openai", emit=None, show=False)
    assert len(streamer.state["seen"]) == 1


async def test_a_card_fix_changes_the_card_reopens_fixed_and_tells_the_model(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.append({"message": "Here.", "calls": [{"tool": "create_wildcard",
        "args": json.dumps({"name": "Pose", "var": "pose", "options": [
            {"text": "standing"}, {"text": "close-up, sitting"}, {"text": "full body"}]})}]})
    first = await _chat(wp_client, "make poses")
    card = first["proposals"][0]
    [fix] = card["fixes"]
    assert fix["key"] == "scope:camera"
    url = f"/wp/api/ai/chats/{first['chat_id']}"
    out = await _json(await wp_client.patch(url, json={"events": [
        {"pid": card["pid"], "fix": fix["key"]}, {"pid": card["pid"], "fix": "nope"}]}))
    body = out["fixed"][card["pid"]]
    assert [o["value"] for o in body["payload"]["options"]] == ["standing", "sitting"]
    assert body["id"] == card["op"]["body"]["id"]

    chat = await _json(await wp_client.get(url))
    shown = chat["turns"][1]["view"]["proposals"][0]
    assert shown["op"]["body"] == body and shown["fixes"] == []
    assert fix["warning"] not in shown["warnings"]

    fake_llm.chat_steps.append({"message": "Ok.", "calls": []})
    await _chat(wp_client, "and the next one", chat_id=first["chat_id"],
                events=[{"pid": card["pid"], "fix": fix["key"], "label": fix["label"]}])
    sent = json.dumps(fake_llm.seen[-1]["body"])
    assert "used the card's fix" in sent and "Remove camera words" in sent


async def test_retry_drops_the_old_turns_card_fixes(wp_client, fake_llm):
    _on(fake_llm)
    step = {"message": "Here.", "calls": [{"tool": "create_wildcard",
        "args": json.dumps({"name": "Pose", "var": "pose", "options": [
            {"text": "standing"}, {"text": "close-up, sitting"}, {"text": "full body"}]})}]}
    fake_llm.chat_steps.append(step)
    first = await _chat(wp_client, "make poses")
    card = first["proposals"][0]
    url = f"/wp/api/ai/chats/{first['chat_id']}"
    await _json(await wp_client.patch(url, json={"events": [
        {"pid": card["pid"], "fix": card["fixes"][0]["key"]}]}))
    fake_llm.chat_steps.append(step)
    again = await _chat(wp_client, "", chat_id=first["chat_id"], retry=True)
    # Same pid, new card: the fix made to the discarded one doesn't carry over.
    assert again["proposals"][0]["pid"] == card["pid"]
    chat = await _json(await wp_client.get(url))
    shown = chat["turns"][1]["view"]["proposals"][0]
    assert len(shown["op"]["body"]["payload"]["options"]) == 3 and shown["fixes"]


async def test_a_second_request_for_a_busy_chat_is_refused(wp_client, fake_llm):
    from wp_api import ai as ai_routes
    _on(fake_llm)
    fake_llm.chat_steps.append({"message": "Hi!", "calls": []})
    first = await _chat(wp_client, "hello")
    ai_routes._BUSY.add(first["chat_id"])
    try:
        out = await _json(await wp_client.post("/wp/api/ai/chat", json={
            "message": "again", "chat_id": first["chat_id"]}), 409)
        assert "still answering" in out["error"]
    finally:
        ai_routes._BUSY.discard(first["chat_id"])
    fake_llm.chat_steps.append({"message": "Back.", "calls": []})
    assert (await _chat(wp_client, "again", chat_id=first["chat_id"]))["message"] == "Back."


def _sent_tools(fake_llm):
    return [t["function"]["name"] for t in fake_llm.seen[-1]["body"].get("tools") or []]


async def test_a_new_chat_fits_the_window_the_model_was_loaded_with(wp_client, fake_llm):
    await _two_wildcards(wp_client)
    # Roomy: every tool and the whole prompt.
    _on(fake_llm, model="tooly")
    await _chat(wp_client, "How do constraints work?")
    full = _sent_tools(fake_llm)
    assert "Docs pages (id: title" in fake_llm.seen[-1]["body"]["messages"][0]["content"]
    # 16k can't hold all 37 tool declarations and the full instructions.
    fake_llm.overrides["_ctx"] = 16384
    _on(fake_llm, model="tooly", context_max=16384)
    out = await _chat(wp_client, "How do constraints work?")
    lean = _sent_tools(fake_llm)
    assert "more_tools" in lean and len(lean) < len(full)
    assert "Docs pages (id: title" not in fake_llm.seen[-1]["body"]["messages"][0]["content"]
    assert out["context"]["window"] == 16384
    # The chat keeps the level it started at.
    await _chat(wp_client, "and exceptions?", chat_id=out["chat_id"])
    assert _sent_tools(fake_llm) == lean


async def test_a_refused_long_first_request_is_retried_leaner(wp_client, fake_llm):
    await _two_wildcards(wp_client)
    _on(fake_llm, model="tooly")
    fake_llm.overrides["_overflow"] = 1
    fake_llm.chat_steps.append({"content": "Constraints link two lists."})
    out = await _chat(wp_client, "How do constraints work?")
    assert out["message"] == "Constraints link two lists."
    refused, retried = fake_llm.seen[-2:]
    assert len(retried["body"]["tools"]) < len(refused["body"]["tools"])


async def test_a_window_too_small_even_when_lean_says_what_to_load(wp_client, fake_llm):
    await _two_wildcards(wp_client)
    _on(fake_llm, model="tooly")
    fake_llm.overrides["_overflow"] = 5
    resp = await wp_client.post("/wp/api/ai/chat", json={"message": "How do constraints work?"})
    err = (await _json(resp, 400))["error"]
    assert "loaded with 16,384 tokens of context" in err
    assert "about 17,339" in err and "at least 32,768" in err
