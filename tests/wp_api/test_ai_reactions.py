"""Chat reactions: thanks skips the model, and the model's `react` tool."""
from __future__ import annotations

import json

from tests.wp_api.test_ai_api import _chat
from tests.wp_api.test_ai_chats import _json, _on


async def test_thanks_gets_a_reaction_without_a_model_call(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.extend([{"message": "Made it.", "calls": []},
                                {"message": "Sure.", "calls": []}])
    first = await _chat(wp_client, "make a hair wildcard")
    calls = len(fake_llm.seen)
    out = await _chat(wp_client, "thanks!", chat_id=first["chat_id"])
    assert out["aside"] is True and out["reaction"] == "❤️" and out["message"] == ""
    assert len(fake_llm.seen) == calls  # no model call
    # The model never reads it: the next request looks as if it wasn't sent.
    await _chat(wp_client, "and a colour one", chat_id=first["chat_id"])
    assert "thanks!" not in json.dumps(fake_llm.seen[-1]["body"])
    chat = await _json(await wp_client.get(f"/wp/api/ai/chats/{first['chat_id']}"))
    assert chat["turns"][2] == {"role": "user", "text": "thanks!", "reaction": "❤️",
                                "aside": True}


async def test_thanks_after_a_question_still_reaches_the_model(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.extend([{"message": "Warm or cold colours?", "calls": []},
                                {"message": "Ok.", "calls": []}])
    first = await _chat(wp_client, "make a hair wildcard")
    out = await _chat(wp_client, "great", chat_id=first["chat_id"])
    assert "aside" not in out and out["message"] == "Ok."


async def test_the_model_can_react_and_say_nothing(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "react", "args": json.dumps({"emoji": "🎉"})}]},
        {"message": "", "calls": []},
    ])
    out = await _chat(wp_client, "It finally works, the whole pack renders!")
    assert out["reaction"] == "🎉" and out["message"] == "" and out["steps"] == []
    chat = await _json(await wp_client.get(f"/wp/api/ai/chats/{out['chat_id']}"))
    assert chat["turns"][0]["reaction"] == "🎉"
    assert chat["turns"][1]["view"]["reaction"] == "🎉"
