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


def test_internal_flag_appends_to_internal_keys_set():
    rows = json.dumps({
        "version": 1,
        "rows": [_row("input_0", "cfg", internal=True)],
    })
    out = WPContextInjector.execute(rows=rows, upstream=None, input_0=7.5)
    assert out.values[0].context["cfg"] == 7.5
    keys = out.values[0].context.get("__wp_internal_keys__", [])
    assert "cfg" in keys


def test_internal_flag_rides_internal_flags_for_assembler():
    # The PromptAssembler strips on `internals["__wp_internal_flags__"]`, so an
    # internal injector row must populate it (not just `__wp_internal_keys__`)
    # or the var leaks into the rendered prompt.
    rows = json.dumps({
        "version": 1,
        "rows": [_row("input_0", "cfg", internal=True), _row("input_1", "shown")],
    })
    out = WPContextInjector.execute(rows=rows, upstream=None, input_0=7.5, input_1="x")
    flags = out.values[0].internals.get("__wp_internal_flags__", {})
    assert flags.get("cfg") is True
    assert "shown" not in flags


def test_non_internal_row_does_not_pollute_internal_keys():
    rows = json.dumps({"version": 1, "rows": [_row("input_0", "public_var")]})
    out = WPContextInjector.execute(rows=rows, upstream=None, input_0="x")
    keys = out.values[0].context.get("__wp_internal_keys__", [])
    assert "public_var" not in keys


def test_each_written_row_emits_trace_entry():
    rows = json.dumps({
        "version": 1,
        "rows": [
            _row("input_0", "a"),
            _row("input_1", "b", internal=True),
        ],
    })
    out = WPContextInjector.execute(rows=rows, upstream=None, input_0="x", input_1="y")
    trace = out.values[0].debug.get("__wp_trace__", [])
    inj = [t for t in trace if t.get("node") == "WP_ContextInjector"]
    assert len(inj) == 2
    bindings = sorted(t.get("binding") for t in inj)
    assert bindings == ["a", "b"]
    assert any(t.get("internal") is True for t in inj)


# ─── Phase 6: per-row template substitution ──────────────────────────────────


def _row_with_template(slot_name: str, binding: str, template: str | None) -> dict:
    return {
        "_uid": f"uid_{slot_name}",
        "slot_name": slot_name,
        "binding": binding,
        "enabled": True,
        "internal": False,
        "template": template,
    }


def test_template_substitutes_self_slot_value():
    rows = json.dumps({
        "version": 1,
        "rows": [_row_with_template("input_0", "phrase", "i love $input_0")],
    })
    out = WPContextInjector.execute(rows=rows, upstream=None, input_0="puppies")
    assert out.values[0].context["phrase"] == "i love puppies"


def test_template_substitutes_cross_slot_value():
    rows = json.dumps({
        "version": 1,
        "rows": [
            _row("input_0", "raw_name"),
            _row_with_template("input_1", "greeting", "hello $input_0!"),
        ],
    })
    out = WPContextInjector.execute(
        rows=rows, upstream=None, input_0="Alice", input_1="ignored"
    )
    assert out.values[0].context["greeting"] == "hello Alice!"


def test_template_unknown_ref_left_literal():
    rows = json.dumps({
        "version": 1,
        "rows": [_row_with_template("input_0", "phrase", "value=$missing")],
    })
    out = WPContextInjector.execute(rows=rows, upstream=None, input_0="x")
    assert out.values[0].context["phrase"] == "value=$missing"


def test_template_double_dollar_escapes_to_literal():
    rows = json.dumps({
        "version": 1,
        "rows": [_row_with_template("input_0", "phrase", "$$5.00 paid by $input_0")],
    })
    out = WPContextInjector.execute(rows=rows, upstream=None, input_0="Bob")
    assert out.values[0].context["phrase"] == "$5.00 paid by Bob"


def test_template_with_unwired_self_slot_still_renders_when_template_uses_others():
    # Self-slot disconnected, but template only references another wired
    # slot. Engine should NOT skip the row — template path bypasses the
    # "self slot must be wired" gate the pass-through path enforces.
    rows = json.dumps({
        "version": 1,
        "rows": [
            _row("input_0", "name"),
            _row_with_template("input_1", "shout", "$input_0 IS HERE"),
        ],
    })
    out = WPContextInjector.execute(rows=rows, upstream=None, input_0="Eve")
    assert out.values[0].context["shout"] == "Eve IS HERE"


def test_template_empty_or_whitespace_falls_back_to_pass_through():
    rows = json.dumps({
        "version": 1,
        "rows": [
            _row_with_template("input_0", "a", ""),
            _row_with_template("input_1", "b", "   "),
        ],
    })
    out = WPContextInjector.execute(rows=rows, upstream=None, input_0="raw_a", input_1="raw_b")
    assert out.values[0].context["a"] == "raw_a"
    assert out.values[0].context["b"] == "raw_b"


def test_template_boolean_substitution_matches_python_str():
    # Booleans render as Python's str(bool) -> "True"/"False" so the
    # template path's output agrees with the pass-through path's
    # downstream stringification semantics. Consistent casing avoids
    # the "i love False" / "i love false" disparity when a row toggles
    # between template + pass-through.
    rows = json.dumps({
        "version": 1,
        "rows": [_row_with_template("input_0", "flag", "is_on=$input_0")],
    })
    out = WPContextInjector.execute(rows=rows, upstream=None, input_0=True)
    assert out.values[0].context["flag"] == "is_on=True"
    out2 = WPContextInjector.execute(rows=rows, upstream=None, input_0=False)
    assert out2.values[0].context["flag"] == "is_on=False"


def test_template_trace_kind_marks_template_row():
    rows = json.dumps({
        "version": 1,
        "rows": [_row_with_template("input_0", "phrase", "hi $input_0")],
    })
    out = WPContextInjector.execute(rows=rows, upstream=None, input_0="x")
    trace = out.values[0].debug.get("__wp_trace__", [])
    template_traces = [t for t in trace if t.get("binding") == "phrase"]
    assert template_traces
    assert template_traces[0]["type"] == "str(template)"


def test_trace_carries_written_value_for_debug_viewer():
    # Debug's trace tab needs the written value alongside the binding
    # so the value column isn't blank for injector rows. Engine
    # modules use `writes: [{value}]` for the same purpose; injector
    # emits a flat top-level `value` (one write per row).
    rows = json.dumps({
        "version": 1,
        "rows": [
            _row("input_0", "a"),
            _row_with_template("input_1", "b", "$input_1 boom"),
        ],
    })
    out = WPContextInjector.execute(
        rows=rows, upstream=None, input_0="alpha", input_1=42,
    )
    trace = out.values[0].debug.get("__wp_trace__", [])
    by_binding = {t.get("binding"): t for t in trace}
    assert by_binding["a"]["value"] == "alpha"
    assert by_binding["b"]["value"] == "42 boom"
