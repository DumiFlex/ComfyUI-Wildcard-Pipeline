"""Prompt text the model writes, checked and compiled per surface.

The model never sees module ids. To point at another wildcard it writes the
engine's ref grammar with a NAME where the id goes:

    @{Colors}                 a fresh pick from the wildcard named Colors
    @{Colors:warm}            only options tagged warm (the filter grammar:
                              not / and / or / , / parentheses over tags)
    @{Colors:warm and not pastel!null}   … and never the empty option
    @{$color}                 the wildcard bound to $color

`compile_text` turns that into ``@{8hex#Name:filter!null}``, checking the
name, the filter against THAT wildcard's tags (with a did-you-mean), self
references and cycles. Reads go the other way: `display_text` shows stored
refs with the target's current name, so what the model reads is what it can
write back.

What each surface may hold follows the engine (docs: Syntax):

    surface    $var   {a|b} picks   @{…} refs
    option      –        ✓            ✓        wildcard option text
    negative    –        ✓            ✓        a wildcard option's negative
    action      ✓        ✓            ✓        derivation action value
    combine     ✓        ✓            –        combine template
    fixed       –        ✓            –        fixed value
    template    ✓        –            –        Assembler template (seedless)

Anything else is refused with a reason the model can act on.
"""
from __future__ import annotations

import difflib
import re
from typing import Any

from engine.syntax.subcat_filter import ParseError, parse, reads_as, validate_subcat_name
from engine.syntax.tokenize import tokenize_text
from engine.syntax.types import TokenKind

SURFACES = ("option", "negative", "action", "combine", "fixed", "template")
_ALLOW: dict[str, tuple[bool, bool, bool]] = {
    # surface: (vars, picks, refs)
    "option": (False, True, True),
    "negative": (False, True, True),
    "action": (True, True, True),
    "combine": (True, True, False),
    "fixed": (False, True, False),
    "template": (True, False, False),
}
_WHY_NO_VAR = {
    "option": "an option can't read $variables (a wildcard sets one); "
              "join variables in a combine or a derivation instead",
    "negative": "a negative can't read $variables",
    "fixed": "a fixed value can't read $variables; use a combine",
}
_WHY_NO_PICK = {
    "template": "the Assembler doesn't pick, so {a|b} would stay as written; "
                "put the choice in a wildcard or a combine and read its variable",
}
_WHY_NO_REF = {
    "combine": "a combine can't pick from another wildcard (@{…} stays as written); "
               "add the wildcard to the stack and read its $variable",
    "fixed": "a fixed value can't pick from another wildcard; use a wildcard",
    "template": "the Assembler can't pick from a wildcard; read its $variable",
}
_HEX8 = re.compile(r"^[0-9a-f]{8}$")
# @{ head [#label] [:filter] [!null] } where head is a name, $var or 8-hex id.
_NAMED_REF = re.compile(
    r"@\{([^{}#:!]+?)\s*(?:#([^{}#:!]*))?(?::((?:[^{}!]|!(?!\s*null\s*\}))*))?(?:!\s*(\w+)\s*)?\}"
)
_LABEL_BAD = re.compile(r"[#:}@{!]")
_IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def _tags_of(payload: dict[str, Any]) -> list[str]:
    return [t for t in payload.get("sub_categories") or [] if isinstance(t, str)]


