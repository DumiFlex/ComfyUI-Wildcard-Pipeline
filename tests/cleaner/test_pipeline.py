"""PromptCleaner orchestrator — composes rules per intensity + overrides."""
from engine.cleaner.pipeline import INTENSITY_TO_RULES, PromptCleaner
from engine.cleaner.tokenize import count_chars, count_words
from engine.cleaner.types import CleanerCtx


def test_gentle_runs_only_whitespace():
    cleaner = PromptCleaner()
    out = cleaner.run(
        "foo  bar",
        config={"mode": "tags", "intensity": "gentle"},
    )
    assert out["text"] == "foo bar"
    assert list(out["report"].keys()) == ["whitespace"]


def test_balanced_runs_4_default_rules():
    cleaner = PromptCleaner()
    out = cleaner.run(
        "foo, foo, bar",
        config={"mode": "tags", "intensity": "balanced"},
    )
    assert out["text"] == "foo, bar"
    assert set(out["report"].keys()) == {
        "whitespace", "dedupe_exact", "wp_dedupe", "null_slot",
    }


def test_aggressive_runs_all_non_blocklist_rules():
    cleaner = PromptCleaner()
    out = cleaner.run(
        "foo, foo, bar",
        config={"mode": "tags", "intensity": "aggressive"},
    )
    assert "fuzzy_dedupe" in out["report"]
    assert "reorder" in out["report"]
    assert "dangling_var" in out["report"]
    assert "blocklist" not in out["report"]


def test_rules_override_turns_rule_off():
    cleaner = PromptCleaner()
    out = cleaner.run(
        "foo, foo",
        config={
            "mode": "tags",
            "intensity": "balanced",
            "rules_override": {"dedupe_exact": False},
        },
    )
    assert "dedupe_exact" not in out["report"]


def test_rules_override_turns_rule_on():
    cleaner = PromptCleaner()
    out = cleaner.run(
        "foo",
        config={
            "mode": "tags",
            "intensity": "gentle",
            "rules_override": {"reorder": True},
        },
    )
    assert "reorder" in out["report"]


def test_blocklist_auto_enables_when_entries_present():
    cleaner = PromptCleaner()
    out = cleaner.run(
        "watermark, blue",
        config={
            "mode": "tags",
            "intensity": "balanced",
            "blocklist": {"kind": "list", "entries": ["watermark"]},
        },
    )
    assert out["text"] == "blue"
    assert "blocklist" in out["report"]


def test_ctx_passed_to_wp_aware_rules():
    cleaner = PromptCleaner()
    ctx = CleanerCtx(picks={"wc_hair": {"value": "pixie cut"}})
    out = cleaner.run(
        "portrait, pixie cut",
        ctx=ctx,
        config={"mode": "tags", "intensity": "balanced"},
    )
    assert out["text"] == "portrait"


def test_count_words_basic():
    assert count_words("foo bar baz") == 3
    assert count_words("") == 0
    assert count_words("hello, world!") == 2


def test_count_chars_basic():
    assert count_chars("hello") == 5
    assert count_chars("") == 0


def test_intensity_map_has_three_presets():
    assert set(INTENSITY_TO_RULES.keys()) == {"gentle", "balanced", "aggressive"}
