"""Moving the database and tag list into `<ComfyUI>/user/wildcard-pipeline/`.

Existing installs have real data loose in the user directory, so the subfolder
is only half the change: without the move the extension comes up with an empty
library and no tag list, which reads as data loss even though the files are
still on disk a level up.
"""
from __future__ import annotations

import pytest

from engine.db import connection as conn_mod
from engine.db import relocate as relocate_mod
from engine.db.connection import DB_FILENAME, WP_DATA_DIRNAME
from engine.db.relocate import TAG_FILE_NAME, migrate_user_data


@pytest.fixture
def user_dir(monkeypatch, tmp_path):
    """A stand-in ComfyUI user directory, with detection pinned to it."""
    base = tmp_path / "user"
    base.mkdir()
    monkeypatch.setattr(conn_mod, "_comfyui_user_dir_from_api", lambda: base)
    monkeypatch.setattr(conn_mod, "_comfyui_user_dir_from_path", lambda: None)
    return base


def test_moves_database_and_tag_list(user_dir):
    (user_dir / DB_FILENAME).write_text("sqlite-ish", encoding="utf-8")
    (user_dir / TAG_FILE_NAME).write_text("1girl,0,100,\n", encoding="utf-8")

    report = migrate_user_data()

    target = user_dir / WP_DATA_DIRNAME
    assert (target / DB_FILENAME).read_text(encoding="utf-8") == "sqlite-ish"
    assert (target / TAG_FILE_NAME).read_text(encoding="utf-8") == "1girl,0,100,\n"
    assert not (user_dir / DB_FILENAME).exists()
    assert not (user_dir / TAG_FILE_NAME).exists()
    assert sorted(report.moved) == sorted([DB_FILENAME, TAG_FILE_NAME])
    assert report.failed == []


def test_moves_the_wal_sidecars_with_the_database(user_dir):
    # A `-wal` holds committed transactions not yet checkpointed into the main
    # file. Moving the `.db` alone silently drops the most recent writes.
    (user_dir / DB_FILENAME).write_text("main", encoding="utf-8")
    (user_dir / f"{DB_FILENAME}-wal").write_text("wal", encoding="utf-8")
    (user_dir / f"{DB_FILENAME}-shm").write_text("shm", encoding="utf-8")

    migrate_user_data()

    target = user_dir / WP_DATA_DIRNAME
    assert (target / f"{DB_FILENAME}-wal").read_text(encoding="utf-8") == "wal"
    assert (target / f"{DB_FILENAME}-shm").read_text(encoding="utf-8") == "shm"


def test_never_overwrites_an_existing_destination(user_dir):
    # A file at the destination means either a finished migration or something
    # the user put there. Either outranks anything we could infer.
    target = user_dir / WP_DATA_DIRNAME
    target.mkdir()
    (target / DB_FILENAME).write_text("the real library", encoding="utf-8")
    (user_dir / DB_FILENAME).write_text("stale leftover", encoding="utf-8")

    report = migrate_user_data()

    assert (target / DB_FILENAME).read_text(encoding="utf-8") == "the real library"
    assert (user_dir / DB_FILENAME).read_text(encoding="utf-8") == "stale leftover"
    assert report.moved == []
    assert any(DB_FILENAME in s for s in report.skipped)


def test_is_idempotent(user_dir):
    (user_dir / DB_FILENAME).write_text("data", encoding="utf-8")
    first = migrate_user_data()
    second = migrate_user_data()

    assert first.moved == [DB_FILENAME]
    # Runs on every boot, so the second call must be a no-op — not a skip, not
    # a failure, nothing at all.
    assert not second.did_anything


def test_nothing_to_do_when_the_user_dir_is_undetectable(monkeypatch):
    monkeypatch.setattr(conn_mod, "_comfyui_user_dir_from_api", lambda: None)
    monkeypatch.setattr(conn_mod, "_comfyui_user_dir_from_path", lambda: None)

    report = migrate_user_data()

    assert not report.did_anything


def test_a_failed_move_is_reported_not_raised(user_dir, monkeypatch):
    # The caller runs this at extension import. A raise here would take the
    # whole extension down over housekeeping; the correct degraded state is
    # "keep using the old location".
    (user_dir / DB_FILENAME).write_text("data", encoding="utf-8")

    def boom(*_args, **_kwargs):
        raise OSError("device is busy")

    monkeypatch.setattr(relocate_mod.shutil, "move", boom)

    report = migrate_user_data()

    assert report.moved == []
    assert any("device is busy" in f for f in report.failed)
    assert (user_dir / DB_FILENAME).exists()


def test_resolved_db_path_points_inside_the_data_dir(user_dir, monkeypatch):
    # The move is only correct if resolution agrees about the destination.
    monkeypatch.delenv("WP_DB_PATH", raising=False)
    monkeypatch.delenv("COMFYUI_USER_DIR", raising=False)
    monkeypatch.setattr(conn_mod, "_load_sidecar", lambda: {})

    path, source = conn_mod.resolve_db_path_with_source()

    assert source == "user"
    assert path == user_dir / WP_DATA_DIRNAME / DB_FILENAME


def test_data_dir_is_not_created_by_asking_for_it(user_dir):
    # The Settings panel probes "where would this live?" on every load. A read
    # should not leave a folder behind.
    assert conn_mod.wp_data_dir() == user_dir / WP_DATA_DIRNAME
    assert not (user_dir / WP_DATA_DIRNAME).exists()
