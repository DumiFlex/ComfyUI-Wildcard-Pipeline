"""One-time move of our files from ``<ComfyUI>/user/`` into ``<user>/wildcard-pipeline/``.

The library database and the downloaded tag list used to sit loose in ComfyUI's
user directory. Existing installs have real data there, so introducing the
subfolder is only half the change — without this the extension would silently
come up with an empty library and no tag list, which reads as data loss even
though the files are still on disk.

Design constraints, in the order they mattered:

1. **Never overwrite.** If something already exists at the destination, the
   legacy file is left exactly where it is and reported as skipped. A
   destination file means either a completed migration or a deliberate
   user-placed file; both outsrank anything we could infer.
2. **Run before the database is opened.** SQLite keeps ``-wal`` and ``-shm``
   sidecars next to the main file, and moving the set out from under an open
   connection corrupts it. ``__init__.py`` calls this at import, before routes
   are registered and before anything connects.
3. **Move the sidecars with it.** A ``-wal`` left behind holds committed
   transactions that have not been checkpointed into the main file yet; moving
   the ``.db`` alone can lose the most recent writes.
4. **Never raise.** A failed migration must degrade to "extension starts with
   the old path still in place", not to "ComfyUI fails to load the extension".
   Every failure is reported in the return value for the caller to log.
"""
from __future__ import annotations

import shutil
from dataclasses import dataclass, field
from pathlib import Path

from engine.db.connection import DB_FILENAME, comfyui_user_dir, wp_data_dir

#: Kept in sync with `wp_api/tags.py::TAG_FILE_NAME`. Duplicated rather than
#: imported because `engine/` must not import from `wp_api/` — the directory
#: contract in CLAUDE.md keeps the engine free of ComfyUI-facing modules, and
#: `wp_api` imports aiohttp.
TAG_FILE_NAME = "wildcard-pipeline-tags.csv"

#: SQLite's write-ahead-log sidecars. Moved with the database, never alone.
_DB_SIDECAR_SUFFIXES = ("-wal", "-shm")


@dataclass
class RelocationReport:
    """What happened, for the caller to log. Empty everywhere = nothing to do."""

    moved: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)

    @property
    def did_anything(self) -> bool:
        return bool(self.moved or self.skipped or self.failed)


def _move_one(src: Path, dst: Path, report: RelocationReport) -> None:
    """Move ``src`` to ``dst`` if and only if ``src`` exists and ``dst`` does not."""
    if not src.exists():
        return
    if dst.exists():
        report.skipped.append(f"{src.name} (already present at destination)")
        return
    try:
        dst.parent.mkdir(parents=True, exist_ok=True)
        # `shutil.move` rather than `Path.rename`: the user directory and our
        # subfolder are normally the same filesystem, but a user dir that is a
        # mount or a symlink elsewhere would make rename fail with EXDEV.
        shutil.move(str(src), str(dst))
        report.moved.append(src.name)
    except Exception as exc:  # noqa: BLE001 - see module docstring, item 4
        report.failed.append(f"{src.name}: {exc}")


def migrate_user_data() -> RelocationReport:
    """Move the database and tag list into ``<user>/wildcard-pipeline/``.

    Idempotent: once the files are at the destination every subsequent call
    finds nothing to move and returns an empty report. Safe to call on every
    boot, which is exactly what happens.
    """
    report = RelocationReport()
    base = comfyui_user_dir()
    target = wp_data_dir()
    if base is None or target is None:
        # No detectable user directory. `resolve_db_path_with_source` falls
        # back to `~/.comfyui/` in this case, which was never inside the user
        # dir, so there is nothing here to move.
        return report

    # Database first, sidecars immediately after it. Order matters only for
    # readability of the report; the "never overwrite" rule makes each move
    # independent.
    _move_one(base / DB_FILENAME, target / DB_FILENAME, report)
    for suffix in _DB_SIDECAR_SUFFIXES:
        _move_one(
            base / f"{DB_FILENAME}{suffix}",
            target / f"{DB_FILENAME}{suffix}",
            report,
        )

    _move_one(base / TAG_FILE_NAME, target / TAG_FILE_NAME, report)
    return report
