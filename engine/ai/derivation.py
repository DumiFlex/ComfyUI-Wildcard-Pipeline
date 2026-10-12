"""Derivation rules from plain language.

The model answers in a flat spec, forced by a JSON schema:

    {"rules": [{
        "summary": str,
        "branches": [{"match": "all" | "any",
                      "conditions": [{"var", "op", "value"}],
                      "actions": [{"target_var", "mode", "value"}]}],
        "else_actions": [{"target_var", "mode", "value"}],
    }]}

`compile_rules` turns that into payload rules the editor appends:

- ``$`` is stripped from variable names, which must be plain identifiers;
- one condition stays a single test, several become an all/any group;
- the first action is the branch's ``action``, the rest ``extra_actions``
  (absent, never ``[]``, for one action);
- an ``equals`` / ``not_equals`` value that matches a wildcard option except
  for case is corrected to the option's spelling, since the engine compares
  exactly;
- action values may point at wildcards by name (``@{Colors:warm}``); those
  are compiled to id refs by `refs.compile_text` (unknown names and tags are
  refused); conditions are literal text or ``$var`` only;
- every rule gets a fresh id and must pass `DerivationHandler.validate_payload`.

Rules that can't be used are dropped and reported; things that work but look
wrong (a variable nobody sets, a value the wildcard doesn't have) come back as
warnings the editor shows next to the rule.
"""
from __future__ import annotations

import re
import secrets
from typing import Any

from engine.ai import about
from engine.ai import refs as ai_refs
from engine.modules.derivation_handler import (
    _VALID_MODES,
    _VALID_OPS,
    DerivationHandler,
)

MAX_RULES = 20
MAX_BRANCHES = 12
MAX_CONDITIONS = 8
MAX_ACTIONS = 6
MAX_VALUE_LEN = 1000

_IDENT = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,63}$")
_NO_VALUE_OPS = {"exists", "not_exists", "is_set", "is_unset", "is_empty", "is_not_empty"}
_VAR_READ = re.compile(r"\$([a-zA-Z_][a-zA-Z0-9_]*)")

_STR = {"type": "string"}


def _obj(props: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "object", "additionalProperties": False,
        "required": list(props), "properties": props,
    }


_ACTION = _obj({
    "target_var": _STR,
    "mode": {"type": "string", "enum": sorted(_VALID_MODES)},
    "value": _STR,
})
_CONDITION = _obj({
    "var": _STR,
    "op": {"type": "string", "enum": sorted(_VALID_OPS)},
    "value": _STR,
})

SCHEMA: dict[str, Any] = _obj({
    "rules": {"type": "array", "items": _obj({
        "summary": _STR,
        "branches": {"type": "array", "items": _obj({
            "match": {"type": "string", "enum": ["all", "any"]},
            "conditions": {"type": "array", "items": _CONDITION},
            "actions": {"type": "array", "items": _ACTION},
        })},
        "else_actions": {"type": "array", "items": _ACTION},
    })},
})

SYSTEM_PROMPT = """\
You write derivation rules for Wildcard Pipeline, a ComfyUI extension that \
builds image-generation prompts from variables. Wildcards pick a random option \
and store it in a variable (for example $class = "mage"). A derivation rule \
reads variables and sets others, so later text can use them.

How a rule runs: its branches are checked top to bottom and the FIRST branch \
whose conditions hold runs its actions; if none holds, else_actions run (leave \
else_actions empty for no else). Separate rules run independently, one after \
another.

Conditions (var is a variable name, no $):
- equals / not_equals: exact, case-sensitive text match. Use the option text \
exactly as listed.
- contains: value is a substring. matches: value is a regular expression.
- exists / not_exists: the variable was set at all. is_set / is_unset: set and \
non-empty / unset or empty. is_empty / is_not_empty. These take value "".
- match "all" needs every condition, "any" needs one.

Actions:
- replace: set target_var to value. append / prepend: add value after / \
before what target_var already holds (include a leading ", " when appending \
to a list of tags).
- negative: add value to target_var's negative prompt. negative_replace: make \
value its only negative.
- value is prompt text. It may read variables as $name, and also \
$name.0 (the first of a multi-pick, .1 the second), $name.AXIS (the tag an \
"accepts" tag group rolled, like $outfit.SHOES) and $name.neg (the \
variable's negative words). It may pick: {a|b}, or @{Wildcard name} / \
@{Wildcard name:tag} for a fresh pick from a wildcard listed below ("if \
$class is mage, append @{Weapons:arcane} to $gear"). Condition values are \
plain text or one $name, never picks.

Use the library's variable names and option texts when the request refers to \
them. Some variables are set at run time outside the library ($iteration from \
a WP Context Loop, anything a WP Context Injector brings in); reading them is \
fine when the request mentions them. A new variable name is fine when the \
request asks for one: letters, digits and _ only. Write one rule per \
independent decision, and a short summary of what each rule does. Don't add \
commentary; the output is data for the user's own library.\
"""


