"""The variables a library defines, as the AI rule drafters see them.

Derivations and constraints are written in terms of variables (``$class``)
and option texts (``mage``). A model only writes useful rules if it knows
which exist, so the route builds this catalog from the library and the prompt
lists it. It's also how the compilers spot a rule about a variable nobody
sets, or a condition on an option the wildcard doesn't have.

Pure: takes module rows (``{"type", "name", "payload"}``), returns plain data.
"""
from __future__ import annotations

import re
from typing import Any

from engine.model_info import (
    _FAMILY_PREFIXES,
    DEFAULT_VARIANT_RULES,
    FAMILY_VAR,
    NAME_VAR,
    VARIANT_VAR,
)

#: Values listed per variable in the prompt; the rest are counted.
MAX_VALUES_SHOWN = 30
#: Characters of a module's description shown next to its variable.
MAX_ABOUT = 100
#: Variables listed in the prompt. A library with more lists the first ones;
#: the user names the rest in their request.
MAX_VARS_SHOWN = 120

_SOURCE_LABEL = {
    "wildcard": "wildcard",
    "fixed_values": "fixed value",
    "combine": "combine",
    "derivation": "set by derivation",
    "model": "WP Model Info",
    "loop": "WP Context Loop",
    "input": "run-time input",
}
#: What the WP Context Loop sets on every iteration (internal by default).
LOOP_VARS = {
    "iteration": "this iteration's number, 1 to N",
    "iteration_total": "how many iterations the loop runs",
}


def _add(
    out: dict[str, dict[str, Any]], name: str, source: str, module: str,
    values: list[str] | None = None, tags: list[str] | None = None,
    about: str = "", axes: list[str] | None = None,
) -> None:
    if not isinstance(name, str) or not name or name.startswith("__"):
        return
    entry = out.get(name)
    if entry is None:
        entry = out[name] = {
            "name": name, "sources": [], "values": [], "tags": [], "about": "", "axes": [],
        }
    if about and not entry["about"]:
        entry["about"] = about
    src = {"kind": source, "module": module}
    if src not in entry["sources"]:
        entry["sources"].append(src)
    for v in values or []:
        if v not in entry["values"]:
            entry["values"].append(v)
    for t in tags or []:
        if t not in entry["tags"]:
            entry["tags"].append(t)
    for a in axes or []:
        if a not in entry.setdefault("axes", []):
            entry["axes"].append(a)


def _action_targets(rule: Any) -> list[str]:
    if not isinstance(rule, dict):
        return []
    clauses = list(rule.get("branches") or [])
    if isinstance(rule.get("else"), dict):
        clauses.append(rule["else"])
    out: list[str] = []
    for c in clauses:
        if not isinstance(c, dict):
            continue
        acts = [c.get("action"), *(c.get("extra_actions") or [])]
        for a in acts:
            if (
                isinstance(a, dict) and isinstance(a.get("target_var"), str)
                and a.get("mode", "replace") in ("replace", "append", "prepend")
            ):
                out.append(a["target_var"])
    return out


def derivation_targets(payload: dict[str, Any]) -> list[str]:
    """Every variable a derivation's rules write (not negatives-only)."""
    out: list[str] = []
    for rule in payload.get("rules") or []:
        out += [t for t in _action_targets(rule) if t not in out]
    return out


