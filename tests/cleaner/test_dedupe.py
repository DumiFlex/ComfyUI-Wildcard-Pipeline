"""Dedupe rules — exact + fuzzy."""
from engine.cleaner.rules.dedupe import apply_exact, apply_fuzzy


def test_exact_drops_duplicate_tags():
    result = apply_exact("pixie cut, brown eyes, pixie cut", mode="tags", config={})
    assert result["text"] == "pixie cut, brown eyes"
    assert result["stats"]["dropped"] == ["pixie cut"]


def test_exact_case_insensitive_leftmost_wins():
    result = apply_exact("Red, blue, RED", mode="tags", config={})
    assert result["text"] == "Red, blue"
    assert result["stats"]["dropped"] == ["RED"]


def test_exact_no_op_in_text_mode():
    result = apply_exact("the cat and the cat", mode="text", config={})
    assert result["text"] == "the cat and the cat"
    assert result["stats"] == {"dropped": []}


def test_exact_empty_string():
    result = apply_exact("", mode="tags", config={})
    assert result == {"text": "", "stats": {"dropped": [], "matched": []}}


def test_fuzzy_drops_near_duplicate():
    result = apply_fuzzy("pixie cut, pixie cuts", mode="tags", config={})
    assert result["text"] == "pixie cut"
    assert "pixie cuts" in result["stats"]["dropped"]


def test_fuzzy_keeps_distinct_tags():
    result = apply_fuzzy("red, blue, green", mode="tags", config={})
    assert result["text"] == "red, blue, green"
    assert result["stats"]["dropped"] == []


def test_fuzzy_no_op_in_text_mode():
    result = apply_fuzzy("smiling smiles", mode="text", config={})
    assert result["text"] == "smiling smiles"
    assert result["stats"] == {"dropped": []}


def test_exact_names_the_tag_each_drop_repeats():
    result = apply_exact("Red, blue, RED, blue", mode="tags", config={})
    assert result["stats"] == {"dropped": ["RED", "blue"], "matched": ["Red", "blue"]}


def test_fuzzy_names_the_kept_tag_and_how_close():
    result = apply_fuzzy("pixie cut, red, pixie cuts", mode="tags", config={})
    assert result["stats"]["dropped"] == ["pixie cuts"]
    assert result["stats"]["matched"] == ["pixie cut"]
    assert 0.9 <= result["stats"]["scores"][0] < 1


def test_fuzzy_exact_atom_repeat_scores_one():
    result = apply_fuzzy("embedding:bad_v4, embedding:bad_v4", mode="tags", config={})
    assert result["stats"]["matched"] == ["embedding:bad_v4"]
    assert result["stats"]["scores"] == [1.0]