class RefIndex:
    """The wildcards a ref may name: library rows plus any being built
    (``{"id", "name", "payload"}``). Later rows replace earlier ones with the
    same id, so a pack's or an editor's version wins over the saved one."""

    def __init__(self, rows: list[dict[str, Any]] | None = None) -> None:
        self.rows: dict[str, dict[str, Any]] = {}
        for r in rows or []:
            self.add(r)

    def add(self, row: dict[str, Any]) -> None:
        if (isinstance(row, dict) and isinstance(row.get("id"), str)
                and (row.get("type") in (None, "wildcard"))
                and isinstance(row.get("payload"), dict)):
            self.rows[row["id"]] = row

    def __bool__(self) -> bool:
        return bool(self.rows)

    def name_of(self, mid: str) -> str:
        r = self.rows.get(mid)
        return str(r.get("name") or "") if r else ""

    def find(self, head: str) -> dict[str, Any] | None:
        """A row by id, exact name, case-insensitive name, or ``$var``."""
        head = head.strip()
        if _HEX8.match(head) and head in self.rows:
            return self.rows[head]
        if head.startswith("$"):
            var = head[1:]
            return next((r for r in self.rows.values()
                         if r["payload"].get("var_binding") == var), None)
        exact = [r for r in self.rows.values() if r.get("name") == head]
        if exact:
            return exact[0]
        low = head.lower()
        return next((r for r in self.rows.values()
                     if str(r.get("name") or "").lower() == low), None)

    def close_names(self, head: str) -> list[str]:
        names = [str(r.get("name") or "") for r in self.rows.values() if r.get("name")]
        return difflib.get_close_matches(head, names, n=3, cutoff=0.6)

    def targets(self, mid: str) -> set[str]:
        """Ids the wildcard's options and negatives point at."""
        r = self.rows.get(mid)
        out: set[str] = set()
        if not r:
            return out
        for o in r["payload"].get("options") or []:
            if not isinstance(o, dict):
                continue
            for field in ("value", "negative"):
                text = o.get(field)
                if isinstance(text, str) and "@{" in text:
                    out.update(t.meta["uuid"] for t in tokenize_text(text)
                               if t.kind is TokenKind.REF)
        return out

    def reaches(self, start: str, goal: str) -> bool:
        """Does ``start`` reach ``goal`` through refs?"""
        seen: set[str] = set()
        stack = [start]
        while stack:
            cur = stack.pop()
            if cur == goal:
                return True
            if cur in seen:
                continue
            seen.add(cur)
            stack.extend(self.targets(cur))
        return False

    def describe(self, *, limit: int = 60, exclude: str | None = None) -> str:
        """One line per wildcard for a prompt: name, $var and tags."""
        lines = []
        for r in list(self.rows.values()):
            if r["id"] == exclude:
                continue
            p = r["payload"]
            bits = [f"@{{{r.get('name') or r['id']}}}"]
            if p.get("var_binding"):
                bits.append(f"(${p['var_binding']})")
            tags = _tags_of(p)
            if tags:
                bits.append("tags: " + ", ".join(tags[:20]))
            lines.append(" ".join(bits))
            if len(lines) >= limit:
                lines.append(f"(+{len(self.rows) - limit} more)")
                break
        return "\n".join(lines)


def _label(name: str) -> str:
    return _LABEL_BAD.sub("", name).strip()[:60]


def _ref(row: dict[str, Any], expr: str, null: bool) -> str:
    label = _label(str(row.get("name") or ""))
    out = "@{" + row["id"] + (f"#{label}" if label else "")
    if expr:
        out += ":" + expr
    if null:
        out += "!null"
    return out + "}"


def _check_filter(expr: str, row: dict[str, Any]) -> str:
    """The filter, normalised, or ValueError naming the bad tag."""
    expr = " ".join(expr.split())
    if not expr:
        return ""
    try:
        ast = parse(expr)
    except ParseError as e:
        raise ValueError(f"the filter {expr!r} doesn't parse: {e}") from None
    if ast is None:
        return ""
    tags = _tags_of(row["payload"])
    lower = {t.lower(): t for t in tags}
    terms: list[str] = []

    def walk(n: dict[str, Any]) -> None:
        if "tag" in n:
            terms.append(n["tag"])
        elif n["op"] == "not":
            walk(n["x"])
        else:
            for k in n["kids"]:
                walk(k)

    walk(ast)
    for t in terms:
        if t in tags:
            continue
        if t.lower() in lower:  # the engine compares exactly; fix the case
            expr = re.sub(rf"(?<![^\s(,]){re.escape(t)}(?![^\s),])", lower[t.lower()], expr)
            continue
        near = difflib.get_close_matches(t, tags, n=2, cutoff=0.6)
        name = row.get("name") or row["id"]
        hint = f"; did you mean {' or '.join(near)}?" if near else (
            f"; its tags are {', '.join(tags[:15])}" if tags else "; it has no tags")
        raise ValueError(f"{name} has no tag {t!r}{hint}")
    # `!warm` parses as `not warm`; store the spelled-out form.
    return reads_as(parse(expr)) if "!" in expr else expr


