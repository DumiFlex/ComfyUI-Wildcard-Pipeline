"""Single-grammar tokenizer for wildcard syntax. Mirrors `richTokenize.ts`.

Returns a flat list of `Token` covering the input contiguously (joining all
`.raw` fields reproduces the input). The "lossless" invariant is asserted
in tests + fuzz.

This file ships in increments — Task 3 lands text + escape, Task 4 adds
var + ref, Task 5 adds dp_brace + dp_pipe + dp_multi.
"""
from __future__ import annotations

from engine.syntax.types import Token, TokenKind


def tokenize_text(text: str) -> list[Token]:
    """Tokenize `text` into a flat list of Token. Single-pass, O(n)."""
    if not text:
        return []

    out: list[Token] = []
    i = 0
    n = len(text)
    text_start: int | None = None

    def _flush_text(end_at: int) -> None:
        nonlocal text_start
        if text_start is None:
            return
        if end_at > text_start:
            out.append(Token(
                kind=TokenKind.TEXT,
                raw=text[text_start:end_at],
                start=text_start,
                end=end_at,
                meta={},
            ))
        text_start = None

    while i < n:
        ch = text[i]

        # Escape sequences: $$ → literal $, @@ → literal @
        if ch == "$" and i + 1 < n and text[i + 1] == "$":
            _flush_text(i)
            out.append(Token(
                kind=TokenKind.ESCAPE,
                raw="$$",
                start=i,
                end=i + 2,
                meta={"literal": "$"},
            ))
            i += 2
            continue

        if ch == "@" and i + 1 < n and text[i + 1] == "@":
            _flush_text(i)
            out.append(Token(
                kind=TokenKind.ESCAPE,
                raw="@@",
                start=i,
                end=i + 2,
                meta={"literal": "@"},
            ))
            i += 2
            continue

        # Default: accumulate literal text
        if text_start is None:
            text_start = i
        i += 1

    _flush_text(n)
    return out
