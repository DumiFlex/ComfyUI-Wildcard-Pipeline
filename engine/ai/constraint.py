"""Constraint rules from plain language.

A constraint links two wildcards: when the source picks something, the
target's options are re-weighted. The model sees both option lists, numbered
``S1..`` and ``T1..`` with their tags, and answers with flat pairs:

    {"rules": [{"source": "#winter" | "S3", "target": "#summer" | "T7",
                "effect": "exclude" | "only" | "boost" | "reduce",
                "factor": number, "reason": str}]}

`compile_rules` maps them onto the payload:

- tag → tag is a matrix cell, ``matrix[src_tag][tgt_tag]``;
- option → option is an exception keyed by the two option texts (plus their
  ids, as the editor stores them);
- a tag on one side and an option on the other becomes one exception per
  option carrying that tag, because the matrix only holds tag pairs;
- factors follow the effect: exclude 0, only 1, boost above 1 (default 2),
  reduce between 0 and 1 (default 0.5);
- a pair named twice keeps the first; a pair the constraint already has is
  marked ``replaces`` so the editor can say so;
- the new cells and exceptions must pass `ConstraintHandler.validate_payload`.
"""
from __future__ import annotations

import json
import math
import re
from typing import Any

from engine.ai import about
from engine.modules.constraint_handler import ConstraintHandler, exception_pair

EFFECTS = ("exclude", "only", "boost", "reduce")
MAX_RULES = 60
#: Exceptions one tag-to-option rule may expand into.
MAX_EXPANSION = 50
#: Options listed per side. Longer lists are cut; tags still cover them.
MAX_OPTIONS_SHOWN = 200
MAX_REASON_LEN = 160

_STR = {"type": "string"}

SCHEMA: dict[str, Any] = {
    "type": "object", "additionalProperties": False, "required": ["rules"],
    "properties": {"rules": {"type": "array", "items": {
        "type": "object", "additionalProperties": False,
        "required": ["source", "target", "effect", "factor", "reason"],
        "properties": {
            "source": _STR, "target": _STR,
            "effect": {"type": "string", "enum": list(EFFECTS)},
            "factor": {"type": "number"},
            "reason": _STR,
        },
    }}},
}

SYSTEM_PROMPT = """\
You write constraint rules for Wildcard Pipeline, a ComfyUI extension that \
builds image-generation prompts. Two wildcards each pick a random option. A \
constraint says how the SOURCE's pick changes the odds of the TARGET's \
options, so combinations make sense (no sandals with a snowy forest).

Each rule pairs a source side with a target side. A side is either a tag, \
written "#tag", which covers every option carrying it, or one option, written \
by its id ("S3" for a source option, "T7" for a target option). Prefer tags \
when a tag says it; use option ids for single exceptions.

Effects:
- exclude: when the source side is picked, the target side can't be. factor 0.
- reduce: makes the target side rarer. factor between 0 and 1 (0.3 = much rarer).
- boost: makes it more likely. factor above 1 (2 = twice as likely).
- only: when the source side is picked, the target sides this source side \
names stay possible and every other target option is shut out. factor 1. \
"Names" means any rule from that source side: an only, reduce or boost rule \
keeps its target (reduce and boost with their own odds), so "only boots, and \
sandals rarely" is an only rule for #boots plus a reduce rule for #sandals. \
Don't mix only and reduce/boost on one source side unless you mean that.

Tag groups: a wildcard's tags can be grouped. In a CLASSIFY group a tag says \
what the option IS, and a rule on it applies when the option has it. In an \
ACCEPTS group the tags are alternatives the option offers (a dress that goes \
with "summer" or "spring"): on the source, each run rolls one of them, and the \
rule follows the rolled one; on the target, an option stays possible when the \
source allows any of its alternatives. Key rules that should match picks on \
the accepts group's tags.

"Never" and "can't" are exclude, not reduce; "only" is an only rule (or an \
exclude for every other side); reduce is for "rarely" and "less often". "X \
only with A" (snow only in cold places) shuts X out everywhere else: from \
every source side other than A, exclude X. Cover every source tag that \
isn't A, not just a few.

Only write the rules the request asks for. Give each a reason of a few words. \
Don't add commentary; the output is data for the user's own library.\
"""


