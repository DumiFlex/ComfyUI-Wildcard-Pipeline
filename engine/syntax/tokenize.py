"""Single-grammar tokenizer for wildcard syntax. Mirrors `richTokenize.ts`.

Returns a flat list of `Token` covering the input contiguously (joining all
`.raw` fields reproduces the input). The "lossless" invariant is asserted
in tests + fuzz.

This file ships in increments — Task 3 lands text + escape, Task 4 adds
var + ref, Task 5 adds dp_brace + dp_pipe + dp_multi.
"""
from __future__ import annotations

import re

from engine.syntax.types import Token, TokenKind

# `$name` — identifier starts with letter or underscore, then word chars
_VAR_RE = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)")
# `@{8hex}` — exactly 8 lowercase hex chars in braces
_REF_RE = re.compile(r"@\{([0-9a-f]{8})\}")


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

        # Variable: $name (only when followed by a valid identifier start)
        if ch == "$":
            m = _VAR_RE.match(text, i)
            if m:
                _flush_text(i)
                out.append(Token(
                    kind=TokenKind.VAR,
                    raw=m.group(0),
                    start=i,
                    end=m.end(),
                    meta={"name": m.group(1)},
                ))
                i = m.end()
                continue
            # Lone $ followed by non-ident — fall through to text accumulation

        # Ref: @{8hex} (only when exactly 8 lowercase hex chars in braces)
        if ch == "@":
            m = _REF_RE.match(text, i)
            if m:
                _flush_text(i)
                out.append(Token(
                    kind=TokenKind.REF,
                    raw=m.group(0),
                    start=i,
                    end=m.end(),
                    meta={"uuid": m.group(1)},
                ))
                i = m.end()
                continue

        # Default: accumulate literal text
        if text_start is None:
            text_start = i
        i += 1

    _flush_text(n)
    return out