def build_prompt(
    *, instruction: str, name: str, catalog_text: str, existing_rules: list[str],
    description: str = "", labels: list[str] | None = None, refs_text: str = "",
) -> str:
    lines = [f"Derivation module: {name or '(unnamed)'}"]
    lines.extend(about.lines(description, labels or []))
    if existing_rules:
        lines.append("It already has these rules (don't repeat them):")
        lines.extend(f"- {r}" for r in existing_rules[:40])
    lines.append("")
    lines.append("Variables in the library (name, where it comes from, its options):")
    lines.append(catalog_text or "(none yet)")
    if refs_text:
        lines.append("")
        lines.append("Wildcards an action can pick from with @{name}:")
        lines.append(refs_text)
    lines.append("")
    lines.append(f"Request: {instruction.strip()}")
    return "\n".join(lines)


def describe_rule(rule: dict[str, Any]) -> str:
    """One line for the prompt: ``IF $a equals x → $b = y; ELSE …``."""
    parts: list[str] = []

    def cond(c: dict[str, Any]) -> str:
        if "conditions" in c:
            j = " and " if c.get("match") == "all" else " or "
            return "(" + j.join(cond(x) for x in c["conditions"] if isinstance(x, dict)) + ")"
        v = "" if c.get("op") in _NO_VALUE_OPS else f' "{c.get("value", "")}"'
        return f"${c.get('var', '')} {c.get('op', '')}{v}"

    def acts(clause: dict[str, Any]) -> str:
        out = []
        for a in [clause.get("action"), *(clause.get("extra_actions") or [])]:
            if isinstance(a, dict):
                mode, target = a.get("mode", "replace"), a.get("target_var", "")
                out.append(f'{mode} ${target} "{a.get("value", "")}"')
        return ", ".join(out)

    for i, b in enumerate(rule.get("branches") or []):
        if isinstance(b, dict) and isinstance(b.get("condition"), dict):
            parts.append(f"{'IF' if i == 0 else 'ELIF'} {cond(b['condition'])} → {acts(b)}")
    if isinstance(rule.get("else"), dict):
        parts.append(f"ELSE → {acts(rule['else'])}")
    return "; ".join(parts)


def _var_name(raw: Any) -> str | None:
    if not isinstance(raw, str):
        return None
    name = raw.strip().lstrip("$").strip()
    return name if _IDENT.match(name) and not name.startswith("__") else None


def _flat(text: Any) -> str:
    return re.sub(r"\s+", " ", text).strip() if isinstance(text, str) else ""


class _Drop(Exception):
    """This rule can't be used; the message says why."""


def _new_id(taken: set[str]) -> str:
    while True:
        rid = f"r_ai{secrets.token_hex(4)}"
        if rid not in taken:
            taken.add(rid)
            return rid


def compile_rules(
    raw: Any, *, catalog: dict[str, dict[str, Any]], taken_ids: set[str] | None = None,
    refs: ai_refs.RefIndex | None = None,
) -> dict[str, Any]:
    """Check the model's rules. Returns
    ``{"rules": [{"rule", "summary", "warnings"}], "skipped": [{"text", "reason"}]}``.
    Raises ValueError when the answer isn't the expected shape at all."""
    if not isinstance(raw, dict) or not isinstance(raw.get("rules"), list):
        raise ValueError("the model's answer wasn't a list of rules")
    taken = set(taken_ids or ())
    # Variables these rules set count as known, so a rule may read what an
    # earlier one in the same answer writes without a warning.
    catalog = dict(catalog)
    for item in raw["rules"][:MAX_RULES]:
        for target in _answer_targets(item):
            catalog.setdefault(target, {"name": target, "sources": [], "values": [], "tags": []})
    out: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    for item in raw["rules"][:MAX_RULES]:
        if not isinstance(item, dict):
            continue
        summary = _flat(item.get("summary"))[:200]
        warnings: list[str] = []
        try:
            rule = _compile_rule(item, catalog, warnings, refs)
        except _Drop as e:
            skipped.append({"text": summary or "a rule", "reason": str(e)})
            continue
        rule = {"id": _new_id(taken), **rule}
        try:
            DerivationHandler.validate_payload({"rules": [rule]})
        except ValueError as e:
            skipped.append({"text": summary or "a rule", "reason": str(e)})
            continue
        out.append({
            "rule": rule, "summary": summary or describe_rule(rule),
            "warnings": list(dict.fromkeys(warnings)),
        })
    return {"rules": out, "skipped": skipped}


