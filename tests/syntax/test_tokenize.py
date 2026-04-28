"""Python tokenizer reads parity corpus and asserts identical token output."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from engine.syntax import Token, tokenize_text

CORPUS_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "syntax-corpus.json"


def _token_to_dict(t: Token) -> dict:
    return {
        "kind": t.kind.value,
        "raw": t.raw,
        "start": t.start,
        "end": t.end,
        "meta": t.meta,
    }


def _load_cases() -> list[dict]:
    return json.loads(CORPUS_PATH.read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", _load_cases(), ids=lambda c: c["name"])
def test_tokenize_matches_corpus(case):
    actual = [_token_to_dict(t) for t in tokenize_text(case["input"])]
    assert actual == case["expected_tokens"], (
        f"tokenize_text({case['input']!r}) diverged from corpus expectation"
    )


def test_tokenize_empty_returns_empty_list():
    assert tokenize_text("") == []


def test_tokenize_lossless_concatenation_invariant():
    """The tokenizer must be lossless — joining all token .raw fields
    reproduces the input exactly, for any input."""
    samples = [
        "hello",
        "$$",
        "@@",
        "a$$b@@c",
        "spaces  and\ttabs\n",
    ]
    for s in samples:
        toks = tokenize_text(s)
        joined = "".join(t.raw for t in toks)
        assert joined == s, f"lossless invariant broken for {s!r}: got {joined!r}"


def test_tokenize_lossless_for_var_ref():
    samples = [
        "$x",
        "$x $y",
        "@{deadbeef} @{cafebabe}",
        "mix $x @{12345678} text",
        "lone $ and lone @ stay text",
    ]
    for s in samples:
        toks = tokenize_text(s)
        joined = "".join(t.raw for t in toks)
        assert joined == s, f"lossless invariant broken for {s!r}: got {joined!r}"
