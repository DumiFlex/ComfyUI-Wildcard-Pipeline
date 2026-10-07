"""Wildcard drafting: what we ask the model, and how its answer is checked.

The model answers in a tiny spec, forced by a JSON schema on every provider:

    {"options": [{"text": str, "weight": number, "tags": [str], "negative": str}]}

It never sees or writes option ids, the tag registry, tag groups or refs.
`compile_options` turns that spec into options the editor can insert:

- text is trimmed and flattened to one line; empty text is dropped;
- anything using extension syntax (``$``, ``@{``, ``{``, ``}``, ``|``) is
  dropped, because the model was told not to and a stray ``$word`` would
  silently become a variable read;
- duplicates of existing options and of each other are dropped
  (case-insensitive, whitespace-collapsed, trailing commas ignored);
- tags are reshaped to the engine's single-token rule, and any tag that still
  fails `validate_subcat_name` is dropped from that option;
- weights outside 0–100 (or not numbers) become 1;
- the new options (with throwaway ids, against the existing tags) must pass
  `WildcardHandler.validate_payload`, the same check a save runs.

Everything dropped is reported back so the user sees why, rather than a
shorter list with no explanation.

Strict-mode note: OpenAI's strict JSON schema needs every property listed in
`required` and `additionalProperties: false`, so "optional" fields are
required here and empty values (``""``, ``[]``) stand for absent.
"""
from __future__ import annotations

import math
import re
from typing import Any

from engine.modules.wildcard_handler import WildcardHandler
from engine.syntax.subcat_filter import validate_subcat_name

MAX_COUNT = 100
MAX_TEXT_LEN = 400
MAX_INSTRUCTION_LEN = 2000
#: How many existing options the model sees as style examples. Enough to show
#: the style and what not to repeat, small enough for an 8K-context local model.
MAX_EXAMPLES = 60

_RESERVED_SYNTAX = ("$", "@{", "{", "}", "|")
_TAG_BAD = re.compile(r"[()!,#:}@{$]")

OPTIONS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["options"],
    "properties": {
        "options": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["text", "weight", "tags", "negative"],
                "properties": {
                    "text": {"type": "string"},
                    "weight": {"type": "number"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "negative": {"type": "string"},
                },
            },
        },
    },
}

SYSTEM_PROMPT = """\
You write wildcard lists for Wildcard Pipeline, a ComfyUI extension that builds \
image-generation prompts. A wildcard is a list of interchangeable options; each \
run picks one option and puts its text into the prompt.

Write each option like this:
- text: one prompt fragment, exactly as it should appear in the prompt. Match the \
style of the existing options: tag style ("red hair, long hair") or plain \
sentences, casing, and length. No numbering, quotes, bullet marks or trailing \
period.
- Never use the characters $ @ { } | in text. They are syntax in this extension.
- Every option must be a real alternative. Don't repeat an existing option or \
reword one.
- weight: 1, unless the request asks for some options to be rarer (below 1) or \
more common (above 1).
- tags: labels for filtering and rules. Prefer the wildcard's existing tags. A \
new tag is one lowercase word (letters, digits, _ or -). Use [] when no tag fits \
or the wildcard has no tags and the request doesn't ask for any.
- negative: words for the negative prompt when this option is picked. Only when \
the request asks for negatives; otherwise "".

Write what the request asks for, in the language of the existing options. Don't \
add commentary or disclaimers; the output is data for the user's own library.\
"""


def _norm_key(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().rstrip(",").strip()).lower()


def build_user_prompt(
    *, instruction: str, count: int, name: str, var_binding: str,
    existing_options: list[str], tags: list[str],
    axes: dict[str, list[str]] | None = None,
) -> str:
    """The per-request message: what exists, then what to add."""
    lines: list[str] = []
    lines.append(f"Wildcard: {name or '(unnamed)'}")
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
    if existing_options:
        shown = existing_options[:MAX_EXAMPLES]
        lines.append("")
        lines.append(f"Existing options ({len(existing_options)}):")
        lines.extend(f"- {o}" for o in shown)
        if len(existing_options) > len(shown):
            lines.append(f"- … and {len(existing_options) - len(shown)} more")
    else:
        lines.append("")
        lines.append("The wildcard is empty.")
    lines.append("")
    lines.append(f"Request: {instruction.strip()}")
    lines.append(f"Write {count} new options.")
    return "\n".join(lines)


