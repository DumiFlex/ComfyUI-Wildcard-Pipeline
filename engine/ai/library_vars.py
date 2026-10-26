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

#: Set by the engine or the canvas (WP Model Info, the Loop), not by an item.
RUNTIME_VARS = frozenset({"iteration", "iteration_total", FAMILY_VAR, VARIANT_VAR, NAME_VAR})
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
    "injector": "WP Context Injector on the canvas",
}
#: What the WP Context Loop sets on every iteration (internal by default).
LOOP_VARS = {
    "iteration": 'the CURRENT frame number as text, "1" for the first frame: a rule per '
                 'frame tests this one (equals "2" is the second frame)',
    "iteration_total": 'how many frames the loop runs in all, e.g. "4"; the same in every '
                       'frame, so it never picks a frame (that is $iteration)',
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
    canvas: list[dict[str, Any]] | None = None,
) -> dict[str, dict[str, Any]]:
    """Every variable the library sets → ``{name, sources, values, tags, axes}``.

    ``values`` are a wildcard's option texts (what an ``equals`` condition
    compares against); ``tags`` its tags; ``axes`` its "accepts" tag groups,
    readable as ``$name.AXIS``. The WP Model Info and WP Context Loop
    variables are always present; ``inputs`` (``{var, about}``) are run-time
    inputs a request declares, set by a WP Context Injector. ``canvas``
    (``{name, source, about}``, source injector / loop / model) are the
    variables the user's open canvas sets, e.g. a renamed Loop variable.
    """
    out: dict[str, dict[str, Any]] = {}
    for m in modules:
        if not isinstance(m, dict):
            continue
        p = _got if isinstance(_got := m.get("payload"), dict) else {}
        mname = _got if isinstance(_got := m.get("name"), str) else ""
        desc = _got if isinstance(_got := m.get("description"), str) else ""
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
            kinds = _got if isinstance(_got := p.get("tag_group_kinds"), dict) else {}
            axes = [k for k, v in kinds.items() if v == "accepts" and isinstance(k, str)]
            _add(out, p.get("var_binding") or "", "wildcard", mname, values, tags, desc, axes)
            # Which options carry each tag, so a test on a tag ("elf") can
            # become a test on those options.
            var = p.get("var_binding") or ""
            if var in out:
                tagged = out[var].setdefault("tagged", {})
                for o in p.get("options") or []:
                    if not isinstance(o, dict) or o.get("is_null") \
                            or not isinstance(o.get("value"), str) or not o["value"].strip():
                        continue
                    for t in o.get("sub_categories") or []:
                        if isinstance(t, str) and o["value"].strip() not in tagged.get(t, []):
                            tagged.setdefault(t, []).append(o["value"].strip())
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
    for c in canvas or []:
        if isinstance(c, dict) and isinstance(c.get("name"), str) \
                and c.get("source") in ("injector", "loop", "model"):
            _add(out, c["name"], c["source"], "", about=str(c.get("about") or "")[:MAX_ABOUT])
    return out


def describe(catalog: dict[str, dict[str, Any]], *, focus: list[str] | None = None,
             values: int = MAX_VALUES_SHOWN) -> str:
    """The catalog as prompt lines, the ``focus`` variables first, with up
    to ``values`` values each."""
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
            shown = ", ".join(vals[:values])
            extra = len(vals) - values
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


#: Variables listed in full by `describe_for`; the rest go on one line by name.
MAX_VARS_FOCUSED = 20
_WORD = re.compile(r"[a-z0-9]+")
#: Request words that say nothing about which variable is meant.
_PLAIN = frozenset("""a an the and or of to in on at for with when if then else set sets
is are be it its this that these those my your from by as not no any all each every
make add write rule rules value values variable variables use only also than into""".split())


def _words(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower().replace("_", " ")) if len(w) > 2
            and w not in _PLAIN}


def describe_for(catalog: dict[str, dict[str, Any]], request: str, *,
                 focus: list[str] | None = None, keep: int = MAX_VARS_FOCUSED,
                 values: int = MAX_VALUES_SHOWN) -> str:
    """`describe`, narrowed to what `request` is about: the variables it
    names (``$name``), the ``focus`` ones, then those whose name, values,
    tags or module share its words, up to ``keep`` in full; every other
    variable is still named on one line, so the model knows it exists. A
    catalog of ``keep`` or fewer is described whole (the derivation and text
    panels sent ~4,900 tokens of catalog for 82 variables, 2026-10-23)."""
    if len(catalog) <= keep:
        return describe(catalog, focus=focus, values=values)
    named = [n for n in var_names_in(request) if n in catalog]
    first = list(dict.fromkeys([*named, *(n for n in focus or [] if n in catalog)]))
    words = _words(request) | {w.rstrip("s") for w in _words(request)}

    def score(name: str) -> int:
        e = catalog[name]
        own = _words(name)
        text = _words(" ".join([*map(str, e["values"][:MAX_VALUES_SHOWN]), *map(str, e["tags"]),
                                str(e.get("about") or ""),
                                *(str(s.get("module") or "") for s in e["sources"])]))
        return 3 * len(words & own) + len(words & text)

    scored = sorted((n for n in catalog if n not in first), key=lambda n: -score(n))
    picked = first + [n for n in scored if score(n) > 0][:max(0, keep - len(first))]
    rest = [n for n in catalog if n not in picked]
    out = describe({n: catalog[n] for n in picked}, values=values) if picked else ""
    if rest:
        out += ("\n" if out else "") + (
            "Also set in the library (name only; use one only when the request is about it): "
            + ", ".join(f"${n}" for n in rest[:MAX_VARS_SHOWN]))
        if len(rest) > MAX_VARS_SHOWN:
            out += f" (+{len(rest) - MAX_VARS_SHOWN} more)"
    return out
