"""engine/db/backups.py — create / list / prune / delete / daily / pre-migration
/ staged restore."""
from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

from engine import prefs
from engine.db import backups as bk
from engine.db import config as dbcfg
from engine.db import migrations as mig
from engine.db.connection import get_connection


@pytest.fixture
def sidecar(tmp_path, monkeypatch):
    p = tmp_path / "db-config.json"
    monkeypatch.setattr(dbcfg, "SIDECAR_PATH", p)
    return p


@pytest.fixture
def db(tmp_path, monkeypatch):
    """A live WAL DB with one committed row, pointed at by WP_DB_PATH."""
    path = tmp_path / "lib" / "wildcard-pipeline.db"
    monkeypatch.setenv("WP_DB_PATH", str(path))
    conn = get_connection(path)
    conn.execute("CREATE TABLE t (v TEXT)")
    with conn:
        conn.execute("INSERT INTO t VALUES ('original')")
    conn.close()
    return path


def _rows(path) -> list[str]:
    conn = sqlite3.connect(str(path))
    try:
        return [r[0] for r in conn.execute("SELECT v FROM t ORDER BY rowid")]
    finally:
        conn.close()


def _touch_backup(db_path, name: str) -> None:
    d = bk.backups_dir(db_path)
    d.mkdir(parents=True, exist_ok=True)
    (d / name).write_bytes(b"x")


# ── create / list ────────────────────────────────────────────────────

def test_create_backup_is_consistent_under_wal(db):
    # Hold a connection open with committed-but-uncheckpointed data in -wal:
    # a plain file copy of the main file would miss the second row.
    conn = get_connection(db)
    with conn:
        conn.execute("INSERT INTO t VALUES ('in-wal')")
    try:
        entry = bk.create_backup(db, "manual")
    finally:
        conn.close()
    assert entry["reason"] == "manual"
    assert entry["name"].startswith("wildcard-pipeline-")
    assert entry["name"].endswith("-manual.db")
    assert entry["created_at"].endswith("Z")
    path = bk.backups_dir(db) / entry["name"]
    assert entry["size"] == path.stat().st_size > 0
    assert _rows(path) == ["original", "in-wal"]
    # No temp file left behind.
    assert [p.name for p in bk.backups_dir(db).iterdir()] == [entry["name"]]


def test_create_backup_rejects_unknown_reason(db):
    with pytest.raises(ValueError):
        bk.create_backup(db, "whenever")


def test_create_backup_missing_db_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        bk.create_backup(tmp_path / "nope.db", "manual")
    assert not (tmp_path / "nope.db").exists()


def test_same_second_names_get_a_suffix(db):
    a = bk.create_backup(db, "manual")
    b = bk.create_backup(db, "manual")
    c = bk.create_backup(db, "manual")
    names = {a["name"], b["name"], c["name"]}
    assert len(names) == 3
    # Newest first — suffix order breaks timestamp ties.
    listed = [e["name"] for e in bk.list_backups(db)]
    assert listed[0] == c["name"] and listed[-1] == a["name"]


def test_list_is_newest_first_and_ignores_strangers(db):
    _touch_backup(db, "wildcard-pipeline-20260101-000000-daily.db")
    _touch_backup(db, "wildcard-pipeline-20260301-000000-manual.db")
    _touch_backup(db, "wildcard-pipeline-20260201-120000-pre-migration.db")
    _touch_backup(db, "notes.txt")
    _touch_backup(db, "wildcard-pipeline-2026-bad-daily.db")
    listed = bk.list_backups(db)
    assert [e["name"] for e in listed] == [
        "wildcard-pipeline-20260301-000000-manual.db",
        "wildcard-pipeline-20260201-120000-pre-migration.db",
        "wildcard-pipeline-20260101-000000-daily.db",
    ]
    assert listed[1] == {
        "name": "wildcard-pipeline-20260201-120000-pre-migration.db",
        "size": 1,
        "created_at": "2026-02-01T12:00:00Z",
        "reason": "pre-migration",
    }


def test_list_without_dir_is_empty(tmp_path):
    assert bk.list_backups(tmp_path / "x.db") == []


# ── prune ────────────────────────────────────────────────────────────

def test_prune_keeps_newest_automatic_and_all_manual(db):
    for day in range(1, 6):
        _touch_backup(db, f"wildcard-pipeline-202601{day:02d}-000000-daily.db")
    _touch_backup(db, "wildcard-pipeline-20251201-000000-manual.db")
    _touch_backup(db, "wildcard-pipeline-20251202-000000-pre-restore.db")
    removed = bk.prune(db, 2)
    assert sorted(removed) == [
        "wildcard-pipeline-20251202-000000-pre-restore.db",
        "wildcard-pipeline-20260101-000000-daily.db",
        "wildcard-pipeline-20260102-000000-daily.db",
        "wildcard-pipeline-20260103-000000-daily.db",
    ]
    assert [e["name"] for e in bk.list_backups(db)] == [
        "wildcard-pipeline-20260105-000000-daily.db",
        "wildcard-pipeline-20260104-000000-daily.db",
        "wildcard-pipeline-20251201-000000-manual.db",
    ]


