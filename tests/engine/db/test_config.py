"""Tests for sidecar config — load, save, clear, atomic write."""
from __future__ import annotations

import json

from engine.db.config import (
    SIDECAR_PATH,
    clear_pending_move,
    load,
    plugin_root,
    save,
)


def test_load_returns_empty_when_sidecar_absent(tmp_path):
    p = tmp_path / "no-such.json"
    assert load(p) == {}


def test_load_returns_empty_on_invalid_json(tmp_path):
    p = tmp_path / "bad.json"
    p.write_text("{ not json", encoding="utf-8")
    assert load(p) == {}


def test_load_strips_unknown_preference(tmp_path):
    p = tmp_path / "cfg.json"
    p.write_text(json.dumps({"preference": "wat"}), encoding="utf-8")
    assert load(p) == {}


def test_load_round_trip(tmp_path):
    p = tmp_path / "cfg.json"
    cfg = {
        "preference": "global",
        "pending_move": {"from": "/a.db", "to": "/b.db", "mode": "copy"},
    }
    save(cfg, p)
    assert load(p) == cfg


def test_save_is_atomic_no_leftover_tmp(tmp_path):
    p = tmp_path / "cfg.json"
    save({"preference": "user"}, p)
    leftovers = [c.name for c in tmp_path.iterdir() if c.name.startswith(".db-config-")]
    assert leftovers == []


def test_clear_pending_move_keeps_preference(tmp_path):
    p = tmp_path / "cfg.json"
    save({
        "preference": "user",
        "pending_move": {"from": "/a", "to": "/b", "mode": "move"},
    }, p)
    clear_pending_move(p)
    assert load(p) == {"preference": "user"}


def test_clear_pending_move_noop_when_absent(tmp_path):
    p = tmp_path / "cfg.json"
    save({"preference": "global"}, p)
    clear_pending_move(p)
    assert load(p) == {"preference": "global"}


def test_plugin_root_points_at_real_dir():
    root = plugin_root()
    assert (root / "engine").is_dir()
    assert (root / "wp_nodes").is_dir()


def test_default_sidecar_path_is_inside_plugin():
    assert SIDECAR_PATH.parent == plugin_root()
    assert SIDECAR_PATH.name == "db-config.json"
