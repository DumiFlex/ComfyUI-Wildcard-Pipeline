"""Sidecar config for DB location preference + pending move/restore state.

Lives at ``<plugin>/db-config.json`` so the resolver can read it BEFORE
opening any DB connection (chicken-and-egg: the preference about where
the DB lives can't live inside the DB itself).

Atomic writes: write-to-temp-then-rename so a crash mid-write can't
corrupt the sidecar.
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any, Literal, TypedDict

Preference = Literal["user", "global", "root"]
MoveMode = Literal["copy", "move"]

# Plugin root: this file is at <plugin>/engine/db/config.py — go up three.
_PLUGIN_ROOT = Path(__file__).resolve().parents[2]
SIDECAR_PATH = _PLUGIN_ROOT / "db-config.json"

_VALID_PREFERENCES = {"user", "global", "root"}
_VALID_MODES = {"copy", "move"}


class PendingMove(TypedDict, total=False):
    from_: str  # NB: "from" is a Python keyword; we map this on read/write
    to: str
    mode: MoveMode


class DbConfig(TypedDict, total=False):
    preference: Preference
    pending_move: dict[str, str]  # {"from": "...", "to": "...", "mode": "..."}
    # {"from": "<absolute backup path>"} — a restore staged from Settings,
    # executed by `engine/db/backups.py:execute_pending_restore` at the next
    # start, before any connection opens (a live SQLite file can't safely be
    # swapped out from under open connections).
    pending_restore: dict[str, str]


def _read_raw(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _resolve_sidecar(path: Path | None) -> Path:
    """Resolve the effective sidecar path.

    Reads ``SIDECAR_PATH`` from this module dynamically when ``path`` is
    ``None`` so tests can ``monkeypatch.setattr("engine.db.config.SIDECAR_PATH", ...)``
    and have all three of ``load``/``save``/``clear_pending_move`` honor
    the override. Using a default argument like ``path = SIDECAR_PATH``
    captures the value at function-definition time, which breaks
    monkeypatching the module attribute."""
    return path if path is not None else SIDECAR_PATH


def load(path: Path | None = None) -> DbConfig:
    """Return the sidecar config or {} if absent / unreadable / invalid."""
    raw = _read_raw(_resolve_sidecar(path))
    out: DbConfig = {}
    pref = raw.get("preference")
    if isinstance(pref, str) and pref in _VALID_PREFERENCES:
        out["preference"] = pref  # type: ignore[typeddict-item]
    pm = raw.get("pending_move")
    if isinstance(pm, dict):
        mode = pm.get("mode")
        src = pm.get("from")
        dst = pm.get("to")
        if (isinstance(mode, str) and mode in _VALID_MODES
                and isinstance(src, str) and isinstance(dst, str)):
            out["pending_move"] = {"from": src, "to": dst, "mode": mode}
    pr = raw.get("pending_restore")
    if isinstance(pr, dict):
        src = pr.get("from")
        if isinstance(src, str) and src:
            out["pending_restore"] = {"from": src}
    return out


def save(config: DbConfig, path: Path | None = None) -> None:
    """Atomically write the sidecar (write-temp + rename)."""
    path = _resolve_sidecar(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Strip any unknown keys; only persist the validated shape.
    out: dict[str, Any] = {}
    if "preference" in config:
        out["preference"] = config["preference"]
    pm = config.get("pending_move")
    if isinstance(pm, dict) and {"from", "to", "mode"} <= pm.keys():
        out["pending_move"] = {"from": pm["from"], "to": pm["to"], "mode": pm["mode"]}
    pr = config.get("pending_restore")
    if isinstance(pr, dict) and isinstance(pr.get("from"), str) and pr["from"]:
        out["pending_restore"] = {"from": pr["from"]}
    fd, tmp_str = tempfile.mkstemp(prefix=".db-config-", dir=str(path.parent))
    tmp_path = Path(tmp_str)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=2)
        os.replace(tmp_path, path)
    except OSError:
        tmp_path.unlink(missing_ok=True)
        raise


def clear_pending_move(path: Path | None = None) -> None:
    """Remove just the pending_move field; preserve preference."""
    path = _resolve_sidecar(path)
    cfg = load(path)
    if "pending_move" in cfg:
        cfg.pop("pending_move", None)
        save(cfg, path)


def set_pending_restore(backup_path: Path, path: Path | None = None) -> None:
    """Stage a restore from ``backup_path``; preserves the other fields.

    Callers validate the path (it must be a file in the backups dir) — this
    layer only persists it.
    """
    path = _resolve_sidecar(path)
    cfg = load(path)
    cfg["pending_restore"] = {"from": str(backup_path)}
    save(cfg, path)


def clear_pending_restore(path: Path | None = None) -> None:
    """Remove just the pending_restore field; preserve everything else."""
    path = _resolve_sidecar(path)
    cfg = load(path)
    if "pending_restore" in cfg:
        cfg.pop("pending_restore", None)
        save(cfg, path)


def plugin_root() -> Path:
    """Expose the plugin root so the resolver can compute the `root` location."""
    return _PLUGIN_ROOT
