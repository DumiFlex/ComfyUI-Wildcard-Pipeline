"""/wp/api/database/* — read-only info + maintenance dispatch + location config."""
from __future__ import annotations

import json as _json
import os
from pathlib import Path
from typing import Any

from aiohttp import web

from engine.db import config as db_config
from engine.db.connection import (
    global_location_path,
    resolve_db_path_with_source,
    root_location_path,
    user_location_path,
)
from engine.db.info import analyze, gather_info, integrity_check, run_migrations, vacuum
from wp_api._helpers import db_session, json_error, json_ok

_OPS = {
    "vacuum": vacuum,
    "integrity": integrity_check,
    "analyze": analyze,
    "migrate": run_migrations,
}

_VALID_PREFERENCES = {"user", "global", "root"}
_VALID_MODES = {"copy", "move"}


async def get_info(request: web.Request) -> web.Response:
    db_path, source = resolve_db_path_with_source()
    with db_session(request) as conn:
        info = gather_info(conn, db_path, source=source)
    return json_ok(info)


async def run_maintenance(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except _json.JSONDecodeError:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be an object", status=400)
    op = body.get("op")
    if op not in _OPS:
        return json_error(
            f"unknown op {op!r}; expected one of: {sorted(_OPS)}",
            status=400,
        )
    handler = _OPS[op]
    with db_session(request) as conn:
        result = handler(conn)
    # result already includes ok / op / duration_ms (+ op-specific keys)
    return json_ok(result)


def _location_entry(path: Path | None) -> dict[str, Any]:
    """Render one location dict for the locations payload.

    ``path`` is ``None`` when the user-dir detector chain failed; in that
    case the entry still has the same shape so the frontend can render it
    consistently (it'll just hide/disable the radio for that option)."""
    if path is None:
        return {"path": None, "exists": False, "size_bytes": None}
    exists = path.is_file()
    size = path.stat().st_size if exists else None
    return {"path": str(path), "exists": exists, "size_bytes": size}


def _resolve_all_locations() -> dict[str, dict[str, Any]]:
    """Compute the three potential DB locations for the config payload."""
    return {
        "user": _location_entry(user_location_path()),
        "global": _location_entry(global_location_path()),
        "root": _location_entry(root_location_path()),
    }


def _build_config_response() -> dict[str, Any]:
    """Compose the GET /wp/api/database/config response from sidecar +
    detected paths + env-lock detection.

    Shared by GET, PUT, and DELETE handlers so the response shape stays
    in one place."""
    cfg = db_config.load()
    return {
        "preference": cfg.get("preference"),
        "pending_move": cfg.get("pending_move"),
        "locations": _resolve_all_locations(),
        "env_locked": bool(
            os.environ.get("WP_DB_PATH") or os.environ.get("COMFYUI_USER_DIR")
        ),
    }


def _validate_pending_move(pm: Any) -> tuple[dict[str, str] | None, str | None]:
    """Validate a pending_move payload.

    Returns ``(value, None)`` on success where ``value`` is either a
    normalized dict or ``None`` (explicit clear). Returns ``(None, err)``
    on validation failure."""
    if pm is None:
        return None, None
    if not isinstance(pm, dict):
        return None, "pending_move must be an object or null"
    src = pm.get("from")
    dst = pm.get("to")
    mode = pm.get("mode")
    if not (isinstance(src, str) and isinstance(dst, str) and isinstance(mode, str)):
        return None, "pending_move requires string fields 'from', 'to', and 'mode'"
    if mode not in _VALID_MODES:
        return None, f"pending_move.mode must be one of: {sorted(_VALID_MODES)}"
    if not Path(src).is_absolute() or not Path(dst).is_absolute():
        return None, "pending_move.from and pending_move.to must be absolute paths"
    return {"from": src, "to": dst, "mode": mode}, None


async def get_config(request: web.Request) -> web.Response:
    return json_ok(_build_config_response())


async def put_config(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except _json.JSONDecodeError:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be an object", status=400)

    current = db_config.load()
    new_cfg: dict[str, Any] = dict(current)

    if "preference" in body:
        pref = body["preference"]
        if pref is None:
            new_cfg.pop("preference", None)
        elif isinstance(pref, str) and pref in _VALID_PREFERENCES:
            new_cfg["preference"] = pref
        else:
            return json_error(
                f"preference must be null or one of: {sorted(_VALID_PREFERENCES)}",
                status=400,
            )

    if "pending_move" in body:
        pm_raw = body["pending_move"]
        if pm_raw is None:
            new_cfg.pop("pending_move", None)
        else:
            value, err = _validate_pending_move(pm_raw)
            if err is not None:
                return json_error(err, status=400)
            new_cfg["pending_move"] = value  # type: ignore[assignment]

    db_config.save(new_cfg)  # type: ignore[arg-type]
    return json_ok(_build_config_response())


async def delete_pending_move(request: web.Request) -> web.Response:
    db_config.clear_pending_move()
    return json_ok(_build_config_response())


def register(router: web.UrlDispatcher) -> None:
    router.add_get("/wp/api/database/info", get_info)
    router.add_post("/wp/api/database/maintenance", run_maintenance)
    router.add_get("/wp/api/database/config", get_config)
    router.add_put("/wp/api/database/config", put_config)
    router.add_delete("/wp/api/database/config/pending-move", delete_pending_move)
