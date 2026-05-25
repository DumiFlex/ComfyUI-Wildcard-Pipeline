"""Blocklist filter — drop tags matching a user-supplied list or regex set.

Two modes (chosen via config.blocklist.kind):
  - "list":  case-insensitive word-boundary substring match within each
             tag (tags mode) or whole-string (text mode). Drops the
             whole matching tag.
  - "regex": each entry compiled separately; bad patterns are caught
             and reported in stats.errors so a single bad regex doesn't
             kill the cleaner.

The widget's blocklist modal owns mode selection + entry editing.
"""
from __future__ import annotations

import re

from engine.cleaner.types import RuleResult

# Post-strip cleanup patterns for text mode. After removing a blocklist
# match the surrounding `, .` artifacts need to collapse so the user
# doesn't see "cfg, . avoid" where "cfg, steps. avoid" used to be.
_TEXT_ORPHAN_PUNCT = re.compile(r"\s+[.,:;!?]+(?=\s|$)")
_TEXT_DOUBLE_SPACE = re.compile(r"\s{2,}")
_TEXT_STRAY_EDGES = re.compile(r"^[\s.,:;!?]+|[\s.,:;!?]+$")


def _cleanup_text(s: str) -> str:
    out = _TEXT_ORPHAN_PUNCT.sub("", s)
    out = _TEXT_DOUBLE_SPACE.sub(" ", out)
    out = _TEXT_STRAY_EDGES.sub("", out)
    return out


def apply(text: str, mode: str, config: dict) -> RuleResult:
    blocklist = (config or {}).get("blocklist") or {}
    kind = blocklist.get("kind", "list")
    entries = blocklist.get("entries") or []
    if not entries:
        return {"text": text, "stats": {"dropped": [], "errors": []}}

    if kind == "regex":
        return _apply_regex(text, mode, entries)
    return _apply_list(text, mode, entries)


def _apply_list(text: str, mode: str, entries: list[str]) -> RuleResult:
    norm_entries = [e for e in entries if isinstance(e, str) and e]
    dropped: list[str] = []
    if mode == "tags":
        tags = [t.strip() for t in text.split(",") if t.strip()]
        kept: list[str] = []
        compiled: list[tuple[str, re.Pattern[str]]] = []
        for entry in norm_entries:
            try:
                compiled.append((entry, re.compile(rf"\b{re.escape(entry)}\b", re.IGNORECASE)))
            except re.error:
                continue
        for tag in tags:
            if any(p.search(tag) or tag.casefold() == src.casefold() for src, p in compiled):
                dropped.append(tag)
            else:
                kept.append(tag)
        out = ", ".join(kept)
    else:
        out = text
        any_changed = False
        for entry in norm_entries:
            pattern = re.compile(rf"\b{re.escape(entry)}\b", re.IGNORECASE)
            new = pattern.sub("", out)
            if new != out:
                dropped.append(entry)
                any_changed = True
            out = new
        if any_changed:
            out = _cleanup_text(out)
    return {"text": out, "stats": {"dropped": dropped, "errors": []}}


def _apply_regex(text: str, mode: str, entries: list[str]) -> RuleResult:
    out = text
    dropped: list[str] = []
    errors: list[str] = []
    compiled: list[tuple[str, re.Pattern[str]]] = []
    for entry in entries:
        if not isinstance(entry, str) or not entry:
            continue
        try:
            compiled.append((entry, re.compile(entry, re.IGNORECASE)))
        except re.error:
            errors.append(entry)
    if mode == "tags":
        tags = [t.strip() for t in out.split(",") if t.strip()]
        kept: list[str] = []
        for tag in tags:
            matched = any(p.search(tag) for _, p in compiled)
            if matched:
                dropped.append(tag)
            else:
                kept.append(tag)
        out = ", ".join(kept)
    else:
        any_changed = False
        for source, pattern in compiled:
            new = pattern.sub("", out)
            if new != out:
                dropped.append(source)
                any_changed = True
            out = new
        if any_changed:
            out = _cleanup_text(out)
    return {"text": out, "stats": {"dropped": dropped, "errors": errors}}