def _answer_targets(item: Any) -> list[str]:
    if not isinstance(item, dict):
        return []
    acts = list(item.get("else_actions") or [])
    for b in item.get("branches") or []:
        if isinstance(b, dict):
            acts.extend(b.get("actions") or [])
    names = [_var_name(a.get("target_var")) for a in acts if isinstance(a, dict)]
    return [n for n in names if n]


def _compile_rule(
    item: dict[str, Any], catalog: dict[str, dict[str, Any]], warnings: list[str],
    refs: ai_refs.RefIndex | None = None,
) -> dict[str, Any]:
    branches: list[dict[str, Any]] = []
    for b in (item.get("branches") or [])[:MAX_BRANCHES]:
        if not isinstance(b, dict):
            continue
        conds = [
            c for c in (_compile_condition(x, catalog, warnings)
                        for x in (b.get("conditions") or [])[:MAX_CONDITIONS])
            if c is not None
        ]
        actions = _compile_actions(b.get("actions"), catalog, warnings, refs)
        if not conds or not actions:
            continue
        condition = conds[0] if len(conds) == 1 else {
            "match": "any" if b.get("match") == "any" else "all", "conditions": conds,
        }
        branch: dict[str, Any] = {"condition": condition, "action": actions[0]}
        if len(actions) > 1:
            branch["extra_actions"] = actions[1:]
        branches.append(branch)
    if not branches:
        raise _Drop("no usable condition and action")
    rule: dict[str, Any] = {"branches": branches}
    else_actions = _compile_actions(item.get("else_actions"), catalog, warnings, refs)
    if else_actions:
        clause: dict[str, Any] = {"action": else_actions[0]}
        if len(else_actions) > 1:
            clause["extra_actions"] = else_actions[1:]
        rule["else"] = clause
    return rule


def _compile_condition(
    c: Any, catalog: dict[str, dict[str, Any]], warnings: list[str],
) -> dict[str, Any] | None:
    if not isinstance(c, dict):
        return None
    var = _var_name(c.get("var"))
    op = c.get("op")
    if var is None:
        raise _Drop(f"{c.get('var')!r} isn't a variable name")
    if op not in _VALID_OPS:
        raise _Drop(f"unknown test {op!r}")
    value = "" if op in _NO_VALUE_OPS else _flat(c.get("value"))[:MAX_VALUE_LEN]
    entry = catalog.get(var)
    if entry is None:
        warnings.append(unset_note(var))
    if value.startswith("$") and op not in _NO_VALUE_OPS:
        read = value[1:]
        if not _IDENT.match(read.split(".")[0]):
            raise _Drop(f"{value!r} isn't a variable name")
        if read.split(".")[0] not in catalog:
            warnings.append(unset_note(read.split(".")[0]))
    elif "@{" in value or ai_refs.has_pick(value):
        raise _Drop("a condition compares with plain text or one $variable, not a pick")
    if op == "matches":
        try:
            re.compile(value)
        except re.error:
            raise _Drop(f"{value!r} isn't a valid pattern") from None
    if op in ("equals", "not_equals") and entry and entry["values"]:
        if value not in entry["values"]:
            fixed = next((v for v in entry["values"] if v.lower() == value.lower()), None)
            if fixed is not None:
                value = fixed
            elif any(s["kind"] == "wildcard" for s in entry["sources"]):
                warnings.append(f'${var} has no option "{value}"')
    return {"var": var, "op": op, "value": value}


def unset_note(var: str) -> str:
    return (f"nothing in your library sets ${var} (fine if a WP Context Injector "
            "or an earlier Context sets it)")


def _compile_actions(
    raw: Any, catalog: dict[str, dict[str, Any]], warnings: list[str],
    refs: ai_refs.RefIndex | None = None,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for a in (raw if isinstance(raw, list) else [])[:MAX_ACTIONS]:
        if not isinstance(a, dict):
            continue
        target = _var_name(a.get("target_var"))
        if target is None:
            raise _Drop(f"{a.get('target_var')!r} isn't a variable name")
        mode = a.get("mode") if a.get("mode") in _VALID_MODES else "replace"
        value = a.get("value") if isinstance(a.get("value"), str) else ""
        value = re.sub(r"\s+", " ", value).strip()[:MAX_VALUE_LEN]
        try:
            value = ai_refs.compile_text(value, surface="action", refs=refs)
        except ValueError as e:
            raise _Drop(str(e)) from None
        if not value and mode != "replace":
            continue
        for read in _VAR_READ.findall(value):
            if read not in catalog and read != target:
                warnings.append(unset_note(read))
        out.append({"target_var": target, "mode": mode, "value": value})
    return out
