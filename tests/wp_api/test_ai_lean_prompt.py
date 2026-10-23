"""Lean prompt (Settings › AI assistant › Advanced, `lean_prompt`): small
models in typed JSON steps get one line per tool in the instructions, and
each tool's arguments and example with the step that first offers it
(request-aware prompts plan, Phase 3)."""
from __future__ import annotations

import json

from engine.ai import chat as ai_chat
from tests.wp_api.test_ai_api import _chat
from tests.wp_api.test_ai_chats import _on
from tests.wp_api.test_ai_small_models import _kind


def test_the_index_is_one_line_per_tool_and_much_shorter():
    full = ai_chat.system_prompt(slim=True, typed=True)
    lean = ai_chat.system_prompt(slim=True, typed=True, index=True)
    assert "- create_wildcard: Propose a new wildcard" in lean
    assert "Example: create_wildcard" in full and "Example: create_wildcard" not in lean
    assert ai_chat.INDEX_NOTE in lean and ai_chat.INDEX_NOTE not in full
    assert len(full) - len(lean) > 8000


def _system(seen):
    return str(seen["body"]["messages"][0]["content"])


def _told(seen):
    return " ".join(str(m["content"]) for m in seen["body"]["messages"][1:])


async def test_tool_docs_come_once_with_the_step_that_offers_them(wp_client, fake_llm):
    _on(fake_llm, model_size="small", tool_format="json", lean_prompt=True)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "search", "args": json.dumps({"query": "hair"})}]},
        {"message": "", "calls": [{"tool": "search", "args": json.dumps({"query": "hat"})}]},
        {"message": "You have no hair items.", "calls": []},
    ])
    n = len(fake_llm.seen)
    out = await _chat(wp_client, "what do I have for hair?")
    acts = [x for x in fake_llm.seen[n:] if "response_format" in x["body"]
            and _kind(x) == "act"]
    assert ai_chat.INDEX_NOTE in _system(acts[0])
    assert "Example: search" not in _system(acts[0])
    told = _told(acts[-1])
    assert told.count("Tools for this step:") >= 1
    assert told.count("Example: search ") == 1  # sent once, then kept
    # The next message of the chat: still visible, not sent again.
    n = len(fake_llm.seen)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "search", "args": json.dumps({"query": "eyes"})}]},
        {"message": "None for eyes either.", "calls": []},
    ])
    await _chat(wp_client, "and for eyes?", chat_id=out["chat_id"])
    last = [x for x in fake_llm.seen[n:] if "response_format" in x["body"]][-1]
    assert _told(last).count("Example: search ") == 1


async def test_off_by_default_the_prompt_lists_every_tool(wp_client, fake_llm):
    _on(fake_llm, model_size="small", tool_format="json")
    fake_llm.chat_steps.append({"message": "Hi.", "calls": []})
    n = len(fake_llm.seen)
    await _chat(wp_client, "what do I have for hair?")
    first = fake_llm.seen[n]
    assert "Example: search" in _system(first)
    assert "Tools for this step:" not in _told(first)


async def test_a_medium_model_keeps_the_full_list(wp_client, fake_llm):
    _on(fake_llm, model_size="medium", tool_format="json", lean_prompt=True)
    fake_llm.chat_steps.append({"message": "Hi.", "calls": []})
    n = len(fake_llm.seen)
    await _chat(wp_client, "what do I have for hair?")
    assert "Example: search" in _system(fake_llm.seen[n])
