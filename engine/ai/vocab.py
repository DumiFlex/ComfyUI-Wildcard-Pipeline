"""The user's own vocabulary for the AI: LoRA and embedding file names, and
the Danbooru tag list.

The data lives in ``wp_api`` (ComfyUI's model folders, the downloaded tag
CSV) and engine/ai never imports it, so the route hands a lookup function
in (``Lookup``). Each source is offered only while the user has its
autocomplete switched on (Settings › Autocomplete; the browser says which)
AND the data is there (a tag list was downloaded, a LoRA folder has files).

Pure: formatting, option-text tag splitting and the tag check.
"""
from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

KINDS = ("tags", "loras", "embeddings")
#: What the browser's autocomplete switches are called in a request.
FLAG_KEYS = {"tags": "tags", "loras": "loras", "embeddings": "embeddings"}
MAX_HITS = 12
MAX_CHECK = 40
#: Tags a pack item's options may use before the check stops counting.
MAX_CHECKED_TAGS = 400

#: ``(kind, query, limit) -> [{name, count?, category?, alias_of?, path?}]``.
Lookup = Callable[[str, str, int], list[dict[str, Any]]]

LABELS = {"tags": "Danbooru tags", "loras": "LoRAs", "embeddings": "embeddings"}
OFF = {
    "tags": "Danbooru tag lookup is off: it needs Tag autocomplete on and the tag list "
            "downloaded (Settings › Autocomplete).",
    "loras": "LoRA lookup is off: it needs LoRA autocomplete on (Settings › Autocomplete) "
             "and LoRA files in ComfyUI's loras folder.",
    "embeddings": "Embedding lookup is off: it needs Embedding autocomplete on "
                  "(Settings › Autocomplete) and files in ComfyUI's embeddings folder.",
}


def flags(raw: Any) -> set[str]:
    """The sources the browser says are switched on: ``{tags, loras,
    embeddings}`` booleans → the set of the true ones."""
    if not isinstance(raw, dict):
        return set()
    return {k for k in KINDS if raw.get(FLAG_KEYS[k]) is True}


def tag_name(text: str) -> str:
    """A tag the way the list spells it: lowercase, spaces as ``_``."""
    return re.sub(r"\s+", "_", text.strip().lower())


_WEIGHT = re.compile(r"^\((.*?)(?::[\d.]+)?\)$")
_SKIP = re.compile(r"[<>$@{}|\\]|^\d+(\.\d+)?$|^score_\d")


def split_tags(text: str) -> list[str]:
    """The plain tags in a comma-separated option text: weights and
    brackets stripped; LoRAs, embeddings, variables, picks, refs, numbers
    and Pony score tags left out (they aren't in the list)."""
    out: list[str] = []
    for part in text.split(","):
        part = part.strip()
        m = _WEIGHT.match(part)
        if m:
            part = m.group(1).strip()
        part = part.strip("()[] ")
        if not part or _SKIP.search(part) or part.lower().startswith("embedding:") \
                or len(part) > 60:
            continue
        out.append(tag_name(part))
    return out


def _exact(hits: list[dict[str, Any]], tag: str) -> dict[str, Any] | None:
    for h in hits:
        if h.get("matched", h.get("name")) == tag or h.get("name") == tag:
            return h
    return None


def check(lookup: Lookup, tags: list[str]) -> tuple[dict[str, dict[str, Any]], list[str]]:
    """Each tag looked up exactly: ``({tag: hit}, unknown)``."""
    known: dict[str, dict[str, Any]] = {}
    unknown: list[str] = []
    for t in dict.fromkeys(tags):
        hit = _exact(lookup("tags", t, 5), t)
        if hit is None:
            unknown.append(t)
        else:
            known[t] = hit
    return known, unknown


def _tag_line(h: dict[str, Any]) -> str:
    line = f"{h['name']} ({h.get('count', 0):,} posts"
    if h.get("category"):
        line += f", {h['category']}"
    line += ")"
    if h.get("matched") and h["matched"] != h["name"]:
        line += f" ← alias {h['matched']}"
    return line


