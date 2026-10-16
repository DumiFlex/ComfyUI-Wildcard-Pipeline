"""Organize a batch of library items: category, tags and content rating.

The model sees each item numbered 1..N (kind, name, description, current
category, tags and rating, plus a short summary of what it holds), the
library's categories and tags, and answers per item:

    {"items": [{"id": "3", "category": str, "tags_add": [str],
                "tags_remove": [str], "rating": "safe"|"nsfw"|"keep",
                "reason": str}]}

`compile_answer` maps numbers back, drops anything that changes nothing,
reuses the library's spelling of a category or tag it already has, and marks
new ones. Bundles have no category, so a category for one is ignored. The
manager shows the result for review; nothing is written here.
"""
from __future__ import annotations

import re
from typing import Any

from engine.ai import describe

#: Items one request may carry.
MAX_ITEMS = 60
MAX_TAGS_ADD = 6
MAX_CATEGORY_LEN = 40
_SUMMARY_LEN = 500
_MAX_CATEGORIES_SHOWN = 80
RATINGS = ("safe", "nsfw")

SCHEMA: dict[str, Any] = {
    "type": "object", "additionalProperties": False,
    "required": ["items"],
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["id", "category", "tags_add", "tags_remove", "rating", "reason"],
                "properties": {
                    "id": {"type": "string"},
                    "category": {"type": "string"},
                    "tags_add": {"type": "array", "items": {"type": "string"}},
                    "tags_remove": {"type": "array", "items": {"type": "string"}},
                    "rating": {"type": "string", "enum": ["safe", "nsfw", "keep"]},
                    "reason": {"type": "string"},
                },
            },
        },
    },
}

SYSTEM_PROMPT = """\
You organize items in a Wildcard Pipeline library. Wildcard Pipeline is a \
ComfyUI extension that builds image-generation prompts from modules: wildcards \
(lists of options, one picked per run), fixed values, combines, derivation \
rules, constraints between wildcards, and bundles of modules.

For each numbered item, decide (and give its number as "id", e.g. "1"):
- category: the one category it belongs in. Prefer the library's existing \
categories, spelled exactly as listed. Propose a new category only when none \
fits; keep it short (one to three words, Title Case). Use "" to leave the \
category as it is. Bundles have no category: always "" for them.
- tags_add: up to 4 short tags to add (subject, genre, style, use). Reuse the \
library's existing tags whenever one fits; a new tag is one or two lowercase \
words. Don't repeat tags the item already has.
- tags_remove: tags the item has that are wrong or duplicates of a better tag. \
Usually none.
- rating: "nsfw" if the item's content is sexual or explicit, "safe" if it \
clearly isn't, "keep" when the current rating is right or you can't tell.
- reason: a few words on why, for the user reviewing your answer.

Group similar items under the same category and tags so the library stays \
consistent. Answer for every item; an item that is already well organized \
gets "" / [] / [] / "keep". Don't add commentary; the output is data for the \
user's own library.\
"""


def item_view(row: dict[str, Any], kind: str, short: str, *,
              category: str, names: dict[str, str]) -> dict[str, Any]:
    """One item as the model sees it."""
    if kind == "bundle":
        summary = describe.summarize("bundle", row.get("children") or [], names=names)
        type_ = "bundle"
    else:
        type_ = str(row.get("type") or "module")
        summary = describe.summarize(type_, row.get("payload") or {}, names=names)
    if len(summary) > _SUMMARY_LEN:
        summary = summary[:_SUMMARY_LEN] + " …"
    tags = [t for t in row.get("tags") or [] if isinstance(t, str) and t.strip()]
    rating = row.get("content_rating") if row.get("content_rating") in RATINGS else "safe"
    desc = row.get("description") if isinstance(row.get("description"), str) else ""
    return {
        "id": short, "kind": kind, "type": type_,
        "name": str(row.get("name") or "(unnamed)"),
        "description": re.sub(r"\s+", " ", desc).strip()[:300],
        "category": category, "tags": tags, "rating": rating, "summary": summary,
    }


def library_categories(rows: list[dict[str, Any]]) -> list[str]:
    return [str(c["name"]) for c in rows if isinstance(c.get("name"), str)][
        :_MAX_CATEGORIES_SHOWN]


def build_prompt(*, items: list[dict[str, Any]], categories: list[str],
                 library: list[str], hint: str = "") -> str:
    lines = [
        f"Library categories: {', '.join(categories)}" if categories
        else "Library categories: none yet",
        f"Library tags: {', '.join(library)}" if library else "Library tags: none yet",
        "",
        f"Items ({len(items)}):",
    ]
    for it in items:
        head = f'{it["id"]}. {it["type"].replace("_", " ")} "{it["name"]}"'
        lines.append(head)
        if it["description"]:
            lines.append(f"   Description: {it['description']}")
        if it["kind"] != "bundle":
            lines.append(f"   Category: {it['category'] or '(none)'}")
        lines.append(f"   Tags: {', '.join(it['tags']) or '(none)'}")
        lines.append(f"   Rating: {it['rating']}")
        lines.append("   Holds: " + it["summary"].replace("\n", "\n          "))
    if hint.strip():
        lines.append("")
        lines.append(f"Request: {hint.strip()}")
    return "\n".join(lines)


