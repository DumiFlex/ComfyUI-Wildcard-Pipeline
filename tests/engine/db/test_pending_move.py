"""Tests for pending-move executor."""
from __future__ import annotations

import pytest

from engine.db import config as dbcfg
from engine.db.pending_move import execute_pending_move


@pytest.fixture
def sidecar(tmp_path, monkeypatch):
    """Point the config module at a tmp sidecar so tests don't clobber the
    real one."""
    p = tmp_path / "db-config.json"
    monkeypatch.setattr(dbcfg, "SIDECAR_PATH", p)
    return p


def test_no_pending_no_op(sidecar):
    execute_pending_move()
    assert not sidecar.exists()  # save() only writes when there's content


def test_copy_keeps_source(tmp_path, sidecar):
    src = tmp_path / "src.db"
    dst = tmp_path / "dst.db"
    src.write_bytes(b"hello")
    dbcfg.save({"preference": "user",
                "pending_move": {"from": str(src), "to": str(dst), "mode": "copy"}})
    execute_pending_move()
    assert src.exists()
    assert dst.read_bytes() == b"hello"
    cfg = dbcfg.load()
    assert "pending_move" not in cfg
    assert cfg.get("preference") == "user"  # preference preserved


def test_move_removes_source(tmp_path, sidecar):
    src = tmp_path / "src.db"
    dst = tmp_path / "moved" / "dst.db"
    src.write_bytes(b"payload")
    dbcfg.save({"pending_move": {"from": str(src), "to": str(dst), "mode": "move"}})
    execute_pending_move()
    assert not src.exists()
    assert dst.read_bytes() == b"payload"


def test_already_done_resume_clears_sidecar(tmp_path, sidecar):
    src = tmp_path / "src.db"  # does not exist
    dst = tmp_path / "dst.db"
    dst.write_bytes(b"already")
    dbcfg.save({"pending_move": {"from": str(src), "to": str(dst), "mode": "move"}})
    execute_pending_move()
    cfg = dbcfg.load()
    assert "pending_move" not in cfg


def test_missing_source_logs_and_keeps_sidecar(tmp_path, sidecar):
    src = tmp_path / "nope.db"
    dst = tmp_path / "dst.db"  # also missing — so resume-clause doesn't fire
    dbcfg.save({"pending_move": {"from": str(src), "to": str(dst), "mode": "copy"}})
    execute_pending_move()
    cfg = dbcfg.load()
    assert cfg.get("pending_move") is not None  # still pending; user can see it


def test_dest_parent_is_created(tmp_path, sidecar):
    src = tmp_path / "src.db"
    dst = tmp_path / "deep" / "nested" / "dst.db"
    src.write_bytes(b"x")
    dbcfg.save({"pending_move": {"from": str(src), "to": str(dst), "mode": "copy"}})
    execute_pending_move()
    assert dst.exists()
