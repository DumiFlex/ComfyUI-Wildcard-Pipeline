"""SQLite connection factory.

DB path resolution order (highest priority first):

1. ``WP_DB_PATH`` env var — explicit override, used as-is. Source ``"WP_DB_PATH"``.
2. ``COMFYUI_USER_DIR`` env var — places the DB under
   ``$COMFYUI_USER_DIR/wildcard-pipeline.db``. Source ``"COMFYUI_USER_DIR"``.
3. Sidecar ``preference`` field at ``<plugin>/db-config.json`` (loaded
   indirectly through ``_load_sidecar`` so tests can stub it):
     - ``"user"``   → ComfyUI user dir + ``wildcard-pipeline.db``,
       source ``"user"``. Falls through if the user dir can't be detected.
     - ``"global"`` → ``~/.comfyui/wildcard-pipeline.db``, source ``"global"``.
     - ``"root"``   → ``<plugin>/db/wildcard-pipeline.db``, source ``"root"``.
4. Default — ComfyUI user dir + ``wildcard-pipeline.db``, source ``"user"``.
   Falls through if detection fails.
5. Last-ditch fallback — ``~/.comfyui/wildcard-pipeline.db``, source
   ``"global"`` (the design folds the old ``"legacy"`` label into
   ``"global"`` since the path is identical and the UI exposes a Global
   radio for it).

The pre-feature back-compat clause that preferred legacy when the new
path had no DB has been removed — the design intentionally surprises
users with an empty new DB so they migrate explicitly via Settings.

Tests can short-circuit the entire chain by setting ``WP_DB_PATH`` or by
stubbing ``_load_sidecar`` to return a chosen preference.
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
    """Return ``~/.comfyui/wildcard-pipeline.db``.

    Still named ``_legacy_*`` for historical reasons but now serves as
    both the explicit ``global`` preference target and the last-ditch
    fallback when no ComfyUI user dir can be detected. Both report
    source ``"global"``."""
    return Path.home() / ".comfyui" / DB_FILENAME


def _plugin_root_db_path() -> Path:
    """Return ``<plugin>/db/wildcard-pipeline.db`` — the ``root``
    preference target. Lives inside the plugin install dir so it
    survives ComfyUI reinstalls; vulnerable to plugin git pulls that
    wipe untracked files (called out in the UI as "not recommended")."""
    from engine.db.config import plugin_root

    return plugin_root() / "db" / DB_FILENAME


def _load_sidecar() -> dict:
    """Indirection over ``engine.db.config.load`` so tests can stub the
    sidecar read without touching the real ``<plugin>/db-config.json``
    file."""
    from engine.db.config import load

    return dict(load())


def user_location_path() -> Path | None:
    """Return the ``user`` preference target path, or ``None`` if the
    ComfyUI user dir can't be detected.

    Same detector chain that ``resolve_db_path_with_source`` uses for the
    ``user`` branch. Exposed for the SPA Settings API so the frontend can
    list all three potential locations regardless of which one is
    currently active (or whether one is detectable at all)."""
    comfy_user = _comfyui_user_dir_from_api() or _comfyui_user_dir_from_path()
    return (comfy_user / DB_FILENAME) if comfy_user else None


def global_location_path() -> Path:
    """Return the ``global`` preference target — ``~/.comfyui/wildcard-pipeline.db``.

    Always available regardless of host detection (just ``Path.home()``)."""
    return _legacy_home_path()


def root_location_path() -> Path:
    """Return the ``root`` preference target — ``<plugin>/db/wildcard-pipeline.db``."""
    return _plugin_root_db_path()


def resolve_db_path_with_source() -> tuple[Path, str]:
    """Like ``resolve_db_path`` but also reports which resolver rule won.

    Source values:
      - ``"WP_DB_PATH"``       — explicit env override
      - ``"COMFYUI_USER_DIR"`` — env user-dir
      - ``"user"``             — ComfyUI user dir (sidecar preference or default)
      - ``"global"``           — ~/.comfyui/wildcard-pipeline.db
      - ``"root"``             — <plugin>/db/wildcard-pipeline.db
    """
    override = os.environ.get("WP_DB_PATH")
    if override:
        return Path(override), "WP_DB_PATH"

    user_dir_env = os.environ.get("COMFYUI_USER_DIR")
    if user_dir_env:
        return Path(user_dir_env) / DB_FILENAME, "COMFYUI_USER_DIR"

    sidecar = _load_sidecar()
    preference = sidecar.get("preference")
    if preference == "global":
        return _legacy_home_path(), "global"
    if preference == "root":
        return _plugin_root_db_path(), "root"
    if preference == "user":
        comfy_user = _comfyui_user_dir_from_api() or _comfyui_user_dir_from_path()
        if comfy_user is not None:
            return comfy_user / DB_FILENAME, "user"
        # Detection failed — fall through to the default chain rather
        # than crash. Last-ditch fallback below will catch it.

    # Default — same as explicit "user" preference.
    comfy_user = _comfyui_user_dir_from_api() or _comfyui_user_dir_from_path()
    if comfy_user is not None:
        return comfy_user / DB_FILENAME, "user"

    # Last-ditch fallback. The design folds the old "legacy" label into
    # "global" because the path is identical and the UI has no separate
    # "legacy" radio.
    return _legacy_home_path(), "global"


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
