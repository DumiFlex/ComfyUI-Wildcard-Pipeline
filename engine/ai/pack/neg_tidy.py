"""Pack builder: negatives and rating tags the code tidies after the model
wrote them (9B bench review, critiques #35 and #38, 2026-10-27).

A small model's negatives list the slot's other options ("dwarf, orc" on
an elf), repeat the option's own words ("sneakers" next to "white
sneakers"), say a word twice, name option ids ("pose_1") and carry Pony's
score tags into packs that never run on Pony. A pack's prompt also mixed
"rating explicit" with "rating_safe". Each pass here is a pure text edit:
the words go, the rest stays in order.
"""
from __future__ import annotations

import re
from collections.abc import Iterable

#: An option id or a variable-like name written as a negative ("pose_1",
#: "outfit_3"): never a picture word.
_ID_LIKE = re.compile(r"^[a-z]+(?:_[a-z]+)*_\d+$")
#: A rating tag in either spelling ("rating_safe", "rating explicit").
RATING = re.compile(r"(?<![\w-])rating[_ ](safe|questionable|explicit|general|sensitive)(?![\w-])",
                    re.I)
#: The ratings a safe pack keeps; an nsfw pack keeps the others.
_SAFE_RATINGS = {"safe", "general"}


def _parts(text: str) -> list[str]:
    return [c.strip() for c in str(text or "").split(",") if c.strip()]


def _key(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip(" .").lower()


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z][a-z'-]+", text.lower()) if len(w) >= 4}


def tidy_negative(negative: str, own: str = "", siblings: Iterable[str] = (),
                  ids: Iterable[str] = ()) -> tuple[str, list[str]]:
    """``negative`` without what doesn't belong in it, and the parts that
    went. Out go: a part said before, an id-like name (or one of ``ids``),
    a part that names the option's own words (``own``: "sneakers" for
    "white sneakers", "watercolor" in a watercolor preset), and a part that
    is another option of the same wildcard (``siblings``): an elf's
    negative listing "dwarf" fights the dwarf pick the next run makes."""
    own_parts = {_key(p) for p in _parts(own)}
    own_words = set().union(*(_words(p) for p in own_parts)) if own_parts else set()
    sib = {_key(p) for s in siblings for p in _parts(s)} - own_parts
    id_set = {_key(i) for i in ids if i}
    kept: list[str] = []
    gone: list[str] = []
    seen: set[str] = set()
    for p in _parts(negative):
        k = _key(p)
        head = k.split()[-1] if k.split() else ""
        if not k or k in seen:
            if k:
                gone.append(p)
            continue
        seen.add(k)
        if _ID_LIKE.match(k) or k in id_set or k in own_parts or k in sib \
                or (len(head) >= 4 and head in own_words):
            gone.append(p)
            continue
        kept.append(p)
    return ", ".join(kept), gone


def dedupe(text: str) -> str:
    """``text`` with each comma part said once ("mutation" twice in the
    standing negative)."""
    seen: set[str] = set()
    out: list[str] = []
    for p in _parts(text):
        k = _key(p)
        if k and k not in seen:
            seen.add(k)
            out.append(p)
    return ", ".join(out)


def fit_ratings(text: str, rating: str) -> tuple[str, int]:
    """Rating tags in the pack's own spelling and rating: underscores
    ("rating_explicit"), and only the ratings the pack is (a safe pack
    keeps safe/general, an nsfw pack the others). Returns the text and how
    many tags changed or went."""
    if not text or not RATING.search(text):
        return text, 0
    nsfw = rating == "nsfw"
    changed = 0
    out: list[str] = []
    seen: set[str] = set()
    for p in _parts(text):
        m = RATING.fullmatch(p.strip())
        if m is None:
            out.append(p)
            continue
        level = m.group(1).lower()
        if rating in ("safe", "nsfw") and (level in _SAFE_RATINGS) == nsfw:
            changed += 1
            continue
        tag = f"rating_{level}"
        changed += tag != p.strip()
        if tag not in seen:
            seen.add(tag)
            out.append(tag)
        else:
            changed += 1
    return ", ".join(out), changed
