"""Pack builder settings recommended for one request: by the code, from the
request and the assistant's model, and by the chat (`plan_pack`'s optional
``settings``). Nothing here applies a setting; the Settings step shows each
one that differs from the user's, with its reason, beside a Use recommended
button. Research: /pr-drafts/pack-settings-recommend-2026-10-26.md."""
from __future__ import annotations

import re
from typing import Any

from engine.ai import adult
from engine.ai import budget as ai_budget
from engine.ai import guide as ai_guide
from engine.ai.pack._common import MAX_COUNT, MIN_COUNT
from engine.ai.pack.settings import SETTINGS

#: Families that read Danbooru tags, and those that read phrases
#: (`guide.FORMATS`); Anima mixes both, so it says nothing either way.
TAG_FAMILIES = frozenset({"pony", "illustrious", "noobai", "animagine", "sd15"})
PHRASE_FAMILIES = frozenset({"flux", "sd3", "chroma", "qwen_image", "hidream", "lumina2",
                             "wan", "sdxl"})
#: Families that ignore the negative prompt (`guide.FORMATS`).
NO_NEGATIVE_FAMILIES = frozenset({"flux", "qwen_image", "hidream", "lumina2", "wan"})

#: What the chat may suggest: the request-content settings. Planner and
#: drafts follow the assistant's own model, which the chat model can't
#: judge, and the youth negative is the user's call.
CHAT_KEYS = ("style", "rating", "model", "negatives", "library", "structure", "count")

_TAGS = re.compile(r"\b(?:danbooru|booru|tag[\s-]?style|as tags|in tags)\b", re.I)
_PHRASES = re.compile(r"\b(?:natural[\s-]language|sentences|prose|plain english)\b", re.I)
_SAFE = re.compile(r"\b(?:sfw|safe for work|no nudity|nothing explicit|family[\s-]friendly)\b",
                   re.I)
_NOT_SFW = re.compile(r"\bnot\s+sfw\b|\bnsfw\b", re.I)
_REUSE = re.compile(r"\b(?:my|existing)\s+(?:own\s+)?(?:wildcards?|library|lists?|fixed values)\b"
                    r"|\breuse\b|\buse what i (?:have|already have)\b", re.I)
_FLAT = re.compile(r"\b(?:one|a single|single)\s+(?:flat\s+)?bundle\b|\bflat\b"
                   r"|\b(?:small|tiny|little|quick)\s+pack\b", re.I)
_COUNT = re.compile(r"\b(\d{1,2})\s+(?:options?|values?|entries|choices)\s+"
                    r"(?:each|per\s+(?:wildcard|list|slot))\b"
                    r"|\b(?:each|every)\s+(?:wildcard|list|slot)\s+(?:gets|has|with)\s+"
                    r"(\d{1,2})\b", re.I)


def _labels(fams: list[str]) -> str:
    names = [ai_guide.FAMILY_LABEL.get(f, f) for f in fams]
    return names[0] if len(names) < 2 else ", ".join(names[:-1]) + " and " + names[-1]


def _read(fams: list[str], what: str, verb: str = "read") -> str:
    """"Flux reads natural phrases", "Pony, Illustrious read Danbooru tags"."""
    return f"{_labels(fams)} {verb if len(fams) > 1 else verb + 's'} {what}"


