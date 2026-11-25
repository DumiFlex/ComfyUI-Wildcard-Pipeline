"""Automatic context: the model's own window instead of a chosen size."""
from __future__ import annotations

import json

from engine.ai import config as ai_config
from wp_api import _ai_client


def _on(fake_llm, model="m1"):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": model})


async def test_automatic_context_reads_the_models_own_window(wp_client, fake_llm):
    async def ask():
        return await (await wp_client.get("/wp/api/ai/context")).json()

    # LM Studio: what the model was loaded with.
    fake_llm.overrides["_ctx"] = 49152
    _on(fake_llm, "m1")
    assert ai_config.load_effective()["context_auto"] is True
    assert await ask() == {"detected": 49152, "used": 49152, "model": "m1"}
    # Ollama: what it was trained for, but no more than the safe cap.
    ai_config.update({"provider": "ollama", "base_url": str(fake_llm.make_url("")),
                      "model": "qwen:9b"})
    got = await ask()
    assert got["detected"] == 131072 and got["used"] == 32768
    fake_llm.overrides["_trained"] = 8192
    _ai_client._found_context.clear()
    assert (await ask())["used"] == 8192
    # Claude: the Models API's max_input_tokens.
    ai_config.update({"provider": "anthropic", "api_key": "sk-ant",
                      "base_url": str(fake_llm.make_url("/anthropic")), "model": "claude-x"})
    assert (await ask())["detected"] == 1000000
    # A size the user picks wins.
    ai_config.update({"provider": "ollama", "context_auto": False, "context_max": 65536})
    assert (await ask())["used"] == 65536


def test_a_changed_size_saved_before_automatic_stays(tmp_path):
    path = tmp_path / "ai.json"
    path.write_text(json.dumps({"provider": "ollama", "providers": {
        "ollama": {"context_max": 65536}, "lmstudio": {"context_max": 16384}}}))
    assert ai_config.load_effective()["context_auto"] is False
    assert ai_config.update({"provider": "lmstudio"})["context_auto"] is True
