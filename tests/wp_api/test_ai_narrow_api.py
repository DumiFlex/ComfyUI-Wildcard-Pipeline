"""Narrowed step grammars in a chat (`engine/ai/narrow.py`, wired in
`_ai_turn._narrowed`): item ids limited to what may change, what follows a
call offered, and the plain grammar again for a server that refuses."""
from __future__ import annotations

import json

from tests.wp_api.test_ai_api import _chat, _two_wildcards
from tests.wp_api.test_ai_plan_items import _offered
from tests.wp_api.test_ai_prefix_stable import _on
from tests.wp_api.test_ai_small_models import _kind, _schema
from wp_api import _ai_chat


def _acts(fake_llm, n):
    return [x for x in fake_llm.seen[n:] if "response_format" in x["body"] and _kind(x) == "act"]


def _id_enum(seen, tool):
    for o in _schema(seen)["properties"]["calls"]["items"].get("anyOf") or []:
        if o["properties"]["tool"]["enum"] == [tool]:
            return o["properties"]["args"]["properties"].get("id", {}).get("enum")
    return "not offered"


def _steps(tgt):
    return [
        {"message": "", "calls": [{"tool": "search", "args": json.dumps({"query": "weapon"})}]},
        {"message": "", "calls": [{"tool": "read", "args": json.dumps({"id": tgt})}]},
        {"message": "", "calls": [{"tool": "add_options", "args": json.dumps(
            {"id": tgt, "options": [{"text": "war axe"}]})}]},
        {"message": "I've proposed a war axe.", "calls": []},
    ]


async def test_ids_follow_what_may_change(wp_client, fake_llm):
    src, tgt = await _two_wildcards(wp_client)
    _on(fake_llm)
    fake_llm.chat_steps.extend(_steps(tgt))
    n = len(fake_llm.seen)
    body = await _chat(wp_client, "add a war axe to my Weapon")
    assert [p["tool"] for p in body["proposals"]] == ["add_options"]
    acts = _acts(fake_llm, n)
    assert len(acts) >= 3
    assert _id_enum(acts[0], "read") == sorted([src, tgt])
    assert _id_enum(acts[0], "add_options") == [tgt]  # named in the message; Class is not
    assert "read" in _offered(acts[1])


async def test_a_server_that_refuses_the_enums_gets_the_plain_grammar(wp_client, fake_llm):
    _src, tgt = await _two_wildcards(wp_client)
    _on(fake_llm, model="qwen3.5-9b-noenum")
    fake_llm.overrides["_no_enums"] = True
    fake_llm.chat_steps.extend(_steps(tgt))
    n = len(fake_llm.seen)
    body = await _chat(wp_client, "add a war axe to my Weapon")
    assert [p["tool"] for p in body["proposals"]] == ["add_options"]
    acts = _acts(fake_llm, n)
    assert _id_enum(acts[0], "read") is not None  # refused (asked again without streaming)
    plain = next(i for i, a in enumerate(acts) if _id_enum(a, "read") in (None, "not offered"))
    assert all(_id_enum(a, "read") in (None, "not offered") for a in acts[plain:])
    assert any(k[1] == "qwen3.5-9b-noenum" for k in _ai_chat.NO_ENUMS)
    assert not any(k[1] == "qwen3.5-9b-noenum" for k in _ai_chat._NO_TYPED)

