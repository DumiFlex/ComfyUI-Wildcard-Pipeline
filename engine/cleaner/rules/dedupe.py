"""Dedupe family — three independently-toggleable rules.

- `apply_exact`     — drop later occurrences of an identical tag
                       (tags mode only). Leftmost wins. Case-insensitive
                       comparison; preserved case in the kept token.
- `apply_wp`        — drop tags matching a WP wildcard pick already
                       injected upstream (needs CleanerCtx).
- `apply_fuzzy`     — drop near-duplicates via Levenshtein ratio.
                       Threshold hardcoded at 0.9 — documented in
                       the spec, not user-tunable in v1.
"""
from __future__ import annotations

from engine.cleaner.types import CleanerCtx, RuleResult

_FUZZY_THRESHOLD = 0.9


def _split_tags(text: str) -> list[str]:
    return [t.strip() for t in text.split(",") if t.strip()]


def _join_tags(tags: list[str]) -> str:
    return ", ".join(tags)


def apply_exact(text: str, mode: str, ctx: CleanerCtx | None, config: dict) -> RuleResult:
    if mode != "tags":
        return {"text": text, "stats": {"dropped": []}}
    tags = _split_tags(text)
    seen: set[str] = set()
    kept: list[str] = []
    dropped: list[str] = []
    for tag in tags:
        key = tag.casefold()
        if key in seen:
            dropped.append(tag)
        else:
            seen.add(key)
            kept.append(tag)
    return {"text": _join_tags(kept), "stats": {"dropped": dropped}}


def apply_wp(text: str, mode: str, ctx: CleanerCtx | None, config: dict) -> RuleResult:
    if ctx is None:
        return {"text": text, "stats": {}}
    pick_values: set[str] = set()
    for pick in ctx.picks.values():
        v = pick.get("value")
        if isinstance(v, str) and v:
            pick_values.add(v.casefold())
    if not pick_values:
        return {"text": text, "stats": {"dropped": []}}
    if mode != "tags":
        return {"text": text, "stats": {"dropped": []}}
    tags = _split_tags(text)
    kept: list[str] = []
    dropped: list[str] = []
    matched_once: set[str] = set()
    for tag in tags:
        key = tag.casefold()
        if key in pick_values and key not in matched_once:
            matched_once.add(key)
            dropped.append(tag)
        else:
            kept.append(tag)
    return {"text": _join_tags(kept), "stats": {"dropped": dropped}}


def _levenshtein_ratio(a: str, b: str) -> float:
    """Vanilla Levenshtein ratio. Pure-Python fallback when rapidfuzz
    isn't installed. Ratio = 1 - distance / max(len(a), len(b))."""
    if a == b:
        return 1.0
    if not a or not b:
        return 0.0
    la, lb = len(a), len(b)
    prev = list(range(lb + 1))
    cur = [0] * (lb + 1)
    for i, ca in enumerate(a, 1):
        cur[0] = i
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
        prev, cur = cur, prev
    distance = prev[lb]
    return 1.0 - distance / max(la, lb)


try:
    from rapidfuzz.fuzz import ratio as _rapidfuzz_ratio  # type: ignore[import-not-found]

    def _ratio(a: str, b: str) -> float:
        return _rapidfuzz_ratio(a, b) / 100.0
except ImportError:
    _ratio = _levenshtein_ratio


def apply_fuzzy(text: str, mode: str, ctx: CleanerCtx | None, config: dict) -> RuleResult:
    if mode != "tags":
        return {"text": text, "stats": {"dropped": []}}
    tags = _split_tags(text)
    kept: list[str] = []
    dropped: list[str] = []
    for tag in tags:
        key = tag.casefold()
        is_dup = False
        for kept_tag in kept:
            if _ratio(key, kept_tag.casefold()) >= _FUZZY_THRESHOLD:
                is_dup = True
                break
        if is_dup:
            dropped.append(tag)
        else:
            kept.append(tag)
    return {"text": _join_tags(kept), "stats": {"dropped": dropped}}
