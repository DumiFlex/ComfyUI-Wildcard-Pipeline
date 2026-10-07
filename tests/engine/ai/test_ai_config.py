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
    assert json.loads(_isolated.read_text())["api_key"] == "sk-secret"


def test_empty_key_removes_it():
    ai_config.update({"provider": "openai", "api_key": "sk-1"})
    view = ai_config.update({"api_key": ""})
    assert view["key_set"] is False


def test_switching_provider_drops_key_address_and_model():
    ai_config.update({"provider": "openai", "api_key": "sk-1", "model": "gpt-x",
                      "base_url": "https://example.test/v1"})
    view = ai_config.update({"provider": "anthropic"})
    assert view["key_set"] is False
    assert view["model"] == ""
    assert view["base_url"] == ""


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
