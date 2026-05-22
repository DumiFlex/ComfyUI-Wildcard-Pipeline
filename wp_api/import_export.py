"""/wp/api/import + /wp/api/export — library bundles only (no workflow files)."""
from __future__ import annotations

import json
import sqlite3

from aiohttp import web

from engine._utils import now_iso as _now_iso
from engine.db.repositories import (
    BundleRepository,
    CategoryRepository,
    ModuleRepository,
)
from engine.exporter import build_export_payload
from engine.importer import commit_import, undo_import
from engine.modules.snapshot import payload_hash
from wp_api._helpers import db_session, json_error, json_ok
from wp_api._validators import validate_body_size

# 7-bucket export request keys (Task 10). Each key, when present, must be
# a list of UUIDs; missing keys default to []. Mis-typed UUIDs (e.g. a
# wildcard id under combine_uuids) are silently dropped by the exporter.
_EXPORT_BUILD_KEYS = (
    "bundle_uuids",
    "wildcard_uuids",
    "fixed_values_uuids",
    "combine_uuids",
    "derivation_uuids",
    "constraint_uuids",
    "category_uuids",
)

_BUNDLE_VERSION = 1


async def export_bundle(request: web.Request) -> web.Response:
    with db_session(request) as conn:
        modules = ModuleRepository(conn).list()
        categories = CategoryRepository(conn).list()
        bundles = BundleRepository(conn).list()
    return json_ok({
        "version": _BUNDLE_VERSION,
        "exported_at": _now_iso(),
        "modules": modules,
        "categories": categories,
        "bundles": bundles,
    })


