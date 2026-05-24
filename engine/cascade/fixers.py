"""Per-mutation cleanup fixers for cascade-edit operations.

Each fixer handles one (kind, action) combination. All take a live
``sqlite3.Connection`` plus target identifiers, mutate affected entities
via repositories, and return:

    (touched, diff)

* ``touched`` — list of entity row dicts captured *before* mutation
  (BEFORE-state snapshots). Passed back to the orchestrator so it can
  persist them in the undo log.
* ``diff``    — list of lightweight index-patch dicts that describe what
  changed, keyed by ``entity_id``.

Contracts:
- Fixers do NOT delete the target entity. The orchestrator handles the
  primary mutation.
- Fixers do NOT write to ``cascade_undo``. The orchestrator persists the
  undo entry.
- All mutations go through repository methods — never raw SQL.
- Zero ComfyUI imports. Stdlib ``re`` + repositories only.

Caller contract (atomicity)
---------------------------
The caller (orchestrator at engine/cascade/orchestrator.py, Task 5)
MUST wrap each fixer call in an explicit BEGIN…COMMIT/ROLLBACK
transaction. Individual repository methods auto-commit via their
own `with conn:` blocks; the outer transaction the orchestrator
opens is the only rollback boundary if a fixer raises mid-loop.
Without an outer transaction, partial mutations are persisted.
"""
from __future__ import annotations

import copy
import re
import sqlite3
from typing import Any

from engine.db.repositories import BundleRepository, ModuleRepository

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _deepcopy_row(row: dict[str, Any]) -> dict[str, Any]:
    """Return a deep-copied snapshot of a row dict."""
    return copy.deepcopy(row)


def _rewrite_var_in_string(s: str, old_name: str, new_name: str) -> str:
    """Replace ``$old_name`` → ``$new_name`` word-boundary-safe.

    Uses a negative-lookbehind/lookahead so ``$mood`` matches but
    ``$moodier`` does not.
    """
    pattern = re.compile(
        r"\$" + re.escape(old_name) + r"(?![A-Za-z0-9_])"
    )
    return pattern.sub(f"${new_name}", s)


def _rewrite_subcat_ref_in_string(
    s: str,
    wildcard_id: str,
    old_subcat: str,
    new_subcat: str,
) -> str:
    """Replace ``@{wildcard_id:old_subcat}`` → ``@{wildcard_id:new_subcat}``."""
    pattern = re.compile(
        r"@\{" + re.escape(wildcard_id) + r":" + re.escape(old_subcat) + r"\}"
    )
    return pattern.sub(f"@{{{wildcard_id}:{new_subcat}}}", s)


def _strip_subcat_ref_in_string(
    s: str,
    wildcard_id: str,
    subcat_name: str,
) -> str:
    """Remove ``@{wildcard_id:subcat_name}`` occurrences from *s*."""
    pattern = re.compile(
        r"@\{" + re.escape(wildcard_id) + r":" + re.escape(subcat_name) + r"\}"
    )
    return pattern.sub("", s)


# ---------------------------------------------------------------------------
# Public fixers
# ---------------------------------------------------------------------------

