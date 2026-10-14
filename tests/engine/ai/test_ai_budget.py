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


def test_a_window_fit_leaves_room_for_a_turn():
    # 16k tokens is about 52k characters; the turn's reserve comes off it.
    assert budget.fits(30000, 16384)
    assert not budget.fits(50000, 16384)
    assert budget.room_chars(16384, 50000) == 2000  # never below the floor
    assert budget.room_chars(65536, 30000) > 150000
    assert budget.suggest_window(50000) == 32768


def test_overflow_reads_the_servers_own_count():
    lmstudio = ('the server answered 500: Engine protocol predict request returned 400: '
                '{"error":{"code":400,"message":"request (17339 tokens) exceeds the available '
                'context size (16384 tokens), try increasing it","type":"exceed_context_size_'
                'error","n_prompt_tokens":17339,"n_ctx":16')
    assert budget.overflow(lmstudio) == (17339, 16384)
    assert budget.overflow('{"n_prompt_tokens": 9000, "n_ctx": 8192}') == (9000, 8192)
    assert budget.overflow("This model's maximum context length is 16384 tokens. However, "
                           "you requested 17339 tokens (17000 in the messages)") == (17339, 16384)
    assert budget.overflow("exceed_context_size_error") == (0, 0)
    assert budget.overflow("the server refused the API key") is None
