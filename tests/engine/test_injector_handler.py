"""Tests for WP_ContextInjector node handler."""
import json

from wp_nodes.injector_node import WPContextInjector
from wp_nodes.types import ContextPayload


def _empty_rows() -> str:
    return json.dumps({"version": 1, "rows": []})


def test_empty_rows_forwards_upstream_ctx():
    upstream = ContextPayload(context={"existing": "value"}, debug={}, internals={})
    out = WPContextInjector.execute(rows=_empty_rows(), upstream=upstream)
    assert out.values[0].context == {"existing": "value"}


def _row(slot_name: str, binding: str, enabled: bool = True, internal: bool = False) -> dict:
    return {
        "_uid": f"uid_{slot_name}",
        "slot_name": slot_name,
        "binding": binding,
        "enabled": enabled,
        "internal": internal,
    }


def test_enabled_named_connected_row_writes_to_ctx():
    rows = json.dumps({"version": 1, "rows": [_row("input_0", "seed_phrase")]})
    out = WPContextInjector.execute(rows=rows, upstream=None, input_0="hello world")
    assert out.values[0].context["seed_phrase"] == "hello world"


def test_disabled_row_skipped():
    rows = json.dumps({
        "version": 1,
        "rows": [_row("input_0", "seed_phrase", enabled=False)],
    })
    out = WPContextInjector.execute(rows=rows, upstream=None, input_0="ignored")
    assert "seed_phrase" not in out.values[0].context


def test_empty_binding_row_skipped():
    rows = json.dumps({"version": 1, "rows": [_row("input_0", "")]})
    out = WPContextInjector.execute(rows=rows, upstream=None, input_0="ignored")
    assert out.values[0].context == {}


def test_disconnected_slot_skipped():
    rows = json.dumps({"version": 1, "rows": [_row("input_0", "seed_phrase")]})
    out = WPContextInjector.execute(rows=rows, upstream=None)
    assert "seed_phrase" not in out.values[0].context


def test_non_primitive_value_stringified():
    rows = json.dumps({"version": 1, "rows": [_row("input_0", "obj")]})

    class Foo:
        def __repr__(self) -> str:
            return "<Foo instance>"

    out = WPContextInjector.execute(rows=rows, upstream=None, input_0=Foo())
    assert out.values[0].context["obj"] == "<Foo instance>"


def test_primitives_pass_through_unchanged():
    rows = json.dumps({
        "version": 1,
        "rows": [
            _row("input_0", "as_int"),
            _row("input_1", "as_float"),
            _row("input_2", "as_bool"),
            _row("input_3", "as_str"),
        ],
    })
    out = WPContextInjector.execute(
        rows=rows, upstream=None,
        input_0=42, input_1=7.5, input_2=True, input_3="text",
    )
    assert out.values[0].context["as_int"] == 42
    assert out.values[0].context["as_float"] == 7.5
    assert out.values[0].context["as_bool"] is True
    assert out.values[0].context["as_str"] == "text"


def test_invalid_binding_chars_skipped_with_warning():
    rows = json.dumps({"version": 1, "rows": [_row("input_0", "has spaces")]})
    out = WPContextInjector.execute(rows=rows, upstream=None, input_0="value")
    assert out.values[0].context == {}
    warnings = out.values[0].debug.get("__wp_warnings__", [])
    assert any(w.get("type") == "injector_invalid_binding" for w in warnings)


def test_reserved_binding_skipped_with_warning():
    rows = json.dumps({"version": 1, "rows": [_row("input_0", "_meta")]})
    out = WPContextInjector.execute(rows=rows, upstream=None, input_0="value")
    assert out.values[0].context == {}
    warnings = out.values[0].debug.get("__wp_warnings__", [])
    assert any(w.get("type") == "injector_reserved_binding" for w in warnings)


def test_valid_bindings_with_underscore_inside_pass():
    rows = json.dumps({"version": 1, "rows": [_row("input_0", "my_var")]})
    out = WPContextInjector.execute(rows=rows, upstream=None, input_0="ok")
    assert out.values[0].context["my_var"] == "ok"
