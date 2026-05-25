"""PromptCleaner orchestrator — composes rules per intensity + overrides."""
from engine.cleaner.pipeline import INTENSITY_TO_RULES, PromptCleaner
from engine.cleaner.tokenize import count_chars, count_words


def test_gentle_runs_only_whitespace():
    out = PromptCleaner().run("foo  bar", {"mode": "tags", "intensity": "gentle"})
    assert out["text"] == "foo bar"
    assert list(out["report"].keys()) == ["whitespace"]


def test_balanced_runs_default_rules():
    out = PromptCleaner().run("foo, foo, bar", {"mode": "tags", "intensity": "balanced"})
    assert out["text"] == "foo, bar"
    assert set(out["report"].keys()) == {"whitespace", "punctuation", "dedupe_exact"}


def test_aggressive_runs_all_non_blocklist_rules():
    out = PromptCleaner().run("foo, foo, bar", {"mode": "tags", "intensity": "aggressive"})
    assert "fuzzy_dedupe" in out["report"]
    assert "blocklist" not in out["report"]


def test_rules_override_turns_rule_off():
    out = PromptCleaner().run(
        "foo, foo",
        {
            "mode": "tags",
            "intensity": "balanced",
            "rules_override": {"dedupe_exact": False},
        },
    )
    assert "dedupe_exact" not in out["report"]


def test_rules_override_turns_rule_on():
    out = PromptCleaner().run(
        "foo, foo, bar",
        {
            "mode": "tags",
            "intensity": "gentle",
            "rules_override": {"dedupe_exact": True},
        },
    )
    assert out["text"] == "foo, bar"
    assert "dedupe_exact" in out["report"]


def test_blocklist_auto_enables_when_entries_present():
    out = PromptCleaner().run(
        "watermark, blue",
        {
            "mode": "tags",
            "intensity": "balanced",
            "blocklist": {"kind": "list", "entries": ["watermark"]},
        },
    )
    assert out["text"] == "blue"
    assert "blocklist" in out["report"]


def test_blocklist_override_off_beats_entries():
    out = PromptCleaner().run(
        "watermark, blue",
        {
            "mode": "tags",
            "intensity": "balanced",
            "blocklist": {"kind": "list", "entries": ["watermark"]},
            "rules_override": {"blocklist": False},
        },
    )
    assert out["text"] == "watermark, blue"
    assert "blocklist" not in out["report"]


def test_determinism_byte_identical_across_runs():
    text = "foo,  bar, foo, baz"
    config = {"mode": "tags", "intensity": "aggressive"}
    runs = [PromptCleaner().run(text, config) for _ in range(20)]
    first = runs[0]["text"]
    assert all(r["text"] == first for r in runs)


def test_count_words_basic():
    assert count_words("foo bar baz") == 3
    assert count_words("") == 0


def test_count_chars_basic():
    assert count_chars("hello") == 5
    assert count_chars("") == 0


def test_intensity_map():
    assert set(INTENSITY_TO_RULES.keys()) == {"gentle", "balanced", "aggressive"}
    assert INTENSITY_TO_RULES["aggressive"] == [
        "whitespace", "punctuation", "dedupe_exact", "fuzzy_dedupe",
    ]
