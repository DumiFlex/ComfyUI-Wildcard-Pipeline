"""Boolean sub-category filter — parser, matcher, normalizer, validators.

Grammar (precedence not > and > or; or/and are n-ary, flattened):
    expr  := or
    or    := and ( ("or" | ",") and )*
    and   := unary ( "and" unary )*
    unary := ("not" | "!") unary | atom
    atom  := SUBCAT | VAR | "(" or ")"
    VAR   := "$" ident   (schema v11: reads a variable at run time, `bind`)

Mirror: src/manager/parsing/subcatFilter.ts — keep behavior identical
(shared fixture in tests/fixtures/subcat_filter_cases.json).
"""
from __future__ import annotations

import re
from typing import Any

RESERVED = {"and", "or", "not", "null"}
# A sub-category NAME is one safe token (see validate_subcat_name).
_NAME_RE = re.compile(r"^[^\s()!,#:}@{$]+$")
_VAR_RE = re.compile(r"^\$[A-Za-z_][A-Za-z0-9_]*$")
_TOKEN_RE = re.compile(r"\s*(\(|\)|,|!|\$[A-Za-z_][A-Za-z0-9_]*|[^\s()!,#:}@{$]+)")


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
        # `!warm` is read as `not warm` (the spelling most people and models
        # reach for first).
        out.append("not" if m.group(1) == "!" else m.group(1))
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
        if _VAR_RE.match(t):
            return {"var": t[1:]}
        return {"tag": t}

    ast = p_or()
    if pos < len(toks):
        raise ParseError(f"unexpected token {toks[pos]!r} (missing an operator?)")
    return ast


def matches(ast: dict[str, Any] | None, tags: set[str]) -> bool:
    """True iff the option's `tags` satisfy the expression. Empty expr => True.
    A `$var` term that was never bound (see `bind`) is left out, as if it
    were not written."""
    if ast is None:
        return True
    if "var" in ast:
        return True
    if "tag" in ast:
        return ast["tag"] in tags
    op = ast["op"]
    if op == "not":
        if _has_var(ast["x"]):
            return matches(_drop_vars(ast), tags)
        return not matches(ast["x"], tags)
    if any("var" in k for k in ast["kids"]):
        return matches(_drop_vars(ast), tags)
    if op == "and":
        return all(matches(k, tags) for k in ast["kids"])
    return any(matches(k, tags) for k in ast["kids"])  # or


def reads_as(ast: dict[str, Any] | None) -> str:
    """Canonical pretty-print: flatten same-op chains; parenthesize only a
    child whose operator differs from the parent's."""
    if ast is None:
        return ""
    if "var" in ast:
        return "$" + ast["var"]
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
        if "var" in n:
            return
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


def variables(ast: dict[str, Any] | None) -> list[str]:
    """Distinct `$name` terms of a parsed expression, in order (no `$`)."""
    out: list[str] = []

    def walk(n: dict[str, Any] | None) -> None:
        if n is None:
            return
        if "var" in n:
            if n["var"] not in out:
                out.append(n["var"])
        elif "tag" in n:
            return
        elif n["op"] == "not":
            walk(n["x"])
        else:
            for k in n["kids"]:
                walk(k)

    walk(ast)
    return out


def expr_variables(expr: Any) -> list[str]:
    """`variables` of an expression string; [] when empty or malformed."""
    if not isinstance(expr, str) or "$" not in expr:
        return []
    try:
        return variables(parse(expr))
    except ParseError:
        return []


def tag_key(value: str) -> str:
    """How a variable's value is compared with tags: trimmed, lower case,
    runs of spaces as one `_`."""
    return "_".join(value.strip().lower().split())


def _has_var(n: dict[str, Any]) -> bool:
    if "var" in n:
        return True
    if "tag" in n:
        return False
    if n["op"] == "not":
        return _has_var(n["x"])
    return any(_has_var(k) for k in n["kids"])


def _drop_vars(n: dict[str, Any] | None) -> dict[str, Any] | None:
    """The expression without its `$var` terms: a `not` or a group left
    empty goes too, a one-child group becomes that child."""
    if n is None or "var" in n:
        return None
    if "tag" in n:
        return n
    if n["op"] == "not":
        x = _drop_vars(n["x"])
        return None if x is None else {"op": "not", "x": x}
    kids = [k for k in (_drop_vars(c) for c in n["kids"]) if k is not None]
    if not kids:
        return None
    return kids[0] if len(kids) == 1 else {"op": n["op"], "kids": kids}


def drop_vars(ast: dict[str, Any] | None) -> dict[str, Any] | None:
    """Public `_drop_vars`: what an expression narrows before the run."""
    return _drop_vars(ast)


