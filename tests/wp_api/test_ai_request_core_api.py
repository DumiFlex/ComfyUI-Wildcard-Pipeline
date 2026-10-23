"""Request-dependent shortlists in a chat (`_ai_turn._offer`, harness notes
H3 + H5): a question's steps never offer a change tool, even after reading
an item; a task gets `run_test` once it made a card and the docs once a
call failed."""
from __future__ import annotations

import json

from engine.ai import tools as ai_tools
from tests.wp_api.test_ai_api import _chat, _two_wildcards
from tests.wp_api.test_ai_narrow_api import _acts
from tests.wp_api.test_ai_plan_items import _offered
from tests.wp_api.test_ai_prefix_stable import _on


async def test_a_question_is_never_offered_a_change(wp_client, fake_llm):
    _src, tgt = await _two_wildcards(wp_client)
    _on(fake_llm)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "read", "args": json.dumps({"id": tgt})}]},
        {"message": "Weapon rolls one of two options.", "calls": []},
    ])
    n = len(fake_llm.seen)
    body = await _chat(wp_client, "how does my Weapon wildcard pick a weapon?")
    assert not body.get("proposals")
    acts = _acts(fake_llm, n)
    assert len(acts) >= 2
    for a in acts:
        offered = _offered(a)
        assert "more_tools" in offered
        assert not [t for t in offered if t in ai_tools.CHANGE]
    assert "explain" in _offered(acts[0])


async def test_a_task_gets_a_test_after_its_card(wp_client, fake_llm):
    _src, tgt = await _two_wildcards(wp_client)
    _on(fake_llm)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "add_options", "args": json.dumps(
            {"id": tgt, "options": [{"text": "war axe"}]})}]},
        {"message": "I've proposed a war axe.", "calls": []},
    ])
    n = len(fake_llm.seen)
    body = await _chat(wp_client, "add a war axe to my Weapon")
    assert [p["tool"] for p in body["proposals"]] == ["add_options"]
    acts = _acts(fake_llm, n)
    assert "run_test" not in _offered(acts[0])
    assert "explain" not in _offered(acts[0])
    assert "run_test" in _offered(acts[1])


async def test_a_failed_call_brings_the_docs(wp_client, fake_llm):
    _src, _tgt = await _two_wildcards(wp_client)
    _on(fake_llm)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "add_options", "args": json.dumps(
            {"id": "ffffffff", "options": [{"text": "war axe"}]})}]},
        {"message": "I couldn't find it.", "calls": []},
    ])
    n = len(fake_llm.seen)
    await _chat(wp_client, "add a war axe to my Weapon")
    acts = _acts(fake_llm, n)
    assert "docs_search" not in _offered(acts[0])
    assert "docs_search" in _offered(acts[1])
