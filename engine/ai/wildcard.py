"""Wildcard drafting: what we ask the model, and how its answer is checked.

The model answers in a tiny spec, forced by a JSON schema on every provider:

    {"options": [{"text": str, "weight": number, "tags": [str], "negative": str}]}

It never sees or writes option ids or the tag registry. It may write inline
picks (``{a|b}``) and point at other wildcards by NAME (``@{Colors:warm}``);
`refs.compile_text` checks both and turns names into ids. `compile_options`
turns that spec into options the editor can insert:

- text is trimmed and flattened to one line; empty text is dropped;
- a ``$variable`` read, a stray brace or a ref to an unknown wildcard, tag,
  the wildcard itself or a loop drops the option with the reason;
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
import secrets
from typing import Any

from engine.ai import about
from engine.ai import refs as ai_refs
from engine.modules.wildcard_handler import WildcardHandler
from engine.syntax.subcat_filter import validate_subcat_name

MAX_COUNT = 100
MAX_TEXT_LEN = 400
MAX_INSTRUCTION_LEN = 2000
#: How many existing options the model sees as style examples. Enough to show
#: the style and what not to repeat, small enough for an 8K-context local model.
MAX_EXAMPLES = 60

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
- Never use $ in text: a wildcard sets a variable, it can't read one.
- {a|b} inside text picks a or b each time (for small variations, like \
"{red|crimson} scarf"); {2$$, $$a|b|c} picks two joined by ", ". Use it \
sparingly; separate options are usually better.
- To use another wildcard's pick inside an option, write @{Its name}, or \
@{Its name:tag} for only its options with that tag (tags combine with and, \
or, not), adding !null to never get its empty option: "a @{Colors:warm} \
scarf". Only name wildcards listed under "Wildcards you can point at".
- Every option must be a real alternative. Don't repeat an existing option or \
reword one.
- weight: 1, unless the request asks for some options to be rarer (below 1) or \
more common (above 1).
- tags: labels for filtering and rules. Prefer the wildcard's existing tags. A \
new tag is one lowercase word (letters, digits, _ or -). Use [] when no tag fits \
or the wildcard has no tags and the request doesn't ask for any.
- negative: words for the negative prompt when this option is picked, for \
things the option invites but the image shouldn't show ("strawberry blonde" \
→ "strawberry, fruit"). Only when the request asks for negatives or the \
option clearly needs one; otherwise "".

Write what the request asks for, in the language of the existing options. Don't \
add commentary or disclaimers; the output is data for the user's own library.\
"""


def _norm_key(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().rstrip(",").strip()).lower()


def build_user_prompt(
    *, instruction: str, count: int, name: str, var_binding: str,
    existing_options: list[str], tags: list[str],
    axes: dict[str, list[str]] | None = None,
    description: str = "", labels: list[str] | None = None, refs_text: str = "",
) -> str:
    """The per-request message: what exists, then what to add."""
    lines: list[str] = []
    lines.append(f"Wildcard: {name or '(unnamed)'}")
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
    if refs_text:
        lines.append("")
        lines.append("Wildcards you can point at with @{name}:")
        lines.append(refs_text)
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


def clean_text(
    raw: Any, *, surface: str, refs: ai_refs.RefIndex | None = None,
    self_id: str | None = None, limit: int = MAX_TEXT_LEN,
) -> str:
    """One line of model text for ``surface``, checked; ValueError says why
    it can't be used. Empty stays empty."""
    text = re.sub(r"\s+", " ", raw).strip() if isinstance(raw, str) else ""
    if not text:
        return ""
    if len(text) > limit:
        raise ValueError("too long")
    return ai_refs.compile_text(text, surface=surface, refs=refs, self_id=self_id)


