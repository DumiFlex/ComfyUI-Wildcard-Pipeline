"""/wp/api/cleaner-presets CRUD + hashes endpoints.

Schema:
  id, name, description, category_id, tags (JSON list), is_favorite,
  is_builtin, payload (JSON), payload_hash, version, created_at,
  updated_at — defined by migration 011_cleaner_presets.

Built-in rows (is_builtin=1) are read-only at the API layer; PUT and
DELETE return 403. The frontend Pinia store + SPA "Clone preset" flow
own the work of creating an editable copy when the user wants to
modify a built-in intensity.
"""
from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
from datetime import datetime, timezone
from typing import Any

from aiohttp import web

from wp_api._helpers import db_session, json_error, json_ok

_UPDATABLE_FIELDS = ("name", "description", "tags", "payload", "is_favorite")
_VALID_INTENSITIES = {"gentle", "balanced", "aggressive"}
_VALID_MODES = {"tags", "text"}
_VALID_BLOCKLIST_KINDS = {"list", "regex"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _hash_payload(payload: dict[str, Any]) -> str:
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(blob).hexdigest()[:16]


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "category_id": row["category_id"],
        "tags": json.loads(row["tags"]) if row["tags"] else [],
        "is_favorite": bool(row["is_favorite"]),
        "is_builtin": bool(row["is_builtin"]),
        "payload": json.loads(row["payload"]),
        "payload_hash": row["payload_hash"],
        "version": row["version"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _validate_payload(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return "payload must be an object"
    intensity = payload.get("intensity")
    if intensity not in _VALID_INTENSITIES:
        return f"intensity must be one of {sorted(_VALID_INTENSITIES)}"
    mode = payload.get("mode")
    if mode not in _VALID_MODES:
        return f"mode must be one of {sorted(_VALID_MODES)}"
    overrides = payload.get("rules_override")
    if overrides is not None and not isinstance(overrides, dict):
        return "rules_override must be an object"
    blocklist = payload.get("blocklist")
    if blocklist is not None:
        if not isinstance(blocklist, dict):
            return "blocklist must be an object"
        kind = blocklist.get("kind")
        if kind not in _VALID_BLOCKLIST_KINDS:
            return f"blocklist.kind must be one of {sorted(_VALID_BLOCKLIST_KINDS)}"
        entries = blocklist.get("entries")
        if not isinstance(entries, list):
            return "blocklist.entries must be a list"
    return None


async def list_presets(request: web.Request) -> web.Response:
    with db_session(request) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM cleaner_presets ORDER BY is_builtin DESC, name ASC"
        ).fetchall()
    return json_ok({"items": [_row_to_dict(r) for r in rows]})


async def hashes(request: web.Request) -> web.Response:
    """Drift-detection endpoint: id → payload_hash map for fast polling."""
    with db_session(request) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT id, payload_hash FROM cleaner_presets"
        ).fetchall()
    return json_ok({"hashes": {r["id"]: r["payload_hash"] for r in rows}})


async def get_preset(request: web.Request) -> web.Response:
    pid = request.match_info["id"]
    with db_session(request) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM cleaner_presets WHERE id = ?", (pid,)
        ).fetchone()
    if row is None:
        return json_error(f"preset not found: {pid}", status=404)
    return json_ok(_row_to_dict(row))


async def create_preset(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    name = body.get("name")
    if not isinstance(name, str) or not name.strip():
        return json_error("name required", status=400)
    payload = body.get("payload")
    err = _validate_payload(payload)
    if err is not None:
        return json_error(err, status=400)
    assert isinstance(payload, dict)  # _validate_payload guarantees this

    now = _now_iso()
    pid = body.get("id") if isinstance(body.get("id"), str) else secrets.token_hex(4)
    payload_hash = _hash_payload(payload)
    tags = body.get("tags") or []
    if not isinstance(tags, list):
        return json_error("tags must be a list", status=400)

    with db_session(request) as conn:
        conn.row_factory = sqlite3.Row
        try:
            conn.execute(
                """
                INSERT INTO cleaner_presets
                    (id, name, description, category_id, tags, is_favorite,
                     is_builtin, payload, payload_hash, version,
                     created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?, ?)
                """,
                (
                    pid,
                    name.strip(),
                    body.get("description", ""),
                    body.get("category_id"),
                    json.dumps(tags),
                    1 if body.get("is_favorite") else 0,
                    json.dumps(payload),
                    payload_hash,
                    now,
                    now,
                ),
            )
            conn.commit()
        except sqlite3.IntegrityError:
            return json_error(f"preset id already exists: {pid}", status=409)
        row = conn.execute(
            "SELECT * FROM cleaner_presets WHERE id = ?", (pid,)
        ).fetchone()
    return json_ok(_row_to_dict(row), status=201)


async def update_preset(request: web.Request) -> web.Response:
    pid = request.match_info["id"]
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)

    with db_session(request) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM cleaner_presets WHERE id = ?", (pid,)
        ).fetchone()
        if row is None:
            return json_error(f"preset not found: {pid}", status=404)
        if row["is_builtin"]:
            return json_error("built-in presets are read-only", status=403)

        updates: dict[str, Any] = {}
        for field in _UPDATABLE_FIELDS:
            if field not in body:
                continue
            value = body[field]
            if field == "payload":
                err = _validate_payload(value)
                if err is not None:
                    return json_error(err, status=400)
                updates["payload"] = json.dumps(value)
                updates["payload_hash"] = _hash_payload(value)
            elif field == "tags":
                if not isinstance(value, list):
                    return json_error("tags must be a list", status=400)
                updates["tags"] = json.dumps(value)
            elif field == "is_favorite":
                updates["is_favorite"] = 1 if value else 0
            elif field == "name":
                if not isinstance(value, str) or not value.strip():
                    return json_error("name must be non-empty", status=400)
                updates["name"] = value.strip()
            else:
                updates[field] = value

        if not updates:
            return json_ok(_row_to_dict(row))

        updates["updated_at"] = _now_iso()
        updates["version"] = row["version"] + 1

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        params = [*updates.values(), pid]
        conn.execute(
            f"UPDATE cleaner_presets SET {set_clause} WHERE id = ?", params
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM cleaner_presets WHERE id = ?", (pid,)
        ).fetchone()
    return json_ok(_row_to_dict(row))


async def delete_preset(request: web.Request) -> web.Response:
    pid = request.match_info["id"]
    with db_session(request) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT is_builtin FROM cleaner_presets WHERE id = ?", (pid,)
        ).fetchone()
        if row is None:
            return json_error(f"preset not found: {pid}", status=404)
        if row["is_builtin"]:
            return json_error("built-in presets cannot be deleted", status=403)
        conn.execute("DELETE FROM cleaner_presets WHERE id = ?", (pid,))
        conn.commit()
    return web.Response(status=204)


def register(router) -> None:
    router.add_get("/wp/api/cleaner-presets", list_presets)
    router.add_get("/wp/api/cleaner-presets/hashes", hashes)
    router.add_post("/wp/api/cleaner-presets", create_preset)
    router.add_get("/wp/api/cleaner-presets/{id}", get_preset)
    router.add_put("/wp/api/cleaner-presets/{id}", update_preset)
    router.add_delete("/wp/api/cleaner-presets/{id}", delete_preset)
