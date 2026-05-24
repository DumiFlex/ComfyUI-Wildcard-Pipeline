"""Dedupe rules — exact, WP-vs-picks, fuzzy."""
from engine.cleaner.rules.dedupe import apply_exact, apply_fuzzy, apply_wp
from engine.cleaner.types import CleanerCtx


def test_exact_drops_duplicate_tags():
    result = apply_exact("pixie cut, brown eyes, pixie cut", mode="tags", ctx=None, config={})
    assert result["text"] == "pixie cut, brown eyes"
    assert result["stats"]["dropped"] == ["pixie cut"]


def test_exact_case_insensitive_leftmost_wins():
    result = apply_exact("Red, blue, RED", mode="tags", ctx=None, config={})
    assert result["text"] == "Red, blue"
    assert result["stats"]["dropped"] == ["RED"]


def test_exact_no_op_in_text_mode():
    result = apply_exact("the cat and the cat", mode="text", ctx=None, config={})
    assert result["text"] == "the cat and the cat"
    assert result["stats"] == {"dropped": []}


def test_exact_empty_string():
    result = apply_exact("", mode="tags", ctx=None, config={})
    assert result == {"text": "", "stats": {"dropped": []}}


def test_wp_dedupe_drops_tag_matching_a_pick():
    ctx = CleanerCtx(picks={"wc_hair": {"value": "pixie cut"}})
    result = apply_wp("portrait, pixie cut, brown eyes", mode="tags", ctx=ctx, config={})
    assert result["text"] == "portrait, brown eyes"
    assert result["stats"]["dropped"] == ["pixie cut"]


def test_wp_dedupe_silent_skip_when_ctx_none():
    result = apply_wp("portrait, pixie cut", mode="tags", ctx=None, config={})
    assert result["text"] == "portrait, pixie cut"
    assert result["stats"] == {}


def test_wp_dedupe_does_not_drop_unmatched_duplicate():
    """Pure dedupe is done by apply_exact, not apply_wp."""
    ctx = CleanerCtx(picks={"wc_hair": {"value": "pixie cut"}})
    result = apply_wp("portrait, portrait, pixie cut", mode="tags", ctx=ctx, config={})
    assert result["text"] == "portrait, portrait"
    assert result["stats"]["dropped"] == ["pixie cut"]


def test_wp_dedupe_regex_meta_chars_in_pick_value_are_literal():
    """A pick value like 'a (b)' must match literally, never as regex."""
    ctx = CleanerCtx(picks={"wc_x": {"value": "a (b)"}})
    result = apply_wp("a (b), c", mode="tags", ctx=ctx, config={})
    assert result["text"] == "c"


def test_fuzzy_drops_near_duplicate():
    result = apply_fuzzy("pixie cut, pixie cuts", mode="tags", ctx=None, config={})
    assert result["text"] == "pixie cut"
    assert "pixie cuts" in result["stats"]["dropped"]


def test_fuzzy_keeps_distinct_tags():
    result = apply_fuzzy("red, blue, green", mode="tags", ctx=None, config={})
    assert result["text"] == "red, blue, green"
    assert result["stats"]["dropped"] == []


def test_fuzzy_no_op_in_text_mode():
    result = apply_fuzzy("smiling smiles", mode="text", ctx=None, config={})
    assert result["text"] == "smiling smiles"
    assert result["stats"] == {"dropped": []}
