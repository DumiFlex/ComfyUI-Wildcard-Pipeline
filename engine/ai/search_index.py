"""Ranked search over what library items say and what they hold.

The chat's `search` used to match the query as one substring of an item's
name, description and tags, so "characters" found nothing in a library full
of hair, eye and outfit wildcards. This index also reads each item's content
(option texts, fixed values, combine and template text, derivation and
constraint variables), splits everything into words, folds plurals, and
widens a few broad subjects ("character", "scene", …) to the words those
items actually use. Hits are ranked, and each says where it matched with up
to three matching option texts, so the model sees *why* an item fits.

Pure: rows in, text out. Built per chat request (a few hundred rows).
"""
from __future__ import annotations

import re
from typing import Any

#: A broad subject → words items about it tend to use. Widened words count
#: for less than the query's own words.
TOPICS: dict[str, tuple[str, ...]] = {
    "character": ("hair", "eye", "face", "body", "skin", "outfit", "clothing", "clothes",
                  "dress", "expression", "emotion", "pose", "race", "species", "class",
                  "girl", "boy", "woman", "man", "subject", "person", "accessory",
                  "hairstyle", "breast", "age", "makeup"),
    "person": ("character",),
    "people": ("character",),
    "appearance": ("hair", "eye", "face", "body", "skin", "outfit", "clothing", "makeup"),
    "clothing": ("outfit", "clothes", "dress", "shirt", "skirt", "pants", "shoe", "wear",
                 "uniform", "costume", "armor", "lingerie", "swimsuit", "accessory"),
    "outfit": ("clothing",),
    "scene": ("background", "location", "place", "environment", "setting", "weather",
              "time", "room", "indoor", "outdoor", "landscape"),
    "background": ("scene",),
    "environment": ("scene",),
    "location": ("scene",),
    "style": ("art", "artist", "medium", "painting", "render", "quality", "aesthetic"),
    "lighting": ("light", "shadow", "sun", "lamp", "glow", "illumination"),
    "camera": ("angle", "shot", "view", "lens", "framing", "composition", "close"),
    "emotion": ("expression", "mood", "smile", "face"),
    "expression": ("emotion",),
    "pose": ("posture", "sitting", "standing", "lying", "kneeling", "action", "gesture"),
    "nsfw": ("nude", "naked", "explicit", "lewd", "exposure", "intimate"),
}

_WORD = re.compile(r"[a-z0-9]+")
#: Field weights: a word in the name says more than one in an option.
WEIGHTS = {"name": 4.0, "var": 3.5, "tags": 3.0, "desc": 2.0, "content": 1.0}
WIDENED = 0.4
MAX_SNIPPETS = 3


def stem(word: str) -> str:
    """'characters' → 'character', 'dresses' → 'dress', 'eyes' → 'eye'."""
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith(("ses", "xes", "ches", "shes")):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def words(text: str) -> set[str]:
    return {stem(w) for w in _WORD.findall(text.lower())}


def _strings(value: Any, out: list[str], skip: frozenset[str]) -> None:
    if isinstance(value, str):
        if value.strip():
            out.append(value)
    elif isinstance(value, dict):
        for k, v in value.items():
            if k not in skip:
                _strings(v, out, skip)
    elif isinstance(value, list):
        for v in value:
            _strings(v, out, skip)


_SKIP = frozenset({"id", "_uid", "history", "source_wildcard_id", "target_wildcard_id",
                   "source_id", "target_id", "mode", "op", "match", "effect"})


def options(row: dict[str, Any]) -> list[str]:
    """A wildcard's option texts (empty for other types)."""
    p = row.get("payload")
    if row.get("type") != "wildcard" or not isinstance(p, dict):
        return []
    return [o["value"] for o in p.get("options") or []
            if isinstance(o, dict) and isinstance(o.get("value"), str) and o["value"].strip()]


def content(row: dict[str, Any]) -> list[str]:
    """Every piece of text the item holds, as separate strings."""
    out: list[str] = []
    p = row.get("payload")
    if isinstance(p, dict):
        _strings(p, out, _SKIP)
    elif isinstance(p, list):  # a bundle's children: their names say what it holds
        for child in p:
            if isinstance(child, dict):
                out.extend(str(child.get(k)) for k in ("name", "description") if child.get(k))
    for key in ("template_string", "negative_template"):
        if isinstance(row.get(key), str):
            out.append(row[key])
    return out


def expand(query: str) -> tuple[set[str], set[str]]:
    """The query's own words, and the words its subjects widen to."""
    own = {w for w in words(query) if len(w) > 1}
    widened: set[str] = set()
    for w in own:
        for x in TOPICS.get(w, ()):
            widened.add(stem(x))
            widened.update(stem(y) for y in TOPICS.get(x, ()))
    return own, widened - own


class Entry:
    __slots__ = ("row", "fields", "texts")

    def __init__(self, row: dict[str, Any]) -> None:
        self.row = row
        tags = [t for t in row.get("tags") or [] if isinstance(t, str)]
        p = _got if isinstance(_got := row.get("payload"), dict) else {}
        var = " ".join(str(x) for x in (p.get("var_binding"), p.get("output_var")) if x)
        self.texts = content(row)
        self.fields = {
            "name": words(str(row.get("name") or "")),
            "var": words(var.replace("_", " ")),
            "tags": words(" ".join(tags).replace("_", " ").replace("-", " ")),
            "desc": words(str(row.get("description") or "")),
            "content": words(" ".join(self.texts)),
        }


def score(entry: Entry, own: set[str], widened: set[str], phrase: str) -> tuple[float, list[str]]:
    """How well the item fits, and the fields that matched."""
    total = 0.0
    where: list[str] = []
    for field, have in entry.fields.items():
        hit = len(own & have) + WIDENED * len(widened & have)
        if hit:
            total += WEIGHTS[field] * hit
            where.append(field)
    if phrase and len(phrase) > 2:
        name = str(entry.row.get("name") or "").lower()
        if phrase in name:
            total += 6.0
        elif any(phrase in t.lower() for t in entry.texts[:400]):
            total += 1.5
    return total, where


def snippets(entry: Entry, own: set[str], widened: set[str], phrase: str) -> list[str]:
    """Up to three option texts that match, own words first."""
    opts = options(entry.row) or entry.texts
    best: list[tuple[float, str]] = []
    for text in opts:
        have = words(text)
        s = 2 * len(own & have) + len(widened & have)
        if phrase and phrase in text.lower():
            s += 3
        if s:
            best.append((s, text))
    best.sort(key=lambda x: -x[0])
    return [t for _, t in best[:MAX_SNIPPETS]]
