"""Pack builder: limits, JSON schemas, patterns and small helpers every phase shares."""
from __future__ import annotations

import re
import secrets
from typing import Any

KINDS = ("wildcard", "library", "fixed_values", "derivation", "combine", "constraint",
         "template")
#: How every option and value in a pack is written.
STYLES = ("tags", "sentences")
MAX_INPUTS = 6
MAX_USE = 200
MAX_ITEMS = 60
MAX_QUESTIONS = 4
MAX_CHOICES = 5
MAX_SECTIONS = 8
MAX_ASSUMPTIONS = 6
MAX_FROM_IMAGES = 4
MAX_DECISIONS = 24
MAX_RESEARCH = 2
MAX_WEB_CHARS = 6000
MIN_COUNT, MAX_COUNT, DEFAULT_COUNT = 4, 60, 12
MAX_ABOUT = 600
MAX_NAME = 80
MAX_TEMPLATE = 4000
CHECK_SEEDS = 200
#: Runs compared to find two variables that are copies of each other.
TWIN_SEEDS = 12
#: Runs a graph plan's relations are checked on (``verify_relations``).
VERIFY_SEEDS = 40
SAMPLE_PROMPTS = 3
#: Sections below this many items go in one bundle even when sections are on.
MIN_SECTIONED = 6
_IDENT = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,63}$")
_VAR_READ = re.compile(r"\$([a-zA-Z_][a-zA-Z0-9_]*)")
_KEY = re.compile(r"^i\d{1,3}$")
_HEX8 = re.compile(r"^[0-9a-f]{8}$")

_STR = {"type": "string"}
_STRS = {"type": "array", "items": _STR}


def _obj(props: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "additionalProperties": False,
            "required": list(props), "properties": props}


ITEM_SCHEMA: dict[str, Any] = _obj({
    "kind": {"type": "string", "enum": list(KINDS)},
    "name": _STR,
    "var": _STR,
    "section": _STR,
    "about": _STR,
    "count": {"type": "integer"},
    "tags": _STRS,
    "source": _STR,
    "target": _STR,
    "use": _STR,
})

#: How the pack is meant to run: one image per run; a story whose frames
#: a WP Context Loop plays in order ($beat from $iteration, the cast held);
#: a sweep sheet (a few short wildcards as Loop sweep axes, the rest held).
#: The planner reads it from the request (or asks), so it lives on the
#: plan, not in the settings.
RUN_MODES = ("single", "story", "sweep")
MIN_FRAMES, MAX_FRAMES, DEFAULT_FRAMES = 2, 12, 4

PLAN_SCHEMA: dict[str, Any] = _obj({
    "title": _STR,
    "summary": _STR,
    "design": _STR,
    "rating": {"type": "string", "enum": ["safe", "nsfw"]},
    "style": {"type": "string", "enum": list(STYLES)},
    "model": _STR,
    "anchor": _STR,
    "questions": {"type": "array", "items": _obj({
        "header": _STR, "question": _STR, "multi": {"type": "boolean"}, "choices": _STRS})},
    "assumptions": _STRS,
    "from_images": _STRS,
    "research": _STRS,
    "run": _obj({"mode": {"type": "string", "enum": list(RUN_MODES)},
                 "frames": {"type": "integer"}}),
    "inputs": {"type": "array", "items": _obj({"var": _STR, "about": _STR, "example": _STR})},
    "sections": {"type": "array", "items": _obj({"name": _STR, "about": _STR})},
    "items": {"type": "array", "items": ITEM_SCHEMA},
})


class PlanError(ValueError):
    """The plan can't be used; the message says why."""


def _clean(text: Any, limit: int) -> str:
    s = re.sub(r"\s+", " ", text).strip() if isinstance(text, str) else ""
    return s[:limit]


def _var(raw: Any) -> str:
    v = _clean(raw, 70).lstrip("$").strip()
    return v if _IDENT.match(v) and not v.startswith("__") else ""


def _tag(raw: Any) -> str:
    t = _clean(raw, 32).lstrip("#").strip().lower().replace(" ", "_")
    return t if t and re.fullmatch(r"[a-z0-9_\-]+", t) else ""


def module_type(item: dict[str, Any]) -> str:
    """The module type an item installs as."""
    if item["kind"] == "library":
        return item.get("library_type") or "wildcard"
    return item["kind"]


def is_wild(item: dict[str, Any]) -> bool:
    """A wildcard the pack runs: one it builds, or one from the library."""
    return module_type(item) == "wildcard" and bool(item["var"])


_TAG_REF = re.compile(r"#([a-z0-9_\-]+)")


def _cut(text: str, limit: int) -> str:
    """``text`` cut to ``limit`` at a clause end ("; "), never mid-tag."""
    if len(text) <= limit:
        return text
    at = text.rfind("; ", 0, limit)
    return text[:at] if at > 0 else text[:limit]


def _once(text: str, var: str) -> str:
    """A merged variable read once: "$tops, $tops OR $tops" → "$tops"."""
    pat = re.compile(r"(\s*(?:,|;|\bor\b|\bOR\b|\band\b|\+)?\s*)\$" + re.escape(var)
                     + r"\b")
    seen = False

    def sub(m: re.Match[str]) -> str:
        nonlocal seen
        if seen:
            return ""
        seen = True
        return m.group(0)
    return pat.sub(sub, text)


def _item(plan: dict[str, Any], key: str) -> dict[str, Any]:
    for i in plan["items"]:
        if i["key"] == key:
            return i
    raise PlanError(f"no item {key} in the plan")


def new_id(taken: set[str]) -> str:
    while True:
        mid = secrets.token_hex(4)
        if mid not in taken:
            taken.add(mid)
            return mid


def _reads(text: str) -> list[str]:
    return list(dict.fromkeys(_VAR_READ.findall(text)))


_NEVER = re.compile(r"\b(never|no|not|can'?t|cannot|excludes?|forbid\w*|without|"
                    r"restrict\w*|ban(?:s|ned)?|prohibit\w*)\b", re.I)


#: Words too common to tell two names or requests apart. The only `_STOP`:
#: the review rules (`_stems`) and the vocab note (`item_vocab_note`) both
#: read this set (before the split the module bound an earlier, shorter set
#: under the same name that this one replaced at import).
_STOP = {"the", "and", "with", "type", "list", "option", "options", "pack", "wildcard",
         "vocabulary", "preset", "style", "values", "for", "from", "each", "that", "this",
         "never", "empty", "sometimes", "none", "tag", "tags", "its", "are", "one"}


def _chunks(text: str) -> set[str]:
    return {c for c in (re.sub(r"\s+", " ", x).strip().lower() for x in text.split(","))
            if len(c) >= 3}