def _clean_tag(raw: Any) -> str | None:
    if not isinstance(raw, str):
        return None
    tag = re.sub(r"\s+", "_", raw.strip().lstrip("#"))
    tag = _TAG_BAD.sub("", tag)
    if not tag or validate_subcat_name(tag):
        return None
    return tag


def _clean_weight(raw: Any) -> float | int:
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return 1
    if not math.isfinite(raw) or raw < 0 or raw > 100:
        return 1
    w = round(float(raw), 3)
    return int(w) if w.is_integer() else w


def compile_options(
    raw: Any, *, existing_payload: dict[str, Any], limit: int = MAX_COUNT,
) -> dict[str, Any]:
    """Turn the model's answer into insertable options.

    Returns ``{"options": [...], "new_tags": [...], "skipped": [...]}``. Each
    option is ``{"value", "weight", "tags", "negative"}``, the same shape the
    editor's bulk-add path takes, so the editor assigns ids and owns the
    insert. Raises ValueError when the answer isn't the expected shape at all.
    """
    if not isinstance(raw, dict) or not isinstance(raw.get("options"), list):
        raise ValueError("the model's answer wasn't a list of options")

    existing_opts = existing_payload.get("options") or []
    seen = {
        _norm_key(o.get("value", ""))
        for o in existing_opts
        if isinstance(o, dict) and isinstance(o.get("value"), str)
    }
    registry = [t for t in (existing_payload.get("sub_categories") or []) if isinstance(t, str)]
    registry_lower = {t.lower(): t for t in registry}

    out: list[dict[str, Any]] = []
    new_tags: list[str] = []
    skipped: list[dict[str, str]] = []

    for item in raw["options"]:
        if not isinstance(item, dict):
            continue
        text = item.get("text")
        if not isinstance(text, str):
            continue
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            continue
        if len(out) >= limit:
            skipped.append({"text": text, "reason": "more than you asked for"})
            continue
        if len(text) > MAX_TEXT_LEN:
            skipped.append({"text": text[:80] + "…", "reason": "too long"})
            continue
        if any(s in text for s in _RESERVED_SYNTAX):
            skipped.append({"text": text, "reason": "uses $, @, {, } or |"})
            continue
        key = _norm_key(text)
        if key in seen:
            skipped.append({"text": text, "reason": "duplicate"})
            continue
        seen.add(key)

        tags: list[str] = []
        for raw_tag in item.get("tags") or []:
            tag = _clean_tag(raw_tag)
            if tag is None:
                continue
            # Reuse an existing tag's spelling instead of minting `Winter`
            # beside `winter`.
            tag = registry_lower.get(tag.lower(), tag)
            if tag not in registry and tag not in new_tags:
                new_tags.append(tag)
            if tag not in tags:
                tags.append(tag)

        negative = item.get("negative")
        negative = re.sub(r"\s+", " ", negative).strip() if isinstance(negative, str) else ""
        if any(s in negative for s in _RESERVED_SYNTAX):
            negative = ""

        out.append({
            "value": text,
            "weight": _clean_weight(item.get("weight")),
            "tags": tags,
            "negative": negative,
        })

    _validate_merged(existing_payload, out, new_tags)
    return {"options": out, "new_tags": new_tags, "skipped": skipped}


def _validate_merged(
    existing_payload: dict[str, Any], new: list[dict[str, Any]], new_tags: list[str],
) -> None:
    """Run the new options through the same validator a save uses.

    Only the new rows are checked, against the existing tag registry plus the
    new tags. The editor's draft can legitimately hold half-typed rows (blank
    scaffolding, a tag being renamed); those are the editor's to resolve on
    save, and must not make every AI draft fail.
    """
    registry = [t for t in (existing_payload.get("sub_categories") or []) if isinstance(t, str)]
    options: list[dict[str, Any]] = []
    for i, o in enumerate(new):
        opt: dict[str, Any] = {
            "id": f"ai{i:06x}", "value": o["value"], "weight": o["weight"],
            "sub_categories": o["tags"],
        }
        if o["negative"]:
            opt["negative"] = o["negative"]
        options.append(opt)
    WildcardHandler.validate_payload({
        "sub_categories": list(dict.fromkeys(registry + new_tags)),
        "options": options,
    })
