"""Dedupe family — exact + fuzzy.

- `apply_exact` — drop later occurrences of an identical tag (tags
                  mode only). Leftmost wins. Case-insensitive comparison;
                  preserved case in the kept token.
- `apply_fuzzy` — drop near-duplicates: tags that are the same words once
                  each is made singular and a leading `a` / `an` / `the`
                  is set aside (`a knight` / `knight` / `knights`,
                  `bad hand` / `bad hands`, `dress` / `dresses`), or
                  whose Levenshtein ratio is at least 0.9 (one-letter
                  slips in a longer tag, `detailed backround`). Tags
                  mode only.

The ratio is plain Levenshtein (`1 - distance / longer length`) whether
or not `rapidfuzz` is installed: its `fuzz.ratio` is an Indel score that
rates `red hair` / `red chair` 0.94, so the rule used to drop different
tags on one install and keep plurals on another.
"""
from __future__ import annotations

from engine.cleaner.atoms import contains_atom
from engine.cleaner.types import RuleResult

_FUZZY_THRESHOLD = 0.9

# Prompt keywords, not tags: each `BREAK` starts a new 75-token chunk and
# each `AND` a new prompt to blend, so repeats are the point. Upper case only,
# the way the parsers that read them match.
_KEYWORDS = frozenset({"BREAK", "AND"})


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
        if tag in _KEYWORDS:
            kept.append(tag)
            continue
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
    from rapidfuzz.distance import (
        Levenshtein as _RapidLevenshtein,  # type: ignore[import-not-found]
    )

    def _ratio(a: str, b: str) -> float:
        return float(_RapidLevenshtein.normalized_similarity(a, b))
except ImportError:
    _ratio = _levenshtein_ratio


# Endings that make an English plural, longest first. A word ending in `ss`
# (`dress`, `glass`) or `us` / `is` (`cactus`, `iris`) is already singular.
_ES_AFTER = ("ches", "shes", "sses", "xes", "zes")


def _singular(word: str) -> str:
    if len(word) <= 3 or not word.endswith("s"):
        return word
    if word.endswith("ies") and len(word) > 4:
        return word[:-3] + "y"
    if word.endswith(_ES_AFTER):
        return word[:-2]
    if word.endswith(("ss", "us", "is")):
        return word
    return word[:-1]


_ARTICLES = frozenset({"a", "an", "the"})


def _plural_key(tag: str) -> str:
    """The tag's words without a leading article, each made singular: two
    tags with the same key only differ by `a` / `the` and plurals
    (`a knight`, `knight`, `knights`)."""
    words = tag.split()
    if len(words) > 1 and words[0] in _ARTICLES:
        words = words[1:]
    return " ".join(_singular(w) for w in words)


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
    # `kinds[i]` is why: "form" (same words once singular, article aside) or "close"
    # (the ratio reached the threshold; exact repeats score 1.0).
    kinds: list[str] = []
    for tag in tags:
        key = tag.casefold()
        if tag in _KEYWORDS:
            kept.append(tag)
            continue
        is_dup = False
        near, score, kind = "", 0.0, "close"
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
            kept_key = kept_tag.casefold()
            score = _ratio(key, kept_key)
            if score >= _FUZZY_THRESHOLD:
                is_dup, near = True, kept_tag
                break
            if _plural_key(key) == _plural_key(kept_key):
                is_dup, near, kind = True, kept_tag, "form"
                break
        if is_dup:
            dropped.append(tag)
            matched.append(near)
            scores.append(round(score, 2))
            kinds.append(kind)
        else:
            kept.append(tag)
    return {
        "text": _join_tags(kept),
        "stats": {"dropped": dropped, "matched": matched, "scores": scores, "kinds": kinds},
    }