async def import_bundle(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    if body.get("version") != _BUNDLE_VERSION:
        return json_error(
            f"unsupported bundle version: {body.get('version')}", status=400,
        )

    skipped: list[str] = []
    cat_imported = 0
    mod_imported = 0
    bundle_imported = 0
    with db_session(request) as conn:
        # Single transaction wrapping ALL inserts so a failure rolls everything
        # back. We bypass repositories' per-row `with self._conn` so we can
        # control commit boundaries.
        with conn:
            existing_cat_names = {
                c["name"].lower()
                for c in conn.execute("SELECT name FROM module_categories;")
            }
            for cat in body.get("categories", []):
                name = cat.get("name", "")
                if not name:
                    skipped.append(cat.get("id", "<no-id>"))
                    continue
                if name.lower() in existing_cat_names:
                    skipped.append(cat.get("id", name))
                    continue
                try:
                    conn.execute(
                        "INSERT INTO module_categories("
                        "id, name, color, icon, sort_order"
                        ") VALUES(?, ?, ?, ?, ?);",
                        (
                            cat.get("id") or name.lower(),
                            name, cat.get("color"), cat.get("icon"),
                            cat.get("sort_order", 0),
                        ),
                    )
                    cat_imported += 1
                    existing_cat_names.add(name.lower())
                except sqlite3.IntegrityError:
                    skipped.append(cat.get("id", name))

            for mod in body.get("modules", []):
                required = ("id", "type", "name", "payload")
                if not all(k in mod for k in required):
                    skipped.append(mod.get("id", "<no-id>"))
                    continue
                try:
                    conn.execute(
                        "INSERT INTO modules("
                        "id, type, name, description, category_id, tags, "
                        "is_favorite, payload, version, created_at, updated_at"
                        ") VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
                        (
                            mod["id"], mod["type"], mod["name"],
                            mod.get("description", ""),
                            mod.get("category_id"),
                            json.dumps(mod.get("tags", [])),
                            int(mod.get("is_favorite", False)),
                            json.dumps(mod["payload"]),
                            mod.get("version", 1),
                            mod.get("created_at", _now_iso()),
                            mod.get("updated_at", _now_iso()),
                        ),
                    )
                    mod_imported += 1
                except sqlite3.IntegrityError:
                    skipped.append(mod["id"])

            # Bundles imported after modules so the children snapshots in
            # each bundle resolve against any modules that were just
            # inserted (relevant if a future bundle child references a
            # library uuid; current bundle children are deep-cloned
            # snapshots so they're self-contained, but ordering matters
            # if that ever changes).
            for bun in body.get("bundles", []):
                required = ("id", "name")
                if not all(k in bun for k in required):
                    skipped.append(bun.get("id", "<no-id>"))
                    continue
                children_blob = list(bun.get("children") or [])
                # Recompute payload_hash from the children since the
                # exported hash was bound to its source DB and we want
                # the import-side hash to reflect THIS DB's perception
                # of the bundle. Mirrors BundleRepository.create.
                ph = bun.get("payload_hash") or payload_hash(
                    {"children": children_blob},
                )
                try:
                    conn.execute(
                        "INSERT INTO bundles("
                        "id, name, description, color, category_id, tags, "
                        "is_favorite, children, payload_hash, version, "
                        "created_at, updated_at"
                        ") VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
                        (
                            bun["id"], bun["name"],
                            bun.get("description", ""),
                            bun.get("color"),
                            bun.get("category_id"),
                            json.dumps(bun.get("tags", [])),
                            int(bun.get("is_favorite", False)),
                            json.dumps(children_blob),
                            ph,
                            bun.get("version", 1),
                            bun.get("created_at", _now_iso()),
                            bun.get("updated_at", _now_iso()),
                        ),
                    )
                    bundle_imported += 1
                except sqlite3.IntegrityError:
                    skipped.append(bun["id"])

    return json_ok({
        "modules_imported": mod_imported,
        "categories_imported": cat_imported,
        "bundles_imported": bundle_imported,
        "skipped": skipped,
    })


async def export_build(request: web.Request) -> web.Response:
    """POST /wp/api/export/build — assemble a 7-bucket export payload.

    Body shape:
        {
            "bundle_uuids":      [...],
            "wildcard_uuids":    [...],
            "fixed_values_uuids":[...],
            "combine_uuids":     [...],
            "derivation_uuids":  [...],
            "constraint_uuids":  [...],
            "category_uuids":    [...],
        }

    Every key is optional and defaults to ``[]``. UUID format is NOT
    validated here: the exporter silently drops missing or cross-bucket
    UUIDs, which is the intended behavior for the picker UI's loose
    type tracking. Response is the exporter payload returned directly
    (no ``{"ok": true, ...}`` wrapper, mirroring the legacy
    ``export_bundle`` handler).
    """
    err = validate_body_size(request.content_length)
    if err is not None:
        return json_error(err, status=400)
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    for key in _EXPORT_BUILD_KEYS:
        if key in body and not isinstance(body[key], list):
            return json_error("uuid lists must be arrays", status=400)

    with db_session(request) as conn:
        payload = build_export_payload(
            conn,
            bundle_uuids=body.get("bundle_uuids", []),
            wildcard_uuids=body.get("wildcard_uuids", []),
            fixed_values_uuids=body.get("fixed_values_uuids", []),
            combine_uuids=body.get("combine_uuids", []),
            derivation_uuids=body.get("derivation_uuids", []),
            constraint_uuids=body.get("constraint_uuids", []),
            category_uuids=body.get("category_uuids", []),
        )
    return json_ok(payload)


async def import_commit(request: web.Request) -> web.Response:
    """POST /wp/api/import/commit — apply a classified commit payload.

    Body shape (produced by the SPA's client-side classifier, Task 15)::

        {
            "adds":     [{"kind": str, "entity":      {...}}, ...],
            "replaces": [{"kind": str, "id": str, "new_content": {...}}, ...],
            "renames":  [{"kind": str, "old_id": str, "new_id": str,
                          "content": {...}}, ...]
        }

    Every bucket is optional and defaults to ``[]``. ``kind`` must be one
    of the 7 buckets (``wildcard``, ``fixed_values``, ``combine``,
    ``derivation``, ``constraint``, ``bundle``, ``category``) — the engine
    rejects anything else as a contract violation.

    Response on success: ``{"ok": True, "undo_entry_id": str, "summary":
    {...}}`` (200). Contract violations and DB-layer errors return
    ``{"error": str}`` with status 400; the engine already wraps raw
    sqlite errors as ``"database integrity violation"`` so no internals
    leak. The 5 MB body cap is the same as every other write endpoint.
    """
    err = validate_body_size(request.content_length)
    if err is not None:
        return json_error(err, status=400)
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    # Each bucket must be a list when present. Mirrors the export_build
    # check at line 209 — the engine would crash with TypeError otherwise.
    for key in ("adds", "replaces", "renames"):
        if key in body and not isinstance(body[key], list):
            return json_error(f"{key} must be a list", status=400)

    with db_session(request) as conn:
        result = commit_import(conn, body)
    if not result.get("ok"):
        # commit_import returns {"ok": False, "error": str} for both
        # contract violations and wrapped DB errors. 400 covers both.
        return json_error(result.get("error", "import commit failed"), status=400)
    # Engine returns ``undo_id``; the locked HTTP contract uses
    # ``undo_entry_id``. Rename at the boundary so the engine field name
    # stays decoupled from the client-facing API.
    return json_ok({
        "ok": True,
        "undo_entry_id": result["undo_id"],
        "summary": result.get("summary", {}),
    })


async def import_undo(request: web.Request) -> web.Response:
    """POST /wp/api/import/undo — reverse a previous import/commit call.

    Body shape::

        {"undo_entry_id": str}

    Response on success: ``{"ok": True}`` (200). Missing or non-string
    ``undo_entry_id`` → 400. Unknown ``undo_entry_id`` → **404** (clean
    miss; the engine returns ``"undo entry ... not found"``). Other
    failures (corrupt undo blob, DB error) → 400.
    """
    err = validate_body_size(request.content_length)
    if err is not None:
        return json_error(err, status=400)
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    if "undo_entry_id" not in body:
        return json_error("undo_entry_id required", status=400)
    undo_entry_id = body["undo_entry_id"]
    if not isinstance(undo_entry_id, str):
        return json_error("undo_entry_id must be a string", status=400)

    with db_session(request) as conn:
        result = undo_import(conn, undo_entry_id)
    if not result.get("ok"):
        error = result.get("error", "undo failed")
        # "undo entry ... not found" → 404. Any other error string is
        # a corrupt-blob or DB-layer failure and stays at 400. The
        # engine message is the only place "not found" appears in the
        # undo error envelope, so substring match is safe.
        status = 404 if "not found" in error else 400
        return json_error(error, status=status)
    return json_ok({"ok": True})


def register(router) -> None:
    router.add_get("/wp/api/export", export_bundle)
    router.add_post("/wp/api/export/build", export_build)
    router.add_post("/wp/api/import", import_bundle)
    router.add_post("/wp/api/import/commit", import_commit)
    router.add_post("/wp/api/import/undo", import_undo)
