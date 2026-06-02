"""Tests for resolve_db_path_with_source — the source-aware resolver."""
from __future__ import annotations

from engine.db.connection import resolve_db_path_with_source


def test_env_override_returns_source_wp_db_path(monkeypatch, tmp_path):
    target = tmp_path / "custom.db"
    monkeypatch.setenv("WP_DB_PATH", str(target))
    monkeypatch.delenv("COMFYUI_USER_DIR", raising=False)
    path, source = resolve_db_path_with_source()
    assert path == target
    assert source == "WP_DB_PATH"


def test_comfyui_user_dir_env(monkeypatch, tmp_path):
    monkeypatch.delenv("WP_DB_PATH", raising=False)
    monkeypatch.setenv("COMFYUI_USER_DIR", str(tmp_path))
    path, source = resolve_db_path_with_source()
    assert path == tmp_path / "wildcard-pipeline.db"
    assert source == "COMFYUI_USER_DIR"


def test_legacy_fallback_when_no_comfyui_detected(monkeypatch, tmp_path):
    monkeypatch.delenv("WP_DB_PATH", raising=False)
    monkeypatch.delenv("COMFYUI_USER_DIR", raising=False)
    # Force both detectors to return None
    monkeypatch.setattr("engine.db.connection._comfyui_user_dir_from_api", lambda: None)
    monkeypatch.setattr("engine.db.connection._comfyui_user_dir_from_path", lambda: None)
    path, source = resolve_db_path_with_source()
    assert source == "legacy"
    assert path.name == "wildcard-pipeline.db"
    assert ".comfyui" in str(path)


def test_comfyui_user_dir_resolved(monkeypatch, tmp_path):
    monkeypatch.delenv("WP_DB_PATH", raising=False)
    monkeypatch.delenv("COMFYUI_USER_DIR", raising=False)
    user_dir = tmp_path / "user"
    user_dir.mkdir()
    monkeypatch.setattr("engine.db.connection._comfyui_user_dir_from_api", lambda: user_dir)
    monkeypatch.setattr("engine.db.connection._comfyui_user_dir_from_path", lambda: None)
    # Pin the legacy path at a non-existent file so the back-compat
    # shortcut stays inert regardless of what sits in $HOME/.comfyui
    # on the machine running the tests.
    monkeypatch.setattr(
        "engine.db.connection._legacy_home_path",
        lambda: tmp_path / "nonexistent-legacy.db",
    )
    path, source = resolve_db_path_with_source()
    assert path == user_dir / "wildcard-pipeline.db"
    assert source == "comfyui_user_dir"


def test_legacy_preferred_when_only_legacy_db_exists(monkeypatch, tmp_path):
    """If detected ComfyUI user dir has no DB but the legacy file does,
    the resolver must return the legacy path (back-compat) and report
    its source as 'legacy'."""
    monkeypatch.delenv("WP_DB_PATH", raising=False)
    monkeypatch.delenv("COMFYUI_USER_DIR", raising=False)
    user_dir = tmp_path / "user"
    user_dir.mkdir()
    legacy = tmp_path / "fake_home" / ".comfyui" / "wildcard-pipeline.db"
    legacy.parent.mkdir(parents=True)
    legacy.touch()
    monkeypatch.setattr("engine.db.connection._comfyui_user_dir_from_api", lambda: user_dir)
    monkeypatch.setattr("engine.db.connection._comfyui_user_dir_from_path", lambda: None)
    monkeypatch.setattr("engine.db.connection._legacy_home_path", lambda: legacy)
    path, source = resolve_db_path_with_source()
    assert path == legacy
    assert source == "legacy"
