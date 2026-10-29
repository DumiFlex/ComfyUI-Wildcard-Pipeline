"""engine/ai/note.py — the "About my library" note."""
from __future__ import annotations

import pytest

from engine.ai import config as ai_config
from engine.ai import note as ai_note


def test_clean_trims_and_caps():
    assert ai_note.clean(None) == "" and ai_note.clean(42) == ""
    assert ai_note.clean("  a  \r\n\n\n\nb​ ") == "a\n\nb"
    assert len(ai_note.clean("x" * 900)) == ai_note.MAX_CHARS


def test_section_only_when_there_is_a_note():
    assert ai_note.section("") == "" and ai_note.section("   ") == ""
    out = ai_note.with_note("RULES", "Booru tags, lowercase.")
    assert out.startswith("RULES\n\n" + ai_note.HEAD)
    assert out.endswith("\nBooru tags, lowercase.")


def test_suggest_prompt_and_answer():
    prompt = ai_note.suggest_prompt("The library now:\nCounts: 2 wildcard", "Old note")
    assert "Counts: 2 wildcard" in prompt and "Old note" in prompt
    assert "so far" not in ai_note.suggest_prompt("x")
    assert ai_note.suggested({"note": '- I use booru tags.\n2. Names are Title Case.'}) \
        == "I use booru tags.\nNames are Title Case."
    assert ai_note.suggested({"nope": 1}) == "" and ai_note.suggested(None) == ""


def test_samples_quote_option_text_not_variable_names():
    rows = [
        {"type": "wildcard", "name": "Hair Colour", "updated_at": "2",
         "payload": {"var_binding": "hair_colour",
                     "options": [{"value": "red hair"}, {"value": "silver hair"}]}},
        {"type": "fixed_values", "name": "Q", "payload": {}},
        {"type": "wildcard", "name": "Empty", "payload": {"options": []}},
    ]
    out = ai_note.samples(rows)
    assert "- Hair Colour: red hair | silver hair" in out
    assert "joined with spaces" in out and "lowercase" in out and "no commas" in out
    assert "hair_colour" not in out
    assert ai_note.samples([]) == ""
    tagged = ai_note.samples([{"type": "wildcard", "name": "H", "payload": {
        "options": [{"value": "red_hair"}, {"value": "Long_Hair"}]}}])
    assert "underscores" in tagged and "lowercase" not in tagged
    assert "Sample options" in ai_note.suggest_prompt("x", "", out)


@pytest.fixture
def _cfg(tmp_path, monkeypatch):
    monkeypatch.setenv("WP_AI_CONFIG_PATH", str(tmp_path / "ai.json"))


def test_config_keeps_the_note_shared(_cfg):
    assert ai_config.public_view()["library_note"] == ""
    ai_config.update({"library_note": " My names are snake_case. "})
    assert ai_config.public_view()["library_note"] == "My names are snake_case."
    # Shared, not per provider or model.
    ai_config.update({"provider": "ollama", "model": "other"})
    assert ai_config.load_effective()["library_note"] == "My names are snake_case."
    ai_config.update({"library_note": None})
    assert ai_config.public_view()["library_note"] == ""


def test_config_refuses_bad_notes(_cfg):
    with pytest.raises(ai_config.ConfigError, match="text"):
        ai_config.update({"library_note": 3})
    with pytest.raises(ai_config.ConfigError, match="longer than 600"):
        ai_config.update({"library_note": "x" * 601})
    with pytest.raises(ai_config.ConfigError, match="minor"):
        ai_config.update({"library_note": "nsfw pack of underage girls"})
    # Blank lines and spaces don't count against the cap.
    ai_config.update({"library_note": "x" * 600 + "\n\n\n\n   "})
