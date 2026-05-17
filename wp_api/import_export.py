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
from engine.modules.snapshot import payload_hash
from wp_api._helpers import db_session, json_error, json_ok

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


def register(router) -> None:
    router.add_get("/wp/api/export", export_bundle)
    router.add_post("/wp/api/import", import_bundle)
