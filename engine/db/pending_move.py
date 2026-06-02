"""Execute deferred DB file moves at plugin load.

The SPA Settings UI lets users change the DB location. The actual file
operation runs here, on next ComfyUI start, BEFORE any DB connection
opens. Errors are logged and never crash the host.
"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path

from engine.db.config import clear_pending_move, load

logger = logging.getLogger(__name__)


def execute_pending_move() -> None:
    """If the sidecar has a pending_move, run it and clear the entry.

    Idempotent if the move already happened (source missing, dest present).
    Failures (source missing without dest, permission errors) are logged;
    sidecar is left intact so the UI can show the pending state on next
    page load.
    """
    cfg = load()
    pm = cfg.get("pending_move")
    if not pm:
        return
    src = Path(pm["from"])
    dst = Path(pm["to"])
    mode = pm["mode"]

    # Resume: previous run completed the move but failed to clear sidecar.
    if not src.exists() and dst.exists():
        logger.info("wp_db_pending_move: already-done (src missing, dst present), clearing")
        clear_pending_move()
        return

    if not src.exists():
        logger.error("wp_db_pending_move: source %s missing, skipping", src)
        return

    try:
        dst.parent.mkdir(parents=True, exist_ok=True)
        if mode == "copy":
            shutil.copy2(src, dst)
        else:  # move
            shutil.move(str(src), str(dst))
    except OSError as e:
        logger.exception("wp_db_pending_move: %s failed: %s", mode, e)
        return

    clear_pending_move()
    logger.info("wp_db_pending_move: %s %s -> %s OK", mode, src, dst)
