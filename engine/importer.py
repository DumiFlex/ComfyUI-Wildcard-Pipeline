"""Atomic import commit + snapshot-based undo.

Receives a classified commit payload from the SPA (Task 15 client-side
classifier produces it from a diff vs. live DB), and applies the three
operation buckets — adds, replaces, renames — inside a single SQLite
transaction. If any row write raises (e.g. PK collision), the entire
commit rolls back and no undo entry is created.

For every successful commit we persist a row in ``import_undo`` that
carries enough information to reverse the commit: the kind+id of every
inserted record, and the pre-replace row contents (with kind) of every
replaced record. ``undo_import`` deletes the inserts and restores the
snapshots, then evicts the undo row.

Commit payload shape (received)::

    {
        "adds":     [{"kind": ..., "entity":      {...full row...}}, ...],
        "replaces": [{"kind": ..., "id": ..., "new_content": {...}}, ...],
        "renames":  [{"kind": ..., "old_id": ..., "new_id": ..., "content": {...}}, ...]
    }

``kind`` is one of: ``wildcard``, ``fixed_values``, ``combine``,
``derivation``, ``constraint``, ``bundle``, ``category``. The first
five are dispatched to the ``modules`` table (discriminated by the
``type`` column). Categories appear only in ``adds`` (name-based merge,
no replace/rename concept).

Undo metadata shape (persisted in ``import_undo`` row)::

    imported_records:   list[{"kind": str, "id": str}]
                        — records added or renamed; undo deletes each.
    replaced_snapshots: dict[id, {"kind": str, "row": {... full pre-replace ...}}]
                        — rows to restore on undo.
    rename_map:         dict[old_id, new_id]
                        — informational mapping; the new_id also appears
                        in imported_records for the actual delete.

Atomicity note: each repository method opens its own ``with self._conn:``
block, which auto-commits per call. To get a single atomic commit across
multi-row inserts we bypass the repositories and use raw SQL inside one
outer transaction — mirroring the legacy ``wp_api/import_export.py``
``import_bundle`` pattern.
"""
from __future__ import annotations

import json
import secrets
import sqlite3
from typing import Any

from engine._fingerprint import module_fingerprint
from engine._utils import now_iso
from engine.modules.snapshot import payload_hash

# Module kinds dispatched to the `modules` table. Mirrors the 5 entries
# of `engine.db.repositories._VALID_TYPES` — kept duplicated here so a
# typo in the discriminator field is caught locally, not silently
# inserted as an unknown type.
_MODULE_KINDS: frozenset[str] = frozenset({
    "wildcard", "fixed_values", "combine", "derivation", "constraint",
})


def _is_module_kind(kind: str) -> bool:
    return kind in _MODULE_KINDS


def _gen_undo_id() -> str:
    """Generate a fresh 16-hex undo id.

    Wider than the 8-hex module/bundle ids — undo entries can pile up
    over a session, and a wider id keeps collision probability
    negligible without a uniqueness check round-trip.
    """
    return secrets.token_hex(8)


def _module_fp_for_entity(entity: dict[str, Any]) -> str:
    """Compute snapshot_fingerprint for a module row dict.

    Mirrors the formula `ModuleRepository.create` uses at line 126:
    derive payload_hash on-the-fly from payload, then build the
    fingerprint. The exporter (Task 12) stamps fingerprints on rows
    before they leave the source DB, but we must re-compute on the
    destination because (a) the source-side hash may differ if the
    payload was migrated en route, and (b) the destination repository
    contract is that any write recomputes the fingerprint.
    """
    return module_fingerprint({
        "type": entity.get("type", ""),
        "name": entity.get("name", ""),
        "description": entity.get("description", ""),
        "tags": entity.get("tags") or [],
        "payload_hash": payload_hash(entity.get("payload") or {}),
    })


def _insert_module(
    conn: sqlite3.Connection, kind: str, entity: dict[str, Any], *,
    target_id: str | None = None,
) -> str:
    """INSERT a module row using raw SQL. Returns the inserted id.

    ``target_id`` overrides ``entity["id"]`` — used by the rename path
    where the inbound entity carries its original id but we want to
    insert under a freshly-allocated id. When None, ``entity["id"]``
    is used verbatim (the add path).
    """
    mid = target_id or entity["id"]
    now = now_iso()
    fp = _module_fp_for_entity({**entity, "type": kind})
    conn.execute(
        "INSERT INTO modules("
        "id, type, name, description, category_id, tags, "
        "is_favorite, payload, snapshot_fingerprint, version, "
        "created_at, updated_at"
        ") VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
        (
            mid, kind, entity["name"], entity.get("description", ""),
            entity.get("category_id"),
            json.dumps(entity.get("tags") or []),
            int(entity.get("is_favorite", False)),
            json.dumps(entity.get("payload") or {}),
            fp,
            entity.get("version", 1),
            entity.get("created_at", now),
            entity.get("updated_at", now),
        ),
    )
    return mid


def _insert_bundle(
    conn: sqlite3.Connection, entity: dict[str, Any], *,
    target_id: str | None = None,
) -> str:
    """INSERT a bundle row using raw SQL. Returns the inserted id.

    Mirrors `BundleRepository.create` for the field set, including
    `payload_hash` recomputation off `children` (the source-side hash
    may not match this DB's hashing rules — we always recompute on
    insert).
    """
    bid = target_id or entity["id"]
    children_blob = list(entity.get("children") or [])
    ph = payload_hash({"children": children_blob})
    now = now_iso()
    conn.execute(
        "INSERT INTO bundles("
        "id, name, description, color, category_id, tags, "
        "is_favorite, children, payload_hash, version, "
        "created_at, updated_at"
        ") VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
        (
            bid, entity["name"], entity.get("description", ""),
            entity.get("color"),
            entity.get("category_id"),
            json.dumps(entity.get("tags") or []),
            int(entity.get("is_favorite", False)),
            json.dumps(children_blob),
            ph,
            entity.get("version", 1),
            entity.get("created_at", now),
            entity.get("updated_at", now),
        ),
    )
    return bid


def _update_module(
    conn: sqlite3.Connection, mid: str, kind: str, content: dict[str, Any],
) -> None:
    """UPDATE the modules row identified by `mid` to mirror `content`.

    Preserves `mid` and the row's `type` (the kind dispatch already
    routed us here so type is implied). Bumps `version` and stamps
    `updated_at` like `ModuleRepository.update`.
    """
    now = now_iso()
    fp = _module_fp_for_entity({**content, "type": kind})
    conn.execute(
        "UPDATE modules SET "
        "name = ?, description = ?, category_id = ?, tags = ?, "
        "is_favorite = ?, payload = ?, snapshot_fingerprint = ?, "
        "version = version + 1, updated_at = ? "
        "WHERE id = ?;",
        (
            content["name"], content.get("description", ""),
            content.get("category_id"),
            json.dumps(content.get("tags") or []),
            int(content.get("is_favorite", False)),
            json.dumps(content.get("payload") or {}),
            fp, now, mid,
        ),
    )


def _update_bundle(
    conn: sqlite3.Connection, bid: str, content: dict[str, Any],
) -> None:
    """UPDATE the bundles row identified by `bid` to mirror `content`."""
    children_blob = list(content.get("children") or [])
    ph = payload_hash({"children": children_blob})
    now = now_iso()
    conn.execute(
        "UPDATE bundles SET "
        "name = ?, description = ?, color = ?, category_id = ?, "
        "tags = ?, is_favorite = ?, children = ?, payload_hash = ?, "
        "version = version + 1, updated_at = ? "
        "WHERE id = ?;",
        (
            content["name"], content.get("description", ""),
            content.get("color"),
            content.get("category_id"),
            json.dumps(content.get("tags") or []),
            int(content.get("is_favorite", False)),
            json.dumps(children_blob), ph, now, bid,
        ),
    )


def _module_exists(conn: sqlite3.Connection, mid: str) -> bool:
    row = conn.execute("SELECT 1 FROM modules WHERE id = ?;", (mid,)).fetchone()
    return row is not None


