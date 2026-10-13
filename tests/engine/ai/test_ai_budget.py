"""engine/ai/budget.py — context sizing and model-size profiles."""
from __future__ import annotations

from engine.ai import budget


def test_size_from_the_model_name():
    assert budget.size_from_name("huihui_ai/qwen3.5-abliterated:9b") == "small"
    assert budget.size_from_name("hf.co/igorls/gemma-4-12B-it-heretic-GGUF:Q4_K_M") == "small"
    assert budget.size_from_name("HammerAI/cydonia-v4.3:24b-q4_K_M") == "medium"
    # A mixture of experts counts its total size, not the active "a3b".
    assert budget.size_from_name("Qwen3.6-35B-A3B-uncensored-heretic") == "medium"
    assert budget.size_from_name("gemma-4-26b-a4b-it") == "medium"
    assert budget.size_from_name("gpt-oss:120b") == "large"
    assert budget.size_from_name("mistral-nemo") is None


def test_model_size_prefers_the_setting_then_the_name():
    assert budget.model_size({"model": "x:9b", "local": True, "model_size": "large"}) == "large"
    assert budget.model_size({"model": "x:9b", "local": True, "model_size": "auto"}) == "small"
    assert budget.model_size({"model": "mystery", "local": True}) == "medium"
    assert budget.model_size({"model": "claude-x", "local": False}) == "large"
    assert budget.profile({"model": "x:9b", "local": True})["slim"] is True


def test_num_ctx_fits_the_prompt_within_the_cap():
    assert budget.num_ctx(1000, 16384) == 4096
    assert budget.num_ctx(20000, 16384) == 16384  # ~6.3k tokens + answer room
    assert budget.num_ctx(200000, 16384) == 16384  # capped
    assert budget.num_ctx(100000, 131072) == 65536


def test_clip():
    text = "\n".join(f"line {i}" for i in range(200))
    out = budget.clip(text, 100)
    assert out.startswith("line 0") and "more lines left out" in out
    assert budget.clip("short", 100) == "short"