def compile_refs(text: str, index: RefIndex | None, *, self_id: str | None = None) -> str:
    """Name-based refs in ``text`` → stored ``@{id#Name:filter!null}``."""
    if "@{" not in text:
        return text

    def sub(m: re.Match[str]) -> str:
        head, expr, flag = m.group(1).strip(), (m.group(3) or "").strip(), m.group(4)
        if flag is not None and flag != "null":
            raise ValueError(f"@{{{head}…!{flag}}}: only !null goes after the filter")
        if index is None or not index:
            raise ValueError("there are no wildcards to point at here")
        row = index.find(head)
        if row is None:
            near = index.close_names(head.lstrip("$"))
            raise ValueError(f"no wildcard named {head!r}"
                             + (f"; did you mean {' or '.join(near)}?" if near else ""))
        if self_id and row["id"] == self_id:
            raise ValueError(f"@{{{head}}} points at the wildcard itself")
        if self_id and index.reaches(row["id"], self_id):
            raise ValueError(f"@{{{head}}} points back at this wildcard (a loop)")
        return _ref(row, _check_filter(expr, row), flag == "null")

    return _NAMED_REF.sub(sub, text)


def compile_text(
    text: str, *, surface: str, refs: RefIndex | None = None, self_id: str | None = None,
) -> str:
    """``text`` as it should be stored on ``surface``; ValueError says why
    not. Name refs become id refs; everything else is kept as written."""
    allow_var, allow_pick, allow_ref = _ALLOW[surface]
    if "@{" in text:
        if not allow_ref:
            raise ValueError(_WHY_NO_REF.get(surface, "no @{…} here"))
        text = compile_refs(text, refs, self_id=self_id)
    for tok in tokenize_text(text):
        if tok.kind is TokenKind.VAR and not allow_var:
            raise ValueError(_WHY_NO_VAR.get(surface, "no $variables here")
                             + " (write $$ for a literal $)")
        if tok.kind in (TokenKind.DP_BRACE, TokenKind.DP_MULTI):
            if not allow_pick:
                raise ValueError(_WHY_NO_PICK.get(surface, "no {a|b} picks here"))
            for branch in tok.meta.get("branches") or []:
                compile_text(branch, surface=surface, refs=refs, self_id=self_id)
        if tok.kind is TokenKind.TEXT and ("{" in tok.raw or "}" in tok.raw):
            raise ValueError("a { } that isn't a pick: write {a|b}, {2$$, $$a|b|c}, or "
                             "drop the braces")
        if tok.kind is TokenKind.TEXT and "@" in tok.raw:
            for m in re.finditer(r"@(\$?[\w\"][\w \"-]*)", tok.raw):
                word = m.group(1).strip('" ')
                if refs and allow_ref and (refs.find(word) or refs.find(word.split(" ")[0])):
                    raise ValueError(f"point at a wildcard as @{{{word.split(' ')[0]}}} "
                                     "(braces), optionally @{Name:tag}")
    return text


def display_text(text: Any, index: RefIndex | None = None) -> str:
    """Stored text with refs shown by name: ``@{Name:filter!null}``."""
    if not isinstance(text, str) or "@{" not in text:
        return text if isinstance(text, str) else ""
    out = []
    for tok in tokenize_text(text):
        if tok.kind is not TokenKind.REF:
            out.append(tok.raw)
            continue
        uuid = tok.meta["uuid"]
        name = (index.name_of(uuid) if index else "") or tok.meta.get("name") or uuid
        piece = "@{" + _label(name)
        if tok.meta.get("filter_expr"):
            piece += ":" + tok.meta["filter_expr"].strip()
        if tok.meta.get("exclude_null"):
            piece += "!null"
        out.append(piece + "}")
    return "".join(out)


def ref_targets(text: Any) -> list[str]:
    """Ids a stored text points at."""
    if not isinstance(text, str) or "@{" not in text:
        return []
    return [t.meta["uuid"] for t in tokenize_text(text) if t.kind is TokenKind.REF]


def has_pick(text: Any) -> bool:
    """Does stored text hold an inline ``{a|b}`` pick?"""
    return isinstance(text, str) and any(
        t.kind in (TokenKind.DP_BRACE, TokenKind.DP_MULTI) for t in tokenize_text(text))


def valid_axis_name(name: str) -> bool:
    return bool(_IDENT.fullmatch(name)) and name != "neg" and not validate_subcat_name(name)
