"""P3 #31 — do embeddings survive a round trip through the Prompt Cleaner?

The engine core never touches embedding syntax: `grep -ri embedding engine/`
returns one unrelated comment. So the pipeline itself is safe, and every
hazard lives in the cleaner's RULES, which treat the prompt as prose or as a
comma-separated tag list and know nothing about `embedding:name`.

The two destructive rules are now fixed: `engine/cleaner/atoms.py` marks
`embedding:name` and `<lora:name:1.0>` as file references the cleaner must not
rewrite. These tests pin that, and the cases that were always safe stay here as
regression cover.
"""
from __future__ import annotations

from engine.cleaner.rules import dedupe, punctuation


def test_plain_embedding_survives_punctuation_stripping() -> None:
    """The common form is safe: it neither starts nor ends with punctuation."""
    out = punctuation.apply("embedding:badhandv4, 1girl", "tags", {})
    assert "embedding:badhandv4" in out["text"]


def test_weighted_embedding_survives() -> None:
    """`(embedding:x:1.2)` — parens are not in the stripped set."""
    out = punctuation.apply("(embedding:easynegative:1.2), 1girl", "tags", {})
    assert "(embedding:easynegative:1.2)" in out["text"]


def test_trailing_underscore_in_an_embedding_name_is_preserved() -> None:
    """An embedding whose filename ends in `_` or `-` keeps it.

    `_` and `-` are in the punctuation set and the rule trims runs of them
    from each tag's trailing edge, which renamed `bad_prompt_` — a real,
    published shape — to a file that does not exist. ComfyUI resolves a
    missing embedding to nothing, so the negative prompt stopped working with
    no error at all.
    """
    out = punctuation.apply("embedding:bad_prompt_, 1girl", "tags", {})
    assert "embedding:bad_prompt_" in out["text"]


def test_ordinary_tags_still_get_their_edges_trimmed() -> None:
    """The atom guard must not switch punctuation stripping off wholesale."""
    out = punctuation.apply("embedding:bad_prompt_, messy tag--, 1girl", "tags", {})
    assert "embedding:bad_prompt_" in out["text"]
    assert "messy tag" in out["text"]
    assert "messy tag--" not in out["text"]


def test_lora_syntax_is_preserved() -> None:
    """`<lora:name:1.0>` is a file reference with the same failure mode."""
    src = "<lora:add_detail_:0.8>, 1girl"
    out = punctuation.apply(src, "tags", {})
    assert "<lora:add_detail_:0.8>" in out["text"]


def test_versioned_loras_are_not_fuzzy_merged() -> None:
    """Same argument as embeddings: one character apart, two different files."""
    out = dedupe.apply_fuzzy(
        "<lora:styleA_v1:0.8>, <lora:styleA_v2:0.8>, 1girl", "tags", {}
    )
    assert "<lora:styleA_v1:0.8>" in out["text"]
    assert "<lora:styleA_v2:0.8>" in out["text"]


def test_fuzzy_dedupe_keeps_two_versions_of_an_embedding() -> None:
    """Versioned embeddings are near-identical strings by design.

    `badhandv4` vs `badhandv5` differ by one character in nine — well above
    the hardcoded 0.9 threshold — while naming two different files with
    different training. The second used to be dropped with nothing said beyond
    a generic "N removed" count.
    """
    out = dedupe.apply_fuzzy(
        "embedding:badhandv4, embedding:badhandv5, 1girl", "tags", {}
    )
    assert "embedding:badhandv4" in out["text"]
    assert "embedding:badhandv5" in out["text"]
    assert out["stats"]["dropped"] == []


def test_fuzzy_dedupe_still_collapses_an_identical_embedding() -> None:
    """Holding back the fuzzy pass must not stop exact repeats collapsing."""
    out = dedupe.apply_fuzzy(
        "embedding:badhandv4, 1girl, embedding:badhandv4", "tags", {}
    )
    assert out["text"].count("embedding:badhandv4") == 1


def test_fuzzy_dedupe_still_merges_ordinary_near_duplicates() -> None:
    """Plain tags keep the old behaviour — the guard is atom-scoped."""
    out = dedupe.apply_fuzzy("beautiful girl, beautiful girll", "tags", {})
    assert out["stats"]["dropped"] == ["beautiful girll"]


def test_exact_dedupe_on_embeddings_is_correct() -> None:
    """The exact rule is fine — an identical embedding twice IS redundant."""
    out = dedupe.apply_exact(
        "embedding:badhandv4, 1girl, embedding:badhandv4", "tags", {}
    )
    assert out["text"].count("embedding:badhandv4") == 1


def test_text_mode_leaves_embeddings_alone() -> None:
    """Text mode strips only the whole string's edges, so interior tags are safe."""
    src = "a photo, embedding:badhandv4, detailed"
    assert punctuation.apply(src, "text", {})["text"] == src


def test_text_mode_does_not_trim_a_trailing_embedding() -> None:
    """Text mode trims the whole string's edges, so a prompt ENDING in an
    atom was the one exposed case."""
    src = "a photo, embedding:bad_prompt_"
    assert punctuation.apply(src, "text", {})["text"] == src


def test_text_mode_still_trims_a_leading_edge() -> None:
    """Guarding the tail must not disable the head."""
    out = punctuation.apply("-- a photo, embedding:bad_prompt_", "text", {})
    assert out["text"] == "a photo, embedding:bad_prompt_"
