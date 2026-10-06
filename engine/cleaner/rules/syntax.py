"""Bracket-aware rules: empty groups + nested weight merging.

Both rules read the prompt as ComfyUI's weight grammar sees it: `( )`
groups (each bare group is a 1.1 weight, `(x:w)` sets one, nested weights
multiply) and `[ ]` groups (not a weight in ComfyUI, but still emptied).

The scanner keeps three things as literal text it never looks inside:

  * escapes — `\\(` and `\\)` are literal parens (`artist \\(style\\)`);
  * angle tags — `<lora:name:0.8>` and siblings are file references;
  * anything after a bracket that doesn't balance — see below.

If the brackets don't balance (a stray `(` or `)`), the rules return the
prompt exactly as written: guessing which paren the author meant could
re-weight half the prompt.

`empty_groups` drops `()`, `[]`, `( , )`, `(:1.2)` and groups left empty
once their own empty children are gone, then closes the seam the group
left (`red (), dress` -> `red, dress`), the way the resolver's join tidy
closes the seam an empty `@{ref}` leaves.

`merge_weights` folds a group whose whole content is another `( )` group
into one group with the product weight (`((a:1.1):1.2)` -> `(a:1.32)`,
`((a))` -> `(a:1.21)`), and unwraps a group whose weight is exactly 1
(`(a:1.0)` -> `a`). Weights are rounded to 2 decimals. A group with
anything beside the inner group (`((a:1.1), b:1.2)`) is left alone, since
merging would change what the outer weight applies to.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from engine.cleaner.types import RuleResult

_OPEN = {"(": ")", "[": "]"}
_CLOSE = {")", "]"}

# `:1.2` at the end of a group's content. ComfyUI splits on the LAST colon
# and only treats the tail as a weight when it parses as a number.
_WEIGHT_TAIL = re.compile(r"^(?P<body>.*?)\s*:\s*(?P<w>[-+]?(?:\d+\.?\d*|\.\d+))\s*$", re.DOTALL)
_EMPTY_TAIL = re.compile(r"^[\s,]*(?::\s*[-+]?(?:\d+\.?\d*|\.\d+)\s*)?[\s,]*$")

#: Placeholder for a removed group until its seam is closed. A control char
#: no prompt contains.
_GAP = "\x00"
_HWS = " \t"


@dataclass
class _Group:
    open: str
    children: list[str | _Group] = field(default_factory=list)
    #: Built by a merge, so folding it again isn't a second merge.
    merged: bool = False


def _parse(text: str) -> list[str | _Group] | None:
    """Split `text` into literal runs and bracket groups. None when the
    brackets don't balance."""
    root: list[str | _Group] = []
    stack: list[_Group] = []
    buf: list[str] = []

    def flush() -> None:
        if buf:
            (stack[-1].children if stack else root).append("".join(buf))
            buf.clear()

    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch == "\\" and i + 1 < n:
            buf.append(text[i : i + 2])
            i += 2
            continue
        if ch == "<":
            end = text.find(">", i + 1)
            nxt = text.find("<", i + 1)
            if end != -1 and (nxt == -1 or nxt > end):
                buf.append(text[i : end + 1])
                i = end + 1
                continue
        if ch in _OPEN:
            flush()
            group = _Group(ch)
            (stack[-1].children if stack else root).append(group)
            stack.append(group)
        elif ch in _CLOSE:
            if not stack or _OPEN[stack[-1].open] != ch:
                return None
            flush()
            stack.pop()
        else:
            buf.append(ch)
        i += 1
    if stack:
        return None
    flush()
    return root


def _render(nodes: list[str | _Group]) -> str:
    return "".join(n if isinstance(n, str) else _render_group(n) for n in nodes)


def _render_group(g: _Group) -> str:
    return g.open + _render(g.children) + _OPEN[g.open]


# ---------------------------------------------------------------- empty groups


def _drop_empty(nodes: list[str | _Group], counter: list[int]) -> list[str | _Group]:
    out: list[str | _Group] = []
    for node in nodes:
        if isinstance(node, str):
            out.append(node)
            continue
        node.children = _drop_empty(node.children, counter)
        inner = _render(node.children).replace(_GAP, "")
        if _EMPTY_TAIL.match(inner):
            counter[0] += 1
            out.append(_GAP)
        else:
            out.append(node)
    return out


