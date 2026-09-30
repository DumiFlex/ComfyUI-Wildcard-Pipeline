"""Library database backups: create, list, prune, delete, staged restore.

Backups live in ``<db file parent>/backups/`` — next to the database they
protect, so moving the library (Settings → Database location) is the only
thing that separates them, and a user who backs up "the wildcard-pipeline
folder" gets both.

File names carry everything we need to know about a backup, so there is no
index file to drift out of sync with the directory::

    wildcard-pipeline-YYYYMMDD-HHMMSS-<reason>[-N].db

(UTC timestamp; ``-N`` only when two backups land in the same second.)

Reasons:

- ``manual``        — the user pressed "Back up now". Never pruned: the user
  made it deliberately, so only the user deletes it.
- ``daily``         — the background scheduler (``maybe_daily_backup``).
- ``pre-migration`` — taken by ``engine/db/migrations.py:migrate`` right
  before it applies schema changes to an existing library.
- ``pre-restore``   — the live DB, saved right before a restore overwrote it,
  so a restore is itself undoable.

Copies go through SQLite's online backup API rather than a file copy: the
library runs in WAL mode, where committed data can sit in ``-wal`` rather
than the main file, and a plain copy of the main file would silently lose it.

Restore is staged, like the DB location move: the request only records the
chosen backup in the sidecar (``engine/db/config.py``), and
``execute_pending_restore`` swaps the file at the next start, before any
connection opens. Swapping a SQLite file out from under live connections is
how databases get corrupted.
"""
from __future__ import annotations

import logging
import os
import re
import shutil
import sqlite3
import tempfile
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from engine import prefs
from engine.db import config as db_config
from engine.db.connection import resolve_db_path

logger = logging.getLogger(__name__)

BACKUPS_DIRNAME = "backups"
REASONS = ("manual", "daily", "pre-migration", "pre-restore")
#: Reasons `prune` may delete. Manual backups are the user's, not ours.
AUTOMATIC_REASONS = frozenset({"daily", "pre-migration", "pre-restore"})
DAILY_INTERVAL = timedelta(hours=24)
SCHEDULER_PERIOD_S = 3600.0

_NAME_RE = re.compile(
    r"^wildcard-pipeline-(\d{8})-(\d{6})-"
    r"(manual|daily|pre-migration|pre-restore)(?:-(\d+))?\.db$"
)


class BackupNotFound(LookupError):
    """The named backup isn't a valid backup file in the backups dir."""


def backups_dir(db_path: Path) -> Path:
    """Where backups of ``db_path`` live. Not created until one is written."""
    return Path(db_path).parent / BACKUPS_DIRNAME


def _parse_name(name: str) -> tuple[datetime, str, int] | None:
    m = _NAME_RE.fullmatch(name)
    if not m:
        return None
    try:
        ts = datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S")
    except ValueError:
        return None
    return ts.replace(tzinfo=timezone.utc), m.group(3), int(m.group(4) or 1)


def _new_backup_path(directory: Path, reason: str, now: datetime | None = None) -> Path:
    """First free ``wildcard-pipeline-<ts>-<reason>[-N].db`` in ``directory``."""
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%d-%H%M%S")
    base = f"wildcard-pipeline-{stamp}-{reason}"
    candidate = directory / f"{base}.db"
    n = 2
    while candidate.exists():
        candidate = directory / f"{base}-{n}.db"
        n += 1
    return candidate


def _entry(path: Path) -> dict[str, Any] | None:
    parsed = _parse_name(path.name)
    if parsed is None or not path.is_file():
        return None
    ts, reason, _ = parsed
    try:
        size = path.stat().st_size
    except OSError:
        return None
    return {
        "name": path.name,
        "size": size,
        "created_at": ts.isoformat().replace("+00:00", "Z"),
        "reason": reason,
    }


def _sort_key(path: Path) -> tuple[datetime, int]:
    parsed = _parse_name(path.name)
    assert parsed is not None
    return parsed[0], parsed[2]


def _check_reason(reason: str) -> None:
    if reason not in REASONS:
        raise ValueError(f"unknown backup reason {reason!r}; expected one of {REASONS}")


