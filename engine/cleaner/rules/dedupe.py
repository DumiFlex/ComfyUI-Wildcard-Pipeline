"""Dedupe family — exact + fuzzy.

- `apply_exact` — drop later occurrences of an identical tag (tags
                  mode only). Leftmost wins. Case-insensitive comparison;
                  preserved case in the kept token.
- `apply_fuzzy` — drop near-duplicates via Levenshtein ratio. Threshold
                  hardcoded at 0.9. Tags mode only.
"""
from __future__ import annotations

from engine.cleaner.atoms import contains_atom
from engine.cleaner.types import RuleResult

_FUZZY_THRESHOLD = 0.9


def _split_tags(text: str) -> list[str]:
    return [t.strip() for t in text.split(",") if t.strip()]


def _join_tags(tags: list[str]) -> str:
    return ", ".join(tags)


def apply_exact(text: str, mode: str, config: dict) -> RuleResult:
    if mode != "tags":
        return {"text": text, "stats": {"dropped": []}}
    tags = _split_tags(text)
    first: dict[str, str] = {}
    kept: list[str] = []
    dropped: list[str] = []
    # `matched[i]` is the earlier tag `dropped[i]` repeats (the Last run
    # window marks it as the reason).
    matched: list[str] = []
    for tag in tags:
        key = tag.casefold()
        if key in first:
            dropped.append(tag)
            matched.append(first[key])
        else:
            first[key] = tag
            kept.append(tag)
    return {"text": _join_tags(kept), "stats": {"dropped": dropped, "matched": matched}}


def _levenshtein_ratio(a: str, b: str) -> float:
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


def apply_fuzzy(text: str, mode: str, config: dict) -> RuleResult:
    if mode != "tags":
        return {"text": text, "stats": {"dropped": []}}
    tags = _split_tags(text)
    kept: list[str] = []
    dropped: list[str] = []
    # `matched[i]` is the kept tag `dropped[i]` was close to, `scores[i]`
    # how close (0-1, two decimals).
    matched: list[str] = []
    scores: list[float] = []
    for tag in tags:
        key = tag.casefold()
        is_dup = False
        # Versioned file references are near-identical strings by design --
        # `embedding:badhandv4` vs `...v5` scores well above the 0.9 threshold
        # while naming two different files. Exact dedupe still collapses a
        # genuinely repeated one; only the FUZZY pass is held back.
        tag_is_atom = contains_atom(tag)
        for kept_tag in kept:
            if tag_is_atom or contains_atom(kept_tag):
                if key == kept_tag.casefold():
                    is_dup, near, score = True, kept_tag, 1.0
                    break
                continue
            score = _ratio(key, kept_tag.casefold())
            if score >= _FUZZY_THRESHOLD:
                is_dup, near = True, kept_tag
                break
        if is_dup:
            dropped.append(tag)
            matched.append(near)
            scores.append(round(score, 2))
        else:
            kept.append(tag)
    return {
        "text": _join_tags(kept),
        "stats": {"dropped": dropped, "matched": matched, "scores": scores},
    }
