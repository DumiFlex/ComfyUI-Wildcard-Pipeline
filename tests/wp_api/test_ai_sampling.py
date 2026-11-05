"""Optional samplers (Settings › AI assistant › Sampling) reach each server
in its own spelling, and never Claude or OpenAI itself; the assistant's
own temperatures stay."""
from __future__ import annotations

from engine.ai import config as ai_config
from tests.wp_api.test_ai_api import _chat
from wp_api import _ai_client

QWEN = {"top_k": 20, "top_p": 0.8, "min_p": 0, "repeat_penalty": 1.0}


def test_fields_per_server():
    base = {"sampling": dict(QWEN)}
    assert _ai_client.sampling_fields({**base, "api": "openai", "provider": "lmstudio",
                                       "local": True}) == QWEN
    got = _ai_client.sampling_fields({**base, "api": "openai", "provider": "openrouter",
                                      "base_url": "https://openrouter.ai/api/v1"})
    assert got["repetition_penalty"] == 1.0 and "repeat_penalty" not in got
    assert _ai_client.sampling_fields({**base, "api": "anthropic"}) == {}
    assert _ai_client.sampling_fields({**base, "api": "openai", "provider": "openai",
                                       "base_url": "https://api.openai.com/v1"}) == {}
    assert _ai_client.sampling_fields({"api": "openai", "provider": "lmstudio"}) == {}


async def test_a_chat_sends_them_beside_its_own_temperature(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "qwen3.5-9b",
                      "sampling": QWEN})
    fake_llm.chat_steps.append({"message": "Hello.", "calls": []})
    n = len(fake_llm.seen)
    await _chat(wp_client, "hi there, what can you do?")
    asks = [x["body"] for x in fake_llm.seen[n:] if "messages" in x["body"]]
    assert asks
    for body in asks:
        assert {k: body[k] for k in QWEN} == QWEN
        assert body["temperature"] in (0.15, 0.4)


async def test_ollama_gets_them_in_options(wp_client, fake_llm):
    ai_config.update({"enabled": True, "provider": "ollama",
                      "base_url": str(fake_llm.make_url("")), "model": "qwen3.5:9b",
                      "sampling": {"top_k": 20}})
    fake_llm.chat_steps.append({"message": "Hello.", "calls": []})
    n = len(fake_llm.seen)
    await _chat(wp_client, "hi there, what can you do?")
    opts = [x["body"].get("options") for x in fake_llm.seen[n:] if x["path"] == "/api/chat"]
    assert opts and all(o["top_k"] == 20 and "temperature" in o for o in opts)
