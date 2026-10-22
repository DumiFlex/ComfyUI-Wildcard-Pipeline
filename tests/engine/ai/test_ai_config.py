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
    for level in ("off", "low", "medium", "high", "auto"):
        assert ai_config.update({"thinking": level})["thinking"] == level
    ai_config.update({"thinking": "high"})
    assert ai_config.load_effective()["thinking"] == "high"
    with pytest.raises(ai_config.ConfigError):
        ai_config.update({"thinking": "max"})