def build_catalog(
    modules: list[dict[str, Any]], *, inputs: list[dict[str, Any]] | None = None,
) -> dict[str, dict[str, Any]]:
    """Every variable the library sets → ``{name, sources, values, tags, axes}``.

    ``values`` are a wildcard's option texts (what an ``equals`` condition
    compares against); ``tags`` its tags; ``axes`` its "accepts" tag groups,
    readable as ``$name.AXIS``. The WP Model Info and WP Context Loop
    variables are always present; ``inputs`` (``{var, about}``) are run-time
    inputs a request declares, set by a WP Context Injector.
    """
    out: dict[str, dict[str, Any]] = {}
    for m in modules:
        if not isinstance(m, dict):
            continue
        p = m.get("payload") if isinstance(m.get("payload"), dict) else {}
        mname = m.get("name") if isinstance(m.get("name"), str) else ""
        desc = m.get("description") if isinstance(m.get("description"), str) else ""
        desc = " ".join(desc.split())
        desc = desc if len(desc) <= MAX_ABOUT else desc[:MAX_ABOUT - 1] + "…"
        kind = m.get("type")
        if kind == "wildcard":
            values = [
                o["value"].strip() for o in p.get("options") or []
                if isinstance(o, dict) and not o.get("is_null")
                and isinstance(o.get("value"), str) and o["value"].strip()
            ]
            tags = [t for t in p.get("sub_categories") or [] if isinstance(t, str)]
            kinds = p.get("tag_group_kinds") if isinstance(p.get("tag_group_kinds"), dict) else {}
            axes = [k for k, v in kinds.items() if v == "accepts" and isinstance(k, str)]
            _add(out, p.get("var_binding") or "", "wildcard", mname, values, tags, desc, axes)
        elif kind == "fixed_values":
            for v in p.get("values") or []:
                if isinstance(v, dict) and isinstance(v.get("name"), str):
                    _add(out, v["name"].strip(), "fixed_values", mname, about=desc)
        elif kind == "combine":
            _add(out, p.get("output_var") or "", "combine", mname, about=desc)
        elif kind == "derivation":
            for rule in p.get("rules") or []:
                for target in _action_targets(rule):
                    _add(out, target, "derivation", mname)
    families = sorted({f for _, f in _FAMILY_PREFIXES})
    _add(out, FAMILY_VAR, "model", "", families)
    _add(out, VARIANT_VAR, "model", "", [r["variant"] for r in DEFAULT_VARIANT_RULES])
    _add(out, NAME_VAR, "model", "", [])
    for name, about in LOOP_VARS.items():
        _add(out, name, "loop", "", about=about)
    for i in inputs or []:
        if isinstance(i, dict) and isinstance(i.get("var"), str):
            _add(out, i["var"], "input", "", about=str(i.get("about") or "")[:MAX_ABOUT])
    return out


def describe(catalog: dict[str, dict[str, Any]], *, focus: list[str] | None = None) -> str:
    """The catalog as prompt lines, the ``focus`` variables first."""
    names = list(catalog)
    if focus:
        first = [n for n in focus if n in catalog]
        names = first + [n for n in names if n not in first]
    lines: list[str] = []
    for name in names[:MAX_VARS_SHOWN]:
        e = catalog[name]
        srcs = ", ".join(
            _SOURCE_LABEL[s["kind"]] + (f' "{s["module"]}"' if s["module"] else "")
            for s in e["sources"]
        )
        line = f"${name} ({srcs})"
        if e.get("about"):
            line += f" — {e['about']}"
        vals = e["values"]
        if vals:
            shown = ", ".join(vals[:MAX_VALUES_SHOWN])
            extra = len(vals) - MAX_VALUES_SHOWN
            more = f" (+{extra} more)" if extra > 0 else ""
            line += f": {shown}{more}"
        if e["tags"]:
            line += f"  [tags: {', '.join(e['tags'][:30])}]"
        if e.get("axes"):
            line += "  [reads: " + ", ".join(f"${name}.{a}" for a in e["axes"]) + "]"
        lines.append(line)
    if len(names) > MAX_VARS_SHOWN:
        lines.append(f"(+{len(names) - MAX_VARS_SHOWN} more variables not listed)")
    return "\n".join(lines)


_VAR = re.compile(r"\$([a-zA-Z_][a-zA-Z0-9_]*)")


def var_names_in(text: str) -> list[str]:
    """The ``$name`` reads in a line of text, in order."""
    return _VAR.findall(text or "")
