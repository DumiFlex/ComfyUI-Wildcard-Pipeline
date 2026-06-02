"""SQLite connection factory.

DB path resolution order (highest priority first):

1. ``WP_DB_PATH`` env var — explicit override, used as-is.
2. ``COMFYUI_USER_DIR`` env var — places the DB under
   ``$COMFYUI_USER_DIR/wildcard-pipeline.db``.
3. ComfyUI's user directory, detected at runtime. The detector tries
   ``folder_paths.get_user_directory()`` first (canonical inside the
   ComfyUI process), then walks up from ``__file__`` to find the
   ComfyUI root and appends ``user/``. This is the default for any
   user running the plugin inside a normal ComfyUI install.
4. Legacy path ``~/.comfyui/wildcard-pipeline.db`` — kept as a
   backward-compat fallback. If a DB already exists at the legacy
   path AND the detected ComfyUI user dir has none, the resolver
   returns the legacy path so existing installs don't silently
   start with an empty DB. Run with ``WP_DB_PATH`` (or copy the
   file) to migrate to the new location.

Tests can short-circuit the entire chain by setting ``WP_DB_PATH``.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

DB_FILENAME = "wildcard-pipeline.db"


def _comfyui_user_dir_from_api() -> Path | None:
    """Use ComfyUI's `folder_paths.get_user_directory()` when the host
    process exposes it. Import is guarded because pytest runs outside
    the ComfyUI sys.path and the module won't be importable there."""
    try:
        import folder_paths  # type: ignore[import-not-found]
    except Exception:
        return None
    try:
        return Path(folder_paths.get_user_directory())
    except Exception:
        return None


def _comfyui_user_dir_from_path() -> Path | None:
    """Walk up from this file to locate the ComfyUI root.

    Custom nodes live at ``<ComfyUI>/custom_nodes/<plugin>/`` by
    convention, so this file at
    ``<ComfyUI>/custom_nodes/ComfyUI-Wildcard-Pipeline/engine/db/connection.py``
    is exactly 4 parents away from the ComfyUI root.

    A presence check on ``<root>/main.py`` (ComfyUI's entrypoint) +
    the `custom_nodes/` directory guards against returning a wrong
    root for unusual install layouts (e.g. when the plugin is
    symlinked from somewhere else).
    """
    here = Path(__file__).resolve()
    parents = here.parents
    if len(parents) < 5:
        return None
    candidate = parents[4]
    if not (candidate / "custom_nodes").is_dir():
        return None
    if not (candidate / "main.py").is_file():
        return None
    return candidate / "user"


def _legacy_home_path() -> Path:
    return Path.home() / ".comfyui" / DB_FILENAME


def resolve_db_path_with_source() -> tuple[Path, str]:
    """Like ``resolve_db_path`` but also reports which resolver rule won.

    Source values:
      - "WP_DB_PATH"        — explicit env override
      - "COMFYUI_USER_DIR"  — env user-dir
      - "comfyui_user_dir"  — detected via folder_paths API or path traversal
      - "legacy"            — fell through to ~/.comfyui/wildcard-pipeline.db
                              (also returned when ComfyUI user dir exists but
                              the legacy file was used because the new
                              location had no DB yet)
    """
    override = os.environ.get("WP_DB_PATH")
    if override:
        return Path(override), "WP_DB_PATH"

    user_dir_env = os.environ.get("COMFYUI_USER_DIR")
    if user_dir_env:
        return Path(user_dir_env) / DB_FILENAME, "COMFYUI_USER_DIR"

    comfy_user = _comfyui_user_dir_from_api() or _comfyui_user_dir_from_path()
    if comfy_user is not None:
        new_path = comfy_user / DB_FILENAME
        legacy = _legacy_home_path()
        if not new_path.exists() and legacy.exists():
            return legacy, "legacy"
        return new_path, "comfyui_user_dir"

    return _legacy_home_path(), "legacy"


def resolve_db_path() -> Path:
    """Path-only convenience wrapper — preserved for all existing callers."""
    return resolve_db_path_with_source()[0]


def get_connection(path: Path | None = None) -> sqlite3.Connection:
    """Open a SQLite connection with WAL mode and FK enforcement."""
    db_path = path or resolve_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn
