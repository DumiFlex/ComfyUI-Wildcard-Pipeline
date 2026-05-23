"""Pure reverse-ref scan for cascade-edit mutations.

Given a target (kind, id) + action, return the list of entities that
reference the target. Used by:
  - confirm dialog (dry-run mode) to show the user what will be affected
  - orchestrator to plan the cleanup pass

The scan reads via repositories and walks payload JSON for ``@{uuid}`` /
``@{uuid:subcat}`` / ``$varname`` text refs. Mirrors the regexes in
``src/manager/import-export/dep-graph.ts``.

Pure function — no mutation, no I/O beyond DB reads.
"""
from __future__ import annotations

import re
import sqlite3
from typing import Any

from engine.db.repositories import (
    BundleRepository,
    ModuleRepository,
)

# ``@{8hex}`` and optional ``:subcat`` suffix — same pattern as dep-graph.ts
_REF_REGEX = re.compile(r"@\{([0-9a-f]{8})(?::([^}]*))?\}")
# ``$varname`` — leading-letter identifier
_VAR_REGEX = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)")


def _list_all_modules(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Return all module rows (no filter). ``ModuleRepository.list()``
    accepts all-optional kwargs, so bare call returns everything."""
    return ModuleRepository(conn).list()


def _list_all_bundles(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Return all bundle rows."""
    return BundleRepository(conn).list()


def _ref_entry(kind: str, row: dict[str, Any], ref_path: str) -> dict[str, Any]:
    return {"kind": kind, "id": row["id"], "name": row.get("name", ""), "ref_path": ref_path}


# ---------------------------------------------------------------------------
# Per-(kind, action) scan helpers
# ---------------------------------------------------------------------------

def _scan_wildcard_delete(conn: sqlite3.Connection, wildcard_id: str) -> list[dict[str, Any]]:
    """Wildcard delete: find constraints, other wildcards, derivations,
    and bundles that reference this wildcard id."""
    out: list[dict[str, Any]] = []

    for m in _list_all_modules(conn):
        if m["id"] == wildcard_id:
            continue
        t = m["type"]
        p = m.get("payload") or {}

        if t == "constraint":
            if (p.get("source_wildcard_id") == wildcard_id
                    or p.get("target_wildcard_id") == wildcard_id):
                out.append(_ref_entry("constraint", m, "source_wildcard_id|target_wildcard_id"))
            continue

        if t == "wildcard":
            opts = p.get("options") or []
            for idx, opt in enumerate(opts):
                v = opt.get("value")
                if not isinstance(v, str):
                    continue
                if any(uid == wildcard_id for uid, _sub in _REF_REGEX.findall(v)):
                    out.append(_ref_entry("wildcard", m, f"options[{idx}].value"))
                    break
            continue

        if t == "derivation":
            found = False
            rules = p.get("rules") or []
            for ri, rule in enumerate(rules):
                if found:
                    break
                for bi, branch in enumerate(rule.get("branches") or []):
                    if found:
                        break
                    for ai, action in enumerate(branch.get("actions") or []):
                        if not isinstance(action, dict):
                            continue
                        for v in action.values():
                            if isinstance(v, str) and any(
                                uid == wildcard_id for uid, _ in _REF_REGEX.findall(v)
                            ):
                                out.append(_ref_entry(
                                    "derivation", m,
                                    f"rules[{ri}].branches[{bi}].actions[{ai}]",
                                ))
                                found = True
                                break
                        if found:
                            break
            continue

    # Bundles: children list may include this wildcard by id
    for b in _list_all_bundles(conn):
        for ci, child in enumerate(b.get("children") or []):
            if child.get("id") == wildcard_id:
                out.append(_ref_entry("bundle", b, f"children[{ci}]"))
                break

    return out


def _scan_subcat(
    conn: sqlite3.Connection,
    wildcard_id: str,
    subcat_name: str,
) -> list[dict[str, Any]]:
    """Shared scan for subcategory delete and rename — affected set is identical."""
    out: list[dict[str, Any]] = []

    for m in _list_all_modules(conn):
        if m["type"] == "constraint":
            p = m.get("payload") or {}
            matrix = p.get("matrix") or {}

            # Source side: matrix keys are source subcat names
            source_match = (
                p.get("source_wildcard_id") == wildcard_id
                and subcat_name in matrix
            )

            # Target side: matrix row values are dicts keyed by target subcat names
            target_match = False
            if p.get("target_wildcard_id") == wildcard_id:
                for row_val in matrix.values():
                    if isinstance(row_val, dict) and subcat_name in row_val:
                        target_match = True
                        break

            if source_match or target_match:
                out.append(_ref_entry(
                    "constraint", m,
                    "matrix.source" if source_match else "matrix.target",
                ))
            continue

        if m["type"] == "wildcard" and m["id"] != wildcard_id:
            opts = (m.get("payload") or {}).get("options") or []
            for idx, opt in enumerate(opts):
                v = opt.get("value")
                if not isinstance(v, str):
                    continue
                for uid, sub in _REF_REGEX.findall(v):
                    if uid == wildcard_id and sub == subcat_name:
                        out.append(_ref_entry("wildcard", m, f"options[{idx}].value"))
                        break

    return out


def _scan_combine_output_var(
    conn: sqlite3.Connection,
    var_name: str,
) -> list[dict[str, Any]]:
    """Find modules that use ``$var_name`` as a variable reference or
    a ``set_var`` assignment target."""
    out: list[dict[str, Any]] = []

    for m in _list_all_modules(conn):
        t = m["type"]
        p = m.get("payload") or {}

        if t == "wildcard":
            for idx, opt in enumerate(p.get("options") or []):
                v = opt.get("value")
                if isinstance(v, str) and var_name in _VAR_REGEX.findall(v):
                    out.append(_ref_entry("wildcard", m, f"options[{idx}].value"))
                    break
            continue

        if t == "derivation":
            found = False
            for ri, rule in enumerate(p.get("rules") or []):
                if found:
                    break
                for bi, branch in enumerate(rule.get("branches") or []):
                    if found:
                        break
                    for ai, action in enumerate(branch.get("actions") or []):
                        if not isinstance(action, dict):
                            continue
                        for k, v in action.items():
                            # Match as variable ref in a string value
                            if isinstance(v, str) and var_name in _VAR_REGEX.findall(v):
                                out.append(_ref_entry(
                                    "derivation", m,
                                    f"rules[{ri}].branches[{bi}].actions[{ai}].{k}",
                                ))
                                found = True
                                break
                            # Or match as the explicit set_var target
                            if k == "set_var" and v == var_name:
                                out.append(_ref_entry(
                                    "derivation", m,
                                    f"rules[{ri}].branches[{bi}].actions[{ai}].set_var",
                                ))
                                found = True
                                break
                        if found:
                            break
            continue

        if t == "combine":
            tpl = p.get("template", "")
            if isinstance(tpl, str) and var_name in _VAR_REGEX.findall(tpl):
                out.append(_ref_entry("combine", m, "payload.template"))
            continue

    return out


def _scan_category_delete(
    conn: sqlite3.Connection,
    category_id: str,
) -> list[dict[str, Any]]:
    """Return every module whose ``category_id`` field equals the target."""
    return [
        _ref_entry(m["type"], m, "category_id")
        for m in _list_all_modules(conn)
        if m.get("category_id") == category_id
    ]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def scan_affected(
    conn: sqlite3.Connection,
    *,
    kind: str,
    id: str,
    action: str,
    extra: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Dispatch reverse-ref scan by (kind, action). Pure function.

    Parameters
    ----------
    conn:
        Open, migrated ``sqlite3.Connection``.
    kind:
        Entity kind being mutated (e.g. ``"wildcard"``, ``"subcategory"``).
    id:
        Primary-key id of the target entity.
    action:
        The mutation action (e.g. ``"delete"``, ``"rename"``).
    extra:
        Per-mutation context dict.  Keys vary by (kind, action):

        * subcategory delete/rename → ``{"subcat_name": "warm"}``
        * combine_output_var rename → ``{"old_name": "mood", "new_name": "tone"}``

    Returns
    -------
    list[dict]
        Each entry: ``{kind, id, name, ref_path}``.
        Returns ``[]`` for unsupported (kind, action) pairs (v1 stub —
        other pairs land when their fixer + scan ship together).
    """
    extra = extra or {}

    if kind == "wildcard" and action == "delete":
        return _scan_wildcard_delete(conn, id)

    if kind == "subcategory" and action in ("delete", "rename"):
        return _scan_subcat(conn, id, extra.get("subcat_name", ""))

    if kind == "combine_output_var":
        # Accept either old_name (rename flow) or name (generic)
        var_name = extra.get("old_name") or extra.get("name", "")
        return _scan_combine_output_var(conn, var_name)

    if kind == "category" and action == "delete":
        return _scan_category_delete(conn, id)

    # Unsupported (kind, action) pair — v1 stub, returns empty.
    return []