# ── delete ───────────────────────────────────────────────────────────

def test_delete_backup(db):
    e = bk.create_backup(db, "manual")
    bk.delete_backup(db, e["name"])
    assert bk.list_backups(db) == []
    with pytest.raises(bk.BackupNotFound):
        bk.delete_backup(db, e["name"])


@pytest.mark.parametrize("name", [
    "../wildcard-pipeline.db",
    "../../etc/passwd",
    "/etc/passwd",
    "wildcard-pipeline.db",
    "sub/wildcard-pipeline-20260101-000000-manual.db",
    "wildcard-pipeline-20260101-000000-manual.db/../../wildcard-pipeline.db",
    "",
])
def test_delete_refuses_traversal_and_non_backups(db, name):
    with pytest.raises(bk.BackupNotFound):
        bk.delete_backup(db, name)
    assert db.exists()


def test_delete_refuses_symlink_escaping_dir(db, tmp_path):
    outside = tmp_path / "victim.db"
    outside.write_bytes(b"v")
    d = bk.backups_dir(db)
    d.mkdir(parents=True, exist_ok=True)
    link = d / "wildcard-pipeline-20260101-000000-manual.db"
    try:
        link.symlink_to(outside)
    except OSError:
        pytest.skip("symlinks unavailable")
    with pytest.raises(bk.BackupNotFound):
        bk.delete_backup(db, link.name)
    assert outside.exists()


# ── daily ────────────────────────────────────────────────────────────

def test_daily_when_none_exist(db):
    entry = bk.maybe_daily_backup(db)
    assert entry is not None and entry["reason"] == "daily"


def test_daily_skipped_when_recent_backup_of_any_reason(db):
    bk.create_backup(db, "manual")
    assert bk.maybe_daily_backup(db) is None


def test_daily_runs_when_newest_older_than_24h(db):
    bk.create_backup(db, "manual")
    later = datetime.now(timezone.utc) + timedelta(hours=25)
    assert bk.maybe_daily_backup(db, now=later) is not None


def test_daily_respects_prefs(db):
    prefs.update({"backups": {"daily": False}})
    assert bk.maybe_daily_backup(db) is None
    prefs.update({"backups": {"daily": True, "enabled": False}})
    assert bk.maybe_daily_backup(db) is None


def test_daily_skips_missing_db(tmp_path):
    assert bk.maybe_daily_backup(tmp_path / "missing.db") is None


def test_daily_prunes(db):
    prefs.update({"backups": {"keep": 1}})
    _touch_backup(db, "wildcard-pipeline-20200101-000000-daily.db")
    entry = bk.maybe_daily_backup(db)
    assert [e["name"] for e in bk.list_backups(db)] == [entry["name"]]


def test_daily_defaults_to_resolved_db_path(db):
    assert bk.maybe_daily_backup() is not None
    assert bk.list_backups(db)


def test_scheduler_runs_check_at_start_and_is_idempotent(db):
    try:
        assert bk.start_daily_scheduler(period=3600) is True
        assert bk.start_daily_scheduler(period=3600) is False
        assert [e["reason"] for e in bk.list_backups(db)] == ["daily"]
    finally:
        bk.stop_daily_scheduler()


# ── pre-migration hook ───────────────────────────────────────────────

def _migrated_partway(path, monkeypatch):
    """A DB that applied migrations up to one below head."""
    all_migs = mig._discover()
    monkeypatch.setattr(mig, "_discover", lambda: all_migs[:-1])
    conn = get_connection(path)
    mig.migrate(conn)
    monkeypatch.setattr(mig, "_discover", lambda: all_migs)
    return conn


def test_pre_migration_backup_taken_before_upgrade(tmp_path, monkeypatch):
    path = tmp_path / "up.db"
    conn = _migrated_partway(path, monkeypatch)
    before = mig.current_version(conn)
    assert bk.list_backups(path) == []  # fresh DB: nothing to back up
    mig.migrate(conn)
    listed = bk.list_backups(path)
    assert [e["reason"] for e in listed] == ["pre-migration"]
    snap = sqlite3.connect(str(bk.backups_dir(path) / listed[0]["name"]))
    try:
        assert mig.current_version(snap) == before  # taken BEFORE applying
    finally:
        snap.close()
    assert mig.current_version(conn) == mig.head_version()
    # Up to date: no further backup.
    mig.migrate(conn)
    assert len(bk.list_backups(path)) == 1
    conn.close()


