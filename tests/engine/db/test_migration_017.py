"""Migration 017 — checksums, and the guard they enable.

The bug being fixed: ``migrate()`` skips every migration ``<= MAX(version)``,
so an integer was the entire identity of a schema. A database migrated by
another build was either silently skipped past (it is "ahead") or silently
accepted (same number, different shape). Both let code read and then write a
schema it does not actually understand.
"""
import sqlite3

import pytest

from engine.db.connection import get_connection
from engine.db.migrations import (
    SchemaAheadError,
    _discover,
    assert_schema_compatible,
    current_version,
    head_version,
    migrate,
)


def test_checksum_column_exists_after_migrate(tmp_path):
    conn = get_connection(tmp_path / "c.db")
    migrate(conn)
    cols = {row[1] for row in conn.execute("PRAGMA table_info(migrations);").fetchall()}
    assert "checksum" in cols
    conn.close()


def test_rerunning_migrate_is_a_noop(tmp_path):
    """The guard runs on every migrate(); a healthy DB must sail through it."""
    db = tmp_path / "idem.db"
    conn = get_connection(db)
    migrate(conn)
    first = current_version(conn)
    migrate(conn)
    assert current_version(conn) == first
    rows = conn.execute("SELECT COUNT(*) FROM migrations;").fetchone()[0]
    assert rows == first
    conn.close()


def test_migration_017_records_its_own_checksum(tmp_path):
    """017 adds the column inside its own transaction, so its row can carry one.

    Everything before it cannot — the column does not exist yet — which is why
    the guard treats NULL as "unknown" rather than "mismatched".
    """
    conn = get_connection(tmp_path / "own.db")
    migrate(conn)
    row = conn.execute("SELECT checksum FROM migrations WHERE version = 17;").fetchone()
    assert row is not None
    assert isinstance(row[0], str) and len(row[0]) == 64
    conn.close()


def test_pre_017_migrations_have_null_checksum(tmp_path):
    conn = get_connection(tmp_path / "null.db")
    migrate(conn)
    nulls = conn.execute(
        "SELECT COUNT(*) FROM migrations WHERE version < 17 AND checksum IS NULL;"
    ).fetchone()[0]
    assert nulls == 16
    conn.close()


def test_database_ahead_of_this_build_is_refused(tmp_path):
    """A DB migrated by a newer build must not be read as if it were ours."""
    db = tmp_path / "ahead.db"
    conn = get_connection(db)
    migrate(conn)
    # A future build applied something this one has never heard of.
    with conn:
        conn.execute(
            "INSERT INTO migrations(version, applied_at) VALUES(?, ?);",
            (head_version() + 1, "2026-08-09T00:00:00Z"),
        )
    with pytest.raises(SchemaAheadError) as exc:
        assert_schema_compatible(conn)
    assert "newer version" in str(exc.value)
    conn.close()


def test_migrate_refuses_an_ahead_database(tmp_path):
    """The guard is inside migrate(), so no caller can forget it."""
    conn = get_connection(tmp_path / "ahead2.db")
    migrate(conn)
    with conn:
        conn.execute(
            "INSERT INTO migrations(version, applied_at) VALUES(?, ?);",
            (head_version() + 5, "2026-08-09T00:00:00Z"),
        )
    with pytest.raises(SchemaAheadError):
        migrate(conn)
    conn.close()


def test_same_version_different_shape_is_refused(tmp_path):
    """The case an integer version cannot catch.

    A migration is reworked after it has already run somewhere — a pre-release
    that got revised before shipping, a hand-edited file, an abandoned branch.
    The version still matches, so before checksums nothing compared anything.
    """
    conn = get_connection(tmp_path / "diverged.db")
    migrate(conn)
    with conn:
        conn.execute(
            "UPDATE migrations SET checksum = ? WHERE version = 17;",
            ("0" * 64,),
        )
    with pytest.raises(SchemaAheadError) as exc:
        assert_schema_compatible(conn)
    assert "017" in str(exc.value)
    conn.close()


def test_null_checksums_are_not_treated_as_mismatched(tmp_path):
    """NULL means "we never recorded one", which is not evidence of divergence.

    Every database that existed before 017 is in this state for versions 1-16;
    treating unknown as bad would lock every existing user out of their library.
    """
    conn = get_connection(tmp_path / "unknown.db")
    migrate(conn)
    with conn:
        conn.execute("UPDATE migrations SET checksum = NULL;")
    assert_schema_compatible(conn)  # must not raise
    conn.close()


def test_guard_is_silent_on_a_database_with_no_migrations_table(tmp_path):
    """A fresh file has nothing to be incompatible with."""
    conn = sqlite3.connect(tmp_path / "empty.db")
    assert_schema_compatible(conn)  # must not raise
    conn.close()


def test_every_shipped_migration_hashes_distinctly():
    """Guards the guard: identical files would make divergence undetectable."""
    from engine.db.migrations import _checksum

    sums = [_checksum(path) for _, path in _discover()]
    assert len(set(sums)) == len(sums)
