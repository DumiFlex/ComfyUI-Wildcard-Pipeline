"""Wildcard edits: remove, rewrite, retag or re-weight existing options.

The model never sees option ids. The route numbers the options it sends
("1", "2", …) and maps the answer back, so a model can only point at rows
that exist. Each action has its own tiny answer shape, forced by a JSON
schema, and returns ONLY the rows it changes:

    remove    {"remove":  [{"id", "reason"}]}
    rewrite   {"options": [{"id", "text"}]}
    retag     {"options": [{"id", "tags"}]}
    reweight  {"options": [{"id", "weight"}]}

`compile_edit` checks the answer the same way `wildcard.compile_options`
checks new options (syntax, duplicates, tag shape, weight range, then the
engine's `WildcardHandler.validate_payload` on the changed rows) and returns
a before/after list the editor shows for review. Nothing here writes.
"""
from __future__ import annotations

import math
import re
from typing import Any

from engine.ai import about, adult
from engine.ai import refs as ai_refs
from engine.ai.wildcard import (
    MAX_TEXT_LEN,
    _clean_tag,
    _norm_key,
)
from engine.modules.wildcard_handler import WildcardHandler

ACTIONS = ("remove", "rewrite", "retag", "reweight")
#: Options sent per request. Enough for most hand-made lists; a bigger list is
#: edited through a selection, which the editor sends instead.
MAX_EDIT_OPTIONS = 300
MAX_REASON_LEN = 160


def _obj(required: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "object", "additionalProperties": False,
        "required": list(required), "properties": required,
    }


def _list_of(key: str, item: dict[str, Any]) -> dict[str, Any]:
    return _obj({key: {"type": "array", "items": _obj(item)}})


_ID = {"type": "string"}

SCHEMAS: dict[str, dict[str, Any]] = {
    "remove": _list_of("remove", {"id": _ID, "reason": {"type": "string"}}),
    "rewrite": _list_of("options", {"id": _ID, "text": {"type": "string"}}),
    "retag": _list_of("options", {
        "id": _ID, "tags": {"type": "array", "items": {"type": "string"}},
    }),
    "reweight": _list_of("options", {"id": _ID, "weight": {"type": "number"}}),
}

_BASE = """\
You edit wildcard lists for Wildcard Pipeline, a ComfyUI extension that builds \
image-generation prompts. A wildcard is a list of interchangeable options; each \
run picks one option (weighted) and puts its text into the prompt. Every option \
has a number id. Answer only about options in the list, by id, and only list \
the options you change. If nothing should change, return an empty list. Don't \
add commentary or disclaimers; the output is data for the user's own library.\
"""

_GUIDES: dict[str, str] = {
    "remove": """
Task: choose the options to REMOVE because they match the request. For each, \
give a reason of a few words. Keep everything that doesn't clearly match.""",
    "rewrite": """
Task: REWRITE option texts as the request says (for example a different style, \
tags to sentences, fixing typos, shorter). Return the full new text for each \
option you change. Keep each option's meaning unless the request says \
otherwise, keep options distinct from each other. Never use $ in text. Keep \
any {a|b} pick and @{Name} reference unless the request is about them; a \
reference must name a wildcard listed under "Wildcards you can point at".""",
    "retag": """
Task: set TAGS on options as the request says. Return the option's complete new \
tag list (it replaces the old one). Prefer the wildcard's existing tags. A new \
tag is one lowercase word (letters, digits, _ or -).""",
    "reweight": """
Task: set WEIGHTS as the request says. 1 is normal, below 1 is rarer (0.5 is \
half as likely), above 1 is more common (2 is twice as likely), 0 never picks \
the option. Use values from 0 to 100.""",
}


def system_prompt(action: str) -> str:
    return _BASE + "\n" + _GUIDES[action]


def build_edit_prompt(
    *, action: str, instruction: str, name: str, var_binding: str,
    options: list[dict[str, Any]], tags: list[str],
    axes: dict[str, list[str]] | None = None,
    description: str = "", labels: list[str] | None = None,
    refs: ai_refs.RefIndex | None = None,
) -> str:
    """`options` are `{"id", "value", "weight", "sub_categories", "negative"}`
    with the short ids the model answers with."""
    lines: list[str] = [f"Wildcard: {name or '(unnamed)'}"]
    lines.extend(about.lines(description, labels or []))
    if var_binding:
        lines.append(f"Variable: ${var_binding}")
    if axes:
        for axis, members in axes.items():
            if members:
                lines.append(f"Tag group {axis}: {', '.join(members)}")
    grouped = {t for ms in (axes or {}).values() for t in ms}
    loose = [t for t in tags if t not in grouped]
    if loose:
        lines.append(f"Other tags: {', '.join(loose)}")
    if not tags:
        lines.append("Tags: none yet")
    lines.append("")
    lines.append(f"Options ({len(options)}):")
    for o in options:
        extra = []
        if o.get("weight", 1) != 1:
            extra.append(f"weight {o['weight']}")
        if o.get("sub_categories"):
            extra.append("tags " + ", ".join(o["sub_categories"]))
        suffix = f"  [{'; '.join(extra)}]" if extra else ""
        lines.append(f"{o['id']}. {ai_refs.display_text(o['value'], refs)}{suffix}")
    if refs and action == "rewrite":
        lines.append("")
        lines.append("Wildcards you can point at with @{name}:")
        lines.append(refs.describe())
    lines.append("")
    lines.append(f"Request: {instruction.strip()}")
    return "\n".join(lines)