def bind(
    ast: dict[str, Any] | None,
    lookup: Any,
    tags: Any,
    tag_groups: Any = None,
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    """Replace every `$name` term with a plain tag expression for this run
    (schema v11). `lookup(name)` returns the variable's values (a list of
    strings; [] or None when unset). `tags` are the wildcard's tags,
    `tag_groups` its {group: [tags]}.

    A term keeps the options tagged with one of the values. An option with
    NO tag of the value's group passes too, so untagged-for-that-axis
    options work for every value. When the variable is unset, or none of
    its values is one of the wildcard's tags, the term narrows nothing and
    a note says why (the caller files it as an info warning), and the term
    is left out as if it were not written. Mirror:
    `bindVars` in src/manager/parsing/subcatFilter.ts.
    """
    notes: list[dict[str, Any]] = []
    if ast is None:
        return None, notes
    by_key: dict[str, str] = {}
    for t in tags or []:
        if isinstance(t, str):
            by_key.setdefault(tag_key(t), t)
    groups: list[list[str]] = [
        [m for m in members if isinstance(m, str)]
        for members in (tag_groups or {}).values()
        if isinstance(members, list)
    ]
    cache: dict[str, dict[str, Any]] = {}

    def term(name: str) -> dict[str, Any]:
        if name in cache:
            return cache[name]
        raw = lookup(name) or []
        values = [str(v) for v in raw if str(v).strip()]
        hit = [by_key[tag_key(v)] for v in values if tag_key(v) in by_key]
        hit = list(dict.fromkeys(hit))
        if not hit:
            notes.append({
                "variable": name,
                "value": ", ".join(values),
                "reason": "unset" if not values else "no_tag",
            })
            node: dict[str, Any] = {"var": name}
        else:
            kids: list[dict[str, Any]] = [{"tag": t} for t in hit]
            axis: list[str] = []
            for g in groups:
                if any(t in g for t in hit):
                    axis.extend(m for m in g if m not in axis)
            if axis:
                kids.append({"op": "not", "x": {"op": "or", "kids": [{"tag": m} for m in axis]}})
            node = kids[0] if len(kids) == 1 else {"op": "or", "kids": kids}
        cache[name] = node
        return node

    def walk(n: dict[str, Any]) -> dict[str, Any]:
        if "var" in n:
            return term(n["var"])
        if "tag" in n:
            return n
        if n["op"] == "not":
            return {"op": "not", "x": walk(n["x"])}
        return {"op": n["op"], "kids": [walk(k) for k in n["kids"]]}

    return _drop_vars(walk(ast)), notes


def values_of(raw: Any) -> list[str]:
    """A context value as the list `bind` compares: a multi-pick list var
    gives its items, anything else its text (empty when unset)."""
    if raw is None:
        return []
    items = getattr(raw, "items", None)
    if isinstance(items, list):
        return [str(i) for i in items]
    text = str(raw)
    return [text] if text.strip() else []


def wildcard_tags(payload: Any) -> list[str]:
    """Every tag a wildcard declares or puts on an option."""
    out: list[str] = []
    if not isinstance(payload, dict):
        return out
    for t in payload.get("sub_categories") or []:
        if isinstance(t, str) and t not in out:
            out.append(t)
    for o in payload.get("options") or []:
        if isinstance(o, dict):
            for t in o.get("sub_categories") or []:
                if isinstance(t, str) and t not in out:
                    out.append(t)
    return out


def bind_for_wildcard(
    expr: Any, get: Any, payload: Any,
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    """Parse `expr` and `bind` its `$name` terms against the run's
    variables (`get(name)` returns the raw context value) and the
    wildcard `payload`'s tags + tag groups."""
    ast = parse(expr) if isinstance(expr, str) else None
    if ast is None or not variables(ast):
        return ast, []
    groups = payload.get("tag_groups") if isinstance(payload, dict) else None
    return bind(ast, lambda n: values_of(get(n)), wildcard_tags(payload), groups)


def filter_variable_warning(
    note: dict[str, Any], *, module_id: str = "", where: str = "",
) -> dict[str, Any]:
    """The info warning for a `$name` term that narrowed nothing."""
    name = note.get("variable", "")
    value = note.get("value", "")
    if note.get("reason") == "unset":
        why = f"${name} is not set"
    else:
        why = f"no tag here is ${name}'s value ({value!r})"
    return {
        "type": "filter_variable_no_tag",
        "severity": "info",
        "module_id": module_id,
        "source_field": "",
        "position": 0,
        "token_index": None,
        "detail": {"variable": name, "value": value, "reason": note.get("reason", "")},
        "message": f"{where}filter term ${name} left out: {why}, so it narrowed nothing",
    }
