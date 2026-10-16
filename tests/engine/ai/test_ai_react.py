"""Reactions: which messages skip the model, and what `react` accepts."""
from __future__ import annotations

import pytest

from engine.ai import chatlog, react


@pytest.mark.parametrize(("text", "emoji"), [
    ("thanks!", "❤️"), ("Thank you so much", "❤️"), ("perfect, thanks!", "❤️"),
    ("ty", "❤️"), ("ok thanks", "❤️"), ("awesome thx", "❤️"),
    ("that works perfectly, thank you", "❤️"),
    ("love it", "🎉"), ("great job!", "🎉"), ("Perfect", "🎉"),
    ("👍", "👍"), ("❤️❤️", "❤️"), ("thanks 🙏", "🙏"),
])
def test_thanks_and_praise_get_a_reaction(text, emoji):
    assert react.quick(text) == emoji


@pytest.mark.parametrize("text", [
    "yes", "ok", "sure", "do it", "sure thanks", "no thanks", "thanks?",
    "thanks, now make another", "🤔", "", "thanks " * 20,
])
def test_answers_and_requests_reach_the_model(text):
    assert react.quick(text) == ""


def test_clean_takes_only_the_fixed_set():
    assert react.clean("❤") == "❤️"
    assert react.clean(" 👍 ") == "👍"
    assert react.clean("🤡") == "" and react.clean(None) == ""


def test_asides_are_never_rendered_but_are_displayed():
    log = [
        chatlog.user_entry("make hair", "make hair", []),
        chatlog.step_entry("Done.", []),
        chatlog.shown_entry({"message": "Done.", "proposals": [], "steps": [], "refs": {},
                             "model": "m", "reaction": "🎉"}),
        chatlog.aside_entry("thanks!", "❤️"),
    ]
    rendered = chatlog.render(log, {})
    assert "thanks" not in str(rendered)
    turns = chatlog.display(log, {})
    assert turns[0] == {"role": "user", "text": "make hair", "reaction": "🎉"}
    assert turns[2] == {"role": "user", "text": "thanks!", "reaction": "❤️", "aside": True}
