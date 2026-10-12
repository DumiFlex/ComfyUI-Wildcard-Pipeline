"""Per-use settings ("use" blocks) the model writes for a stack item.

Multi-pick, a tag filter, Hold across run and the rest are not part of a
module: they live on each USE of it (a Context row, a bundle child, a Test
Runner stack item, as its ``instance``). The model writes them as one short
line of ``;``-separated clauses, which this module turns into instance keys:

    pick 2-3              pick_min 2, pick_max 3 (a list; $var joins them,
                          $var.0 is the first)
    pick 1-3 repeats      … allowing the same option twice
    sep " and "           pick_separator (default ", ")
    filter warm and not wet   category_filter, checked against its tags
    no empty              exclude_null (never the empty option)
    match $model_variant  match_variable (take the option equal to it)
    hold                  seed_scope "hold" (same pick for a whole Loop run)
    internal              hidden from the prompt, still readable by rules
    as $hat               variable_binding (bind it to another variable)

`describe` goes the other way, so `read` can show a bundle child's settings
in the same words.
"""
from __future__ import annotations

import re
from typing import Any

from engine.syntax.subcat_filter import ParseError, parse

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
MAX_PICK = 20
#: Which clause works on which module kind.
_KINDS = {
    "pick": ("wildcard",), "sep": ("wildcard",), "filter": ("wildcard",),
    "no empty": ("wildcard",), "match": ("wildcard",),
    "hold": ("wildcard", "combine", "fixed_values"),
    "internal": ("wildcard", "combine", "derivation"),
    "as": ("wildcard", "combine"),
}


def _var(raw: str) -> str:
    v = raw.strip().lstrip("$").strip()
    if not _IDENT.match(v) or v.startswith("__"):
        raise ValueError(f"{raw.strip()!r} isn't a variable name")
    return v


def parse_use(
    raw: Any, *, kind: str, tags: list[str] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """``(instance, notes)`` for a module of ``kind``. ``raw`` is the clause
    line, or an object of clause → value. Clauses that don't apply to the
    kind or don't parse are left out and named in ``notes``."""
    if isinstance(raw, dict):
        parts = []
        for k, v in raw.items():
            if v is True:
                parts.append(str(k))
            elif v not in (None, False, ""):
                parts.append(f"{k} {v}")
        raw = "; ".join(parts)
    if not isinstance(raw, str) or not raw.strip():
        return {}, []
    out: dict[str, Any] = {}
    notes: list[str] = []
    for clause in (c.strip() for c in raw.split(";")):
        if not clause:
            continue
        low = clause.lower()
        word = next((w for w in sorted(_KINDS, key=len, reverse=True)
                     if low == w or low.startswith(w + " ")), None)
        if word is None and low in ("exclude null", "exclude_null", "!null", "never empty"):
            word = "no empty"
        if word is None:
            notes.append(f"{clause!r} isn't a setting")
            continue
        if kind not in _KINDS[word]:
            notes.append(f"{word} doesn't apply to a {kind.replace('_', ' ')}")
            continue
        rest = clause[len(word):].strip()
        try:
            _apply(word, rest, out, tags)
        except ValueError as e:
            notes.append(f"{clause}: {e}")
    return out, notes


def _apply(word: str, rest: str, out: dict[str, Any], tags: list[str] | None) -> None:
    if word == "pick":
        m = re.fullmatch(r"(\d+)(?:\s*(?:-|to)\s*(\d+))?(\s+repeats?)?", rest.lower())
        if not m:
            raise ValueError("write pick N or pick N-M")
        lo = int(m.group(1))
        hi = int(m.group(2)) if m.group(2) else lo
        lo, hi = min(lo, hi), max(lo, hi)
        if hi < 1 or hi > MAX_PICK:
            raise ValueError(f"pick between 1 and {MAX_PICK}")
        out["pick_min"], out["pick_max"] = max(0, lo), hi
        if m.group(3):
            out["pick_independent"] = True
    elif word == "sep":
        m = re.fullmatch(r"\"(.*)\"|'(.*)'", rest)
        out["pick_separator"] = (m.group(1) if m.group(1) is not None else m.group(2)) \
            if m else rest
    elif word == "filter":
        expr = " ".join(rest.split())
        try:
            ast = parse(expr)
        except ParseError as e:
            raise ValueError(str(e)) from None
        if ast is None:
            raise ValueError("the filter is empty")
        if tags is not None:
            known = set(tags)
            terms = re.findall(r"[^\s()!,]+", expr)
            bad = [t for t in terms if t.lower() not in ("and", "or", "not") and t not in known]
            if bad:
                raise ValueError(f"no tag {bad[0]!r} on this wildcard"
                                 + (f" (its tags: {', '.join(tags[:15])})" if tags else ""))
        out["category_filter"] = expr
    elif word == "no empty":
        out["exclude_null"] = True
    elif word == "match":
        out["match_variable"] = _var(rest)
    elif word == "hold":
        out["seed_scope"] = "hold"
    elif word == "internal":
        out["internal"] = True
    elif word == "as":
        out["variable_binding"] = _var(rest)


def describe(instance: Any) -> str:
    """An instance's settings as the clause line ``parse_use`` reads."""
    if not isinstance(instance, dict):
        return ""
    bits: list[str] = []
    lo, hi = instance.get("pick_min"), instance.get("pick_max")
    if isinstance(hi, int) and (hi != 1 or (isinstance(lo, int) and lo != 1)):
        lo = lo if isinstance(lo, int) else hi
        bits.append(f"pick {lo}" + (f"-{hi}" if hi != lo else "")
                    + (" repeats" if instance.get("pick_independent") else ""))
        if isinstance(instance.get("pick_separator"), str):
            bits.append(f'sep "{instance["pick_separator"]}"')
    if isinstance(instance.get("category_filter"), str) and instance["category_filter"].strip():
        bits.append(f"filter {instance['category_filter'].strip()}")
    if instance.get("exclude_null"):
        bits.append("no empty")
    if isinstance(instance.get("match_variable"), str) and instance["match_variable"]:
        bits.append(f"match ${instance['match_variable']}")
    if instance.get("seed_scope") == "hold":
        bits.append("hold")
    if instance.get("internal"):
        bits.append("internal")
    if isinstance(instance.get("variable_binding"), str) and instance["variable_binding"]:
        bits.append(f"as ${instance['variable_binding']}")
    if isinstance(instance.get("locked_seed"), (int, float)):
        bits.append(f"seed locked to {instance['locked_seed']}")
    if instance.get("enabled_options"):
        bits.append(f"{len(instance['enabled_options'])} options switched on")
    if instance.get("template_override"):
        bits.append("own template")
    if instance.get("disabled_rule_ids"):
        bits.append(f"{len(instance['disabled_rule_ids'])} rules off")
    return "; ".join(bits)


GUIDE = """\
Per-use settings ("use", for a wildcard, combine or derivation in a bundle or \
stack), written as clauses separated by ";": "pick 2-3" (several options; \
$var joins them with ", ", $var.0 is the first; "pick 1-3 repeats" allows the \
same one twice; sep " and " changes the joiner), "filter warm and not wet" \
(only options with those tags), "no empty" (never the empty option), "match \
$model_variant" (take the option whose text equals that variable), "hold" \
(the same pick for a whole WP Context Loop run, like a character that \
stays), "internal" (rules can read it, the prompt doesn't show it), "as \
$other" (bind it to another variable). "" for none.\
"""
