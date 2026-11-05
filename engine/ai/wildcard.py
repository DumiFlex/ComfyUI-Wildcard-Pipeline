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

from engine.ai import about, adult
from engine.ai import negation as ai_negation
from engine.ai import refs as ai_refs
from engine.ai import scripts as ai_scripts
from engine.modules.wildcard_handler import WildcardHandler
from engine.syntax.subcat_filter import validate_subcat_name

MAX_COUNT = 100


def over_ask(count: int) -> int:
    """How many options to ask for when `count` are wanted: a third more (at
    least one), since repeats of the list are dropped after."""
    return min(MAX_COUNT, count + max(1, -(-count // 3)))


def answer_tokens(count: int) -> int:
    """The output limit for `count` new options with reasoning off: an
    option with its tags and negative is well under 100 tokens, so this
    leaves room for long ones and the axes, and stops a looping model
    early instead of after 8k tokens."""
    return min(8192, 600 + 150 * count)
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

Each option has these fields:
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
- tags: labels for filtering and rules. Tag new options the way the existing \
options are tagged, with the wildcard's existing tags. A new tag is one \
lowercase word (letters, digits, _ or -), only when the request asks for it. \
A tag on every new option, or one that repeats what the wildcard is ("outfit" \
on outfits), filters nothing: leave it out. Use [] when no tag fits or the \
wildcard has no tags and the request doesn't ask for any.
- negative: words for the negative prompt when this option is picked, for \
things the option invites but the image shouldn't show ("strawberry blonde" \
→ "strawberry, fruit"). Only when the request asks for negatives or the \
existing options have them; otherwise "". Never another option's words or the \
opposite of this one.

Write what the request asks for, in the language of the existing options. Don't \
add commentary or disclaimers; the output is data for the user's own library.\
"""


#: Quote pairs a small model wraps a whole option in (bench N5).
_QUOTES = {'"': '"', "\u201c": "\u201d", "`": "`"}


def _unquote(text: str) -> str:
    """An option written inside its own quotes, without them; one with
    quotes inside ("a \"lucky\" charm") stays."""
    while len(text) >= 2 and _QUOTES.get(text[0]) == text[-1] \
            and text[0] not in text[1:-1] and text[-1] not in text[1:-1]:
        text = text[1:-1].strip()
    return text


def _norm_key(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().rstrip(",").strip()).lower()


def build_user_prompt(
    *, instruction: str, count: int, name: str, var_binding: str,
    existing_options: list[str], tags: list[str],
    axes: dict[str, list[str]] | None = None,
    description: str = "", labels: list[str] | None = None, refs_text: str = "",
    kinds: dict[str, str] | None = None,
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
                kind = " (accepts: what an option goes with)" \
                    if (kinds or {}).get(axis) == "accepts" else ""
                lines.append(f"Tag group {axis}{kind}: {', '.join(members)}")
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


#: A weight copied from the prompt's "[weight 0.1; tags …]" note as a tag
#: (bench W11: "weight_0.1").
_NOTE_TAG = re.compile(r"weight[_-]?\d", re.I)


def _clean_tag(raw: Any) -> str | None:
    if not isinstance(raw, str):
        return None
    tag = re.sub(r"\s+", "_", raw.strip().lstrip("#"))
    tag = _TAG_BAD.sub("", tag)
    if not tag or validate_subcat_name(tag) or _NOTE_TAG.match(tag):
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
    request: str | None = None, labels: list[str] | None = None, own_name: str = "",
) -> dict[str, Any]:
    """Turn the model's answer into insertable options.

    Returns ``{"options": [...], "new_tags": [...], "skipped": [...]}``. Each
    option is ``{"value", "weight", "tags", "negative"}``, the same shape the
    editor's bulk-add path takes, so the editor assigns ids and owns the
    insert. Raises ValueError when the answer isn't the expected shape at all.

    With ``request`` (the Draft panel's typed ask) the answer is also held to
    it, see `_hold_to_request`. ``labels`` are the wildcard's library tags
    and ``own_name`` its name and variable.
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

    # The library's own words and the request: the scripts an option may use.
    reference = " ".join([request or "", own_name, *(
        str(o.get("value") or "") for o in existing_opts[:200] if isinstance(o, dict))])

    for item in raw["options"]:
        if not isinstance(item, dict):
            continue
        text = item.get("text")
        if not isinstance(text, str):
            continue
        text = _unquote(re.sub(r"\s+", " ", text).strip())
        if request is not None:
            # The prompt lists "- text  [tags a, b]".
            text = _NOTE.sub("", text).strip()
        if not text:
            continue
        if reference.strip() and ai_scripts.foreign(text, reference):
            skipped.append({"text": text[:80], "reason": "written in another script than "
                                                         "your list"})
            continue
        if len(text) > MAX_TEXT_LEN:
            skipped.append({"text": text[:80] + "…", "reason": "too long"})
            continue
        try:
            text = ai_refs.compile_text(text, surface="option", refs=refs, self_id=self_id)
        except ValueError as e:
            skipped.append({"text": text, "reason": str(e)})
            continue
        why = adult.blocked(text)
        if why:
            skipped.append({"text": text[:80], "reason": why})
            continue
        if ai_negation.excluded(text):
            skipped.append({"text": text[:80], "reason": "it only says what to leave out, "
                                                         "which belongs in the negative"})
            continue
        key = _norm_key(text)
        if key in seen:
            skipped.append({"text": text, "reason": "duplicate" + ai_refs.ref_dupe_hint(text)})
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

    if request is not None:
        new_tags = _hold_to_request(out, new_tags, skipped, request=request, labels=labels,
                                    own_name=own_name, registry=registry,
                                    existing=[o for o in existing_opts if isinstance(o, dict)])
    if len(out) > limit:
        kept = _trim_by_group(out, limit, request or "")
        skipped.extend({"text": o["value"], "reason": "more than you asked for"}
                       for o in out if not any(o is k for k in kept))
        out = kept
        used = {t for o in out for t in o["tags"]}
        new_tags = [t for t in new_tags if t in used]
    _validate_merged(existing_payload, out, new_tags)
    return {"options": out, "new_tags": new_tags, "skipped": skipped}


def _trim_by_group(out: list[dict[str, Any]], limit: int, request: str) -> list[dict[str, Any]]:
    """The first `limit` options taken in turn from each tag group, in the
    answer's order. Asked for 10 split by coverage, the 9B wrote 14 and the
    first 10 held 1 sheer piece (bench Z1); 12 poses kept 0 nude (Z4). The
    group is the tags the request names, else an option's first tag."""
    words = {_stem(w) for w in re.findall(r"[A-Za-z][\w-]*", request)}

    def key(o: dict[str, Any]) -> str:
        named = [t for t in o["tags"] if _stem(t.lower()) in words]
        return ",".join(sorted(named)) if named else (o["tags"][0] if o["tags"] else "")

    groups: dict[str, list[int]] = {}
    for i, o in enumerate(out):
        groups.setdefault(key(o), []).append(i)
    if len(groups) < 2:
        return out[:limit]
    picked: list[int] = []
    queues = [list(v) for v in groups.values()]
    while len(picked) < limit:
        for q in queues:
            if q and len(picked) < limit:
                picked.append(q.pop(0))
    return [out[i] for i in sorted(picked)]


#: The "[tags a, b]" note the draft prompt puts after an existing option.
_NOTE = re.compile(r"\s*\[tags [^\]]*\]\s*$")
_ASKS_NEGATIVES = re.compile(r"\bnegativ", re.I)
_ASKS_TAGS = re.compile(r"\btag", re.I)


def _stem(word: str) -> str:
    w = word.lower()
    return w[:-1] if len(w) > 3 and w.endswith("s") else w


def _hold_to_request(
    out: list[dict[str, Any]], new_tags: list[str], skipped: list[dict[str, str]], *,
    request: str, labels: list[str] | None, own_name: str, registry: list[str],
    existing: list[dict[str, Any]],
) -> list[str]:
    """Tags and negatives the request didn't ask for, off the drafted
    options (bench W1, W3, W5, W6, W18: "desert" on every desert option,
    the library tag "bench" on every outfit, "long hair" as the negative
    of a short cut, other outfits as a trench coat's negatives). Returns
    the new tags still in use.

    - A wildcard's library tag is not an option tag (the retag path drops
      it too), nor is one that repeats its name or variable.
    - A new tag on every new option (3 or more) filters nothing, unless
      the request asks for that tag.
    - Negatives only when the request asks for them or existing options
      have them; then never words of another option.
    """
    reg = {t.lower() for t in registry}
    words = {_stem(w) for w in re.findall(r"[A-Za-z][\w-]*", request)}
    asks_tags = bool(_ASKS_TAGS.search(request))

    def drop(tag: str, reason: str) -> None:
        for o in out:
            if tag in o["tags"]:
                o["tags"].remove(tag)
        if not any(x["text"] == f"#{tag}" for x in skipped):
            skipped.append({"text": f"#{tag}", "reason": reason})

    lab = {t.lower() for t in labels or []} - reg
    self_words = {_stem(w) for w in re.findall(r"[A-Za-z][\w-]*", own_name)} - {""}
    for tag in list(new_tags):
        low = tag.lower()
        if low in lab:
            drop(tag, "the wildcard's own library tag")
        elif _stem(low) in self_words and not (asks_tags and _stem(low) in words):
            drop(tag, "repeats what the wildcard is")
        elif (len(out) >= 3 and all(tag in o["tags"] for o in out)
              and not (asks_tags and _stem(low) in words)):
            drop(tag, "on every new option, so it filters nothing")
    used = {t for o in out for t in o["tags"]}
    new_tags = [t for t in new_tags if t in used]

    if not _ASKS_NEGATIVES.search(request) and not any(o.get("negative") for o in existing):
        n = sum(1 for o in out if o["negative"])
        for o in out:
            o["negative"] = ""
        if n:
            skipped.append({"text": f"{n} negative{'s' if n != 1 else ''}",
                            "reason": "not asked for"})
        return new_tags
    texts = [o["value"].lower() for o in out] + [
        str(o.get("value") or "").lower() for o in existing]
    for o in out:
        if not o["negative"]:
            continue
        own = o["value"].lower()
        parts = [p.strip() for p in o["negative"].split(",")]
        kept = [p for p in parts if p and not any(
            re.search(rf"\b{re.escape(p.lower())}\b", t) for t in texts if t != own)]
        o["negative"] = ", ".join(kept)
    return new_tags


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


#: The Add tab's answer: options plus any tag groups the request asks for.
DRAFT_SCHEMA: dict[str, Any] = {
    "type": "object", "additionalProperties": False,
    "required": ["axes", "options"],
    "properties": {
        "axes": {"type": "array", "items": _AXIS},
        "options": OPTIONS_SCHEMA["properties"]["options"],
    },
}

DRAFT_GUIDE = """\
- axes: [] unless the request asks to group tags, or the options offer \
alternatives another wildcard should match ("outfits and the shoes they go \
with"). Each axis is {name, kind, tags}. kind "classify" says what an option \
IS (style: casual, formal). kind "accepts" lists what an option GOES WITH \
(SHOES: sneakers, boots, heels): each run rolls one of its tags, readable \
as $variable.SHOES, and a constraint on that tag makes the Shoes wildcard \
agree. An accepts name is letters, digits and _ (like SHOES), not "neg". \
Tag every option with at least one tag of each accepts group. Never write \
the alternatives into the option text: "school uniform" with tags \
loafers, sneakers, not "school uniform with loafers".\
"""


def draft_prompt() -> str:
    return SYSTEM_PROMPT + "\n\n" + DRAFT_GUIDE


def new_groups(
    raw_axes: Any, *, existing_payload: dict[str, Any], new_tags: list[str],
    options: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """The tag groups a draft adds: ``[{name, kind, tags}]``, each tag spelled
    as the wildcard (or the draft) has it and not already in another group,
    plus warnings. A group the wildcard has keeps its kind unless the draft
    makes it ``accepts``. Tags no option has are left out: a group only
    sorts tags that exist. ``options`` (the draft's) are checked to carry a
    tag of every accepts group."""
    warnings: list[str] = []
    registry = [t for t in existing_payload.get("sub_categories") or [] if isinstance(t, str)]
    lower = {t.lower(): t for t in [*registry, *new_tags]}
    groups = existing_payload.get("tag_groups") or {}
    kinds = existing_payload.get("tag_group_kinds") or {}
    grouped = {t: k for k, v in groups.items() if isinstance(v, list) for t in v}
    out: list[dict[str, Any]] = []
    for a in _axes(raw_axes, warnings):
        members = []
        for t in a["tags"]:
            if t.lower() not in lower:
                continue
            t = lower[t.lower()]
            if grouped.get(t, a["name"]) != a["name"] or t in members:
                continue
            members.append(t)
        kind = "accepts" if a["kind"] == "accepts" or kinds.get(a["name"]) == "accepts" \
            else "classify"
        fresh = [t for t in members if t not in (groups.get(a["name"]) or [])]
        if fresh or (a["name"] in groups and kind != kinds.get(a["name"], "classify")):
            out.append({"name": a["name"], "kind": kind, "tags": fresh})
            grouped.update({t: a["name"] for t in fresh})
    for name in {g["name"] for g in out if g["kind"] == "accepts"} | {
            k for k, v in kinds.items() if v == "accepts"}:
        members_all = set(groups.get(name) or []) | {
            t for g in out if g["name"] == name for t in g["tags"]}
        loose = [o["value"] for o in options or [] if not set(o.get("tags") or []) & members_all]
        if loose and members_all:
            n = len(loose)
            warnings.append(f"{n} new option{'s offer' if n != 1 else ' offers'} no {name} tag "
                            f"(e.g. {loose[0][:40]})")
    return out, warnings


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
        {"options": _got if isinstance(_got := raw.get("options"), list) else []},
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


def edit_groups(payload: dict[str, Any], raw: Any) -> dict[str, Any]:
    """Change a wildcard's tag groups as they are: ``[{"group", "rename",
    "kind", "ungroup"}]``. Rename keeps its tags, kind switches classify /
    accepts, ungroup sends its tags back to the loose tags. Same return
    shape as `group_tags`."""
    warnings: list[str] = []
    preview: list[str] = []
    groups = {k: list(v) for k, v in (payload.get("tag_groups") or {}).items()
              if isinstance(v, list)}
    kinds = dict(payload.get("tag_group_kinds") or {})
    by_lower = {k.lower(): k for k in groups}
    for x in raw if isinstance(raw, list) else []:
        if not isinstance(x, dict):
            continue
        name = by_lower.get(str(x.get("group") or "").strip().lower())
        if name is None:
            warnings.append(f"no tag group {str(x.get('group') or '')[:30]!r}")
            continue
        if x.get("ungroup") is True:
            groups.pop(name)
            kinds.pop(name, None)
            by_lower.pop(name.lower(), None)
            preview.append(f"Ungroup {name}: its tags stay on the options")
            continue
        kind = x.get("kind")
        if kind in ("classify", "accepts") and kind != kinds.get(name, "classify"):
            kinds[name] = kind
            preview.append(f"Group {name}: {kind}")
        new = str(x.get("rename") or "").strip()[:40]
        if new and new != name:
            if new.lower() in by_lower and by_lower[new.lower()] != name:
                warnings.append(f"a group named {new} exists; move the tags with axes instead")
                continue
            if new.lower() == "neg":
                warnings.append("neg is reserved and can't name a group")
                continue
            groups = {(new if k == name else k): v for k, v in groups.items()}
            kinds = {(new if k == name else k): v for k, v in kinds.items()}
            by_lower.pop(name.lower(), None)
            by_lower[new.lower()] = new
            preview.append(f"Rename group {name} → {new}")
    out = {"tag_groups": groups,
           "tag_group_kinds": {k: kinds.get(k, "classify") for k in groups}}
    return {"payload": out, "preview": preview, "warnings": warnings}


def rename_option_tags(payload: dict[str, Any], renames: Any, drops: Any) -> dict[str, Any]:
    """Rename option tags (``[{"from", "to"}]``; onto an existing tag merges
    them) or drop them (``[tag]``) on every option, the tag list and the
    groups. Same return shape as `group_tags`, plus ``"changed"``: the old
    tag names, for the constraints that name them."""
    warnings: list[str] = []
    preview: list[str] = []
    registry = [t for t in payload.get("sub_categories") or [] if isinstance(t, str)]
    lower = {t.lower(): t for t in registry}
    mapping: dict[str, str | None] = {}
    for x in renames if isinstance(renames, list) else []:
        if not isinstance(x, dict):
            continue
        old = lower.get(str(x.get("from") or "").strip().lstrip("#").lower())
        new = str(x.get("to") or "").strip().lstrip("#")[:40]
        if old is None:
            warnings.append(f"no tag #{str(x.get('from') or '')[:30]} on this wildcard")
            continue
        if new and new != old:
            mapping[old] = lower.get(new.lower(), new)
            preview.append(f"#{old} → #{mapping[old]}"
                           + (" (merge)" if new.lower() in lower else ""))
    for raw in drops if isinstance(drops, list) else []:
        old = lower.get(str(raw or "").strip().lstrip("#").lower())
        if old is None:
            warnings.append(f"no tag #{str(raw or '')[:30]} on this wildcard")
            continue
        mapping[old] = None
        preview.append(f"Remove #{old} from every option")

    def fix(tags: list[Any]) -> list[str]:
        out: list[str] = []
        for t in tags:
            if not isinstance(t, str):
                continue
            t2 = mapping.get(t, t)
            if t2 and t2 not in out:
                out.append(t2)
        return out
    options = [{**o, "sub_categories": fix(o.get("sub_categories") or [])}
               if isinstance(o, dict) and o.get("sub_categories") else o
               for o in payload.get("options") or []]
    groups = {k: fix(v) for k, v in (payload.get("tag_groups") or {}).items()
              if isinstance(v, list)}
    groups = {k: v for k, v in groups.items() if v}
    out = {"sub_categories": fix(registry), "options": options, "tag_groups": groups,
           "tag_group_kinds": {k: v for k, v in (payload.get("tag_group_kinds") or {}).items()
                               if k in groups}}
    return {"payload": out, "preview": preview, "warnings": warnings,
            "changed": sorted(mapping)}


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


def bleed_note(name: str, var: str, options: list[dict[str, Any]], instruction: str) -> str:
    """One re-ask's note when new options of a one-concept wildcard also set
    another concept the request never named (hair options that pick an
    outfit too), from `lint.scope_bleed`: code checks the answer instead
    of asking the model to review its own (TICK, LLM-Modulo). "" when
    there is nothing to say."""
    from engine.ai import lint

    hits = lint.bleeding(name, var, options)
    asked = lint._words(instruction)
    named = {other for other in hits if any(lint._has(asked, w)
                                            for w in lint.CONCEPTS[other])}
    found = {k: v for k, v in hits.items() if k not in named}
    if not found:
        return ""
    other, texts = next(iter(found.items()))
    return (f"Your last answer: {len(texts)} options also set {other} ("
            + ", ".join(f'"{t[:40]}"' for t in texts[:3])
            + f"). {name or 'This wildcard'} holds one thing; write the options again "
            f"without any {other}.")


#: "tagged by coverage: modest, revealing or sheer": the tags it names.
_TAGGED_BY = re.compile(r"\btag(?:ged|s)?\b[^:.;]{0,60}:\s*([^.;]+)", re.I)


def asked_tags(instruction: str) -> list[str]:
    """The tag names a request lists after "tagged by …:" ("short or long"
    → short, long), lowercased; [] when it lists none."""
    m = _TAGGED_BY.search(instruction or "")
    if not m:
        return []
    parts = re.split(r",|\bor\b|\band\b|/", m.group(1))
    names = [re.sub(r"[^\w-]", "", p.strip().lower().split(" ")[0]) for p in parts if p.strip()]
    return list(dict.fromkeys(n for n in names if n))[:12]


def untagged_note(instruction: str, options: list[dict[str, Any]],
                  existing: list[dict[str, Any]] | None = None) -> str:
    """One re-ask's note when the request asks for tags (or every existing
    option is tagged) and no new option carries one. Bench W1 runs 1 and
    3, Z1, Z4: "tagged by length: short or long" came back with no tags,
    quietly; Z20 added untagged options to a tagged list. "" otherwise."""
    if not options or any(o.get("tags") for o in options):
        return ""
    named = asked_tags(instruction)
    tagged = [o for o in existing or [] if isinstance(o, dict) and o.get("sub_categories")]
    if named:
        want = "one of " + ", ".join(named)
    elif _ASKS_TAGS.search(instruction or ""):
        want = "the tags the request asks for"
    elif existing and len(tagged) == len([o for o in existing if isinstance(o, dict)]):
        want = "the wildcard's existing tags, the way the existing options are tagged"
    else:
        return ""
    return f"Your last answer tagged no option. Tag every option with {want}, and answer again."