def _bundle_exists(conn: sqlite3.Connection, bid: str) -> bool:
    row = conn.execute("SELECT 1 FROM bundles WHERE id = ?;", (bid,)).fetchone()
    return row is not None


def _category_id_exists(conn: sqlite3.Connection, cid: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM module_categories WHERE id = ?;", (cid,),
    ).fetchone()
    return row is not None


def _fetch_module_row(
    conn: sqlite3.Connection, mid: str,
) -> dict[str, Any] | None:
    """Read a modules row as a plain dict (JSON columns deserialised)."""
    row = conn.execute("SELECT * FROM modules WHERE id = ?;", (mid,)).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"],
        "type": row["type"],
        "name": row["name"],
        "description": row["description"],
        "category_id": row["category_id"],
        "tags": json.loads(row["tags"]),
        "is_favorite": bool(row["is_favorite"]),
        "payload": json.loads(row["payload"]),
        "snapshot_fingerprint": row["snapshot_fingerprint"],
        "version": row["version"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _fetch_bundle_row(
    conn: sqlite3.Connection, bid: str,
) -> dict[str, Any] | None:
    """Read a bundles row as a plain dict (JSON columns deserialised)."""
    row = conn.execute("SELECT * FROM bundles WHERE id = ?;", (bid,)).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "color": row["color"],
        "category_id": row["category_id"],
        "tags": json.loads(row["tags"]),
        "is_favorite": bool(row["is_favorite"]),
        "children": json.loads(row["children"]),
        "payload_hash": row["payload_hash"],
        "version": row["version"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def commit_import(
    conn: sqlite3.Connection, payload: dict[str, Any],
) -> dict[str, Any]:
    """Apply a classified commit payload atomically.

    Returns ``{"ok": True, "undo_id": str, "summary": {...counts...}}``
    on success, or ``{"ok": False, "error": str}`` on contract
    violation (collision on add, missing-id on replace, missing-id on
    rename target table, etc.).

    On any error all in-progress writes are rolled back via the outer
    ``with conn:`` block, and the import_undo row is NOT inserted.
    """
    adds = list(payload.get("adds") or [])
    replaces = list(payload.get("replaces") or [])
    renames = list(payload.get("renames") or [])

    imported_records: list[dict[str, str]] = []
    replaced_snapshots: dict[str, dict[str, Any]] = {}
    rename_map: dict[str, str] = {}

    try:
        with conn:
            # ---- ADDS ---------------------------------------------------
            for op in adds:
                kind = op.get("kind")
                entity = op.get("entity") or {}
                if kind == "category":
                    name = (entity.get("name") or "").strip()
                    if not name:
                        # Skip nameless categories the same way the
                        # legacy import_bundle does — but loudly, since
                        # the new pipeline pre-validates.
                        raise ValueError(
                            "category add missing 'name' field",
                        )
                    # Name-based merge (case-insensitive). Matches the
                    # legacy `import_bundle` behaviour at lines 71-82
                    # of wp_api/import_export.py.
                    existing = conn.execute(
                        "SELECT id FROM module_categories "
                        "WHERE name = ? COLLATE NOCASE;",
                        (name,),
                    ).fetchone()
                    if existing is not None:
                        # Skip — nothing to undo.
                        continue
                    cid = entity.get("id") or name.lower()
                    if _category_id_exists(conn, cid):
                        # Same id, different name — treat as collision.
                        raise sqlite3.IntegrityError(
                            f"category id collision: {cid!r}",
                        )
                    conn.execute(
                        "INSERT INTO module_categories("
                        "id, name, color, icon, sort_order"
                        ") VALUES(?, ?, ?, ?, ?);",
                        (
                            cid, name,
                            entity.get("color"), entity.get("icon"),
                            entity.get("sort_order", 0),
                        ),
                    )
                    imported_records.append({"kind": "category", "id": cid})

                elif kind == "bundle":
                    bid = entity.get("id")
                    if not bid:
                        raise ValueError("bundle add missing 'id' field")
                    if _bundle_exists(conn, bid):
                        raise sqlite3.IntegrityError(
                            f"bundle id collision on add: {bid!r}",
                        )
                    _insert_bundle(conn, entity)
                    imported_records.append({"kind": "bundle", "id": bid})

                elif _is_module_kind(kind or ""):
                    mid = entity.get("id")
                    if not mid:
                        raise ValueError(f"{kind} add missing 'id' field")
                    if _module_exists(conn, mid):
                        raise sqlite3.IntegrityError(
                            f"module id collision on add: {mid!r}",
                        )
                    _insert_module(conn, kind, entity)  # type: ignore[arg-type]
                    imported_records.append({"kind": kind, "id": mid})  # type: ignore[dict-item]

                else:
                    raise ValueError(f"unknown kind in add: {kind!r}")

            # ---- REPLACES ----------------------------------------------
            # Categories never appear here (spec lock #2).
            for op in replaces:
                kind = op.get("kind")
                rid = op.get("id")
                new_content = op.get("new_content") or {}
                if not rid:
                    raise ValueError(f"{kind} replace missing 'id' field")
                if kind == "bundle":
                    existing = _fetch_bundle_row(conn, rid)
                    if existing is None:
                        raise ValueError(
                            f"bundle replace target {rid!r} not found",
                        )
                    replaced_snapshots[rid] = {"kind": "bundle", "row": existing}
                    _update_bundle(conn, rid, new_content)
                elif _is_module_kind(kind or ""):
                    existing = _fetch_module_row(conn, rid)
                    if existing is None:
                        raise ValueError(
                            f"{kind} replace target {rid!r} not found",
                        )
                    replaced_snapshots[rid] = {"kind": kind, "row": existing}  # type: ignore[dict-item]
                    _update_module(conn, rid, kind, new_content)  # type: ignore[arg-type]
                else:
                    raise ValueError(f"unknown kind in replace: {kind!r}")

            # ---- RENAMES -----------------------------------------------
            # Insert at new_id, treat as a fresh add for undo purposes.
            # Categories never appear here (spec lock #2).
            for op in renames:
                kind = op.get("kind")
                old_id = op.get("old_id")
                new_id = op.get("new_id")
                content = op.get("content") or {}
                if not new_id:
                    raise ValueError(f"{kind} rename missing 'new_id' field")
                if not old_id:
                    raise ValueError(f"{kind} rename missing 'old_id' field")
                if kind == "bundle":
                    if _bundle_exists(conn, new_id):
                        raise sqlite3.IntegrityError(
                            f"bundle new_id collision on rename: {new_id!r}",
                        )
                    _insert_bundle(conn, content, target_id=new_id)
                    imported_records.append({"kind": "bundle", "id": new_id})
                    rename_map[old_id] = new_id
                elif _is_module_kind(kind or ""):
                    if _module_exists(conn, new_id):
                        raise sqlite3.IntegrityError(
                            f"module new_id collision on rename: {new_id!r}",
                        )
                    _insert_module(conn, kind, content, target_id=new_id)  # type: ignore[arg-type]
                    imported_records.append({"kind": kind, "id": new_id})  # type: ignore[dict-item]
                    rename_map[old_id] = new_id
                else:
                    raise ValueError(f"unknown kind in rename: {kind!r}")

            # ---- UNDO ROW ----------------------------------------------
            undo_id = _gen_undo_id()
            conn.execute(
                "INSERT INTO import_undo("
                "id, created_at, imported_records, "
                "replaced_snapshots, rename_map"
                ") VALUES(?, ?, ?, ?, ?);",
                (
                    undo_id, now_iso(),
                    json.dumps(imported_records),
                    json.dumps(replaced_snapshots),
                    json.dumps(rename_map),
                ),
            )
    except (sqlite3.IntegrityError, sqlite3.DatabaseError, ValueError) as exc:
        # `with conn:` already rolled back on exception. Return the
        # error envelope the wp_api layer (Task 14) expects.
        return {"ok": False, "error": str(exc)}

    return {
        "ok": True,
        "undo_id": undo_id,
        "summary": {
            "added": len(imported_records) - len(rename_map),
            "replaced": len(replaced_snapshots),
            "renamed": len(rename_map),
        },
    }


def get_undo_entry(
    conn: sqlite3.Connection, undo_id: str,
) -> dict[str, Any] | None:
    """Read the persisted undo metadata. Returns ``None`` if missing.

    The dict shape mirrors what `commit_import` wrote:
    ``{id, created_at, imported_records, replaced_snapshots, rename_map}``.
    """
    row = conn.execute(
        "SELECT * FROM import_undo WHERE id = ?;", (undo_id,),
    ).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "imported_records": json.loads(row["imported_records"]),
        "replaced_snapshots": json.loads(row["replaced_snapshots"]),
        "rename_map": json.loads(row["rename_map"]),
    }


def undo_import(
    conn: sqlite3.Connection, undo_id: str,
) -> dict[str, Any]:
    """Reverse a previous `commit_import` call.

    Steps inside a single ``with conn:`` transaction:
      1. Restore each replaced row to its pre-replace state.
      2. Delete each inserted record (adds + renames' new_ids).
      3. Delete the import_undo row.

    Returns ``{"ok": True}`` on success, ``{"ok": False, "error": str}``
    on missing entry or any restore/delete error (rolls back).
    """
    entry = get_undo_entry(conn, undo_id)
    if entry is None:
        return {"ok": False, "error": f"undo entry {undo_id!r} not found"}

    try:
        with conn:
            # ---- RESTORE REPLACES --------------------------------------
            for rid, snap in entry["replaced_snapshots"].items():
                kind = snap["kind"]
                row = snap["row"]
                if kind == "bundle":
                    # Restore literal columns including the original
                    # payload_hash, version, timestamps. We bypass
                    # `_update_bundle` because that helper bumps
                    # `version` and recomputes `payload_hash` — neither
                    # is correct for an undo (we want the row to look
                    # bit-identical to its pre-replace state).
                    conn.execute(
                        "UPDATE bundles SET "
                        "name = ?, description = ?, color = ?, "
                        "category_id = ?, tags = ?, is_favorite = ?, "
                        "children = ?, payload_hash = ?, version = ?, "
                        "created_at = ?, updated_at = ? "
                        "WHERE id = ?;",
                        (
                            row["name"], row["description"], row["color"],
                            row["category_id"],
                            json.dumps(row["tags"]),
                            int(row["is_favorite"]),
                            json.dumps(row["children"]),
                            row["payload_hash"],
                            row["version"],
                            row["created_at"], row["updated_at"], rid,
                        ),
                    )
                elif _is_module_kind(kind):
                    conn.execute(
                        "UPDATE modules SET "
                        "name = ?, description = ?, category_id = ?, "
                        "tags = ?, is_favorite = ?, payload = ?, "
                        "snapshot_fingerprint = ?, version = ?, "
                        "created_at = ?, updated_at = ? "
                        "WHERE id = ?;",
                        (
                            row["name"], row["description"],
                            row["category_id"],
                            json.dumps(row["tags"]),
                            int(row["is_favorite"]),
                            json.dumps(row["payload"]),
                            row["snapshot_fingerprint"],
                            row["version"],
                            row["created_at"], row["updated_at"], rid,
                        ),
                    )
                else:
                    raise ValueError(
                        f"unknown kind {kind!r} in undo snapshot",
                    )

            # ---- DELETE INSERTS ----------------------------------------
            for rec in entry["imported_records"]:
                kind = rec["kind"]
                rec_id = rec["id"]
                if kind == "bundle":
                    conn.execute(
                        "DELETE FROM bundles WHERE id = ?;", (rec_id,),
                    )
                elif kind == "category":
                    conn.execute(
                        "DELETE FROM module_categories WHERE id = ?;",
                        (rec_id,),
                    )
                elif _is_module_kind(kind):
                    conn.execute(
                        "DELETE FROM modules WHERE id = ?;", (rec_id,),
                    )
                else:
                    raise ValueError(
                        f"unknown kind {kind!r} in imported_records",
                    )

            # ---- EVICT UNDO ROW ----------------------------------------
            conn.execute(
                "DELETE FROM import_undo WHERE id = ?;", (undo_id,),
            )
    except (sqlite3.DatabaseError, ValueError, KeyError) as exc:
        return {"ok": False, "error": str(exc)}

    return {"ok": True}
