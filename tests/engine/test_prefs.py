"""engine/prefs.py — server-side settings file + the run-time ref depth limit."""
from __future__ import annotations

import json
import os

import pytest

from engine import prefs
from engine.pipeline import PipelineEngine


@pytest.fixture
def settings_file(tmp_path, monkeypatch):
    p = tmp_path / "settings.json"
    monkeypatch.setenv("WP_SETTINGS_PATH", str(p))
    return p


def test_defaults_when_file_missing(settings_file):
    assert not settings_file.exists()
    assert prefs.load() == prefs.DEFAULTS
    assert prefs.max_ref_depth() == 8


def test_corrupt_file_falls_back_to_defaults(settings_file):
    settings_file.write_text("{not json", encoding="utf-8")
    assert prefs.load() == prefs.DEFAULTS


def test_invalid_values_replaced_and_out_of_range_clamped(settings_file):
    settings_file.write_text(json.dumps({
        "max_ref_depth": 99,
        "backups": {"enabled": "yes", "keep": 0, "daily": False},
        "junk": 1,
    }), encoding="utf-8")
    assert prefs.load() == {
        "max_ref_depth": 32,
        "backups": {"enabled": True, "keep": 1, "daily": False},
    }


@pytest.mark.parametrize("bad", [True, "8", 2.5, None, [3]])
def test_non_int_depth_uses_default(settings_file, bad):
    settings_file.write_text(json.dumps({"max_ref_depth": bad}), encoding="utf-8")
    assert prefs.max_ref_depth() == 8


def test_update_deep_merges_and_persists(settings_file):
    out = prefs.update({"backups": {"keep": 3}})
    assert out["backups"] == {"enabled": True, "keep": 3, "daily": True}
    out = prefs.update({"max_ref_depth": 4, "backups": {"daily": False}})
    assert out == {
        "max_ref_depth": 4,
        "backups": {"enabled": True, "keep": 3, "daily": False},
    }
    assert json.loads(settings_file.read_text(encoding="utf-8")) == out
    assert prefs.load() == out


def test_update_drops_unknown_keys(settings_file):
    prefs.update({"evil": "x", "max_ref_depth": 0})
    on_disk = json.loads(settings_file.read_text(encoding="utf-8"))
    assert "evil" not in on_disk
    assert on_disk["max_ref_depth"] == 1


def test_update_rejects_non_dict(settings_file):
    with pytest.raises(TypeError):
        prefs.update([1])  # type: ignore[arg-type]


def test_external_edit_picked_up_via_mtime(settings_file):
    prefs.update({"max_ref_depth": 5})
    assert prefs.max_ref_depth() == 5
    settings_file.write_text(json.dumps({"max_ref_depth": 6}), encoding="utf-8")
    st = settings_file.stat()
    os.utime(settings_file, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000_000))
    assert prefs.max_ref_depth() == 6


def test_load_returns_a_copy(settings_file):
    prefs.load()["backups"]["keep"] = 99
    assert prefs.load()["backups"]["keep"] == 7


def test_path_falls_back_to_plugin_root_without_user_dir(monkeypatch):
    monkeypatch.delenv("WP_SETTINGS_PATH", raising=False)
    monkeypatch.setattr("engine.db.connection.wp_data_dir", lambda: None)
    from engine.db.config import plugin_root

    assert prefs.settings_path() == plugin_root() / "wp-settings.json"


def test_path_uses_wp_data_dir(tmp_path, monkeypatch):
    monkeypatch.delenv("WP_SETTINGS_PATH", raising=False)
    monkeypatch.setattr("engine.db.connection.wp_data_dir", lambda: tmp_path / "wpd")
    assert prefs.settings_path() == tmp_path / "wpd" / "settings.json"


# ── run-time recursion limit ─────────────────────────────────────────

def _chain_catalog(length: int) -> dict:
    """`c0000001 → c0000002 → … → leaf`, ``length`` refs deep (ids are hex,
    as the `@{uuid}` grammar requires)."""
    catalog = {}
    for i in range(1, length + 1):
        value = f"@{{c{i + 1:07d}}}" if i < length else "leaf"
        catalog[f"c{i:07d}"] = {
            "type": "wildcard",
            "var_binding": f"v{i}",
            "options": [{"id": f"o{i}", "value": value, "weight": 1}],
        }
    return catalog


def _run_chain(length: int, ctx: dict | None = None) -> dict:
    module = {
        "id": "a0000000",
        "_uid": "a0000000",
        "type": "wildcard",
        "enabled": True,
        "name": "top",
        "payload": {"var_binding": "top",
                    "options": [{"id": "t", "value": "@{c0000001}", "weight": 1}]},
        "instance": {},
    }
    ctx = dict(ctx or {})
    ctx["__wp_catalog__"] = _chain_catalog(length)
    return PipelineEngine().run([module], ctx=ctx, seed=0)


def _depth_warnings(ctx: dict) -> list[dict]:
    return [w for w in ctx["__wp_warnings__"] if w.get("type") == "recursion_limit"]


def test_run_stamps_configured_depth(settings_file):
    prefs.update({"max_ref_depth": 3})
    ctx = PipelineEngine().run([], seed=0)
    assert ctx["__wp_max_ref_depth__"] == 3


def test_default_depth_resolves_a_three_deep_chain(settings_file):
    ctx = _run_chain(3)
    assert ctx["__wp_max_ref_depth__"] == 8
    assert ctx["top"] == "leaf"
    assert _depth_warnings(ctx) == []


def test_configured_depth_limit_warns_at_runtime(settings_file):
    prefs.update({"max_ref_depth": 2})
    ctx = _run_chain(3)
    assert ctx["top"] == ""
    warnings = _depth_warnings(ctx)
    assert warnings, ctx["__wp_warnings__"]
    assert warnings[0]["detail"]["limit"] == 2
    assert "depth 2" in warnings[0]["message"]


def test_caller_pinned_depth_wins_over_settings(settings_file):
    prefs.update({"max_ref_depth": 2})
    ctx = _run_chain(3, {"__wp_max_ref_depth__": 8})
    assert ctx["top"] == "leaf"


def test_depth_key_is_engine_internal(settings_file):
    from engine.context import strip_engine_internals, strip_internals

    ctx = PipelineEngine().run([], seed=0)
    assert "__wp_max_ref_depth__" not in strip_internals(ctx)
    assert "__wp_max_ref_depth__" not in strip_engine_internals(ctx)