def compile_options(
    raw: Any, *, existing_payload: dict[str, Any], limit: int = MAX_COUNT,
    refs: ai_refs.RefIndex | None = None, self_id: str | None = None,
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
    # At most one fallback per wildcard: the first flagged option, and none
    # when the wildcard already has one.
    fb_taken = any(isinstance(o, dict) and o.get("fallback") for o in existing_opts)

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
        try:
            text = ai_refs.compile_text(text, surface="option", refs=refs, self_id=self_id)
        except ValueError as e:
            skipped.append({"text": text, "reason": str(e)})
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

        try:
            negative = clean_text(item.get("negative"), surface="negative", refs=refs,
                                  self_id=self_id)
        except ValueError:
            negative = ""

        row = {
            "value": text,
            "weight": _clean_weight(item.get("weight")),
            "tags": tags,
            "negative": negative,
        }
        if item.get("fallback") is True and not fb_taken:
            row["fallback"] = True
            fb_taken = True
        out.append(row)

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
        if o.get("fallback"):
            opt["fallback"] = True
        options.append(opt)
    WildcardHandler.validate_payload({
        "sub_categories": list(dict.fromkeys(registry + new_tags)),
        "options": options,
    })


# ── the whole wildcard: options plus tag groups, the empty option, fallback ──

_OPTION = {
    "type": "object", "additionalProperties": False,
    "required": ["text", "weight", "tags", "negative", "fallback"],
    "properties": {
        "text": {"type": "string"},
        "weight": {"type": "number"},
        "tags": {"type": "array", "items": {"type": "string"}},
        "negative": {"type": "string"},
        "fallback": {"type": "boolean"},
    },
}
_AXIS = {
    "type": "object", "additionalProperties": False,
    "required": ["name", "kind", "tags"],
    "properties": {
        "name": {"type": "string"},
        "kind": {"type": "string", "enum": ["classify", "accepts"]},
        "tags": {"type": "array", "items": {"type": "string"}},
    },
}
SPEC_SCHEMA: dict[str, Any] = {
    "type": "object", "additionalProperties": False,
    "required": ["axes", "null_weight", "options"],
    "properties": {
        "axes": {"type": "array", "items": _AXIS},
        "null_weight": {"type": "number"},
        "options": {"type": "array", "items": _OPTION},
    },
}

SPEC_GUIDE = """\
The whole wildcard also has:
- fallback: true on at most one option, the one used when rules (constraints) \
or weights leave nothing to pick; it is also picked normally. Give one to a \
wildcard other wildcards' rules narrow, so it never comes out empty. Weight 0 \
on it makes it a stand-in only.
- null_weight: the weight of an empty option ("sometimes nothing"). 0 for \
none. "A hat 30% of the time" with 7 options of weight 1 is null_weight 16 \
(16 of 23 runs get no hat). Leave 0 unless the request wants "sometimes none".
- axes: optional groups of tags, each {name, kind, tags}. kind "classify" \
says what the option IS (an outfit is casual or formal; rules test all of its \
tags). kind "accepts" lists alternatives the option OFFERS (an outfit goes \
with sneakers or boots): each run rolls one of them, readable as \
$variable.NAME, and a constraint keys on the rolled one, which is how two \
wildcards are made to agree ("shoes that match the outfit"). An accepts \
name is a word of letters, digits and _ (often UPPERCASE, like SHOES), not \
"neg"; give every option at least one of its tags. [] when the request \
needs no groups.\
"""


def spec_prompt() -> str:
    return SYSTEM_PROMPT + "\n\n" + SPEC_GUIDE


def _axes(raw: Any, warnings: list[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for a in raw if isinstance(raw, list) else []:
        if not isinstance(a, dict):
            continue
        name = re.sub(r"\s+", "_", str(a.get("name") or "").strip())[:40]
        kind = a.get("kind") if a.get("kind") in ("classify", "accepts") else "classify"
        if kind == "accepts" and not ai_refs.valid_axis_name(name):
            warnings.append(f"Tag group {name or '?'} isn't a usable name; kept as classify")
            kind = "classify"
        if not name or name in seen:
            continue
        tags = [t for t in (_clean_tag(x) for x in a.get("tags") or []) if t]
        if tags:
            seen.add(name)
            out.append({"name": name, "kind": kind, "tags": list(dict.fromkeys(tags))})
    return out


def compile_spec(
    raw: Any, *, var: str | None, refs: ai_refs.RefIndex | None = None,
    self_id: str | None = None, limit: int = MAX_COUNT,
    existing_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """A whole wildcard from the model's spec. Returns ``{"payload",
    "preview", "warnings", "skipped"}``; the payload has ids and passes
    `WildcardHandler.validate_payload`. ``existing_payload`` (when adding to
    a wildcard) keeps its options, tags and groups and appends the new ones.
    Raises ValueError when no option is usable."""
    if not isinstance(raw, dict):
        raise ValueError("the model's answer wasn't a wildcard")
    base = existing_payload or {"options": [], "sub_categories": []}
    compiled = compile_options(
        {"options": raw.get("options") if isinstance(raw.get("options"), list) else []},
        existing_payload=base, limit=limit, refs=refs, self_id=self_id,
    )
    warnings: list[str] = []
    if not compiled["options"]:
        raise ValueError("no usable options" + "".join(
            f"; {s['text'][:40]}: {s['reason']}" for s in compiled["skipped"][:3]))
    axes = _axes(raw.get("axes"), warnings)
    registry = list(dict.fromkeys(
        [*(t for t in base.get("sub_categories") or [] if isinstance(t, str)),
         *compiled["new_tags"]]))
    lower = {t.lower(): t for t in registry}
    groups = {k: list(v) for k, v in (base.get("tag_groups") or {}).items()
              if isinstance(v, list)}
    kinds = dict(base.get("tag_group_kinds") or {})
    grouped = {t for v in groups.values() for t in v}
    for a in axes:
        members = []
        for t in a["tags"]:
            t = lower.get(t.lower(), t)
            if t not in registry:
                registry.append(t)
                lower[t.lower()] = t
            if t not in grouped:
                members.append(t)
                grouped.add(t)
        if not members:
            continue
        groups.setdefault(a["name"], [])
        groups[a["name"]] += [t for t in members if t not in groups[a["name"]]]
        kinds[a["name"]] = a["kind"]
    options: list[dict[str, Any]] = [dict(o) for o in base.get("options") or []
                                     if isinstance(o, dict)]
    taken = {o.get("id") for o in options}
    preview: list[str] = []
    for o in compiled["options"]:
        oid = _new_option_id(taken)
        row: dict[str, Any] = {"id": oid, "value": o["value"], "weight": o["weight"],
                               "sub_categories": o["tags"]}
        if o["negative"]:
            row["negative"] = o["negative"]
        if o.get("fallback"):
            row["fallback"] = True
        options.append(row)
        preview.append(option_line(row))
    null_w = raw.get("null_weight")
    has_null = any(o.get("is_null") for o in options)
    if (isinstance(null_w, (int, float)) and not isinstance(null_w, bool)
            and 0 < null_w <= 100 and not has_null):
        options.append({"id": _new_option_id(taken), "value": "", "is_null": True,
                        "weight": _clean_weight(null_w), "sub_categories": []})
        preview.append(f"∅ (nothing) ×{_clean_weight(null_w)}")
    used = {t for o in options for t in o.get("sub_categories") or []}
    payload: dict[str, Any] = dict(base)
    payload["options"] = options
    payload["sub_categories"] = [t for t in registry if t in used or t in grouped]
    if groups:
        payload["tag_groups"] = {k: [t for t in v if t in payload["sub_categories"]]
                                 for k, v in groups.items()}
        payload["tag_groups"] = {k: v for k, v in payload["tag_groups"].items() if v}
        payload["tag_group_kinds"] = {k: v for k, v in kinds.items()
                                      if k in payload["tag_groups"]}
        if not payload["tag_groups"]:
            payload.pop("tag_groups")
            payload.pop("tag_group_kinds")
    if var:
        payload["var_binding"] = var
    for name, members in (payload.get("tag_groups") or {}).items():
        if payload.get("tag_group_kinds", {}).get(name) != "accepts":
            continue
        loose = [ai_refs.display_text(o["value"], refs) for o in options
                 if not o.get("is_null")
                 and not set(o.get("sub_categories") or []) & set(members)]
        if loose:
            n = len(loose)
            warnings.append(f"{n} option{'s offer' if n != 1 else ' offers'} no {name} tag "
                            f"(e.g. {loose[0][:40]})")
    WildcardHandler.validate_payload(payload)
    warnings += [f"Left out {s['text'][:60]}: {s['reason']}" for s in compiled["skipped"][:8]]
    return {"payload": payload, "preview": preview, "warnings": warnings,
            "skipped": compiled["skipped"], "new_count": len(compiled["options"])}


def group_tags(payload: dict[str, Any], raw_axes: Any) -> dict[str, Any]:
    """Group a wildcard's existing tags into axes (``[{name, kind, tags}]``).
    A tag moves out of any group it was in; a group left empty goes.
    Returns ``{"payload": {sub_categories, tag_groups, tag_group_kinds},
    "preview", "warnings"}`` (the keys to merge into the payload)."""
    warnings: list[str] = []
    registry = [t for t in payload.get("sub_categories") or [] if isinstance(t, str)]
    lower = {t.lower(): t for t in registry}
    groups = {k: list(v) for k, v in (payload.get("tag_groups") or {}).items()
              if isinstance(v, list)}
    kinds = dict(payload.get("tag_group_kinds") or {})
    preview: list[str] = []
    for a in _axes(raw_axes, warnings):
        members = [lower[t.lower()] for t in a["tags"] if t.lower() in lower]
        missing = [t for t in a["tags"] if t.lower() not in lower]
        if missing:
            warnings.append(f"{a['name']}: no tag {', '.join(missing[:4])} on this wildcard")
        if not members:
            continue
        for g in groups:
            groups[g] = [t for t in groups[g] if t not in members]
        groups[a["name"]] = list(dict.fromkeys([*groups.get(a["name"], []), *members]))
        kinds[a["name"]] = a["kind"]
        preview.append(f"Group {a['name']} ({a['kind']}): {', '.join(groups[a['name']])}")
    groups = {k: v for k, v in groups.items() if v}
    out: dict[str, Any] = {"sub_categories": registry}
    out["tag_groups"] = groups
    out["tag_group_kinds"] = {k: kinds.get(k, "classify") for k in groups}
    for name in groups:
        if out["tag_group_kinds"][name] != "accepts":
            continue
        loose = [o for o in payload.get("options") or [] if isinstance(o, dict)
                 and not o.get("is_null")
                 and not set(o.get("sub_categories") or []) & set(groups[name])]
        if loose:
            warnings.append(f"{len(loose)} option{'s offer' if len(loose) != 1 else ' offers'} "
                            f"no {name} tag")
    return {"payload": out, "preview": preview, "warnings": warnings}


clean_weight = _clean_weight


def new_option_id(taken: set[Any]) -> str:
    return _new_option_id(taken)


def _new_option_id(taken: set[Any]) -> str:
    while True:
        oid = secrets.token_hex(4)
        if oid not in taken:
            taken.add(oid)
            return oid


def option_line(o: dict[str, Any], refs: ai_refs.RefIndex | None = None) -> str:
    """An option as one readable line: text, tags, weight, negative, flags."""
    if o.get("is_null"):
        text = "∅ (nothing)"
    else:
        text = ai_refs.display_text(o.get("value"), refs)
    bits = []
    w = o.get("weight", 1)
    if w != 1:
        bits.append(f"×{w}")
    if o.get("sub_categories"):
        bits.append("#" + " #".join(o["sub_categories"]))
    if o.get("fallback"):
        bits.append("fallback")
    out = text + (f"  [{' '.join(bits)}]" if bits else "")
    if o.get("negative"):
        out += f"  (negative: {ai_refs.display_text(o['negative'], refs)})"
    return out