def from_request(request: str, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    """``{settings, reasons}``: the settings the request and the assistant's
    model point to, each with a short reason. A setting the code can't tell
    is left out (the user's own stays)."""
    text = request or ""
    out: dict[str, Any] = {}
    why: dict[str, str] = {}
    fams = ai_guide.families_in(text)
    if len(fams) >= 2:
        out["model"], why["model"] = "family", f"the request names {_labels(fams)}"
    elif fams:
        out["model"], why["model"] = "any", f"the request names one model, {_labels(fams)}"

    if _TAGS.search(text):
        out["style"], why["style"] = "tags", "the request asks for Danbooru tags"
    elif _PHRASES.search(text):
        out["style"], why["style"] = "sentences", "the request asks for natural language"
    elif fams and set(fams) <= TAG_FAMILIES:
        out["style"], why["style"] = "tags", _read(fams, "Danbooru tags")
    elif fams and set(fams) <= PHRASE_FAMILIES:
        out["style"], why["style"] = "sentences", _read(fams, "natural phrases")
    elif len(fams) >= 2:
        out["style"], why["style"] = "auto", (
            f"{_labels(fams)} read different styles, so the planner picks")

    if fams and set(fams) <= NO_NEGATIVE_FAMILIES:
        out["negatives"], why["negatives"] = "none", _read(fams, "the negative prompt", "ignore")
    elif fams:
        out["negatives"], why["negatives"] = "auto", _read(
            [f for f in fams if f not in NO_NEGATIVE_FAMILIES], "a negative prompt")

    explicit = adult.explicit_words(text)
    if not_sfw := _NOT_SFW.search(text):
        out["rating"], why["rating"] = "nsfw", f"the request says \"{not_sfw.group(0).lower()}\""
    elif _SAFE.search(text):
        out["rating"], why["rating"] = "safe", "the request asks for a safe pack"
    elif explicit:
        out["rating"], why["rating"] = "nsfw", f"the request says \"{explicit[0]}\""

    if _REUSE.search(text):
        out["library"], why["library"] = "reuse", "the request asks to use your library"
    if _FLAT.search(text):
        out["structure"], why["structure"] = "flat", "the request asks for a small or flat pack"
    m = _COUNT.search(text)
    if m:
        n = max(MIN_COUNT, min(MAX_COUNT, int(m.group(1) or m.group(2))))
        out["count"], why["count"] = n, f"the request asks for {n} options each"

    if cfg is not None:
        size = ai_budget.model_size(cfg)
        name = str(cfg.get("model") or "the assistant's model")
        out["planner"], why["planner"] = "graph", (
            f"the shape-first planner is the one tested on every model size ({name} is {size})")
        out["drafts"], why["drafts"] = "auto", (
            "a second draft only when the first has a problem, so a clean plan costs nothing extra")
    return {"settings": out, "reasons": why}


#: How each setting value reads on a card ("Tags, Per model family").
LABELS: dict[str, dict[str, str]] = {
    "style": {"auto": "Written as the planner decides", "tags": "Tags",
              "sentences": "Natural phrases"},
    "rating": {"auto": "Rating read from the request", "safe": "Safe", "nsfw": "NSFW"},
    "model": {"any": "Any model", "family": "Per model family"},
    "negatives": {"auto": "Standing + per-option negatives", "template": "Template negative only",
                  "none": "No negatives"},
    "library": {"reuse": "Reuse your library", "inspire": "New, in your library's style",
                "new": "Everything new"},
    "structure": {"sections": "Sub-bundle per section", "flat": "One bundle"},
}


def settings_line(settings: dict[str, Any]) -> str:
    """The settings as one line for a card."""
    parts = [LABELS[k][v] for k, v in settings.items() if k in LABELS and v in LABELS[k]]
    if settings.get("count"):
        parts.append(f"{settings['count']} options each")
    return ", ".join(parts)


def clean_suggested(raw: Any) -> dict[str, Any]:
    """The chat's suggested settings with anything unknown dropped."""
    out: dict[str, Any] = {}
    if not isinstance(raw, dict):
        return out
    for k in CHAT_KEYS:
        v = raw.get(k)
        if k == "count":
            if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0:
                out[k] = max(MIN_COUNT, min(MAX_COUNT, int(v)))
            continue
        if isinstance(v, str) and v.strip().lower() in SETTINGS[k]:
            out[k] = v.strip().lower()
    return out


def recommend(request: str, cfg: dict[str, Any] | None = None,
              suggested: Any = None) -> dict[str, Any]:
    """The code's recommendations with the chat's suggestions on top: the
    chat saw the whole conversation, the description may not say it all.
    Returns ``{settings, reasons}``."""
    got = from_request(request, cfg)
    for k, v in clean_suggested(suggested).items():
        if got["settings"].get(k) == v:
            continue
        got["settings"][k] = v
        got["reasons"][k] = "suggested in the chat"
    return got