def create_backup(
    db_path: Path,
    reason: str,
    *,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Write a consistent snapshot of ``db_path`` and return its list entry.

    ``conn`` lets a caller that already holds a connection (the migration
    runner) back up through it instead of opening a second one. The snapshot
    is written to a temp file and renamed into place, so a half-written
    backup never shows up in the list.
    """
    _check_reason(reason)
    db_path = Path(db_path)
    if conn is None and not db_path.is_file():
        raise FileNotFoundError(f"database {db_path} does not exist")
    directory = backups_dir(db_path)
    directory.mkdir(parents=True, exist_ok=True)
    target = _new_backup_path(directory, reason)
    fd, tmp_str = tempfile.mkstemp(prefix=".backup-", suffix=".db", dir=str(directory))
    os.close(fd)
    tmp = Path(tmp_str)
    try:
        src = conn if conn is not None else sqlite3.connect(str(db_path))
        try:
            dst = sqlite3.connect(str(tmp))
            try:
                src.backup(dst)
            finally:
                dst.close()
        finally:
            if conn is None:
                src.close()
        os.replace(tmp, target)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    entry = _entry(target)
    assert entry is not None
    logger.info("wp_db_backup: wrote %s", target)
    return entry


def _backup_paths(db_path: Path) -> list[Path]:
    """Valid backup files, newest first."""
    directory = backups_dir(db_path)
    if not directory.is_dir():
        return []
    paths = [p for p in directory.iterdir() if p.is_file() and _parse_name(p.name)]
    paths.sort(key=_sort_key, reverse=True)
    return paths


def list_backups(db_path: Path) -> list[dict[str, Any]]:
    """Every backup of ``db_path``, newest first."""
    out = []
    for p in _backup_paths(db_path):
        e = _entry(p)
        if e is not None:
            out.append(e)
    return out


def prune(db_path: Path, keep: int) -> list[str]:
    """Delete the oldest AUTOMATIC backups beyond ``keep``; return their names.

    Manual backups neither count toward ``keep`` nor get deleted.
    """
    keep = max(0, int(keep))
    automatic = [p for p in _backup_paths(db_path)
                 if _parse_name(p.name)[1] in AUTOMATIC_REASONS]  # type: ignore[index]
    removed: list[str] = []
    for p in automatic[keep:]:
        try:
            p.unlink()
            removed.append(p.name)
        except OSError:
            logger.exception("wp_db_backup: could not prune %s", p)
    return removed


def resolve_backup(db_path: Path, name: str) -> Path:
    """Map a client-supplied backup name to its file, or raise BackupNotFound.

    SECURITY: ``name`` comes from an unauthenticated HTTP request and ends up
    in ``unlink`` / a file copy over the live DB. It must be a bare file name
    matching the backup pattern (which admits no separators or ``..``) and
    must resolve to a file directly inside the backups dir.
    """
    if not isinstance(name, str) or _parse_name(name) is None:
        raise BackupNotFound(name)
    directory = backups_dir(db_path).resolve()
    candidate = (directory / name).resolve()
    if candidate.parent != directory or not candidate.is_file():
        raise BackupNotFound(name)
    return candidate


def delete_backup(db_path: Path, name: str) -> None:
    """Delete one backup by name; raises BackupNotFound for anything else."""
    resolve_backup(db_path, name).unlink()


def _newest_age(db_path: Path, now: datetime) -> timedelta | None:
    paths = _backup_paths(db_path)
    if not paths:
        return None
    return now - _sort_key(paths[0])[0]


def maybe_daily_backup(
    db_path: Path | None = None,
    *,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    """Take a ``daily`` backup when one is due; return it, or None.

    Due = backups + daily backups enabled, the DB exists, and the newest
    backup of ANY reason is at least 24h old (a manual backup this morning
    already covers today).
    """
    cfg = prefs.backups()
    if not (cfg["enabled"] and cfg["daily"]):
        return None
    db_path = Path(db_path) if db_path is not None else resolve_db_path()
    if not db_path.is_file():
        return None
    now = now or datetime.now(timezone.utc)
    age = _newest_age(db_path, now)
    if age is not None and age < DAILY_INTERVAL:
        return None
    entry = create_backup(db_path, "daily")
    prune(db_path, cfg["keep"])
    return entry


def backup_before_migration(conn: sqlite3.Connection) -> dict[str, Any] | None:
    """Called by `migrate` before applying pending migrations to a library
    that already has some. Never raises: a failed backup is logged and the
    migration goes ahead, because refusing to start is worse than the risk
    the backup was insuring against.
    """
    try:
        if not prefs.backups()["enabled"]:
            return None
        db_file = _main_db_file(conn)
        if db_file is None:
            return None
        entry = create_backup(db_file, "pre-migration", conn=conn)
        prune(db_file, prefs.backups()["keep"])
        return entry
    except Exception:  # noqa: BLE001 - see docstring
        logger.exception("wp_db_backup: pre-migration backup failed; migrating anyway")
        return None


def _main_db_file(conn: sqlite3.Connection) -> Path | None:
    """The file behind ``conn``'s main schema, or None for in-memory DBs."""
    for row in conn.execute("PRAGMA database_list;").fetchall():
        if row[1] == "main":
            return Path(row[2]) if row[2] else None
    return None


# ── staged restore ───────────────────────────────────────────────────


def stage_restore(db_path: Path, name: str) -> Path:
    """Record a restore of backup ``name`` for the next start."""
    path = resolve_backup(db_path, name)
    db_config.set_pending_restore(path)
    return path


def cancel_restore() -> None:
    db_config.clear_pending_restore()


def pending_restore_name(db_path: Path) -> str | None:
    """Name of the staged restore's backup, if one is staged for this DB."""
    pr = db_config.load().get("pending_restore")
    if not pr:
        return None
    src = Path(pr["from"])
    try:
        resolve_backup(db_path, src.name)
    except BackupNotFound:
        return None
    return src.name


def _copy_live_db_file(db_path: Path) -> None:
    """Fallback pre-restore snapshot: plain file copy (nothing is open yet)."""
    directory = backups_dir(db_path)
    directory.mkdir(parents=True, exist_ok=True)
    shutil.copy2(db_path, _new_backup_path(directory, "pre-restore"))


def execute_pending_restore() -> None:
    """If a restore is staged, run it and clear the entry. Never raises.

    Runs at plugin load, right after ``execute_pending_move`` and before any
    connection opens. Order: snapshot the live DB as ``pre-restore`` (so the
    restore is undoable), drop the live ``-wal`` / ``-shm`` (they belong to the
    file being replaced — left behind, SQLite would replay them onto the
    restored one), then copy the backup into place via temp + rename.
    """
    try:
        _execute_pending_restore()
    except Exception:  # noqa: BLE001 - see docstring
        logger.exception("wp_db_restore: failed")


def _execute_pending_restore() -> None:
    pr = db_config.load().get("pending_restore")
    if not pr:
        return
    db_path = resolve_db_path()
    src = Path(pr["from"])
    try:
        src = resolve_backup(db_path, src.name)
    except BackupNotFound:
        # A backup that is gone (or a sidecar pointing somewhere else) will
        # never become restorable; keeping the entry would retry forever.
        logger.error("wp_db_restore: backup %s not found in %s, dropping request",
                     pr["from"], backups_dir(db_path))
        db_config.clear_pending_restore()
        return

    if db_path.is_file():
        try:
            create_backup(db_path, "pre-restore")
        except Exception:  # noqa: BLE001 - fall back to a raw copy
            logger.exception("wp_db_restore: online pre-restore backup failed, copying file")
            try:
                _copy_live_db_file(db_path)
            except OSError:
                # Without a safety copy, overwriting would be irreversible.
                logger.exception("wp_db_restore: could not save current DB; not restoring")
                return

    for suffix in ("-wal", "-shm"):
        Path(str(db_path) + suffix).unlink(missing_ok=True)

    db_path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_str = tempfile.mkstemp(prefix=".restore-", suffix=".db", dir=str(db_path.parent))
    os.close(fd)
    tmp = Path(tmp_str)
    try:
        shutil.copyfile(src, tmp)
        os.replace(tmp, db_path)
    except OSError:
        tmp.unlink(missing_ok=True)
        logger.exception("wp_db_restore: copying %s over %s failed", src, db_path)
        return
    db_config.clear_pending_restore()
    try:
        prune(db_path, prefs.backups()["keep"])
    except Exception:  # noqa: BLE001 - pruning is housekeeping
        logger.exception("wp_db_restore: prune failed")
    logger.info("wp_db_restore: restored %s -> %s", src, db_path)


# ── daily scheduler ─────────────────────────────────────────────────

_scheduler_lock = threading.Lock()
_scheduler: threading.Thread | None = None
_scheduler_stop = threading.Event()


def _safe_daily() -> None:
    try:
        maybe_daily_backup()
    except Exception:  # noqa: BLE001 - a failed backup must not kill the loop
        logger.exception("wp_db_backup: daily backup failed")


def _scheduler_loop(period: float) -> None:
    while not _scheduler_stop.wait(period):
        _safe_daily()


def start_daily_scheduler(period: float = SCHEDULER_PERIOD_S) -> bool:
    """Check for a due daily backup now, then hourly on a daemon thread.

    Hourly checks against a 24h interval, rather than one 24h timer, so a
    machine that sleeps or a ComfyUI that restarts often still gets its
    backup roughly on schedule. Idempotent: returns False if already running.
    """
    global _scheduler
    with _scheduler_lock:
        if _scheduler is not None and _scheduler.is_alive():
            return False
        _scheduler_stop.clear()
        _safe_daily()
        _scheduler = threading.Thread(
            target=_scheduler_loop, args=(period,),
            name="wp-daily-backup", daemon=True,
        )
        _scheduler.start()
        return True


def stop_daily_scheduler() -> None:
    """Stop the scheduler thread (tests)."""
    global _scheduler
    with _scheduler_lock:
        _scheduler_stop.set()
        if _scheduler is not None:
            _scheduler.join(timeout=5)
        _scheduler = None
