"""End-to-end cascade-edit orchestrator.

apply_cascade dispatches scan + fixer + target-delete + undo-write in a
single SQLite transaction. The `with conn:` block is the rollback boundary
described in the fixers.py atomicity contract.
"""
from __future__ import annotations

import sqlite3
from typing import Any

from engine.cascade.fixers import (
    fix_bundle_delete,
    fix_category_delete,
    fix_combine_output_var_rename,
    fix_option_delete,
    fix_subcat_delete,
    fix_subcat_rename,
    fix_wildcard_delete,
)
from engine.cascade.scan import scan_affected
from engine.cascade.undo import write_undo_entry
from engine.db.repositories import (
    BundleRepository,
    CategoryRepository,
    ModuleRepository,
)


def _delete_target(conn: sqlite3.Connection, kind: str, target_id: str) -> dict[str, Any]:
    """Delete the primary target entity and return its BEFORE-snapshot.

    Raises XNotFound (e.g. ModuleNotFound, CategoryNotFound) if the target
    does not exist — propagates to the caller's try/except error envelope.
    """
    if kind == "bundle":
        repo: Any = BundleRepository(conn)
    elif kind == "category":
        repo = CategoryRepository(conn)
    else:
        repo = ModuleRepository(conn)
    snapshot = repo.get(target_id)  # raises XNotFound if missing → caller catches
    repo.delete(target_id)
    return snapshot


def _rename_subcat_target_only(
    conn: sqlite3.Connection,
    wildcard_id: str,
    old_name: str,
    new_name: str,
) -> dict[str, Any] | None:
    """Rename a subcat inside the source wildcard ONLY (no cascade to refs).

    Touches both the top-level `payload.sub_categories` declared list and
    each option's `sub_categories` membership list (SP1 multi-tag shape).
    """
    mod = ModuleRepository(conn)
    wc = mod.get(wildcard_id)
    snapshot = dict(wc)  # capture BEFORE
    payload = dict(wc.get("payload") or {})

    declared = payload.get("sub_categories") or []
    if old_name in declared:
        payload["sub_categories"] = [
            new_name if s == old_name else s for s in declared
        ]

    new_options = []
    for opt in payload.get("options") or []:
        new_opt = dict(opt)
        subs = new_opt.get("sub_categories")
        if isinstance(subs, list) and old_name in subs:
            new_opt["sub_categories"] = [
                new_name if s == old_name else s for s in subs
            ]
        new_options.append(new_opt)
    payload["options"] = new_options

    mod.update(wildcard_id, payload=payload)
    return snapshot


def apply_cascade(conn: sqlite3.Connection, req: dict[str, Any]) -> dict[str, Any]:
    """Dispatch scan + fixer + target-delete + undo-write atomically.

    Parameters
    ----------
    conn:
        Open, migrated sqlite3.Connection.
    req:
        Operation descriptor dict — see module docstring for full shape.

    Returns
    -------
    dict
        Response envelope. Always has ``ok: bool``.
        On error: ``{ok: False, error: str}``.
        On dry_run: ``{ok: True, affected_count: int, affected_entities: list}``.
        On commit: ``{ok: True, undo_entry_id: str, affected_count: int,
                       affected_entities: list, diff: list}``.
        On opt-out rename: ``{ok: True, undo_entry_id: str, affected_count: 0,
                              broken_refs: list}``.
    """
    kind = req.get("kind")
    target_id = req.get("id")
    action = req.get("action")
    cascade_refs = req.get("cascade_refs", True)
    dry_run = req.get("dry_run", False)
    new_name = req.get("new_name")
    extra = req.get("extra") or {}

    # --- Validate required fields -------------------------------------------
    if not kind:
        return {"ok": False, "error": "kind required"}
    if not target_id:
        return {"ok": False, "error": "id required"}
    if not action:
        return {"ok": False, "error": "action required"}

    # --- Scan (read-only, safe outside transaction) --------------------------
    affected = scan_affected(conn, kind=kind, id=target_id, action=action, extra=extra)

    if dry_run:
        return {
            "ok": True,
            "affected_count": len(affected),
            "affected_entities": affected,
        }

    # --- Opt-out rename: snapshot + rename target only, write undo ----------
    if action == "rename" and cascade_refs is False:
        if not new_name:
            return {"ok": False, "error": "new_name required for rename"}
        try:
            with conn:
                snapshot_before: list[dict[str, Any]] = []
                if kind == "subcategory":
                    old_name = extra.get("subcat_name", "")
                    snap = _rename_subcat_target_only(conn, target_id, old_name, new_name)
                    if snap is not None:
                        snapshot_before.append(snap)
                elif kind == "combine_output_var":
                    # Update the combine's output_var field only (not its name).
                    mod = ModuleRepository(conn)
                    cb = mod.get(target_id)
                    snapshot_before.append(cb)
                    new_payload = {**(cb.get("payload") or {}), "output_var": new_name}
                    mod.update(target_id, payload=new_payload)
                else:
                    # Generic module rename: snapshot then update name.
                    repo = ModuleRepository(conn)
                    before = repo.get(target_id)
                    snapshot_before.append(before)
                    repo.update(target_id, name=new_name)
                undo_id = write_undo_entry(
                    conn,
                    target_kind=kind,
                    target_id=target_id,
                    action=action,
                    snapshot_before=snapshot_before,
                    snapshot_after=[],
                )
            return {
                "ok": True,
                "undo_entry_id": undo_id,
                "affected_count": 0,
                "broken_refs": affected,
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    # --- Cascade-on path: dispatch fixer + target delete + undo -------------
    # Validate rename operands before opening the transaction.
    if action == "rename" and kind in ("subcategory", "combine_output_var") and not new_name:
        return {"ok": False, "error": "new_name required for rename"}

    try:
        with conn:
            touched_before: list[dict[str, Any]] = []
            diff: list[dict[str, Any]] = []
            key = (kind, action)

            if key == ("wildcard", "delete"):
                # Opt-in nested-ref cleanup: only entities the caller
                # lists get their @{wildcard_id...} token stripped.
                # Constraints are never deleted (healed via reattach UI);
                # an empty list strips nothing.
                cleanup_ids = req.get("cleanup_ids") or []
                touched_before, diff = fix_wildcard_delete(conn, target_id, cleanup_ids)
            elif key == ("subcategory", "delete"):
                touched_before, diff = fix_subcat_delete(
                    conn, target_id, extra.get("subcat_name", "")
                )
            elif key == ("subcategory", "rename"):
                touched_before, diff = fix_subcat_rename(
                    conn, target_id, extra.get("subcat_name", ""), new_name,  # type: ignore[arg-type]
                )
            elif key == ("combine_output_var", "rename"):
                touched_before, diff = fix_combine_output_var_rename(
                    conn, target_id, extra.get("old_name", ""), new_name,  # type: ignore[arg-type]
                )
            elif key == ("category", "delete"):
                touched_before, diff = fix_category_delete(conn, target_id)
            elif key == ("bundle", "delete"):
                touched_before, diff = fix_bundle_delete(conn, target_id)
            elif key == ("option", "delete"):
                touched_before, diff = fix_option_delete(
                    conn, extra.get("wildcard_id", ""), target_id,
                )
            elif action == "delete" and kind in (
                "fixed_values",
                "combine",
                "derivation",
                "constraint",
            ):
                # These module types are leaves from a reverse-ref
                # perspective: nothing in another row's payload points
                # at them by id the way `option.id` is referenced from
                # constraint matrices or `wildcard.id` is referenced
                # from constraint source/target. A whole-entity delete
                # is just a row drop + undo snapshot — no fix step,
                # no diff entries.
                #
                # Caveat: combine.output_var IS referenced by name
                # from downstream payloads, but the cascade pipeline
                # treats that as a "rename" concern (already wired as
                # combine_output_var/rename above). Deleting a combine
                # leaves any consumer referencing the output_var with
                # an unresolved variable, surfaced separately by the
                # integrity/broken-refs scan.
                touched_before, diff = [], []
            else:
                return {
                    "ok": False,
                    "error": f"unsupported (kind, action) pair: ({kind}, {action})",
                }

            # Delete target entity for whole-entity delete ops. Module
            # subtypes route through ModuleRepository via _delete_target
            # (the else-branch of its dispatch).
            if action == "delete" and kind in (
                "wildcard",
                "category",
                "bundle",
                "fixed_values",
                "combine",
                "derivation",
                "constraint",
            ):
                target_snapshot = _delete_target(conn, kind, target_id)
                touched_before.append(target_snapshot)
                diff.append({"entity_id": target_id, "removed": True})

            undo_id = write_undo_entry(
                conn,
                target_kind=kind,
                target_id=target_id,
                action=action,
                snapshot_before=touched_before,
                snapshot_after=[],
            )

        return {
            "ok": True,
            "undo_entry_id": undo_id,
            "affected_count": len(diff),
            "affected_entities": affected,
            "diff": diff,
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
