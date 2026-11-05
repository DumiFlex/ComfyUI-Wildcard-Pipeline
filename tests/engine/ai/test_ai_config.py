"""engine/ai/config.py — AI assistant settings and the write-only key."""
from __future__ import annotations

import json

import pytest

from engine.ai import config as ai_config


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("WP_AI_CONFIG_PATH", str(tmp_path / "ai.json"))
    for var in ("WP_AI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.delenv(var, raising=False)
    return tmp_path / "ai.json"


def test_off_by_default():
    view = ai_config.public_view()
    assert view["enabled"] is False
    assert view["provider"] == "ollama"
    assert view["key_set"] is False


def test_key_is_write_only(_isolated):
    view = ai_config.update({"provider": "anthropic", "api_key": "sk-secret"})
    assert view["key_set"] is True
    assert "api_key" not in view
    assert "sk-secret" not in json.dumps(ai_config.public_view())
    # It is on disk for the client, and only there.
    assert ai_config.load_effective()["api_key"] == "sk-secret"
    assert json.loads(_isolated.read_text())["providers"]["anthropic"]["api_key"] == "sk-secret"


def test_empty_key_removes_it():
    ai_config.update({"provider": "openai", "api_key": "sk-1"})
    view = ai_config.update({"api_key": ""})
    assert view["key_set"] is False


def test_each_provider_keeps_its_own_key_address_and_model():
    ai_config.update({"provider": "openai", "api_key": "sk-1", "model": "gpt-x",
                      "base_url": "https://example.test/v1"})
    view = ai_config.update({"provider": "anthropic"})
    # The OpenAI settings don't leak into Claude's...
    assert view["key_set"] is False
    assert view["model"] == ""
    assert view["base_url"] == ""
    assert view["keys_saved"] == ["openai"]
    ai_config.update({"api_key": "sk-ant", "model": "claude-x"})
    assert ai_config.load_effective()["api_key"] == "sk-ant"
    # ...and switching back brings them back.
    view = ai_config.update({"provider": "openai"})
    assert view["key_set"] is True
    assert view["model"] == "gpt-x"
    assert view["base_url"] == "https://example.test/v1"
    assert view["keys_saved"] == ["anthropic", "openai"]
    assert ai_config.load_effective()["api_key"] == "sk-1"


def test_old_flat_file_is_read_as_its_providers_settings():
    ai_config.config_path().write_text(json.dumps({
        "enabled": True, "provider": "openai", "base_url": "https://example.test/v1",
        "model": "gpt-x", "api_key": "sk-old", "unload_after_s": 30,
    }), encoding="utf-8")
    cfg = ai_config.load_effective()
    assert cfg["api_key"] == "sk-old"
    assert cfg["model"] == "gpt-x"
    ai_config.update({"provider": "ollama"})
    view = ai_config.update({"provider": "openai"})
    assert view["key_set"] is True and view["model"] == "gpt-x"
    assert "api_key" not in json.loads(ai_config.config_path().read_text())


def test_public_view_never_carries_any_key():
    ai_config.update({"provider": "openai", "api_key": "sk-1"})
    ai_config.update({"provider": "anthropic", "api_key": "sk-2"})
    text = json.dumps(ai_config.public_view())
    assert "sk-1" not in text and "sk-2" not in text


def test_env_key_wins_and_is_reported(monkeypatch):
    ai_config.update({"provider": "anthropic", "api_key": "saved"})
    monkeypatch.setenv("ANTHROPIC_API_KEY", "from-env")
    assert ai_config.load_effective()["api_key"] == "from-env"
    assert ai_config.public_view()["key_from_env"] is True


def test_preset_address_fills_an_empty_one():
    ai_config.update({"provider": "lmstudio"})
    cfg = ai_config.load_effective()
    assert cfg["base_url"] == "http://127.0.0.1:1234/v1"
    assert cfg["api"] == "openai"
    assert cfg["local"] is True


@pytest.mark.parametrize("url, message", [
    ("ftp://host", "http"),
    ("http://user:pw@host", "API key field"),
    ("http://host/v1?x=1", "query"),
])
def test_bad_addresses_are_refused(url, message):
    with pytest.raises(ai_config.ConfigError, match=message):
        ai_config.update({"base_url": url})


def test_unknown_provider_refused():
    with pytest.raises(ai_config.ConfigError):
        ai_config.update({"provider": "skynet"})


def test_unload_after_is_clamped():
    assert ai_config.update({"unload_after_s": 99999})["unload_after_s"] == 3600
    assert ai_config.update({"unload_after_s": -5})["unload_after_s"] == 0


def test_corrupt_file_degrades_to_defaults(_isolated):
    _isolated.write_text("{not json")
    assert ai_config.public_view()["enabled"] is False


def test_tool_format(tmp_path, monkeypatch):
    monkeypatch.setenv("WP_AI_CONFIG_PATH", str(tmp_path / "ai.json"))
    assert ai_config.public_view()["tool_format"] == "auto"
    assert ai_config.update({"tool_format": "json"})["tool_format"] == "json"
    assert ai_config.load_effective()["tool_format"] == "json"
    with pytest.raises(ai_config.ConfigError):
        ai_config.update({"tool_format": "xml"})


def test_thinking_levels(tmp_path, monkeypatch):
    monkeypatch.setenv("WP_AI_CONFIG_PATH", str(tmp_path / "ai.json"))
    assert ai_config.public_view()["thinking"] == "auto"
    for level in ("off", "on", "low", "medium", "high", "xhigh", "max", "auto"):
        assert ai_config.update({"thinking": level})["thinking"] == level
    ai_config.update({"thinking": "high"})
    assert ai_config.load_effective()["thinking"] == "high"
    with pytest.raises(ai_config.ConfigError):
        ai_config.update({"thinking": "ultra"})


def test_samplers_are_optional_per_provider_and_checked():
    view = ai_config.update({"provider": "lmstudio", "sampling": {
        "top_k": 20, "top_p": 0.8, "min_p": 0, "repeat_penalty": 1.0}})
    assert view["sampling"] == {"top_k": 20, "top_p": 0.8, "min_p": 0.0, "repeat_penalty": 1.0}
    view = ai_config.update({"sampling": {"min_p": None, "presence_penalty": 0.5}})
    assert view["sampling"] == {"top_k": 20, "top_p": 0.8, "repeat_penalty": 1.0,
                                "presence_penalty": 0.5}
    # Another provider has its own (none); switching back keeps them.
    assert ai_config.update({"provider": "ollama"})["sampling"] == {}
    assert ai_config.update({"provider": "lmstudio"})["sampling"]["top_k"] == 20
    for bad in ({"top_k": 2.5}, {"top_p": 1.5}, {"temperature": 0.7}, {"min_p": True},
                {"repeat_penalty": "1.1"}):
        with pytest.raises(ai_config.ConfigError):
            ai_config.update({"sampling": bad})
    with pytest.raises(ai_config.ConfigError):
        ai_config.update({"sampling": [1]})


def test_a_hand_edited_sampler_out_of_range_is_dropped(_isolated):
    _isolated.write_text(json.dumps({"provider": "lmstudio", "providers": {"lmstudio": {
        "model": "m", "sampling": {"top_k": 20, "top_p": 7, "nope": 1}}}}), encoding="utf-8")
    assert ai_config.load_effective()["sampling"] == {"top_k": 20}


def test_model_settings_follow_the_provider():
    # The bug: Medium thinking set for Claude stuck when switching to a
    # LM Studio Qwen that only takes on/off.
    ai_config.update({"provider": "anthropic", "model": "claude-sonnet-5-5"})
    ai_config.update({"thinking": "medium", "model_size": "large", "context_max": 65536,
                      "tool_format": "native"})
    view = ai_config.update({"provider": "lmstudio", "model": "qwen/qwen3.5-9b"})
    assert view["thinking"] == "auto"
    assert view["model_size"] == "auto"
    assert view["context_max"] == 16384
    assert view["tool_format"] == "auto"
    ai_config.update({"thinking": "off", "context_max": 32768, "choose_first": True,
                      "lean_prompt": True, "unload_after_s": 300,
                      "sampling": {"top_k": 20}})
    view = ai_config.update({"provider": "anthropic"})
    assert (view["thinking"], view["model_size"], view["context_max"]) == ("medium", "large", 65536)
    assert view["choose_first"] is False and view["lean_prompt"] is False
    assert view["unload_after_s"] == 60 and view["sampling"] == {}
    view = ai_config.update({"provider": "lmstudio"})
    assert (view["thinking"], view["context_max"], view["unload_after_s"]) == ("off", 32768, 300)
    assert view["choose_first"] is True and view["lean_prompt"] is True
    assert ai_config.load_effective()["sampling"] == {"top_k": 20}


def test_each_model_keeps_its_own_settings():
    ai_config.update({"provider": "lmstudio", "model": "dumi/qwen3.8-27b-effort"})
    ai_config.update({"thinking": "medium", "model_size": "medium", "context_max": 32768,
                      "lean_prompt": False})
    # A model with nothing saved keeps the provider's values, but Thinking
    # and model size start at automatic.
    view = ai_config.update({"model": "qwen/qwen3.5-9b"})
    assert (view["thinking"], view["model_size"], view["context_max"]) == ("auto", "auto", 32768)
    ai_config.update({"thinking": "on", "lean_prompt": True})
    view = ai_config.update({"model": "dumi/qwen3.8-27b-effort"})
    assert (view["thinking"], view["model_size"]) == ("medium", "medium")
    assert view["lean_prompt"] is False
    view = ai_config.update({"model": "qwen/qwen3.5-9b"})
    assert (view["thinking"], view["lean_prompt"]) == ("on", True)
    # Shared settings stay shared.
    ai_config.update({"allow_delete": True})
    assert ai_config.update({"provider": "ollama"})["allow_delete"] is True


def test_settings_from_before_per_provider_ones_are_kept(_isolated):
    _isolated.write_text(json.dumps({
        "enabled": True, "provider": "anthropic", "thinking": "medium", "context_max": 65536,
        "tool_format": "json", "unload_after_s": 120, "choose_first": True,
        "providers": {"anthropic": {"model": "claude-x", "model_size": "large"},
                      "lmstudio": {"model": "qwen/qwen3.5-9b"}},
    }), encoding="utf-8")
    view = ai_config.public_view()
    assert (view["thinking"], view["context_max"], view["tool_format"]) == ("medium", 65536, "json")
    assert view["model_size"] == "large" and view["choose_first"] is True
    # Another provider gets the old values except Thinking, which was set
    # for the provider in use then.
    view = ai_config.update({"provider": "lmstudio"})
    assert (view["thinking"], view["context_max"], view["tool_format"]) == ("auto", 65536, "json")
    assert view["unload_after_s"] == 120 and view["model_size"] == "auto"
    stored = json.loads(_isolated.read_text())
    assert "thinking" not in stored and "context_max" not in stored


def test_only_so_many_models_are_remembered():
    ai_config.update({"provider": "ollama"})
    for i in range(ai_config.MODELS_KEPT + 5):
        ai_config.update({"model": f"m{i}", "thinking": "on"})
    stored = json.loads(ai_config.config_path().read_text())
    models = stored["providers"]["ollama"]["models"]
    assert len(models) == ai_config.MODELS_KEPT
    assert "m0" not in models and f"m{ai_config.MODELS_KEPT + 4}" in models
