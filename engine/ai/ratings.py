"""Content ratings the assistant proposes, kept in step with the tags.

A library item is rated "safe" or "nsfw". The bench found the two
disagreeing (critique #38, 2026-10-27):

- a chat-made wildcard tagged #nsfw came out rated Safe (Z11, Z16), because
  the create tools had no rating at all. `rate_new` gives a new item the
  model's rating, and NSFW whenever its tags (#nsfw, #explicit…) or its
  text (nude, sex…) say so;
- Organize and the chat's update tools lowered NSFW to Safe and took #nsfw
  off unasked (Z15, L5). `keep_nsfw` drops such a change unless the user's
  words ask for it ("mark these safe", "fix the ratings", "remove the nsfw
  tag"). Raising a rating to NSFW is always allowed: it only hides an item
  from safe views.

Rating tags in a prompt (`rating_tags`): Pony reads `rating_safe`,
`rating_questionable`, `rating_explicit`; "rating explicit" or
"rating: explicit" is neither Pony's spelling nor Danbooru's bare word, so
it is rewritten to the underscore form (P13 mixed "rating explicit" with
"rating_safe"). `rating_levels` lists the levels a prompt says, so a check
can flag a prompt that says two.
"""
from __future__ import annotations

import re
from collections.abc import Iterable

from engine.ai import adult

#: Tags that mean an item is for adults.
NSFW_TAGS = frozenset({"nsfw", "explicit", "adult", "18+", "r18", "r-18", "lewd", "hentai",
                       "porn", "xxx", "erotic", "erotica", "nude", "nudity", "smut"})
#: Sexual words that, in an item's own text, make it NSFW. Not the soft
#: ones ("sexy", "lingerie", "boudoir", "pin-up"): a fashion item may say
#: those and still be safe, which is the user's call.
_SOFT = frozenset({"sexy", "seductive", "lingerie", "panties", "boudoir", "pin-up", "pinup",
                   "pin-ups", "pinups", "fetish", "kinky", "undress", "undressed",
                   "undressing", "ecchi"})

_DOWNGRADE_ASK = re.compile(
    r"\b(?:safe|sfw|rat(?:e|es|ed|ing|ings)|re-?rate|unrate)\b"
    r"|\bnot\s+(?:nsfw|explicit|adult)\b|\bisn'?t\s+(?:nsfw|explicit|adult)\b",
    re.I,
)
_UNTAG_ASK = re.compile(
    r"\b(?:remove|drop|untag|strip|take\s+(?:off|out)|delete|clear|without)\b[^.;\n]{0,40}"
    r"#?\b(?:nsfw|explicit|adult|lewd|r-?18|18\+)",
    re.I,
)


def is_nsfw_tag(tag: str) -> bool:
    return str(tag or "").strip().lstrip("#").lower() in NSFW_TAGS


def nsfw_tagged(tags: Iterable[str]) -> list[str]:
    """The tags in ``tags`` that mean the item is for adults."""
    return [t for t in tags if isinstance(t, str) and is_nsfw_tag(t)]


def strong_explicit(text: str) -> list[str]:
    """The sexual or nude words in ``text`` that make an item NSFW."""
    return [w for w in adult.explicit_words(text) if w not in _SOFT]


def asks_downgrade(text: str) -> bool:
    """True when the user's words ask for a rating change towards safe."""
    return bool(_DOWNGRADE_ASK.search(text or ""))


def asks_untag(text: str) -> bool:
    """True when the user's words ask to take an adult tag off."""
    return bool(_UNTAG_ASK.search(text or "")) or asks_downgrade(text)


def rate_new(rating: object, tags: Iterable[str], text: str) -> tuple[str, str]:
    """A new item's rating and, when it was raised, why: the model's
    ``rating`` ("safe"/"nsfw", else safe), NSFW when ``tags`` or ``text``
    say so."""
    asked = rating if rating in ("safe", "nsfw") else "safe"
    if asked == "nsfw":
        return "nsfw", ""
    tagged = nsfw_tagged(tags)
    if tagged:
        return "nsfw", f"Rated NSFW: it's tagged #{tagged[0]}"
    words = strong_explicit(text)
    if words:
        return "nsfw", f"Rated NSFW: it says {', '.join(words[:3])}"
    return "safe", ""


def keep_nsfw(before_rating: str, before_tags: Iterable[str], rating: str | None,
              removed: Iterable[str], user_text: str) -> tuple[str | None, list[str], list[str]]:
    """``(rating, removed, notes)`` with the unasked parts of a change taken
    out: an NSFW item lowered to safe, or an adult tag removed, when the
    user's words don't ask for it. ``rating`` None means no rating change."""
    notes: list[str] = []
    if rating == "safe" and before_rating == "nsfw" and not asks_downgrade(user_text):
        rating = None
        notes.append("Kept it rated NSFW: lowering a rating to Safe needs your say-so")
    gone = [t for t in removed if is_nsfw_tag(t)]
    if gone and not asks_untag(user_text):
        removed = [t for t in removed if not is_nsfw_tag(t)]
        notes.append(f"Kept #{gone[0]}: taking an adult tag off needs your say-so")
    else:
        removed = list(removed)
    return rating, removed, notes


_RATING_SPACED = re.compile(r"(?<![\w-])rating\s*[:\s]\s*(safe|questionable|explicit)(?![\w-])",
                            re.I)
_RATING_LEVEL = re.compile(r"(?<![\w-])rating_(safe|questionable|explicit)(?![\w-])", re.I)


def rating_tags(text: str) -> tuple[str, int]:
    """``text`` with "rating explicit" / "rating: explicit" written as
    Pony's ``rating_explicit``, and how many were rewritten."""
    if not text or "rating" not in text.lower():
        return text, 0
    out, n = _RATING_SPACED.subn(lambda m: f"rating_{m.group(1).lower()}", text)
    return out, n


def rating_levels(text: str) -> list[str]:
    """The Pony rating levels a prompt says, in order, each once."""
    seen: list[str] = []
    for m in _RATING_LEVEL.finditer(rating_tags(text)[0]):
        level = m.group(1).lower()
        if level not in seen:
            seen.append(level)
    return seen


def payload_rating_tags(kind: str, payload: dict[str, object]) -> tuple[dict[str, object], int]:
    """A pack item's payload with its spaced rating tags rewritten
    (`rating_tags`) in every text it prints: options, values, a combine or
    template and its negative. Returns ``(payload, how many)``."""
    total = 0

    def fix(text: object) -> object:
        nonlocal total
        if not isinstance(text, str):
            return text
        out, n = rating_tags(text)
        total += n
        return out

    out = dict(payload)
    for key in ("options", "values"):
        rows = out.get(key)
        if isinstance(rows, list):
            out[key] = [{**r, "value": fix(r.get("value")),
                         **({"negative": fix(r["negative"])} if r.get("negative") else {})}
                        if isinstance(r, dict) else r for r in rows]
    for key in ("template", "template_string", "negative", "negative_template"):
        if key in out:
            out[key] = fix(out[key])
    return (out, total) if total else (payload, 0)
