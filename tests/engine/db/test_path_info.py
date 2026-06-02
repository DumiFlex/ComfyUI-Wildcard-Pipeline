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
    monkeypatch.setattr("engine.db.connection._load_sidecar", lambda: {})
    path, source = resolve_db_path_with_source()
    # Source is now "global" — the design folds the old "legacy" label into
    # "global" because both resolve to ~/.comfyui/wildcard-pipeline.db and
    # the new UI exposes a "Global" preference.
    assert source == "global"
    assert path.name == "wildcard-pipeline.db"
    assert ".comfyui" in str(path)


def test_comfyui_user_dir_resolved(monkeypatch, tmp_path):
    monkeypatch.delenv("WP_DB_PATH", raising=False)
    monkeypatch.delenv("COMFYUI_USER_DIR", raising=False)
    user_dir = tmp_path / "user"
    user_dir.mkdir()
    monkeypatch.setattr("engine.db.connection._comfyui_user_dir_from_api", lambda: user_dir)
    monkeypatch.setattr("engine.db.connection._comfyui_user_dir_from_path", lambda: None)
    monkeypatch.setattr("engine.db.connection._load_sidecar", lambda: {})
    path, source = resolve_db_path_with_source()
    assert path == user_dir / "wildcard-pipeline.db"
    # Source is now "user" — the design renames the old "comfyui_user_dir"
    # label to "user" so it matches the UI radio button.
    assert source == "user"


def test_sidecar_user_preference(monkeypatch, tmp_path):
    monkeypatch.delenv("WP_DB_PATH", raising=False)
    monkeypatch.delenv("COMFYUI_USER_DIR", raising=False)
    user_dir = tmp_path / "user"
    user_dir.mkdir()
    monkeypatch.setattr("engine.db.connection._comfyui_user_dir_from_api", lambda: user_dir)
    monkeypatch.setattr("engine.db.connection._comfyui_user_dir_from_path", lambda: None)
    # Stub the sidecar loader so the test doesn't touch the real file.
    monkeypatch.setattr("engine.db.connection._load_sidecar", lambda: {"preference": "user"})
    path, source = resolve_db_path_with_source()
    assert source == "user"
    assert path == user_dir / "wildcard-pipeline.db"


def test_sidecar_global_preference(monkeypatch):
    monkeypatch.delenv("WP_DB_PATH", raising=False)
    monkeypatch.delenv("COMFYUI_USER_DIR", raising=False)
    monkeypatch.setattr("engine.db.connection._load_sidecar", lambda: {"preference": "global"})
    path, source = resolve_db_path_with_source()
    assert source == "global"
    assert ".comfyui" in str(path)


def test_sidecar_root_preference(monkeypatch):
    monkeypatch.delenv("WP_DB_PATH", raising=False)
    monkeypatch.delenv("COMFYUI_USER_DIR", raising=False)
    monkeypatch.setattr("engine.db.connection._load_sidecar", lambda: {"preference": "root"})
    path, source = resolve_db_path_with_source()
    assert source == "root"
    assert path.name == "wildcard-pipeline.db"
    assert path.parent.name == "db"


def test_env_wins_over_sidecar(monkeypatch, tmp_path):
    monkeypatch.setenv("WP_DB_PATH", str(tmp_path / "x.db"))
    monkeypatch.setattr("engine.db.connection._load_sidecar", lambda: {"preference": "global"})
    path, source = resolve_db_path_with_source()
    assert source == "WP_DB_PATH"
