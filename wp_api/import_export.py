"""/wp/api/import + /wp/api/export — library bundles only (no workflow files)."""
from __future__ import annotations

import datetime as _dt
import json
import sqlite3

from aiohttp import web

from engine.db.repositories import CategoryRepository, ModuleRepository
from wp_api._helpers import db_session, json_error, json_ok

_BUNDLE_VERSION = 1


def _now_iso() -> str:
    return _dt.datetime.now(_dt.UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


async def export_bundle(request: web.Request) -> web.Response:
    with db_session(request) as conn:
        modules = ModuleRepository(conn).list()
        categories = CategoryRepository(conn).list()
    return json_ok({
        "version": _BUNDLE_VERSION,
        "exported_at": _now_iso(),
        "modules": modules,
        "categories": categories,
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
    with db_session(request) as conn:
        cat_repo = CategoryRepository(conn)
        existing_cat_names = {c["name"].lower() for c in cat_repo.list()}
        for cat in body.get("categories", []):
            name = cat.get("name", "")
            if name.lower() in existing_cat_names:
                skipped.append(cat.get("id", name))
                continue
            try:
                cat_repo.create(
                    name=name,
                    color=cat.get("color"),
                    icon=cat.get("icon"),
                    sort_order=cat.get("sort_order", 0),
                )
                cat_imported += 1
                existing_cat_names.add(name.lower())
            except ValueError:
                skipped.append(cat.get("id", name))

        # Modules — dedup by id (PRIMARY KEY collision = skip).
        for mod in body.get("modules", []):
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
                        mod.get("created_at"), mod.get("updated_at"),
                    ),
                )
                mod_imported += 1
            except sqlite3.IntegrityError:
                skipped.append(mod["id"])
        conn.commit()

    return json_ok({
        "modules_imported": mod_imported,
        "categories_imported": cat_imported,
        "skipped": skipped,
    })


def register(router) -> None:
    router.add_get("/wp/api/export", export_bundle)
    router.add_post("/wp/api/import", import_bundle)
