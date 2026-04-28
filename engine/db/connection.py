"""SQLite connection factory.

DB path resolution order:
1. ``WP_DB_PATH`` env var (explicit override)
2. ``$COMFYUI_USER_DIR/wildcard-pipeline.db``
3. Fallback: ``~/.comfyui/wildcard-pipeline.db``
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path


def resolve_db_path() -> Path:
    override = os.environ.get("WP_DB_PATH")
    if override:
        return Path(override)
    user_dir = os.environ.get("COMFYUI_USER_DIR")
    if user_dir:
        return Path(user_dir) / "wildcard-pipeline.db"
    return Path.home() / ".comfyui" / "wildcard-pipeline.db"


def get_connection(path: Path | None = None) -> sqlite3.Connection:
    """Open a SQLite connection with WAL mode and FK enforcement."""
    db_path = path or resolve_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn
