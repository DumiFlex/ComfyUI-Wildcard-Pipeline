"""Cascade-apply undo persistence + replay.

write_undo_entry stores BEFORE-state snapshots in cascade_undo.
undo_cascade reads + restores via repository methods in a single transaction.

Engine isolation: zero ComfyUI/torch/wp_nodes imports. Stdlib json,
secrets, sqlite3 + repositories only.
"""
from __future__ import annotations

import json
import secrets
import sqlite3
from typing import Any

from engine._utils import now_iso as _now
from engine.db.repositories import (
    BundleNotFound,
    BundleRepository,
    CategoryNotFound,
    CategoryRepository,
    ModuleNotFound,
    ModuleRepository,
)

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def write_undo_entry(
    conn: sqlite3.Connection,
    *,
    target_kind: str,
    target_id: str,
    action: str,
    snapshot_before: list[dict[str, Any]] | None,
    snapshot_after: list[dict[str, Any]] | None,
) -> str:
    """Persist a BEFORE/AFTER snapshot pair in cascade_undo.

    Returns the generated undo_id (16 hex chars — secrets.token_hex(8)).
    Defensive defaults: None is treated as [] for both snapshot args so
    callers that pass None don't trip the NOT NULL constraint.
    """
    undo_id = secrets.token_hex(8)
    conn.execute(
        "INSERT INTO cascade_undo "
        "(id, created_at, target_kind, target_id, action, snapshot_before, snapshot_after) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            undo_id,
            _now(),
            target_kind,
            target_id,
            action,
            json.dumps(snapshot_before or []),
            json.dumps(snapshot_after or []),
        ),
    )
    conn.commit()
    return undo_id


def undo_cascade(conn: sqlite3.Connection, undo_id: str) -> dict[str, Any]:
    """Restore all entities from snapshot_before atomically.

    Returns ``{ok: True}`` on success, ``{ok: False, error: str}`` if the
    undo_id is not found or any restore step raises.  The "not found"
    substring in the error message is intentional — wp_api maps it to
    HTTP 404.
    """
    row = conn.execute(
        "SELECT snapshot_before, target_kind, target_id "
        "FROM cascade_undo WHERE id = ?",
        (undo_id,),
    ).fetchone()

    if row is None:
        return {"ok": False, "error": f"undo entry not found: {undo_id}"}

    snapshot_before: list[dict[str, Any]] = json.loads(row["snapshot_before"])

    try:
        for entity in snapshot_before:
            _dispatch_restore(conn, entity)
        conn.execute("DELETE FROM cascade_undo WHERE id = ?", (undo_id,))
        conn.commit()
        return {"ok": True}
    except Exception as exc:
        conn.rollback()
        return {"ok": False, "error": str(exc)}


# ---------------------------------------------------------------------------
# Internal restore helpers
# ---------------------------------------------------------------------------

def _dispatch_restore(conn: sqlite3.Connection, entity: dict[str, Any]) -> None:
    """Route an entity snapshot to the correct repository restore path.

    Dispatch priority:
    1. ``type`` in module-type set → module.
    2. ``children`` key present → bundle.
    3. ``color`` or ``icon`` key present (and no ``type``) → category.
    4. Fallback → treat as module (most common case).
    """
    entity_type = entity.get("type")
    if entity_type in ("wildcard", "fixed_values", "combine", "derivation", "constraint"):
        _restore_module(conn, entity)
    elif "children" in entity:
        _restore_bundle(conn, entity)
    elif "color" in entity or "icon" in entity:
        _restore_category(conn, entity)
    else:
        # Fallback: attempt module restore.
        _restore_module(conn, entity)