def test_pre_migration_skipped_when_disabled(tmp_path, monkeypatch):
    prefs.update({"backups": {"enabled": False}})
    path = tmp_path / "up.db"
    conn = _migrated_partway(path, monkeypatch)
    mig.migrate(conn)
    assert bk.list_backups(path) == []
    conn.close()


def test_pre_migration_backup_failure_never_blocks(tmp_path, monkeypatch):
    path = tmp_path / "up.db"
    conn = _migrated_partway(path, monkeypatch)

    def boom(*a, **k):
        raise OSError("disk full")

    monkeypatch.setattr(bk, "create_backup", boom)
    mig.migrate(conn)
    assert mig.current_version(conn) == mig.head_version()
    conn.close()


def test_in_memory_db_never_backed_up(monkeypatch):
    calls = []
    monkeypatch.setattr(bk, "create_backup", lambda *a, **k: calls.append(a))
    conn = sqlite3.connect(":memory:")
    assert bk.backup_before_migration(conn) is None
    assert calls == []


# ── staged restore ───────────────────────────────────────────────────

def _write(path, value: str) -> None:
    conn = get_connection(path)
    with conn:
        conn.execute("UPDATE t SET v = ?", (value,))
    conn.close()


def test_restore_round_trip(db, sidecar):
    dbcfg.save({"preference": "user"})
    snap = bk.create_backup(db, "manual")
    _write(db, "changed")
    assert bk.stage_restore(db, snap["name"]).name == snap["name"]
    assert bk.pending_restore_name(db) == snap["name"]
    # Leftover WAL sidecars from the live DB must not be replayed onto the restore.
    (db.parent / (db.name + "-wal")).write_bytes(b"garbage")
    (db.parent / (db.name + "-shm")).write_bytes(b"garbage")

    bk.execute_pending_restore()

    assert _rows(db) == ["original"]
    assert "pending_restore" not in dbcfg.load()
    assert dbcfg.load()["preference"] == "user"  # other sidecar fields kept
    reasons = sorted(e["reason"] for e in bk.list_backups(db))
    assert reasons == ["manual", "pre-restore"]
    pre = next(e for e in bk.list_backups(db) if e["reason"] == "pre-restore")
    assert _rows(bk.backups_dir(db) / pre["name"]) == ["changed"]


def test_stage_restore_unknown_name(db, sidecar):
    with pytest.raises(bk.BackupNotFound):
        bk.stage_restore(db, "wildcard-pipeline-20260101-000000-manual.db")
    with pytest.raises(bk.BackupNotFound):
        bk.stage_restore(db, "../wildcard-pipeline.db")
    assert "pending_restore" not in dbcfg.load()


def test_cancel_restore(db, sidecar):
    snap = bk.create_backup(db, "manual")
    bk.stage_restore(db, snap["name"])
    bk.cancel_restore()
    assert bk.pending_restore_name(db) is None
    bk.execute_pending_restore()  # nothing staged → no-op
    assert [e["reason"] for e in bk.list_backups(db)] == ["manual"]


def test_restore_of_vanished_backup_is_dropped(db, sidecar):
    snap = bk.create_backup(db, "manual")
    bk.stage_restore(db, snap["name"])
    bk.delete_backup(db, snap["name"])
    bk.execute_pending_restore()
    assert "pending_restore" not in dbcfg.load()
    assert _rows(db) == ["original"]


def test_restore_ignores_sidecar_pointing_outside_backups(db, sidecar, tmp_path):
    other = tmp_path / "wildcard-pipeline-20260101-000000-manual.db"
    other.write_bytes(b"not a db")
    dbcfg.set_pending_restore(other)
    bk.execute_pending_restore()
    assert _rows(db) == ["original"]
    assert "pending_restore" not in dbcfg.load()


def test_restore_never_raises(db, sidecar, monkeypatch):
    snap = bk.create_backup(db, "manual")
    bk.stage_restore(db, snap["name"])
    monkeypatch.setattr(bk, "resolve_db_path", lambda: (_ for _ in ()).throw(RuntimeError("x")))
    bk.execute_pending_restore()  # logged, not raised


def test_sidecar_round_trips_pending_restore(sidecar, tmp_path):
    dbcfg.save({"pending_move": {"from": "/a", "to": "/b", "mode": "copy"},
                "pending_restore": {"from": str(tmp_path / "x.db")}})
    cfg = dbcfg.load()
    assert cfg["pending_restore"] == {"from": str(tmp_path / "x.db")}
    dbcfg.clear_pending_move()
    assert "pending_restore" in dbcfg.load()
    dbcfg.clear_pending_restore()
    assert dbcfg.load() == {}


def test_sidecar_drops_malformed_pending_restore(sidecar):
    sidecar.write_text('{"pending_restore": {"from": 3}}', encoding="utf-8")
    assert dbcfg.load() == {}
