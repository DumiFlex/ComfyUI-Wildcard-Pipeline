"""Grammar-only precision for small models (research note "Request-aware
prompts", plan Phase 2): each step's typed JSON schema names the items a
call may point at, and the tools that usually come next join the
shortlist.

The schema is the server's grammar, not part of the prompt, so it can
change every step without touching the prompt cache. The prompt, the
native declarations and `check_args` keep the plain schemas; only the
offer a typed JSON step sends is narrowed (`_ai_turn._model_step`).

- `id` of the item tools is an enum of what the edit guard would allow
  (`Library._check_named`): named items, the page's item, this chat's
  proposals and, on a change ask, items this answer read. A tool with no
  such item of its kind leaves the offer.
- `read`'s `id`, `run_test`'s `template` and `open`'s page and settings
  section are enums of what exists, while the list is small enough for a
  grammar (`MAX_ENUM`).
- `NEXT`: after a call, the tools that usually follow it are offered too
  (search → read; read of a wildcard → its edit tools; a create →
  run_test), so the shortlist doesn't cost a `more_tools` step there.
"""
from __future__ import annotations

import copy
from dataclasses import replace
from typing import Any

from engine.ai import client_tools
from engine.ai.tools.registry import Tool

#: Longest enum put in a grammar: past it the field stays free text.
MAX_ENUM = 300

#: Item tools by the kinds of item they change (empty: any kind).
ITEM_KINDS: dict[str, tuple[str, ...]] = {
    "add_options": ("wildcard",), "edit_options": ("wildcard",),
    "edit_values": ("fixed_values",), "edit_combine": ("combine",),
    "add_rules": ("derivation",), "edit_rules": ("derivation",),
    "edit_constraint": ("constraint",), "edit_template": ("template",),
    "edit_bundle": ("bundle",), "update_info": (),
}

#: Tools that usually follow a call of the key tool.
NEXT: dict[str, tuple[str, ...]] = {
    "search": ("read",),
    "variables": ("read",),
    **{t: ("run_test",) for t in ("create_wildcard", "create_derivation", "create_constraint",
                                  "create_fixed_values", "create_combine", "create_bundle")},
}
#: After reading an item of a kind, the tools that change it.
AFTER_READ: dict[str, tuple[str, ...]] = {
    "wildcard": ("add_options", "edit_options", "create_constraint"),
    "derivation": ("add_rules", "edit_rules"),
    "constraint": ("edit_constraint",),
    "fixed_values": ("edit_values",),
    "combine": ("edit_combine",),
    "template": ("edit_template",),
    "bundle": ("edit_bundle", "run_test"),
}


def next_tools(called: set[str], read_kinds: set[str]) -> set[str]:
    """Tools the next step offers because of what this answer did."""
    out: set[str] = set()
    for tool in called:
        out.update(NEXT.get(tool, ()))
    for kind in read_kinds:
        out.update(AFTER_READ.get(kind, ()))
    return out


def _rows(lib: Any) -> dict[str, dict[str, Any]]:
    return {**lib.modules, **lib.bundles, **lib.templates}


def editable(lib: Any) -> set[str] | None:
    """Ids the item tools may change now, or None when nothing limits them."""
    if lib.named is None:
        return None
    rows = _rows(lib)
    out = {i for i in lib.named if i in rows}
    out |= {i for i, r in rows.items() if r.get("_proposed")}
    if lib.editor_id and lib.editor_id in rows:
        out.add(lib.editor_id)
    if lib.edit_read:
        out |= {i for i in lib.touched if i in rows}
    return out


def enums(lib: Any) -> dict[str, dict[str, list[str]]]:
    """Tool → field → the values its grammar allows this step. An empty list
    means the tool can't be called usefully now."""
    rows = _rows(lib)
    out: dict[str, dict[str, list[str]]] = {
        "open": {"page": list(client_tools.PAGES),
                 "section": list(client_tools.SETTINGS_SECTIONS)},
    }
    if 0 < len(rows) <= MAX_ENUM:
        # Empty library: read stays free (it says what it found).
        out["read"] = {"id": sorted(rows)}
    if len(lib.templates) <= MAX_ENUM:
        out["run_test"] = {"template": sorted(lib.templates)}
    allowed = editable(lib)
    if allowed is not None:
        for tool, kinds in ITEM_KINDS.items():
            ids = sorted(i for i in allowed if not kinds or lib.kind_of(i) in kinds)
            if len(ids) <= MAX_ENUM:
                out[tool] = {"id": ids}
    return out


def _with_enums(t: Tool, fields: dict[str, list[str]]) -> Tool | None:
    """`t` with its string fields limited to `fields`; None when a required
    field allows nothing. An optional field that allows nothing is dropped."""
    params = copy.deepcopy(t.params)
    props = params.get("properties") or {}
    required = set(params.get("required") or [])
    for name, values in fields.items():
        prop = props.get(name)
        if not isinstance(prop, dict) or prop.get("type") != "string":
            continue
        if not values:
            if name in required:
                return None
            del props[name]
            continue
        prop["enum"] = list(values)
    return replace(t, params=params)


def narrow(offer: list[Tool], lib: Any) -> list[Tool]:
    """The offer with each tool's fields limited to what exists and what may
    be changed. Never empties it: if every tool would go, it is unchanged."""
    limits = enums(lib)
    out = []
    for t in offer:
        fields = limits.get(t.name)
        got = _with_enums(t, fields) if fields else t
        if got is not None:
            out.append(got)
    return out or offer
