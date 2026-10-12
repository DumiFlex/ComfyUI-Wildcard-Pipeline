"""A description and library tags for a module, bundle or template.

The model reads what the thing contains (a short per-type summary, never raw
ids) plus the library's existing tags, and answers:

    {"description": str, "tags": [str]}

`compile_answer` trims the description, cleans the tags, reuses the library's
spelling of a tag it already has, and says which tags are new. The editor shows
both for review; nothing is written here.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from typing import Any

from engine.ai import about
from engine.ai.constraint import describe_existing
from engine.ai.derivation import describe_rule

KINDS = ("wildcard", "fixed_values", "combine", "derivation", "constraint", "bundle", "template")
MAX_DESCRIPTION = 400
MAX_TAGS = 8
MAX_TAG_LEN = 32
#: Library tags listed for the model to reuse, most used first.
MAX_LIBRARY_TAGS = 100
_SUMMARY_LIMIT = 4000

SCHEMA: dict[str, Any] = {
    "type": "object", "additionalProperties": False,
    "required": ["description", "tags"],
    "properties": {
        "description": {"type": "string"},
        "tags": {"type": "array", "items": {"type": "string"}},
    },
}

SYSTEM_PROMPT = """\
You label items in a Wildcard Pipeline library. Wildcard Pipeline is a ComfyUI \
extension that builds image-generation prompts from modules: wildcards (lists \
of options, one picked per run), fixed values, combines, derivation rules, \
constraints between wildcards, bundles of modules, and templates.

Write:
- description: one or two plain sentences saying what this item is for and \
when to use it, as its author would. Mention the subject and style, not how \
the extension works. No marketing words, no quotes, no trailing list of tags.
- tags: 3 to 6 short tags for finding it in the library (subject, genre, \
style, use). Reuse the library's existing tags whenever one fits; a new tag is \
one or two lowercase words.

If the item already has a description or tags, improve on them and keep what \
is right. Don't add commentary; the output is data for the user's own library.\
"""

_NOISE_KEYS = {"id", "history", "source_id", "target_id", "_uid"}


def _strip(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _strip(v) for k, v in value.items() if k not in _NOISE_KEYS}
    if isinstance(value, list):
        return [_strip(v) for v in value]
    return value


def _clip(text: str) -> str:
    return text if len(text) <= _SUMMARY_LIMIT else text[:_SUMMARY_LIMIT] + " …"


def summarize(kind: str, payload: Any, *, names: dict[str, str] | None = None) -> str:
    """What the item holds, in a few lines. ``names`` maps module ids to names
    so a constraint can say which wildcards it links."""
    p = payload if isinstance(payload, dict) else {}
    names = names or {}
    lines: list[str] = []
    if kind == "wildcard":
        if p.get("var_binding"):
            lines.append(f"Variable: ${p['var_binding']}")
        tags = [t for t in p.get("sub_categories") or [] if isinstance(t, str)]
        if tags:
            lines.append(f"Option tags: {', '.join(tags[:40])}")
        opts = [
            o["value"] for o in p.get("options") or []
            if isinstance(o, dict) and isinstance(o.get("value"), str) and o["value"].strip()
        ]
        lines.append(f"Options ({len(opts)}):")
        lines.extend(f"- {o}" for o in opts[:40])
        if len(opts) > 40:
            lines.append(f"- … and {len(opts) - 40} more")
    elif kind == "fixed_values":
        for v in (p.get("values") or [])[:40]:
            if isinstance(v, dict):
                lines.append(f"${v.get('name', '')} = {v.get('value', '')}")
    elif kind == "derivation":
        for r in (p.get("rules") or [])[:30]:
            if isinstance(r, dict):
                lines.append(f"- {describe_rule(r)}")
    elif kind == "constraint":
        src = names.get(str(p.get("source_wildcard_id")), p.get("source_wildcard_name") or "?")
        tgt = names.get(str(p.get("target_wildcard_id")), p.get("target_wildcard_name") or "?")
        lines.append(f"Links wildcard {src} (source) to {tgt} (target).")
        lines.extend(f"- {r}" for r in describe_existing(p)[:40])
    elif kind == "bundle":
        for child in (payload if isinstance(payload, list) else [])[:40]:
            if not isinstance(child, dict):
                continue
            cname = child.get("name") or "(unnamed)"
            ctype = child.get("type") or "module"
            cdesc = child.get("description") if isinstance(child.get("description"), str) else ""
            lines.append(f"- {ctype} {cname}" + (f": {cdesc[:120]}" if cdesc else ""))
    elif kind == "template":
        lines.append(str(payload)[:_SUMMARY_LIMIT] if not isinstance(payload, dict) else
                     json.dumps(_strip(payload), ensure_ascii=False))
    else:
        lines.append(json.dumps(_strip(p), ensure_ascii=False))
    return _clip("\n".join(lines))


def library_tags(rows: list[dict[str, Any]]) -> list[str]:
    """Tags used across the library, most used first."""
    counts: Counter[str] = Counter()
    for r in rows:
        for t in r.get("tags") or []:
            if isinstance(t, str) and t.strip():
                counts[t.strip()] += 1
    return [t for t, _ in counts.most_common(MAX_LIBRARY_TAGS)]


def build_prompt(
    *, kind: str, name: str, description: str, tags: list[str], summary: str,
    library: list[str], hint: str = "",
) -> str:
    lines = [f"Item: {kind.replace('_', ' ')} \"{name or '(unnamed)'}\""]
    lines.extend(about.lines(description, tags))
    lines.append("")
    lines.append("What it holds:")
    lines.append(summary or "(empty)")
    lines.append("")
    lines.append(f"Library tags: {', '.join(library)}" if library else "Library tags: none yet")
    if hint.strip():
        lines.append("")
        lines.append(f"Request: {hint.strip()}")
    return "\n".join(lines)


def _clean_tag(raw: Any) -> str | None:
    if not isinstance(raw, str):
        return None
    tag = re.sub(r"\s+", " ", raw.strip().lstrip("#")).strip(" ,.;")
    if not tag or len(tag) > MAX_TAG_LEN:
        return None
    return tag


def compile_answer(raw: Any, *, current: list[str], library: list[str]) -> dict[str, Any]:
    """Returns ``{"description", "tags": [{"tag", "new", "has"}]}``. ``new`` is
    a tag nothing in the library uses yet; ``has`` one the item already has.
    Raises ValueError when the answer isn't the expected shape."""
    if not isinstance(raw, dict):
        raise ValueError("the model's answer wasn't an object")
    desc = raw.get("description")
    desc = re.sub(r"\s+", " ", desc).strip().strip('"') if isinstance(desc, str) else ""
    if len(desc) > MAX_DESCRIPTION:
        cut = desc[:MAX_DESCRIPTION]
        desc = cut[: cut.rfind(" ")] + "…" if " " in cut else cut
    by_lower = {t.lower(): t for t in [*library, *current]}
    have = {t.lower() for t in current}
    tags: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw.get("tags") if isinstance(raw.get("tags"), list) else []:
        tag = _clean_tag(item)
        if tag is None or tag.lower() in seen:
            continue
        seen.add(tag.lower())
        known = by_lower.get(tag.lower())
        tags.append({
            "tag": known or tag.lower(),
            "new": known is None,
            "has": tag.lower() in have,
        })
        if len(tags) >= MAX_TAGS:
            break
    if not desc and not tags:
        raise ValueError("it was empty")
    return {"description": desc, "tags": tags}
