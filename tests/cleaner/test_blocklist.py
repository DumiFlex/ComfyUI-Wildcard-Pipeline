"""Blocklist rule — drop tags matching a user list or regex set."""
from engine.cleaner.rules.blocklist import apply


def test_list_drops_exact_tag_match():
    result = apply(
        "watermark, brown eyes, lowres",
        mode="tags",
        ctx=None,
        config={"blocklist": {"kind": "list", "entries": ["watermark", "lowres"]}},
    )
    assert result["text"] == "brown eyes"
    assert sorted(result["stats"]["dropped"]) == ["lowres", "watermark"]


def test_list_case_insensitive():
    result = apply(
        "Watermark, blue",
        mode="tags",
        ctx=None,
        config={"blocklist": {"kind": "list", "entries": ["watermark"]}},
    )
    assert result["text"] == "blue"


def test_list_text_mode_substring():
    """In text mode the rule does whole-word boundary match."""
    result = apply(
        "a cat sat near catcher",
        mode="text",
        ctx=None,
        config={"blocklist": {"kind": "list", "entries": ["cat"]}},
    )
    assert result["text"] == "a  sat near catcher"


def test_list_empty_entries_no_op():
    result = apply(
        "watermark",
        mode="tags",
        ctx=None,
        config={"blocklist": {"kind": "list", "entries": []}},
    )
    assert result["text"] == "watermark"
    assert result["stats"]["dropped"] == []


def test_regex_drops_matching_tag():
    result = apply(
        "watermark, brown eyes",
        mode="tags",
        ctx=None,
        config={"blocklist": {"kind": "regex", "entries": [r"water.*"]}},
    )
    assert result["text"] == "brown eyes"
    assert result["stats"]["dropped"] == ["watermark"]


def test_regex_bad_pattern_logged_not_raised():
    """A malformed regex shouldn't crash; pattern reported in stats.errors."""
    result = apply(
        "watermark, brown eyes",
        mode="tags",
        ctx=None,
        config={"blocklist": {"kind": "regex", "entries": ["[unterminated", "water.*"]}},
    )
    assert result["text"] == "brown eyes"
    assert "[unterminated" in result["stats"]["errors"]


def test_regex_text_mode_strips_matches():
    result = apply(
        "see watermark and stuff",
        mode="text",
        ctx=None,
        config={"blocklist": {"kind": "regex", "entries": [r"water\S+"]}},
    )
    assert result["text"] == "see  and stuff"


def test_missing_blocklist_config_no_op():
    result = apply("watermark", mode="tags", ctx=None, config={})
    assert result["text"] == "watermark"
    assert result["stats"] == {"dropped": [], "errors": []}
