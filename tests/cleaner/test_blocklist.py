"""Blocklist rule — drop tags matching a user list or regex set."""
from engine.cleaner.rules.blocklist import apply


def test_list_drops_exact_tag_match():
    result = apply(
        "watermark, brown eyes, lowres",
        mode="tags",
        config={"blocklist": {"kind": "list", "entries": ["watermark", "lowres"]}},
    )
    assert result["text"] == "brown eyes"
    assert sorted(result["stats"]["dropped"]) == ["lowres", "watermark"]


def test_list_case_insensitive():
    result = apply(
        "Watermark, blue",
        mode="tags",
        config={"blocklist": {"kind": "list", "entries": ["watermark"]}},
    )
    assert result["text"] == "blue"


def test_list_text_mode_substring():
    result = apply(
        "a cat sat near catcher",
        mode="text",
        config={"blocklist": {"kind": "list", "entries": ["cat"]}},
    )
    # Post-strip cleanup collapses the double-space artifact.
    assert result["text"] == "a sat near catcher"


def test_list_empty_entries_no_op():
    result = apply(
        "watermark",
        mode="tags",
        config={"blocklist": {"kind": "list", "entries": []}},
    )
    assert result["text"] == "watermark"
    assert result["stats"]["dropped"] == []


def test_regex_drops_matching_tag():
    result = apply(
        "watermark, brown eyes",
        mode="tags",
        config={"blocklist": {"kind": "regex", "entries": [r"water.*"]}},
    )
    assert result["text"] == "brown eyes"
    assert result["stats"]["dropped"] == ["watermark"]


def test_regex_bad_pattern_logged_not_raised():
    result = apply(
        "watermark, brown eyes",
        mode="tags",
        config={"blocklist": {"kind": "regex", "entries": ["[unterminated", "water.*"]}},
    )
    assert result["text"] == "brown eyes"
    assert "[unterminated" in result["stats"]["errors"]


def test_regex_text_mode_strips_matches():
    result = apply(
        "see watermark and stuff",
        mode="text",
        config={"blocklist": {"kind": "regex", "entries": [r"water\S+"]}},
    )
    assert result["text"] == "see and stuff"


def test_text_mode_strips_adjacent_punctuation_after_match():
    """`cfg, steps. avoid` minus `steps` should not leave orphan `. ` ."""
    result = apply(
        "cfg, steps. avoid",
        mode="text",
        config={"blocklist": {"kind": "list", "entries": ["steps"]}},
    )
    assert result["text"] == "cfg, avoid"


def test_missing_blocklist_config_no_op():
    result = apply("watermark", mode="tags", config={})
    assert result["text"] == "watermark"
    assert result["stats"] == {"dropped": [], "errors": []}


def test_tags_mode_names_the_entry_that_matched():
    result = apply(
        "signature watermark, brown eyes, lowres",
        mode="tags",
        config={"blocklist": {"kind": "list", "entries": ["lowres", "watermark"]}},
    )
    assert result["stats"]["dropped"] == ["signature watermark", "lowres"]
    assert result["stats"]["matched"] == ["watermark", "lowres"]


def test_regex_tags_mode_names_the_pattern_that_matched():
    result = apply(
        "bad hands, artist name, blue",
        mode="tags",
        config={"blocklist": {"kind": "regex", "entries": [r"bad\s+\w+", "artist"]}},
    )
    assert result["stats"]["matched"] == [r"bad\s+\w+", "artist"]


def test_text_mode_has_no_matched_list():
    result = apply(
        "a watermark here",
        mode="text",
        config={"blocklist": {"kind": "list", "entries": ["watermark"]}},
    )
    assert "matched" not in result["stats"]


def test_text_mode_keeps_the_last_full_stop():
    from engine.cleaner.rules.blocklist import apply as bl

    out = bl("A black cat sat. A dog.", mode="text", config={"blocklist": {"entries": ["cat"]}})
    assert out["text"] == "A black sat. A dog."
