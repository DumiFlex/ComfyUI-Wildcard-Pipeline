"""Tests for snapshot.py — payload hash, freeze, legacy coercion."""
from engine.modules.snapshot import (
    coerce_legacy_module,
    freeze_snapshot,
    payload_hash,
)


def test_payload_hash_is_stable_across_key_order():
    a = {"x": 1, "y": [1, 2]}
    b = {"y": [1, 2], "x": 1}
    assert payload_hash(a) == payload_hash(b)


def test_payload_hash_changes_with_value():
    a = {"x": 1}
    b = {"x": 2}
    assert payload_hash(a) != payload_hash(b)


def test_payload_hash_returns_64_char_hex_string():
    h = payload_hash({"x": 1})
    assert isinstance(h, str)
    assert len(h) == 64
    int(h, 16)  # raises ValueError if not hex


def test_payload_hash_handles_non_ascii():
    a = {"name": "café"}
    h = payload_hash(a)
    assert len(h) == 64


def test_freeze_snapshot_includes_required_fields():
    library_row = {
        "id": "wc_colors_a3f2",
        "type": "wildcard",
        "name": "colors",
        "category_id": "style",
        "version": 7,
        "payload": {"options": []},
    }
    snap = freeze_snapshot(library_row)
    assert snap["library_id"] == "wc_colors_a3f2"
    assert snap["library_version_at_snapshot"] == 7
    assert snap["library_snapshot_at"]
    assert snap["library_snapshot_at"].endswith("Z")
    assert "." in snap["library_snapshot_at"]  # ms-precision
    assert snap["type"] == "wildcard"
    assert snap["name"] == "colors"
    assert snap["category_id"] == "style"
    assert snap["payload"] == {"options": []}
    assert snap["instance"] == {
        "variable_binding": "",
        "enabled_options": None,
        "category_filter": None,
    }


def test_freeze_snapshot_each_call_yields_fresh_instance_dict():
    library_row = {
        "id": "x", "type": "wildcard", "name": "n",
        "category_id": None, "version": 1, "payload": {},
    }
    a = freeze_snapshot(library_row)
    b = freeze_snapshot(library_row)
    a["instance"]["variable_binding"] = "$mutated"
    assert b["instance"]["variable_binding"] == ""


def test_freeze_snapshot_handles_missing_category_id():
    library_row = {
        "id": "x", "type": "wildcard", "name": "n",
        "version": 1, "payload": {},
    }
    snap = freeze_snapshot(library_row)
    assert snap["category_id"] is None


def test_coerce_legacy_module_fills_missing_fields_for_fixed_values():
    legacy = {
        "id": "fv_x",
        "type": "fixed_values",
        "entries": [
            {"variable_name": "lens", "value": "85mm"},
            {"variable_name": "angle", "value": "wide"},
        ],
    }
    coerced = coerce_legacy_module(legacy)
    assert coerced["library_id"] is None
    assert coerced["library_snapshot_at"] is None
    assert coerced["library_version_at_snapshot"] is None
    assert coerced["type"] == "fixed_values"
    assert coerced["payload"]["values"][0] == {
        "id": "val_0000", "name": "lens", "value": "85mm",
    }
    assert coerced["payload"]["values"][1] == {
        "id": "val_0001", "name": "angle", "value": "wide",
    }
    assert coerced["instance"]["variable_binding"] == ""


def test_coerce_legacy_module_passes_through_already_coerced():
    already = {
        "library_id": "fv_x",
        "library_snapshot_at": "2026-04-26T00:00:00Z",
        "library_version_at_snapshot": 1,
        "type": "fixed_values",
        "name": "lens",
        "category_id": None,
        "payload": {"values": []},
        "instance": {
            "variable_binding": "$lens",
            "enabled_options": None,
            "category_filter": None,
        },
    }
    coerced = coerce_legacy_module(already)
    assert coerced == already


def test_coerce_legacy_module_uses_meta_name_when_present():
    legacy = {
        "id": "fv_x",
        "type": "fixed_values",
        "meta": {"name": "from-meta"},
        "entries": [],
    }
    coerced = coerce_legacy_module(legacy)
    assert coerced["name"] == "from-meta"


def test_coerce_legacy_module_prefers_top_level_name_over_meta():
    legacy = {
        "id": "x",
        "type": "fixed_values",
        "name": "top-level",
        "meta": {"name": "from-meta"},
        "entries": [],
    }
    coerced = coerce_legacy_module(legacy)
    assert coerced["name"] == "top-level"


def test_coerce_legacy_module_non_fixed_values_uses_payload():
    raw = {
        "id": "wc_x",
        "type": "wildcard",
        "name": "x",
        "payload": {"options": [{"id": "o1", "value": "red", "weight": 1}]},
    }
    coerced = coerce_legacy_module(raw)
    assert coerced["type"] == "wildcard"
    assert coerced["payload"] == {"options": [{"id": "o1", "value": "red", "weight": 1}]}