def _close_gaps(text: str) -> str:
    """Close the seam each removed group left behind."""
    while _GAP in text:
        idx = text.index(_GAP)
        left = text[:idx].rstrip(_HWS)
        right = text[idx + 1 :]
        # Runs of gaps (`() []`) close as one seam.
        while right.lstrip(_HWS).startswith(_GAP):
            right = right.lstrip(_HWS)[1:]
        had_ws = text[:idx] != left or right[:1] in (" ", "\t")
        right = right.lstrip(_HWS)
        if not left:
            if right.startswith(","):
                right = right[1:].lstrip(_HWS)
            text = right
            continue
        if not right:
            text = left[:-1].rstrip(_HWS) if left.endswith(",") else left
            continue
        if left.endswith(",") and right.startswith(","):
            right = right[1:].lstrip(_HWS)
            text = left + (" " if right else "") + right
            continue
        if left.endswith(",") and right[0] in ")]":
            text = left[:-1].rstrip(_HWS) + right
            continue
        if left[-1] in "([" and right.startswith(","):
            text = left + right[1:].lstrip(_HWS)
            continue
        joiner = "" if right[0] in ",)]\n" or left[-1] in "([\n" else (" " if had_ws else "")
        text = left + joiner + right
    return text


def apply_empty_groups(text: str, mode: str, config: dict) -> RuleResult:
    tree = _parse(text)
    if tree is None:
        return {"text": text, "stats": {"removed": 0}}
    counter = [0]
    tree = _drop_empty(tree, counter)
    if not counter[0]:
        return {"text": text, "stats": {"removed": 0}}
    return {"text": _close_gaps(_render(tree)), "stats": {"removed": counter[0]}}


# --------------------------------------------------------------- merge weights


def _fmt(weight: float) -> str:
    return f"{weight:.2f}".rstrip("0").rstrip(".")


def _split_weight(g: _Group) -> tuple[list[str | _Group], float, bool]:
    """(body nodes, weight, explicit) for a `( )` group. The weight tail can
    only sit in the group's last literal run."""
    last = g.children[-1] if g.children else None
    if isinstance(last, str):
        m = _WEIGHT_TAIL.match(last)
        if m and (m.group("body").strip() or len(g.children) > 1):
            body = [*g.children[:-1], m.group("body")] if m.group("body") else list(g.children[:-1])
            return body, float(m.group("w")), True
    return list(g.children), 1.1, False


def _only_group(body: list[str | _Group]) -> _Group | None:
    """The single `( )` group `body` consists of, ignoring whitespace."""
    groups = [n for n in body if isinstance(n, _Group)]
    if len(groups) != 1 or groups[0].open != "(":
        return None
    if any(isinstance(n, str) and n.strip() for n in body):
        return None
    return groups[0]


def _merge(nodes: list[str | _Group], counter: list[int]) -> list[str | _Group]:
    out: list[str | _Group] = []
    for node in nodes:
        if isinstance(node, str):
            out.append(node)
            continue
        node.children = _merge(node.children, counter)
        if node.open != "(":
            out.append(node)
            continue
        body, weight, explicit = _split_weight(node)
        inner = _only_group(body)
        changed = False
        counted = inner is not None and inner.merged
        while inner is not None:
            inner_body, inner_w, _ = _split_weight(inner)
            body, weight, explicit = inner_body, round(weight * inner_w, 6), True
            changed = True
            inner = _only_group(body)
        if explicit and round(weight, 2) == 1:
            counter[0] += 0 if counted else 1
            out.extend(body)
            continue
        if changed:
            counter[0] += 0 if counted else 1
            out.append(_Group("(", [*body, f":{_fmt(weight)}"], merged=True))
            continue
        out.append(node)
    return out


def apply_merge_weights(text: str, mode: str, config: dict) -> RuleResult:
    tree = _parse(text)
    if tree is None:
        return {"text": text, "stats": {"merged": 0}}
    counter = [0]
    tree = _merge(tree, counter)
    if not counter[0]:
        return {"text": text, "stats": {"merged": 0}}
    return {"text": _render(tree), "stats": {"merged": counter[0]}}
