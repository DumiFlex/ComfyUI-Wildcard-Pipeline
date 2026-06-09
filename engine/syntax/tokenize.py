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

# `$name` or `$name.K` — identifier starts with letter or underscore, then
# word chars, with an optional `.K` list-index accessor (SP2a). Group 2 = the
# index digits when present.
_VAR_RE = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)(?:\.(\d+))?")
# 4-segment ref grammar (fixed order): `@{8hex [#name] [:expr] [!null]}`.
#   group 1 — uuid: exactly 8 lowercase hex chars.
#   group 2 — optional `#name`: display label cached at write-time so a
#             broken ref still tells the user what the wildcard was
#             called. Purely informational — the resolver matches uuid.
#   group 3 — optional `:expr`: a BOOLEAN sub-category filter expression
#             (`and`/`or`/`not`/parens/comma=or). Parsed + matched by the
#             shared `engine.syntax.subcat_filter` matcher; narrows the
#             nested pick to options whose tag set satisfies the
#             expression — same matcher as instance.category_filter.
#   group 4 — optional `!null`: the exclude-null marker (drops the null
#             option from the nested pick). Separate from the expression.
#
# Name/expr char-classes exclude `!` (the null-marker delimiter) so the
# segments stay unambiguous; sub-category names additionally forbid the
# boolean grammar chars (see `subcat_filter.validate_subcat_name`),
# enforced at the editor + API boundary, not at parse time.
_REF_RE = re.compile(
    r"@\{([0-9a-f]{8})(?:#([^#:}@{!]*))?(?::([^}!]*))?(?:!([^}]*))?\}"
)
# Multi-pick prefix: {N$$sep$$ or {N-M~$$sep$$ — group 1 is the count (a fixed
# `N` or a `N-M` range), group 2 is the optional `~` independent flag (repeats
# allowed; absent = unique), group 3 is the separator (may be empty). SP2b.
_MULTI_PREFIX_RE = re.compile(r"^\{(\d+(?:-\d+)?)(~?)\$\$(.*?)\$\$", flags=re.DOTALL)


def _split_top_level_pipes(s: str) -> list[str]:
    """Split `s` on `|` at brace-depth zero only. Nested `{a|b}` stays intact."""
    parts: list[str] = []
    depth = 0
    last = 0
    for idx, c in enumerate(s):
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        elif c == "|" and depth == 0:
            parts.append(s[last:idx])
            last = idx + 1
    parts.append(s[last:])
    return parts


def _scan_brace_block(
    text: str, start: int
) -> tuple[int, list[str], tuple[int, int, bool] | None, str | None] | None:
    """Try to scan a `{...}` block starting at `text[start] == '{'`.

    Returns:
        (end_index, branches, count_or_None, sep_or_None)

    where end_index is the position AFTER the closing brace, branches is
    the list of branch source strings (split at top-level `|`), count is
    the parsed integer count for multi-pick or None for single-pick, and
    sep is the separator string for multi-pick or None for single-pick.

    Returns None if the block is malformed (unclosed, no pipes for single-pick).
    The caller falls back to literal text.
    """
    n = len(text)
    if start >= n or text[start] != "{":
        return None

    # Walk to the matching `}` while tracking brace depth so nested
    # {a|{b|c}|d} works.
    i = start + 1
    depth = 1
    while i < n and depth > 0:
        c = text[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    if depth != 0:
        return None  # unclosed

    body_start = start + 1
    body_end = i  # index of closing brace
    end_index = i + 1
    body = text[body_start:body_end]

    # Detect multi-pick prefix: N$$sep$$
    body_with_braces = "{" + body  # match against `{N$$sep$$...`
    multi_match = _MULTI_PREFIX_RE.match(body_with_braces)
    if multi_match:
        count_raw = multi_match.group(1)            # "N" or "N-M"
        independent = multi_match.group(2) == "~"   # SP2b: repeats allowed
        sep = multi_match.group(3)
        # Body remaining after the prefix is the branch list
        prefix_len = multi_match.end() - 1  # subtract the leading `{` we added
        rest = body[prefix_len:]
        branches = _split_top_level_pipes(rest)
        if "-" in count_raw:
            lo, hi = count_raw.split("-", 1)
            cmin, cmax = int(lo), int(hi)
        else:
            cmin = cmax = int(count_raw)
        if cmin > cmax:                             # normalize a swapped range
            cmin, cmax = cmax, cmin
        return (end_index, branches, (cmin, cmax, independent), sep)

    # Single-pick: must contain at least one top-level `|`
    branches = _split_top_level_pipes(body)
    if len(branches) < 2:
        return None  # not a pick — fall back to literal
    return (end_index, branches, None, None)


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
                var_meta: dict[str, object] = {"name": m.group(1)}
                if m.group(2) is not None:
                    var_meta["index"] = int(m.group(2))
                out.append(Token(
                    kind=TokenKind.VAR,
                    raw=m.group(0),
                    start=i,
                    end=m.end(),
                    meta=var_meta,
                ))
                i = m.end()
                continue
            # Lone $ followed by non-ident — fall through to text accumulation

        # Ref: @{8hex} (only when exactly 8 lowercase hex chars in braces)
        if ch == "@":
            m = _REF_RE.match(text, i)
            if m:
                _flush_text(i)
                # Group 1: uuid. Group 2: optional cached display name.
                # Group 3: optional boolean sub-category filter
                # expression (stored raw; the resolver parses it via the
                # shared subcat_filter matcher). A whitespace-only
                # `:expr` is "no filter" — keeps `@{xyz:}` from banning
                # every option. Group 4: the `!null` exclude-null marker.
                meta: dict = {"uuid": m.group(1)}
                name_raw = m.group(2)
                if name_raw:
                    meta["name"] = name_raw
                expr_raw = m.group(3)
                if expr_raw is not None and expr_raw.strip():
                    meta["filter_expr"] = expr_raw
                if m.group(4) == "null":
                    meta["exclude_null"] = True
                out.append(Token(
                    kind=TokenKind.REF,
                    raw=m.group(0),
                    start=i,
                    end=m.end(),
                    meta=meta,
                ))
                i = m.end()
                continue

        # Brace block: {...} for inline pick or {N$$sep$$...} for multi-pick
        if ch == "{":
            scanned = _scan_brace_block(text, i)
            if scanned is not None:
                end_index, branches, count, sep = scanned
                _flush_text(i)
                if count is None:
                    out.append(Token(
                        kind=TokenKind.DP_BRACE,
                        raw=text[i:end_index],
                        start=i,
                        end=end_index,
                        meta={"branches": branches},
                    ))
                else:
                    cmin, cmax, independent = count
                    out.append(Token(
                        kind=TokenKind.DP_MULTI,
                        raw=text[i:end_index],
                        start=i,
                        end=end_index,
                        # `count` kept == max for back-compat readers; min/max
                        # carry the range, independent carries the `~` flag (SP2b).
                        meta={
                            "min": cmin, "max": cmax, "independent": independent,
                            "count": cmax, "sep": sep, "branches": branches,
                        },
                    ))
                i = end_index
                continue
            # Malformed brace — fall through to literal text

        # Default: accumulate literal text
        if text_start is None:
            text_start = i
        i += 1

    _flush_text(n)
    return out