def answer(lookup: Lookup, kind: str, query: str) -> str:
    """The lookup tool's text. For tags, a comma-separated query checks
    each tag (known with its post count, or not in the list with the
    closest ones); a single phrase lists the tags it starts."""
    query = query.strip()
    if kind == "tags" and "," in query:
        tags = [tag_name(t) for t in query.split(",") if t.strip()][:MAX_CHECK]
        known, unknown = check(lookup, tags)
        lines = [f"- {t}: {_tag_line(known[t])}" if t in known else
                 f"- {t}: NOT in the tag list" + _near(lookup, t) for t in tags]
        head = (f"{len(known)} of {len(tags)} are Danbooru tags"
                + ("; models trained on Danbooru tags won't know the others." if unknown
                   else "."))
        return head + "\n" + "\n".join(lines)
    q = tag_name(query) if kind == "tags" else query
    hits = lookup(kind, q, MAX_HITS)
    if not hits:
        return f"No {LABELS[kind]} start with \"{query}\"" + (
            "; try a shorter start or another word." if kind == "tags" else ".")
    if kind == "tags":
        return (f"Danbooru tags starting \"{q}\", most used first:\n"
                + "\n".join(f"- {_tag_line(h)}" for h in hits))
    usage = ("write it as <lora:PATH:0.8> next to its trigger words" if kind == "loras"
             else "write it as embedding:PATH")
    return (f"The user's {LABELS[kind]} matching \"{query}\" ({usage}):\n"
            + "\n".join(f"- {h['name']}" + (f" · path {h['path']}" if h.get("path")
                                            and h["path"] != h["name"] else "")
                        for h in hits))


def _near(lookup: Lookup, tag: str) -> str:
    stem = tag.split("_")[0]
    hits = [h["name"] for h in lookup("tags", stem, 4)] if len(stem) > 2 else []
    return f" (close: {', '.join(hits)})" if hits else ""


def vocab_note(lookup: Lookup | None, kinds: set[str], words: list[str]) -> str:
    """Tags the list knows for an item's subject words, for a build
    request in tag style: real spellings to prefer. "" when off."""
    if lookup is None or "tags" not in kinds:
        return ""
    seen: list[str] = []
    for w in dict.fromkeys(tag_name(x) for x in words if len(x) > 2):
        for h in lookup("tags", w, 6):
            if h["name"] not in seen and h.get("category") in (None, "general"):
                seen.append(h["name"])
        if len(seen) >= 30:
            break
    if not seen:
        return ""
    return ("Danbooru tags in the user's tag list that may fit (real spellings; prefer "
            "them to made-up tags): " + ", ".join(seen[:30]))


def unknown_tags(lookup: Lookup | None, kinds: set[str], texts: list[str]) -> list[str]:
    """Tags in option texts the user's tag list doesn't have."""
    if lookup is None or "tags" not in kinds:
        return []
    tags: list[str] = []
    for t in texts:
        tags += split_tags(t)
        if len(tags) >= MAX_CHECKED_TAGS:
            break
    return check(lookup, tags[:MAX_CHECKED_TAGS])[1]


def loras_note(lookup: Lookup | None, kinds: set[str], words: list[str],
               limit: int = 30) -> str:
    """The user's LoRA files matching a request's words (or the first ones),
    for the planner. "" when the lookup is off or finds nothing."""
    if lookup is None or "loras" not in kinds:
        return ""
    names: list[str] = []
    for w in dict.fromkeys(x for x in words if len(x) > 2):
        names += [h["path"] or h["name"] for h in lookup("loras", w, 8)]
    if len(names) < 5:
        names += [h["path"] or h["name"] for h in lookup("loras", "", limit)]
    names = list(dict.fromkeys(names))[:limit]
    if not names:
        return ""
    return ("LoRA files the user has (as <lora:PATH:0.8>; name a real one where the pack "
            "uses a LoRA): " + ", ".join(names))
