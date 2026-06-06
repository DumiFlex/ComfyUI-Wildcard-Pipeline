"""Boolean sub-category filter — parser, matcher, normalizer, validators.

Grammar (precedence not > and > or; or/and are n-ary, flattened):
    expr  := or
    or    := and ( ("or" | ",") and )*
    and   := unary ( "and" unary )*
    unary := "not" unary | atom
    atom  := SUBCAT | "(" or ")"

Mirror: src/manager/parsing/subcatFilter.ts — keep behavior identical
(shared fixture in tests/fixtures/subcat_filter_cases.json).
"""
from __future__ import annotations

import re
from typing import Any

RESERVED = {"and", "or", "not", "null"}
# A sub-category NAME is one safe token (see validate_subcat_name).
_NAME_RE = re.compile(r"^[^\s()!,#:}@{$]+$")
_TOKEN_RE = re.compile(r"\s*(\(|\)|,|[^\s()!,#:}@{$]+)")


class ParseError(ValueError):
    pass


def _tokenize(s: str) -> list[str]:
    out: list[str] = []
    i = 0
    while i < len(s):
        m = _TOKEN_RE.match(s, i)
        if not m:
            if s[i:].strip() == "":  # only trailing whitespace left
                break
            raise ParseError(f"unexpected character {s[i]!r}")
        out.append(m.group(1))
        i = m.end()
    return out


def parse(s: str) -> dict[str, Any] | None:
    """Parse an expression string to an AST, or None when empty."""
    toks = _tokenize(s)
    if not toks:
        return None
    pos = 0

    def peek() -> str | None:
        return toks[pos] if pos < len(toks) else None

    def eat() -> str:
        nonlocal pos
        t = toks[pos]
        pos += 1
        return t

    def p_or() -> dict[str, Any]:
        kids = [p_and()]
        while peek() in ("or", ","):
            eat()
            kids.append(p_and())
        return kids[0] if len(kids) == 1 else {"op": "or", "kids": kids}

    def p_and() -> dict[str, Any]:
        kids = [p_unary()]
        while peek() == "and":
            eat()
            kids.append(p_unary())
        return kids[0] if len(kids) == 1 else {"op": "and", "kids": kids}

    def p_unary() -> dict[str, Any]:
        if peek() == "not":
            eat()
            return {"op": "not", "x": p_unary()}
        return p_atom()

    def p_atom() -> dict[str, Any]:
        t = peek()
        if t == "(":
            eat()
            inner = p_or()
            if peek() != ")":
                raise ParseError("missing closing paren )")
            eat()
            return inner
        if t is None:
            raise ParseError("expression incomplete (missing a term)")
        if t in ("and", "or", "not", ")", ","):
            raise ParseError(f"unexpected token {t!r} (missing an operator/term?)")
        eat()
        return {"tag": t}

    ast = p_or()
    if pos < len(toks):
        raise ParseError(f"unexpected token {toks[pos]!r} (missing an operator?)")
    return ast


def matches(ast: dict[str, Any] | None, tags: set[str]) -> bool:
    """True iff the option's `tags` satisfy the expression. Empty expr => True."""
    if ast is None:
        return True
    if "tag" in ast:
        return ast["tag"] in tags
    op = ast["op"]
    if op == "not":
        return not matches(ast["x"], tags)
    if op == "and":
        return all(matches(k, tags) for k in ast["kids"])
    return any(matches(k, tags) for k in ast["kids"])  # or


def reads_as(ast: dict[str, Any] | None) -> str:
    """Canonical pretty-print: flatten same-op chains; parenthesize only a
    child whose operator differs from the parent's."""
    if ast is None:
        return ""
    if "tag" in ast:
        return ast["tag"]
    op = ast["op"]
    if op == "not":
        c = ast["x"]
        inner = reads_as(c)
        return f"not ({inner})" if ("op" in c and c["op"] in ("and", "or")) else f"not {inner}"
    parts = []
    for k in ast["kids"]:
        inner = reads_as(k)
        if "op" in k and k["op"] in ("and", "or") and k["op"] != op:
            parts.append(f"({inner})")
        else:
            parts.append(inner)
    return f" {op} ".join(parts)


def validate_subcat_name(name: str) -> str | None:
    """Return an error string, or None when the name is a valid single token."""
    if not name:
        return "name is empty"
    if name.lower() in RESERVED:
        return f"reserved word: {name!r} (and/or/not/null are not allowed)"
    if any(ch.isspace() for ch in name):
        return "name must not contain whitespace"
    if not _NAME_RE.match(name):
        bad = next(ch for ch in name if ch in "()!,#:}@{$")
        return f"disallowed character: {bad!r}"
    return None


def validate_expression(s: str, known: set[str]) -> str | None:
    """Return an error string, or None when the expression is valid against `known`."""
    try:
        ast = parse(s)
    except ParseError as e:
        return str(e)
    if ast is None:
        return None
    seen: set[str] = set()

    def walk(n: dict[str, Any]) -> None:
        if "tag" in n:
            seen.add(n["tag"])
            return
        if n["op"] == "not":
            walk(n["x"])
            return
        for k in n["kids"]:
            walk(k)

    walk(ast)
    for t in seen:
        if t.lower() in RESERVED:
            return f"reserved word used as a term: {t!r}"
        if t not in known:
            return f"Unknown sub-category: {t!r}"
    return None