def fix_wildcard_delete(
    conn: sqlite3.Connection,
    wildcard_id: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Strip all references to *wildcard_id* from constraints and bundles.

    * Constraints whose source or target is *wildcard_id* are deleted.
    * Bundle ``children[]`` lists have the wildcard entry removed.

    The fixer does NOT delete the wildcard row itself; the orchestrator
    owns that mutation.
    """
    touched: list[dict[str, Any]] = []
    diff: list[dict[str, Any]] = []

    mod_repo = ModuleRepository(conn)
    bundle_repo = BundleRepository(conn)

    # --- Constraints --------------------------------------------------------
    for m in mod_repo.list():
        if m["type"] != "constraint":
            continue
        p = m.get("payload") or {}
        if (p.get("source_wildcard_id") == wildcard_id
                or p.get("target_wildcard_id") == wildcard_id):
            touched.append(_deepcopy_row(m))
            mod_repo.delete(m["id"])
            diff.append({"entity_id": m["id"], "removed": True})

    # --- Bundles ------------------------------------------------------------
    for b in bundle_repo.list():
        children = b.get("children") or []
        new_children = [ch for ch in children if ch.get("id") != wildcard_id]
        if len(new_children) != len(children):
            touched.append(_deepcopy_row(b))
            bundle_repo.update(b["id"], children=new_children)
            diff.append({
                "entity_id": b["id"],
                "remove_ref": {"kind": "wildcard", "id": wildcard_id},
            })

    return touched, diff


def fix_subcat_delete(
    conn: sqlite3.Connection,
    wildcard_id: str,
    subcat_name: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Strip all references to ``wildcard_id:subcat_name``.

    * Source wildcard's ``options[].sub_categories`` — removes the name.
    * Constraint matrix keys (source-side) — removes the top-level key.
    * Constraint matrix values (target-side) — removes nested keys.
    * Other wildcards' option values — removes ``@{wildcard_id:subcat_name}``.
    """
    touched: list[dict[str, Any]] = []
    diff: list[dict[str, Any]] = []

    repo = ModuleRepository(conn)

    for m in repo.list():
        t = m["type"]
        p = m.get("payload") or {}
        changed = False
        new_payload = copy.deepcopy(p)

        if t == "wildcard" and m["id"] == wildcard_id:
            # Top-level declared list
            declared = new_payload.get("sub_categories") or []
            if subcat_name in declared:
                new_payload["sub_categories"] = [
                    s for s in declared if s != subcat_name
                ]
                changed = True
            # Per-option singular assignment — null out options pointing at
            # the deleted subcat (preserves the option, releases the link)
            for opt in new_payload.get("options") or []:
                if opt.get("sub_category") == subcat_name:
                    opt["sub_category"] = None
                    changed = True

        elif t == "constraint":
            matrix = new_payload.get("matrix") or {}

            # Source-side: top-level matrix keys are source subcat names
            if (new_payload.get("source_wildcard_id") == wildcard_id
                    and subcat_name in matrix):
                del matrix[subcat_name]
                new_payload["matrix"] = matrix
                changed = True

            # Target-side: nested keys within each row value
            if new_payload.get("target_wildcard_id") == wildcard_id:
                for _row_key, row_val in list(matrix.items()):
                    if isinstance(row_val, dict) and subcat_name in row_val:
                        del row_val[subcat_name]
                        changed = True

        elif t == "wildcard" and m["id"] != wildcard_id:
            # Strip @{wildcard_id:subcat_name} text refs from option values
            for opt in new_payload.get("options") or []:
                v = opt.get("value")
                if isinstance(v, str):
                    new_v = _strip_subcat_ref_in_string(v, wildcard_id, subcat_name)
                    if new_v != v:
                        opt["value"] = new_v
                        changed = True

        if changed:
            touched.append(_deepcopy_row(m))
            repo.update(m["id"], payload=new_payload)
            diff.append({
                "entity_id": m["id"],
                "remove_ref": {"kind": "subcat", "wildcard_id": wildcard_id, "subcat": subcat_name},
            })

    return touched, diff


def fix_subcat_rename(
    conn: sqlite3.Connection,
    wildcard_id: str,
    old_name: str,
    new_name: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Rewrite all references to ``wildcard_id:old_name`` → ``wildcard_id:new_name``.

    * Source wildcard's ``options[].sub_categories``.
    * Constraint matrix keys (source-side) — renamed top-level key.
    * Constraint matrix values (target-side) — renamed nested keys.
    * Other wildcards' option values — ``@{uuid:old}`` → ``@{uuid:new}``.
    """
    touched: list[dict[str, Any]] = []
    diff: list[dict[str, Any]] = []

    repo = ModuleRepository(conn)

    for m in repo.list():
        t = m["type"]
        p = m.get("payload") or {}
        changed = False
        new_payload = copy.deepcopy(p)

        if t == "wildcard" and m["id"] == wildcard_id:
            # Top-level declared sub_categories list
            declared = new_payload.get("sub_categories") or []
            if old_name in declared:
                new_payload["sub_categories"] = [
                    new_name if s == old_name else s for s in declared
                ]
                changed = True
            # Per-option singular assignment (`opt.sub_category`, not plural)
            for opt in new_payload.get("options") or []:
                if opt.get("sub_category") == old_name:
                    opt["sub_category"] = new_name
                    changed = True

        elif t == "constraint":
            matrix = new_payload.get("matrix") or {}

            # Source-side: rename top-level matrix key
            if (new_payload.get("source_wildcard_id") == wildcard_id
                    and old_name in matrix):
                matrix[new_name] = matrix.pop(old_name)
                new_payload["matrix"] = matrix
                changed = True

            # Target-side: rename nested keys in each row
            if new_payload.get("target_wildcard_id") == wildcard_id:
                for row_val in matrix.values():
                    if isinstance(row_val, dict) and old_name in row_val:
                        row_val[new_name] = row_val.pop(old_name)
                        changed = True

        elif t == "wildcard" and m["id"] != wildcard_id:
            # Rewrite @{wildcard_id:old_name} → @{wildcard_id:new_name}
            for opt in new_payload.get("options") or []:
                v = opt.get("value")
                if isinstance(v, str):
                    new_v = _rewrite_subcat_ref_in_string(v, wildcard_id, old_name, new_name)
                    if new_v != v:
                        opt["value"] = new_v
                        changed = True

        if changed:
            touched.append(_deepcopy_row(m))
            repo.update(m["id"], payload=new_payload)
            diff.append({
                "entity_id": m["id"],
                "rename_ref": {
                    "kind": "subcat",
                    "wildcard_id": wildcard_id,
                    "old": old_name,
                    "new": new_name,
                },
            })

    return touched, diff


def fix_combine_output_var_rename(
    conn: sqlite3.Connection,
    combine_id: str,
    old_name: str,
    new_name: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Rename a combine's output variable and all ``$old_name`` references.

    * Combine's ``output_var`` field updated to *new_name*.
    * Other wildcards: ``$old_name`` → ``$new_name`` in option values.
    * Derivations: ``$old_name`` → ``$new_name`` in action string values;
      ``set_var: "old_name"`` → ``set_var: "new_name"``.
    * Other combines: ``$old_name`` → ``$new_name`` in template.
    """
    touched: list[dict[str, Any]] = []
    diff: list[dict[str, Any]] = []

    repo = ModuleRepository(conn)

    for m in repo.list():
        t = m["type"]
        p = m.get("payload") or {}
        changed = False
        new_payload = copy.deepcopy(p)

        if t == "combine" and m["id"] == combine_id:
            # Update the combine's own output_var
            if new_payload.get("output_var") == old_name:
                new_payload["output_var"] = new_name
                changed = True
            # Also rewrite $old in its own template in case it self-references
            tpl = new_payload.get("template", "")
            if isinstance(tpl, str):
                new_tpl = _rewrite_var_in_string(tpl, old_name, new_name)
                if new_tpl != tpl:
                    new_payload["template"] = new_tpl
                    changed = True

        elif t == "wildcard":
            for opt in new_payload.get("options") or []:
                v = opt.get("value")
                if isinstance(v, str):
                    new_v = _rewrite_var_in_string(v, old_name, new_name)
                    if new_v != v:
                        opt["value"] = new_v
                        changed = True

        elif t == "derivation":
            for rule in new_payload.get("rules") or []:
                for branch in rule.get("branches") or []:
                    for action in branch.get("actions") or []:
                        if not isinstance(action, dict):
                            continue
                        for k in list(action.keys()):
                            v = action[k]
                            if k == "set_var" and v == old_name:
                                action[k] = new_name
                                changed = True
                            elif isinstance(v, str):
                                new_v = _rewrite_var_in_string(v, old_name, new_name)
                                if new_v != v:
                                    action[k] = new_v
                                    changed = True

        elif t == "combine" and m["id"] != combine_id:
            tpl = new_payload.get("template", "")
            if isinstance(tpl, str):
                new_tpl = _rewrite_var_in_string(tpl, old_name, new_name)
                if new_tpl != tpl:
                    new_payload["template"] = new_tpl
                    changed = True

        if changed:
            touched.append(_deepcopy_row(m))
            repo.update(m["id"], payload=new_payload)
            diff.append({
                "entity_id": m["id"],
                "rename_ref": {"kind": "var", "old": old_name, "new": new_name},
            })

    return touched, diff


def fix_category_delete(
    conn: sqlite3.Connection,
    category_id: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Null out ``category_id`` on every module referencing *category_id*.

    Does NOT delete the category row itself; the orchestrator handles that.
    """
    touched: list[dict[str, Any]] = []
    diff: list[dict[str, Any]] = []

    repo = ModuleRepository(conn)

    for m in repo.list():
        if m.get("category_id") == category_id:
            touched.append(_deepcopy_row(m))
            repo.update(m["id"], category_id=None)
            diff.append({
                "entity_id": m["id"],
                "remove_ref": {"kind": "category", "id": category_id},
            })

    return touched, diff
