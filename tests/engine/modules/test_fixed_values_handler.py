"""Tests for FixedValuesHandler — emits one mapping per named value."""
from engine.modules.fixed_values_handler import FixedValuesHandler


def _payload(values):
    return {"values": values}


def test_resolve_returns_all_values():
    payload = _payload([
        {"id": "v1", "name": "$lens", "value": "85mm"},
        {"id": "v2", "name": "$angle", "value": "wide"},
    ])
    out = FixedValuesHandler.resolve(payload, instance={}, ctx=None)
    assert out == {"$lens": "85mm", "$angle": "wide"}


def test_resolve_empty_values_returns_empty_dict():
    out = FixedValuesHandler.resolve(_payload([]), instance={}, ctx=None)
    assert out == {}


def test_resolve_filters_by_enabled_options():
    payload = _payload([
        {"id": "v1", "name": "$a", "value": "1"},
        {"id": "v2", "name": "$b", "value": "2"},
    ])
    out = FixedValuesHandler.resolve(
        payload, instance={"enabled_options": ["v2"]}, ctx=None,
    )
    assert out == {"$b": "2"}


def test_resolve_skips_blank_names():
    payload = _payload([
        {"id": "v1", "name": "", "value": "x"},
        {"id": "v2", "name": "   ", "value": "y"},
        {"id": "v3", "name": "$ok", "value": "z"},
    ])
    out = FixedValuesHandler.resolve(payload, instance={}, ctx=None)
    assert out == {"$ok": "z"}


def test_resolve_handles_missing_value_key():
    """A value without 'value' resolves to empty string."""
    payload = _payload([{"id": "v1", "name": "$x"}])
    out = FixedValuesHandler.resolve(payload, instance={}, ctx=None)
    assert out == {"$x": ""}


def test_resolve_coerces_value_to_string():
    payload = _payload([{"id": "v1", "name": "$n", "value": 42}])
    out = FixedValuesHandler.resolve(payload, instance={}, ctx=None)
    assert out == {"$n": "42"}


def test_handler_type_id_is_fixed_values():
    assert FixedValuesHandler.type_id == "fixed_values"


def test_resolve_via_dispatcher_after_import():
    """Importing engine.modules auto-registers FixedValuesHandler."""
    from engine.modules import resolve_module
    snap = {
        "type": "fixed_values",
        "payload": _payload([{"id": "v1", "name": "$lens", "value": "85mm"}]),
        "instance": {},
    }
    out = resolve_module(snap, ctx=None)
    assert out == {"$lens": "85mm"}