def _clean_weight(raw: Any) -> float | int | None:
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    if not math.isfinite(raw) or raw < 0 or raw > 100:
        return None
    w = round(float(raw), 3)
    return int(w) if w.is_integer() else w


def compile_edit(
    action: str, raw: Any, *, options: list[dict[str, Any]], registry: list[str],
    refs: ai_refs.RefIndex | None = None, self_id: str | None = None,
) -> dict[str, Any]:
    """Check the model's answer against the options it was shown.

    Returns ``{"changes": [...], "new_tags": [...], "skipped": [...]}``. Each
    change is ``{"id", "before": {...}, "after": {...}}`` for the edited
    fields (``after`` is ``None`` for a removal, which carries ``reason``).
    ``id`` is the short id; the route maps it back. Raises ValueError when
    the answer isn't the expected shape at all.
    """
    if action not in ACTIONS:
        raise ValueError(f"unknown action {action!r}")
    key = "remove" if action == "remove" else "options"
    if not isinstance(raw, dict) or not isinstance(raw.get(key), list):
        raise ValueError("the model's answer wasn't the expected list")

    by_id = {o["id"]: o for o in options}
    registry_lower = {t.lower(): t for t in registry}
    changes: list[dict[str, Any]] = []
    new_tags: list[str] = []
    skipped: list[dict[str, str]] = []
    seen: set[str] = set()
    # Texts the list will hold after the rewrite, to refuse a rewrite that
    # turns two options into the same one.
    final_texts = {_norm_key(o["value"]): o["id"] for o in options}

    for item in raw[key]:
        if not isinstance(item, dict):
            continue
        oid = item.get("id")
        if isinstance(oid, (int, float)) and not isinstance(oid, bool):
            oid = str(int(oid))
        if not isinstance(oid, str) or oid.strip() not in by_id:
            skipped.append({"text": str(oid)[:40], "reason": "not an option in the list"})
            continue
        oid = oid.strip()
        if oid in seen:
            continue
        seen.add(oid)
        opt = by_id[oid]

        if action == "remove":
            reason = item.get("reason")
            reason = (
                re.sub(r"\s+", " ", reason).strip()[:MAX_REASON_LEN]
                if isinstance(reason, str) else ""
            )
            changes.append({
                "id": oid, "before": {"value": opt["value"]}, "after": None, "reason": reason,
            })

        elif action == "rewrite":
            text = item.get("text")
            text = re.sub(r"\s+", " ", text).strip() if isinstance(text, str) else ""
            if len(text) > MAX_TEXT_LEN:
                skipped.append({"text": text[:80] + "…", "reason": "too long"})
                continue
            try:
                text = ai_refs.compile_text(text, surface="option", refs=refs, self_id=self_id) \
                    if text else ""
            except ValueError as e:
                skipped.append({"text": text, "reason": str(e)})
                continue
            if not text or text == opt["value"]:
                continue
            if adult.sexual_minor(text):
                skipped.append({"text": text[:80],
                                "reason": "it names a minor in a sexual context"})
                continue
            nk = _norm_key(text)
            if final_texts.get(nk, oid) != oid:
                skipped.append({"text": text, "reason": "same as another option"})
                continue
            final_texts.pop(_norm_key(opt["value"]), None)
            final_texts[nk] = oid
            changes.append({"id": oid, "before": {"value": opt["value"]}, "after": {"value": text}})

        elif action == "retag":
            tags: list[str] = []
            for raw_tag in item.get("tags") or []:
                tag = _clean_tag(raw_tag)
                if tag is None:
                    continue
                tag = registry_lower.get(tag.lower(), tag)
                if tag not in registry and tag not in new_tags:
                    new_tags.append(tag)
                if tag not in tags:
                    tags.append(tag)
            before = list(opt.get("sub_categories") or [])
            if set(tags) == set(before):
                continue
            changes.append({
                "id": oid, "before": {"tags": before}, "after": {"tags": tags},
            })

        else:  # reweight
            w = _clean_weight(item.get("weight"))
            if w is None:
                skipped.append({"text": opt["value"][:80], "reason": "weight out of range"})
                continue
            if w == opt.get("weight", 1):
                continue
            changes.append({
                "id": oid, "before": {"weight": opt.get("weight", 1)}, "after": {"weight": w},
            })

    # Tags only count as new if a change still uses them.
    used = {t for c in changes if c["after"] and "tags" in c["after"] for t in c["after"]["tags"]}
    new_tags = [t for t in new_tags if t in used]
    _validate_changed(changes, by_id, registry, new_tags)
    return {"changes": changes, "new_tags": new_tags, "skipped": skipped}


def _validate_changed(
    changes: list[dict[str, Any]], by_id: dict[str, dict[str, Any]],
    registry: list[str], new_tags: list[str],
) -> None:
    """The changed rows, as they would be saved, must pass the engine check."""
    rows: list[dict[str, Any]] = []
    for i, c in enumerate(changes):
        if c["after"] is None:
            continue
        o = by_id[c["id"]]
        after = c["after"]
        row: dict[str, Any] = {
            "id": f"ai{i:06x}",
            "value": after.get("value", o["value"]),
            "weight": after.get("weight", o.get("weight", 1)),
            "sub_categories": [
                t for t in after.get("tags", o.get("sub_categories") or [])
                if t in registry or t in new_tags
            ],
        }
        rows.append(row)
    if rows:
        WildcardHandler.validate_payload({
            "sub_categories": list(dict.fromkeys(registry + new_tags)),
            "options": rows,
        })
