"""Bundle editor: split a bundle's children into sub-bundles with the AI.

The model only names a section for each child, in the order they run; the
groups are the runs of neighbouring children with the same section, so the
order the bundle runs in never changes and nothing has to be re-checked.
A run of one child stays in the bundle itself, and a child that is already
a bundle breaks a run (a sub-bundle can't hold a bundle).
"""
from __future__ import annotations

import re
from typing import Any

from engine.ai import guide as ai_guide
from engine.ai.pack import _module_name, _module_sets

MAX_CHILDREN = 120
MAX_SECTIONS = 8
MAX_NAME = 40
_VAR_READ = re.compile(r"\$([a-zA-Z_][a-zA-Z0-9_]*)")

SCHEMA: dict[str, Any] = {
    "type": "object", "additionalProperties": False, "required": ["sections", "children"],
    "properties": {
        "sections": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["name", "about"],
            "properties": {"name": {"type": "string"}, "about": {"type": "string"}}}},
        "children": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["index", "section"],
            "properties": {"index": {"type": "integer"}, "section": {"type": "string"}}}},
    },
}

SYSTEM = """\
You tidy a Wildcard Pipeline bundle by grouping its children into \
sub-bundles: one per part of the prompt (character, outfit, scene, style…), \
so each part can be reused on its own. You only name a section for each \
child; the children keep their order, and neighbours with the same section \
become one sub-bundle. So give the same section to children that sit next \
to each other and belong together; a constraint sits just before the \
wildcard it limits and goes in that wildcard's section. Use 2 to 8 short \
section names (one or two words). Leave the section empty ("") for a child \
that should stay in the bundle itself (a lone item, or one that ties \
several parts together). Children that are bundles already stay as they \
are; give them "". Answer with every child by its index.

""" + ai_guide.WHICH


class SplitError(ValueError):
    pass


def _reads(payload: Any) -> list[str]:
    out: list[str] = []

    def walk(x: Any) -> None:
        if isinstance(x, str):
            out.extend(_VAR_READ.findall(x))
        elif isinstance(x, dict):
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(payload)
    return list(dict.fromkeys(out))


def prompt(name: str, children: list[dict[str, Any]], instruction: str = "") -> str:
    """The bundle's children for the model, one line each."""
    lines = [f'Bundle "{name}", children in run order:']
    for n, c in enumerate(children[:MAX_CHILDREN]):
        if c.get("type") == "bundle":
            lines.append(f"{n}. bundle {c.get('name') or c.get('id')} (already a sub-bundle)")
            continue
        bits = [str(c.get("type") or "module")]
        sets = _module_sets(c)
        if sets:
            bits.append("sets $" + ", $".join(sets[:4]))
        reads = [r for r in _reads(c.get("payload")) if r not in sets]
        if reads:
            bits.append("reads $" + ", $".join(reads[:4]))
        lines.append(f"{n}. {_module_name(c)} ({'; '.join(bits)})")
    if instruction.strip():
        lines += ["", f"The user asks: {instruction.strip()[:1000]}"]
    return "\n".join(lines)


def compile_groups(answer: Any, children: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The model's sections as groups of neighbouring children:
    ``[{name, about, start, end}]`` (``end`` inclusive), each with at least
    two children that aren't bundles. Raises SplitError when nothing
    groups."""
    if not isinstance(answer, dict):
        raise SplitError("the answer had no sections")
    about: dict[str, str] = {}
    for s in answer.get("sections") or []:
        if isinstance(s, dict) and isinstance(s.get("name"), str) and s["name"].strip():
            about.setdefault(s["name"].strip()[:MAX_NAME].lower(),
                             str(s.get("about") or "").strip()[:200])
    label: dict[int, str] = {}
    names: dict[str, str] = {}
    for c in answer.get("children") or []:
        if not isinstance(c, dict):
            continue
        n, sec = c.get("index"), c.get("section")
        if isinstance(n, int) and not isinstance(n, bool) and 0 <= n < len(children) \
                and isinstance(sec, str) and sec.strip():
            key = sec.strip()[:MAX_NAME].lower()
            names.setdefault(key, sec.strip()[:MAX_NAME])
            label[n] = key
    groups: list[dict[str, Any]] = []
    run: list[int] = []

    def close() -> None:
        if len(run) >= 2:
            key = label[run[0]]
            groups.append({"name": names[key], "about": about.get(key, ""),
                           "start": run[0], "end": run[-1]})
    for n, c in enumerate(children):
        key = label.get(n, "") if c.get("type") != "bundle" else ""
        if run and (not key or label.get(run[-1]) != key):
            close()
            run = []
        if key:
            run.append(n)
    close()
    groups = groups[:MAX_SECTIONS]
    if not groups:
        raise SplitError("the model didn't group any neighbouring children; try again, or "
                         "say how to group them")
    # Two runs with the same section name get numbered, so names stay apart.
    seen: dict[str, int] = {}
    for g in groups:
        k = g["name"].lower()
        seen[k] = seen.get(k, 0) + 1
        if seen[k] > 1:
            g["name"] = f"{g['name']} {seen[k]}"
    return groups
