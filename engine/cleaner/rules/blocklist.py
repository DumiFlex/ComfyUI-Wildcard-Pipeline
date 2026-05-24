"""Blocklist filter — drop tags matching a user-supplied list or regex set.

Two modes (chosen via config.blocklist.kind):
  - "list":  case-insensitive exact tag match (tags mode) or
             word-boundary substring match (text mode)
  - "regex": each entry compiled separately; bad patterns are caught
             and reported in stats.errors so a single bad regex
             doesn't kill the cleaner.

The widget's blocklist modal owns mode selection + entry editing.
"""
from __future__ import annotations

import re

from engine.cleaner.types import CleanerCtx, RuleResult


def apply(text: str, mode: str, ctx: CleanerCtx | None, config: dict) -> RuleResult:
    blocklist = (config or {}).get("blocklist") or {}
    kind = blocklist.get("kind", "list")
    entries = blocklist.get("entries") or []
    if not entries:
        return {"text": text, "stats": {"dropped": [], "errors": []}}

    if kind == "regex":
        return _apply_regex(text, mode, entries)
    return _apply_list(text, mode, entries)


def _apply_list(text: str, mode: str, entries: list[str]) -> RuleResult:
    norm_entries = {e.casefold() for e in entries if isinstance(e, str)}
    dropped: list[str] = []
    if mode == "tags":
        tags = [t.strip() for t in text.split(",") if t.strip()]
        kept: list[str] = []
        for tag in tags:
            if tag.casefold() in norm_entries:
                dropped.append(tag)
            else:
                kept.append(tag)
        out = ", ".join(kept)
    else:
        out = text
        for entry in entries:
            if not isinstance(entry, str) or not entry:
                continue
            pattern = re.compile(rf"\b{re.escape(entry)}\b", re.IGNORECASE)
            new = pattern.sub("", out)
            if new != out:
                dropped.append(entry)
            out = new
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
        for source, pattern in compiled:
            new = pattern.sub("", out)
            if new != out:
                dropped.append(source)
            out = new
    return {"text": out, "stats": {"dropped": dropped, "errors": errors}}
