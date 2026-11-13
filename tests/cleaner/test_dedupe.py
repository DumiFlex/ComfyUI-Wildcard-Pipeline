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


def test_fuzzy_drops_plurals_of_short_tags():
    # knight / knights is only 0.86 by Levenshtein; the plural check catches it.
    text = "knight, bad hand, knights, bad hands, dresses, dress"
    result = apply_fuzzy(text, mode="tags", config={})
    assert result["text"] == "knight, bad hand, dresses"
    assert result["stats"]["dropped"] == ["knights", "bad hands", "dress"]
    assert result["stats"]["kinds"] == ["form", "form", "form"]


def test_fuzzy_plural_check_leaves_singular_s_words_alone():
    for text in ("dress, dres", "cactus, cactu", "red hair, red chair", "1girl, 2girls"):
        assert apply_fuzzy(text, mode="tags", config={})["stats"]["dropped"] == [], text


def test_fuzzy_ratio_is_levenshtein_with_or_without_rapidfuzz():
    from engine.cleaner.rules import dedupe

    # rapidfuzz's fuzz.ratio (Indel) scores this 0.94; Levenshtein 0.89.
    a, b = "red hair", "red chair"
    assert dedupe._ratio(a, b) == dedupe._levenshtein_ratio(a, b)
    assert apply_fuzzy(f"{a}, {b}", mode="tags", config={})["text"] == f"{a}, {b}"


def test_fuzzy_close_drop_reports_kind_close():
    result = apply_fuzzy("detailed background, detailed backround", mode="tags", config={})
    assert result["stats"]["dropped"] == ["detailed backround"]
    assert result["stats"]["kinds"] == ["close"]


def test_break_and_and_keywords_are_never_deduped():
    assert apply_exact("a, BREAK, b, BREAK, c, AND, d, AND", mode="tags", config={})["text"] == (
        "a, BREAK, b, BREAK, c, AND, d, AND"
    )
    assert apply_fuzzy("a, BREAK, b, BREAK", mode="tags", config={})["text"] == "a, BREAK, b, BREAK"


def test_fuzzy_sets_a_leading_article_aside():
    result = apply_fuzzy("masterpiece, a knight, forest, knight, knights", mode="tags", config={})
    assert result["text"] == "masterpiece, a knight, forest"
    assert result["stats"]["matched"] == ["a knight", "a knight"]
