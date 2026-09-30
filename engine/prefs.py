"""Server-side user preferences (`settings.json`).

Why a file and not the database: some of these settings govern the database
itself (backups run before migrations and restores replace the DB file), so
they must be readable before any connection opens — the same chicken-and-egg
that put the DB location preference in `engine/db/config.py`'s sidecar.

Why not the browser: the ref recursion limit applies to canvas runs, preview
and the Test Runner alike, all of which execute server-side. A value living
in localStorage would only reach whichever surface happened to send it.

Location, highest priority first:

1. ``WP_SETTINGS_PATH`` env var — used as-is (tests point it at tmp_path).
2. ``<ComfyUI user dir>/wildcard-pipeline/settings.json`` — beside the
   library, so it survives an extension reinstall.
3. ``<plugin>/wp-settings.json`` — when the user dir can't be detected.

Every read normalizes: a missing file, unreadable JSON or an out-of-range
value all degrade to defaults instead of raising, because a broken settings
file must never stop a prompt from rendering.
"""
from __future__ import annotations

import copy
import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Any

SETTINGS_FILENAME = "settings.json"
FALLBACK_FILENAME = "wp-settings.json"

MAX_REF_DEPTH_MIN = 1
MAX_REF_DEPTH_MAX = 32
BACKUP_KEEP_MIN = 1
BACKUP_KEEP_MAX = 100

DEFAULTS: dict[str, Any] = {
    "max_ref_depth": 8,
    "backups": {
        "enabled": True,
        "keep": 7,
        "daily": True,
    },
}

_lock = threading.Lock()
#: ``(path, mtime_ns)`` → cached normalized prefs. `max_ref_depth()` runs once
#: per pipeline run (every Context node execution, every Test Runner seed), so
#: a stat beats a parse.
_cache: tuple[tuple[str, int], dict[str, Any]] | None = None


def settings_path() -> Path:
    """Resolve where settings live (see module docstring for the order)."""
    override = os.environ.get("WP_SETTINGS_PATH")
    if override:
        return Path(override)
    from engine.db.connection import wp_data_dir

    data_dir = wp_data_dir()
    if data_dir is not None:
        return data_dir / SETTINGS_FILENAME
    from engine.db.config import plugin_root

    return plugin_root() / FALLBACK_FILENAME


def _clamp_int(value: Any, lo: int, hi: int, default: int) -> int:
    """Clamp an int into range; non-ints (bools included) fall back to default.

    Clamping rather than rejecting an out-of-range number: a user who typed 50
    meant "as deep as allowed", not "reset to 8".
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    if isinstance(value, float) and not value.is_integer():
        return default
    return max(lo, min(hi, int(value)))


def _bool(value: Any, default: bool) -> bool:
    return value if isinstance(value, bool) else default


def normalize(raw: Any) -> dict[str, Any]:
    """Return the full prefs shape from any input, filling/repairing fields."""
    src = raw if isinstance(raw, dict) else {}
    backups_raw = src.get("backups")
    backups_src = backups_raw if isinstance(backups_raw, dict) else {}
    d_backups = DEFAULTS["backups"]
    return {
        "max_ref_depth": _clamp_int(
            src.get("max_ref_depth"), MAX_REF_DEPTH_MIN, MAX_REF_DEPTH_MAX,
            DEFAULTS["max_ref_depth"],
        ),
        "backups": {
            "enabled": _bool(backups_src.get("enabled"), d_backups["enabled"]),
            "keep": _clamp_int(
                backups_src.get("keep"), BACKUP_KEEP_MIN, BACKUP_KEEP_MAX,
                d_backups["keep"],
            ),
            "daily": _bool(backups_src.get("daily"), d_backups["daily"]),
        },
    }


def _read_raw(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _stat_key(path: Path) -> tuple[str, int]:
    try:
        return (str(path), path.stat().st_mtime_ns)
    except OSError:
        return (str(path), -1)


def load() -> dict[str, Any]:
    """Current prefs, normalized. Cached on (path, mtime) so repeat calls are
    a single ``stat``; an external edit to the file is picked up next call."""
    global _cache
    path = settings_path()
    key = _stat_key(path)
    with _lock:
        if _cache is not None and _cache[0] == key:
            return copy.deepcopy(_cache[1])
    prefs = normalize(_read_raw(path))
    with _lock:
        _cache = (key, prefs)
    return copy.deepcopy(prefs)


def _deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def _save(prefs: dict[str, Any], path: Path) -> None:
    """Atomically write (temp file + rename) so a crash can't truncate it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_str = tempfile.mkstemp(prefix=".wp-settings-", dir=str(path.parent))
    tmp_path = Path(tmp_str)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(prefs, f, indent=2)
        os.replace(tmp_path, path)
    except OSError:
        tmp_path.unlink(missing_ok=True)
        raise


def update(partial: dict[str, Any]) -> dict[str, Any]:
    """Deep-merge ``partial`` over the current prefs, normalize, persist.

    Unknown keys are dropped by `normalize`, so the file only ever holds the
    documented shape. Returns the full normalized prefs.
    """
    global _cache
    if not isinstance(partial, dict):
        raise TypeError("prefs update must be a dict")
    path = settings_path()
    merged = normalize(_deep_merge(load(), partial))
    _save(merged, path)
    with _lock:
        _cache = None
    return copy.deepcopy(merged)


def max_ref_depth() -> int:
    """The configured ``@{uuid}`` nesting limit — cheap enough per run.

    Never raises: a settings problem must degrade to the default limit, not
    fail the prompt that asked for it.
    """
    try:
        return int(load()["max_ref_depth"])
    except Exception:  # noqa: BLE001 - see docstring
        return int(DEFAULTS["max_ref_depth"])


def backups() -> dict[str, Any]:
    """The ``backups`` sub-section of the current prefs."""
    return load()["backups"]