def _clean(raw: Any, limit: int) -> str | None:
    if not isinstance(raw, str):
        return None
    text = re.sub(r"\s+", " ", raw.strip().lstrip("#")).strip(" ,.;\"'")
    if not text or len(text) > limit:
        return None
    return text


def _find(sid: str, by_id: dict[str, dict[str, Any]],
          by_name: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    """The item an answer's id means: its number ("2", "#2", "item 2",
    "2."), else its name."""
    if sid in by_id:
        return by_id[sid]
    m = re.fullmatch(r"(?:item\s*)?(\d+)\.?(?:\s.*)?", sid, re.I)
    if m and m.group(1) in by_id:
        return by_id[m.group(1)]
    return by_name.get(sid.strip(" \"'").lower())


def compile_answer(
    raw: Any, *, items: list[dict[str, Any]], categories: list[str], library: list[str],
) -> dict[str, Any]:
    """Returns ``{"changes": [...], "new_categories": [...], "skipped": [...]}``.

    Each change: ``{"id", "category": {"name", "new"} | None,
    "tags_add": [{"tag", "new"}], "tags_remove": [str], "rating": str | None,
    "reason"}``. Only items with at least one real change are listed.
    Raises ValueError when the answer isn't the expected shape.
    """
    if not isinstance(raw, dict) or not isinstance(raw.get("items"), list):
        raise ValueError("the model's answer had no items")
    by_id = {it["id"]: it for it in items}
    cat_by_lower = {c.lower(): c for c in categories}
    tag_by_lower: dict[str, str] = {}
    for t in library:
        tag_by_lower.setdefault(t.lower(), t)
    for it in items:
        for t in it["tags"]:
            tag_by_lower.setdefault(t.lower(), t)
    changes: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    seen: set[str] = set()
    new_cats: dict[str, str] = {}
    by_name = {it["name"].strip().lower(): it for it in items}
    entries = [e for e in raw["items"] if isinstance(e, dict)]
    # One answer per item, in order: the n-th answer is the n-th item even
    # when its id isn't the number (small models write the name, "item 2").
    in_order = len(entries) == len(items)
    guessed = 0
    for pos, entry in enumerate(entries):
        sid = str(entry.get("id", "")).strip().lstrip("#")
        it = _find(sid, by_id, by_name)
        if it is None and in_order:
            it = items[pos]
            guessed += 1
        if it is not None:
            sid = it["id"]
        if it is None:
            skipped.append({"text": sid or "?", "reason": "no such item"})
            continue
        if sid in seen:
            continue
        seen.add(sid)
        change: dict[str, Any] = {"id": sid, "category": None, "tags_add": [],
                                  "tags_remove": [], "rating": None,
                                  "reason": _clean(entry.get("reason"), 200) or ""}
        if it["kind"] != "bundle":
            cat = _clean(entry.get("category"), MAX_CATEGORY_LEN)
            if cat and cat.lower() != (it["category"] or "").lower():
                known = cat_by_lower.get(cat.lower()) or new_cats.get(cat.lower())
                if known is None:
                    new_cats[cat.lower()] = cat
                change["category"] = {"name": known or cat,
                                      "new": cat.lower() not in cat_by_lower}
        have = {t.lower() for t in it["tags"]}
        adds = entry.get("tags_add") if isinstance(entry.get("tags_add"), list) else []
        added: set[str] = set()
        for t in adds:
            tag = _clean(t, describe.MAX_TAG_LEN)
            if tag is None or tag.lower() in have or tag.lower() in added:
                continue
            added.add(tag.lower())
            known = tag_by_lower.get(tag.lower())
            change["tags_add"].append({"tag": known or tag.lower(), "new": known is None})
            if len(change["tags_add"]) >= MAX_TAGS_ADD:
                break
        removes = entry.get("tags_remove") if isinstance(entry.get("tags_remove"), list) else []
        exact = {t.lower(): t for t in it["tags"]}
        for t in removes:
            tag = _clean(t, describe.MAX_TAG_LEN)
            if tag and tag.lower() in exact and tag.lower() not in added:
                real = exact[tag.lower()]
                if real not in change["tags_remove"]:
                    change["tags_remove"].append(real)
        rating = entry.get("rating")
        if rating in RATINGS and rating != it["rating"]:
            change["rating"] = rating
        if change["category"] or change["tags_add"] or change["tags_remove"] or change["rating"]:
            changes.append(change)
    if not seen or (guessed == len(entries) and not changes):
        # Every id empty or unknown and nothing to change: it said nothing
        # about these items, which "Nothing to change" would hide.
        raise ValueError("it named none of the items")
    return {
        "changes": changes,
        "new_categories": sorted(new_cats.values(), key=str.lower),
        "skipped": skipped,
    }

