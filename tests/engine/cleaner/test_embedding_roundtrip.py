"""P3 #31 — do embeddings survive a round trip through the Prompt Cleaner?

The engine core never touches embedding syntax: `grep -ri embedding engine/`
returns one unrelated comment. So the pipeline itself is safe, and every
hazard lives in the cleaner's RULES, which treat the prompt as prose or as a
comma-separated tag list and know nothing about `embedding:name`.

These tests document what actually happens. Where a rule is destructive the
test asserts the CURRENT behaviour and says so — this is an investigation, and
turning the finding into a fix is a separate decision.
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


def test_HAZARD_trailing_underscore_is_stripped_from_the_name() -> None:
    """An embedding whose filename ends in `_` or `-` is silently renamed.

    `_` and `-` are in the punctuation set, and the rule strips runs of them
    from each tag's trailing edge. `bad_prompt_` is a real, published
    embedding name shape; after cleaning it points at a file that does not
    exist, and ComfyUI resolves a missing embedding to nothing — so the
    negative prompt quietly stops working rather than erroring.
    """
    out = punctuation.apply("embedding:bad_prompt_, 1girl", "tags", {})
    assert "embedding:bad_prompt_" not in out["text"]
    assert "embedding:bad_prompt" in out["text"]


def test_HAZARD_fuzzy_dedupe_drops_a_DIFFERENT_embedding() -> None:
    """Versioned embeddings are near-identical strings, so fuzzy dedupe eats one.

    `badhandv4` vs `badhandv5` differ by one character in nine — a ratio well
    above the hardcoded 0.9 threshold. They are different files with different
    weights, and the second is dropped without a word to the user beyond the
    generic "N removed" count.
    """
    out = dedupe.apply_fuzzy(
        "embedding:badhandv4, embedding:badhandv5, 1girl", "tags", {}
    )
    assert "embedding:badhandv5" not in out["text"]
    assert out["stats"]["dropped"] == ["embedding:badhandv5"]


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
