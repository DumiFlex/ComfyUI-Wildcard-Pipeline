"""Strip `$var` tokens the engine couldn't bind at runtime.

Reads ctx.warnings looking for type='unknown_var' entries. For each,
removes the matching `$<name>` occurrences from the prompt. Escaped
sequences (`\\$name`) are preserved.
"""
from __future__ import annotations

import re

from engine.cleaner.types import CleanerCtx, RuleResult


def _unbound_names(ctx: CleanerCtx) -> set[str]:
    out: set[str] = set()
    for w in ctx.warnings:
        if not isinstance(w, dict):
            continue
        if w.get("type") != "unknown_var":
            continue
        detail = w.get("detail") or {}
        if not isinstance(detail, dict):
            continue
        name = detail.get("name")
        if isinstance(name, str) and name:
            out.add(name)
    return out


_STRAY_BEFORE_COMMA = re.compile(r"\s+,")
_DOUBLE_COMMA = re.compile(r",\s*,+")
_LEADING_PUNCT_RUN = re.compile(r"^[,\s]+")
_TRAILING_PUNCT_RUN = re.compile(r"[,\s]+$")
_DOUBLE_SPACE = re.compile(r"  +")


def _cleanup_stray(text: str) -> str:
    """Scrub stray comma/space artifacts left behind by var strips.

    A var sitting alone in a comma-separated list (`a, $var, b`)
    leaves `a, , b` after the substitution. Collapse those into the
    surrounding context so the cleaner-output isn't littered with the
    user-invisible scar of the removed token.
    """
    out = _DOUBLE_COMMA.sub(",", text)
    out = _STRAY_BEFORE_COMMA.sub(",", out)
    out = _DOUBLE_SPACE.sub(" ", out)
    out = _LEADING_PUNCT_RUN.sub("", out)
    out = _TRAILING_PUNCT_RUN.sub("", out)
    return out


def apply(text: str, mode: str, ctx: CleanerCtx | None, config: dict) -> RuleResult:
    if ctx is None:
        return {"text": text, "stats": {}}
    names = _unbound_names(ctx)
    if not names:
        return {"text": text, "stats": {"stripped": []}}
    stripped: list[str] = []
    out = text
    for name in names:
        pattern = re.compile(rf"(?<!\\)\${re.escape(name)}\b")
        new = pattern.sub("", out)
        if new != out:
            stripped.append(f"${name}")
        out = new
    if stripped:
        out = _cleanup_stray(out)
    return {"text": out, "stats": {"stripped": stripped}}