def _restore_module(conn: sqlite3.Connection, entity: dict[str, Any]) -> None:
    repo = ModuleRepository(conn)
    eid: str = entity["id"]
    try:
        repo.get(eid)
        # Row exists — overwrite with snapshot values.
        # Build kwargs only for fields present + non-None in snapshot.
        kwargs: dict[str, Any] = {}
        if (name := entity.get("name")) is not None:
            kwargs["name"] = name
        if (description := entity.get("description")) is not None:
            kwargs["description"] = description
        if (category_id := entity.get("category_id")) is not None:
            kwargs["category_id"] = category_id
        if (tags := entity.get("tags")) is not None:
            kwargs["tags"] = tags if tags else []
        if (payload := entity.get("payload")) is not None:
            kwargs["payload"] = payload if payload else {}
        if (is_favorite := entity.get("is_favorite")) is not None:
            kwargs["is_favorite"] = is_favorite
        repo.update(eid, **kwargs)
    except ModuleNotFound:
        # Row was deleted — recreate at the original id.
        # ModuleRepository.create() accepts id= (8-hex validated).
        repo.create(
            type=entity["type"],
            name=entity.get("name", ""),
            description=entity.get("description", ""),
            category_id=entity.get("category_id"),
            tags=entity.get("tags") or [],
            payload=entity.get("payload") or {},
            is_favorite=entity.get("is_favorite", False),
            id=eid,
        )


def _restore_bundle(conn: sqlite3.Connection, entity: dict[str, Any]) -> None:
    repo = BundleRepository(conn)
    eid: str = entity["id"]
    try:
        repo.get(eid)
        # Row exists — overwrite.
        # Build kwargs only for fields present + non-None in snapshot.
        kwargs: dict[str, Any] = {}
        if (name := entity.get("name")) is not None:
            kwargs["name"] = name
        if (description := entity.get("description")) is not None:
            kwargs["description"] = description
        if (color := entity.get("color")) is not None:
            kwargs["color"] = color
        if (category_id := entity.get("category_id")) is not None:
            kwargs["category_id"] = category_id
        if (tags := entity.get("tags")) is not None:
            kwargs["tags"] = tags if tags else []
        if (children := entity.get("children")) is not None:
            kwargs["children"] = children if children else []
        if (is_favorite := entity.get("is_favorite")) is not None:
            kwargs["is_favorite"] = is_favorite
        repo.update(eid, **kwargs)
    except BundleNotFound:
        # Row was deleted — recreate at the original id.
        # BundleRepository.create() accepts id= (8-hex validated).
        repo.create(
            name=entity.get("name", ""),
            description=entity.get("description", ""),
            color=entity.get("color"),
            category_id=entity.get("category_id"),
            tags=entity.get("tags") or [],
            children=entity.get("children") or [],
            is_favorite=entity.get("is_favorite", False),
            id=eid,
        )


def _restore_category(conn: sqlite3.Connection, entity: dict[str, Any]) -> None:
    """Restore a category row.

    CategoryRepository.create() derives the id from the name slug and does
    not accept an explicit ``id=`` kwarg. For deleted categories we fall back
    to a raw INSERT so the original (slug-based) id is preserved exactly.
    """
    repo = CategoryRepository(conn)
    eid: str = entity["id"]
    try:
        repo.get(eid)
        # Row exists — update in place.
        # Build kwargs only for fields present + non-None in snapshot.
        kwargs: dict[str, Any] = {}
        if (name := entity.get("name")) is not None:
            kwargs["name"] = name
        if (color := entity.get("color")) is not None:
            kwargs["color"] = color
        if (icon := entity.get("icon")) is not None:
            kwargs["icon"] = icon
        if (sort_order := entity.get("sort_order")) is not None:
            kwargs["sort_order"] = sort_order
        repo.update(eid, **kwargs)
    except CategoryNotFound:
        # Raw INSERT to preserve the original slug-based id.
        conn.execute(
            "INSERT INTO module_categories (id, name, color, icon, sort_order) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                eid,
                entity.get("name", ""),
                entity.get("color"),
                entity.get("icon"),
                entity.get("sort_order", 0),
            ),
        )
        conn.commit()
