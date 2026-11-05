"""Every chat request starts with the one before it. Local servers keep only
the prompt's shared start, and on hybrid models (Qwen3.5 and later) any
change before the end of the prompt reads all of it again, so this locks
the rule every small-model change has to follow: the system prompt stays
the same for the whole chat and new text is only ever added at the end.
See /pr-drafts/request-aware-prompts-plan.md, Phase 0."""
from __future__ import annotations

import json

from engine.ai import config as ai_config
from tests.wp_api.test_ai_api import _chat, _two_wildcards


def _on(fake_llm, model="qwen3.5-9b"):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": model})


def _messages(seen):
    return [(m.get("role"), m.get("content")) for m in seen["body"]["messages"]]


def _extends(before, after):
    """`after` keeps `before` as its start: the same messages, except that
    the last one may have grown (a note joined onto a results message)."""
    if len(after) < len(before):
        return False
    for i, (b, a) in enumerate(zip(before, after, strict=False)):
        if b == a:
            continue
        last = i == len(before) - 1
        if not (last and b[0] == a[0] and isinstance(b[1], str) and isinstance(a[1], str)
                and a[1].startswith(b[1])):
            return False
    return True


async def test_each_request_starts_with_the_one_before(wp_client, fake_llm):
    _src, tgt = await _two_wildcards(wp_client)
    _on(fake_llm)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "search", "args": json.dumps({"query": "weapon"})}]},
        {"message": "", "calls": [{"tool": "read", "args": json.dumps({"id": tgt})}]},
        {"message": "", "calls": [{"tool": "add_options", "args": json.dumps(
            {"id": tgt, "options": [{"text": "war axe"}]})}]},
        {"message": "I've proposed a war axe; apply the card.", "calls": []},
    ])
    n = len(fake_llm.seen)
    first = await _chat(wp_client, "add a war axe to my Weapon")
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "read", "args": json.dumps({"id": tgt})}]},
        {"message": "It has an oak staff, a longsword and the war axe card.", "calls": []},
    ])
    await _chat(wp_client, "what does Weapon hold now?", chat_id=first["chat_id"])
    asks = [_messages(x) for x in fake_llm.seen[n:] if "messages" in x["body"]]
    assert len(asks) >= 6
    system = {m[1] for a in asks for m in a if m[0] == "system"}
    assert len(system) == 1, "the system prompt changed inside one chat"
    for i in range(1, len(asks)):
        assert _extends(asks[i - 1], asks[i]), f"request {i + 1} does not start with request {i}"


async def test_the_answer_keeps_a_trace(wp_client, fake_llm):
    _src, tgt = await _two_wildcards(wp_client)
    _on(fake_llm)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "read", "args": json.dumps({"id": tgt})}]},
        {"message": "", "calls": [{"tool": "read", "args": json.dumps({"id": tgt})}]},
        {"message": "Weapon has an oak staff and a longsword.", "calls": []},
    ])
    body = await _chat(wp_client, "what is in my Weapon?")
    assert "trace" not in body  # the browser never gets it
    from engine.db.repositories import ChatRepository
    from wp_api._helpers import db_session

    class _Req:
        app = wp_client.server.app

    with db_session(_Req()) as conn:
        entries = ChatRepository(conn).messages(body["chat_id"])
    trace = [e["trace"] for e in entries if e.get("kind") == "shown"][-1]
    called = [s["called"] for s in trace["steps"]]
    assert ["read"] in called
    assert any(s.get("repeats") for s in trace["steps"])  # the same read twice
    assert trace["model"] == "qwen3.5-9b"
    assert trace["profile"]