def _clean_options(options: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for o in options if isinstance(options, list) else []:
        if not isinstance(o, dict) or o.get("is_null") is True:
            continue
        value = o.get("value")
        if not isinstance(value, str) or not value.strip():
            continue
        tags = [t for t in o.get("sub_categories") or [] if isinstance(t, str)]
        oid = o.get("id") if isinstance(o.get("id"), str) else ""
        out.append({"id": oid, "value": value, "tags": tags})
    return out[:MAX_OPTIONS_SHOWN]


def side_view(wildcard: dict[str, Any], prefix: str) -> dict[str, Any]:
    """A wildcard row as one side of the prompt: numbered options + tags."""
    payload = wildcard.get("payload") if isinstance(wildcard.get("payload"), dict) else {}
    options = _clean_options(payload.get("options"))
    for i, o in enumerate(options, 1):
        o["short"] = f"{prefix}{i}"
    tags = [t for t in payload.get("sub_categories") or [] if isinstance(t, str)]
    kinds = payload.get("tag_group_kinds")
    kinds = kinds if isinstance(kinds, dict) else {}
    raw_groups = payload.get("tag_groups")
    raw_groups = raw_groups if isinstance(raw_groups, dict) else {}
    groups = [{"name": str(g), "kind": "accepts" if kinds.get(g) == "accepts" else "classify",
               "tags": [t for t in members if isinstance(t, str)]}
              for g, members in raw_groups.items() if isinstance(members, list) and members]
    description, labels = about.clean(wildcard.get("description"), wildcard.get("tags"))
    return {
        "name": wildcard.get("name") if isinstance(wildcard.get("name"), str) else "",
        "var": payload.get("var_binding") if isinstance(payload.get("var_binding"), str) else "",
        "options": options,
        "tags": tags,
        "groups": groups,
        "prefix": prefix,
        "description": description,
        "labels": labels,
    }


def build_prompt(
    *, instruction: str, source: dict[str, Any], target: dict[str, Any],
    existing: list[str], name: str = "", description: str = "",
    labels: list[str] | None = None,
) -> str:
    lines: list[str] = []
    if name or description or labels:
        lines.append(f"Constraint: {name or '(unnamed)'}")
        lines.extend(about.lines(description, labels or []))
        lines.append("")
    for label, side in (("SOURCE", source), ("TARGET", target)):
        var = f" (${side['var']})" if side["var"] else ""
        lines.append(f"{label} wildcard: {side['name'] or '(unnamed)'}{var}")
        lines.extend(about.lines(side["description"], side["labels"], indent="  "))
        lines.append(f"Tags: {', '.join('#' + t for t in side['tags']) or 'none'}")
        for g in side.get("groups") or []:
            lines.append(f"  {g['kind'].upper()} group {g['name']}: "
                         + ", ".join("#" + t for t in g["tags"]))
        for o in side["options"]:
            tags = f"  [{', '.join('#' + t for t in o['tags'])}]" if o["tags"] else ""
            lines.append(f"{o['short']}. {o['value']}{tags}")
        lines.append("")
    if existing:
        lines.append("Rules it already has:")
        lines.extend(f"- {r}" for r in existing[:60])
        lines.append("")
    lines.append(f"Request: {instruction.strip()}")
    return "\n".join(lines)


def describe_existing(payload: dict[str, Any]) -> list[str]:
    """The constraint's current rules as prompt lines."""
    out: list[str] = []
    matrix = payload.get("matrix") if isinstance(payload.get("matrix"), dict) else {}
    for src, row in matrix.items():
        if not isinstance(row, dict):
            continue
        for tgt, cell in row.items():
            if isinstance(cell, dict) and cell.get("mode") not in (None, "allow"):
                out.append(f"#{src} → #{tgt}: {cell['mode']} ×{cell.get('factor', 1)}")
    for exc in payload.get("exceptions") or []:
        if isinstance(exc, dict) and (pair := exception_pair(exc)):
            out.append(f'"{pair[0]}" → "{pair[1]}": {exc.get("mode")} ×{exc.get("factor", 1)}')
    return out


def _factor(effect: str, raw: Any) -> float | int:
    if effect == "exclude":
        return 0
    if effect == "only":
        return 1
    ok = isinstance(raw, (int, float)) and not isinstance(raw, bool) and math.isfinite(raw)
    if effect == "boost":
        f = float(raw) if ok and 1 < raw <= 100 else 2.0
    else:
        f = float(raw) if ok and 0 < raw < 1 else 0.5
    f = round(f, 3)
    return int(f) if f.is_integer() else f


def _side(raw: Any, view: dict[str, Any], tag_lower: dict[str, str]) -> tuple[str, Any] | None:
    """``("tag", name)`` or ``("option", option)``; None when it names nothing."""
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if text.startswith("#"):
        tag = _tag_like(text[1:].strip().lower(), tag_lower)
        return ("tag", tag) if tag else _by_word(text[1:], view)
    m = re.fullmatch(r"([STst])?\s*(\d+)", text)
    if m:
        short = f"{view['prefix']}{int(m.group(2))}"
        if m.group(1) and m.group(1).upper() != view["prefix"]:
            return None
        return next((("option", o) for o in view["options"] if o["short"] == short), None)
    # A model sometimes writes the option text or a bare tag instead.
    for o in view["options"]:
        if o["value"].strip().lower() == text.lower():
            return ("option", o)
    tag = tag_lower.get(text.lower())
    if tag:
        return ("tag", tag)
    # A word from the options ("sandals" for "sundress, sandals"), as a
    # missing #tag is read (chat eval round 3).
    return _by_word(text, view) if " " not in text.strip() else None


def _tag_like(word: str, tag_lower: dict[str, str]) -> str | None:
    """The tag ``word`` names: itself, its singular or plural ("sandal" for
    #sandals), or without a role word ("mage_weapons" for #mage)."""
    forms = [word, word + "s", word[:-1] if word.endswith("s") else "",
             word[:-2] if word.endswith("es") else ""]
    parts = re.split(r"[_-]", word)
    if len(parts) > 1:
        forms += [parts[0], parts[-1]]
    for f in forms:
        if f and f in tag_lower:
            return tag_lower[f]
    return None


def _by_word(word: str, view: dict[str, Any]) -> tuple[str, Any] | None:
    """A tag the wildcard doesn't have ("#snow", "#plate_armor") as the
    options whose text says it ("light snow", "heavy plate armor"), so the
    rule still lands instead of being left out."""
    w = word.strip().lower().replace("_", " ").replace("-", " ")
    if len(w) < 3:
        return None
    pat = re.compile(r"\b" + re.escape(w) + r"s?\b")
    hits = [o for o in view["options"] if pat.search(o["value"].lower())]
    return ("options", hits) if hits else None


def _split_sides(rules: list[Any], views: tuple[dict[str, Any], dict[str, Any]] | None = None,
                 ) -> list[dict[str, Any]]:
    """A rule naming several tags on one side ("#hot, #dry, #sand") as one
    rule per tag, so the ones that exist land and the rest are skipped
    one by one instead of the whole rule. So is a list of option numbers or
    words ("3, 4", "sandals, shorts") that isn't one option's own text."""
    out: list[dict[str, Any]] = []
    for item in rules:
        if not isinstance(item, dict):
            continue
        sides = []
        for i, key in enumerate(("source", "target")):
            raw = item.get(key)
            several = isinstance(raw, str) and (raw.count("#") > 1 or (
                views is not None and re.search(r",|/|\band\b|\bor\b|\+", raw) is not None
                and _side(raw, views[i], {t.lower(): t for t in views[i]["tags"]}) is None))
            parts = [p.strip() for p in re.split(r"\s*(?:,|/|\bor\b|\band\b|\+)\s*", raw)
                     if p.strip()] if several else []
            sides.append(parts or [raw])
        for a in sides[0]:
            for b in sides[1]:
                out.append({**item, "source": a, "target": b})
    return out[:MAX_RULES * 2]


def _carried(side: tuple[str, Any] | None, view: dict[str, Any]) -> tuple[str, Any] | None:
    """A tag the wildcard lists but no option carries reads as the options
    whose text says it, like a tag it doesn't list."""
    if side is None or side[0] != "tag" or any(side[1] in o["tags"] for o in view["options"]):
        return side
    carried = {t.lower(): t for o in view["options"] for t in o["tags"]}
    near = _tag_like(side[1].lower(), carried)
    if near:
        return ("tag", near)
    return _by_word(side[1], view) or side


def _label(side: tuple[str, Any]) -> str:
    if side[0] == "options":
        return " / ".join(o["value"] for o in side[1][:3]) + ("…" if len(side[1]) > 3 else "")
    return f"#{side[1]}" if side[0] == "tag" else side[1]["value"]


def example_rule(source: dict[str, Any], target: dict[str, Any]) -> str:
    """One rule that works between these two wildcards, written from their
    own tags and options, plus what each side can name. A failed call
    shows it: a small model copies an example far better than it follows
    "name options by number" (the 9B failed three times in a row)."""
    def side(view: dict[str, Any]) -> tuple[str, str]:
        carried = [t for t in view["tags"] if any(t in o["tags"] for o in view["options"])]
        first = f"#{carried[0]}" if carried else (
            view["options"][0]["value"] if view["options"] else "1")
        names = (f"tags #{', #'.join(carried[:8])}; " if carried else "no tags; ") + \
            "options " + ", ".join(f'{o["short"][1:]} "{o["value"][:30]}"'
                                   for o in view["options"][:6])
        return first, names
    s_first, s_names = side(source)
    t_first, t_names = side(target)
    rule = json.dumps({"source": s_first, "target": t_first, "effect": "exclude",
                       "reason": "..."}, ensure_ascii=False)
    return (f"A rule that works here: {rule}. The source {source['name'] or ''} has "
            f"{s_names}. The target {target['name'] or ''} has {t_names}. Name a tag with # "
            "only when it is in that list; otherwise use the option's number or exact text")


def compile_rules(
    raw: Any, *, source: dict[str, Any], target: dict[str, Any],
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Check the model's pairs. Returns ``{"cells": [...], "exceptions": [...],
    "skipped": [...]}``; each item carries ``reason`` and ``replaces``.
    Raises ValueError when the answer isn't the expected shape at all."""
    if not isinstance(raw, dict) or not isinstance(raw.get("rules"), list):
        raise ValueError("the model's answer wasn't a list of rules")
    existing = existing or {}
    old_matrix = existing.get("matrix") if isinstance(existing.get("matrix"), dict) else {}
    old_pairs = {
        p for e in existing.get("exceptions") or []
        if isinstance(e, dict) and (p := exception_pair(e))
    }
    src_tags = {t.lower(): t for t in source["tags"]}
    tgt_tags = {t.lower(): t for t in target["tags"]}

    cells: list[dict[str, Any]] = []
    exceptions: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    seen_cells: set[tuple[str, str]] = set()
    seen_pairs: set[tuple[str, str]] = set()

    for item in _split_sides(raw["rules"][:MAX_RULES], (source, target)):
        s = _carried(_side(item.get("source"), source, src_tags), source)
        t = _carried(_side(item.get("target"), target, tgt_tags), target)
        shown = f"{item.get('source')} → {item.get('target')}"[:80]
        if s is None or t is None:
            which = "source" if s is None else "target"
            have = (source if s is None else target)["tags"]
            # The tags it does have, so a rebuild picks from them.
            skipped.append({"text": shown, "reason": f"the {which} isn't an option or tag"
                            + (f" (its tags: #{', #'.join(have[:12])})" if have else
                               " (it has no tags: name options by number)")
                            + "; one option or tag per side, a rule each"})
            continue
        effect = item.get("effect")
        if effect not in EFFECTS:
            skipped.append({"text": shown, "reason": "unknown effect"})
            continue
        factor = _factor(effect, item.get("factor"))
        reason = item.get("reason")
        if isinstance(reason, str):
            reason = re.sub(r"\s+", " ", reason).strip()[:MAX_REASON_LEN]
        else:
            reason = ""

        if s[0] == "tag" and t[0] == "tag":
            key = (s[1], t[1])
            if key in seen_cells:
                continue
            seen_cells.add(key)
            row = old_matrix.get(s[1]) if isinstance(old_matrix.get(s[1]), dict) else {}
            old = row.get(t[1])
            cells.append({
                "source_tag": s[1], "target_tag": t[1],
                "cell": {"mode": effect, "factor": factor}, "reason": reason,
                "replaces": isinstance(old, dict) and old.get("mode") not in (None, "allow"),
            })
            continue

        srcs = [s[1]] if s[0] == "option" else s[1] if s[0] == "options" else [
            o for o in source["options"] if s[1] in o["tags"]]
        tgts = [t[1]] if t[0] == "option" else t[1] if t[0] == "options" else [
            o for o in target["options"] if t[1] in o["tags"]]
        pairs = [(a, b) for a in srcs for b in tgts]
        if not pairs:
            skipped.append({"text": shown, "reason": "no option carries that tag"})
            continue
        if len(pairs) > MAX_EXPANSION:
            skipped.append({"text": shown, "reason": f"would add {len(pairs)} exceptions"})
            continue
        group = f"{_label(s)} → {_label(t)}" if len(pairs) > 1 else ""
        for a, b in pairs:
            key = (a["value"], b["value"])
            if key in seen_pairs:
                continue
            seen_pairs.add(key)
            exc: dict[str, Any] = {
                "source": a["value"], "target": b["value"],
                "mode": effect, "factor": factor,
            }
            if a["id"]:
                exc["source_id"] = a["id"]
            if b["id"]:
                exc["target_id"] = b["id"]
            exceptions.append({
                "exception": exc, "reason": reason, "from": group,
                "replaces": key in old_pairs,
            })

    if cells or exceptions:
        matrix: dict[str, dict[str, Any]] = {}
        for c in cells:
            matrix.setdefault(c["source_tag"], {})[c["target_tag"]] = c["cell"]
        ConstraintHandler.validate_payload({
            "source_wildcard_id": "source", "target_wildcard_id": "target",
            "matrix": matrix, "exceptions": [e["exception"] for e in exceptions],
        })
    return {"cells": cells, "exceptions": exceptions, "skipped": skipped}
