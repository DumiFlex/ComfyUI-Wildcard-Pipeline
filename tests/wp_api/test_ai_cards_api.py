"""Feature cards in a chat (`engine/ai/cards.py`, wired in `_ai_turn`): a
small model gets a card with the message that needs it, once, at the end
of the prompt; a change tool's card comes with its first failed call."""
from __future__ import annotations

import json

from tests.wp_api.test_ai_api import _chat, _two_wildcards
from tests.wp_api.test_ai_prefix_stable import _extends, _messages, _on


def _users(seen, n):
    return [m["content"] for x in seen[n:] if "messages" in x["body"]
            for m in x["body"]["messages"] if m.get("role") == "user"]


async def test_a_card_rides_with_the_message_once(wp_client, fake_llm):
    await _two_wildcards(wp_client)
    _on(fake_llm)
    fake_llm.chat_steps.append({"message": "Use a constraint with exclude.", "calls": []})
    n = len(fake_llm.seen)
    first = await _chat(wp_client, "never give a longsword to a mage")
    fake_llm.chat_steps.append({"message": "Still a constraint.", "calls": []})
    await _chat(wp_client, "and never an oak staff to a warrior", chat_id=first["chat_id"])
    last = "\n".join(_users(fake_llm.seen[-1:], 0))
    assert last.count("- Constraints: A constraint links") == 1  # sent once, kept in the log
    assert "Derivation rules" not in last  # "and" is not AND
    asks = [_messages(x) for x in fake_llm.seen[n:] if "messages" in x["body"]]
    for i in range(1, len(asks)):
        assert _extends(asks[i - 1], asks[i])


async def test_a_large_model_gets_no_cards(wp_client, fake_llm):
    await _two_wildcards(wp_client)
    _on(fake_llm)
    from engine.ai import config as ai_config
    ai_config.update({"model_size": "large"})
    fake_llm.chat_steps.append({"message": "Use a constraint.", "calls": []})
    n = len(fake_llm.seen)
    await _chat(wp_client, "never give a longsword to a mage")
    assert not any("Notes for this ask" in u for u in _users(fake_llm.seen, n))


async def test_a_failed_change_call_brings_its_card(wp_client, fake_llm):
    await _two_wildcards(wp_client)
    _on(fake_llm)
    bad = {"tool": "create_derivation", "args": json.dumps({"name": "Cloaks"})}
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [bad]},
        {"message": "", "calls": [{**bad, "args": json.dumps({"name": "Cloaks", "x": 1})}]},
        {"message": "That didn't work.", "calls": []},
    ])
    n = len(fake_llm.seen)
    await _chat(wp_client, "hello, make me a cloak item")
    last = [x for x in fake_llm.seen[n:] if "messages" in x["body"]][-1]
    text = "\n".join(str(m.get("content")) for m in last["body"]["messages"])
    assert text.count("(Note: Derivation rules: A derivation rule is") == 1, text[-2000:]


async def test_the_tools_a_card_names_are_offered(wp_client, fake_llm):
    from tests.wp_api.test_ai_plan_items import _offered
    from tests.wp_api.test_ai_small_models import _kind

    await _two_wildcards(wp_client)
    _on(fake_llm)
    for text, want in (("rename the variable weapon to arms", {"variables", "edit_options"}),
                       ("never give a longsword to a mage", {"create_constraint"})):
        fake_llm.chat_steps.append({"message": "Noted.", "calls": []})
        n = len(fake_llm.seen)
        await _chat(wp_client, text)
        acts = [x for x in fake_llm.seen[n:] if "response_format" in x["body"]
                and _kind(x) == "act"]
        assert acts and want <= set(_offered(acts[0])), (text, _offered(acts[0]))


async def test_a_plan_has_room_for_the_item_a_card_brings(wp_client, fake_llm):
    from tests.wp_api.test_ai_small_models import _schema

    _on(fake_llm)
    fake_llm.chat_steps.append({"message": "", "calls": [{"tool": "plan_items", "args": json.dumps(
        {"items": [{"tool": "create_wildcard", "name": "Setting", "about": "places"}]})}]})
    fake_llm.chat_steps.append({"message": "Planned.", "calls": []})
    n = len(fake_llm.seen)
    await _chat(wp_client, "Make a Setting wildcard (beach, office, forest) and an Outfit "
                "wildcard with outfits tagged by the setting they suit, then make each "
                "setting get only outfits that suit it.")
    plan = next(x for x in fake_llm.seen[n:] if "response_format" in x["body"])
    items = _schema(plan)["properties"]["calls"]["items"]
    args = (items.get("anyOf") or [items])[0]["properties"]["args"]["properties"]["items"]
    assert args["maxItems"] == 3
    assert "create_constraint" in args["items"]["properties"]["tool"]["enum"]
