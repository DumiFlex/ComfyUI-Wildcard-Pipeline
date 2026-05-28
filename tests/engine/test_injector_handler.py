"""Tests for WP_ContextInjector node handler."""
import json

from wp_nodes.injector_node import WPContextInjector
from wp_nodes.types import ContextPayload


def _empty_rows() -> str:
    return json.dumps({"version": 1, "rows": []})


def test_empty_rows_forwards_upstream_ctx():
    upstream = ContextPayload(context={"existing": "value"}, debug={}, internals={})
    out = WPContextInjector.execute(wp_rows=_empty_rows(), upstream=upstream)
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
    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0="hello world")
    assert out.values[0].context["seed_phrase"] == "hello world"


def test_disabled_row_skipped():
    rows = json.dumps({
        "version": 1,
        "rows": [_row("input_0", "seed_phrase", enabled=False)],
    })
    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0="ignored")
    assert "seed_phrase" not in out.values[0].context


def test_empty_binding_row_skipped():
    rows = json.dumps({"version": 1, "rows": [_row("input_0", "")]})
    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0="ignored")
    assert out.values[0].context == {}


def test_disconnected_slot_skipped():
    rows = json.dumps({"version": 1, "rows": [_row("input_0", "seed_phrase")]})
    out = WPContextInjector.execute(wp_rows=rows, upstream=None)
    assert "seed_phrase" not in out.values[0].context


def test_non_primitive_value_stringified():
    rows = json.dumps({"version": 1, "rows": [_row("input_0", "obj")]})

    class Foo:
        def __repr__(self) -> str:
            return "<Foo instance>"

    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0=Foo())
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
        wp_rows=rows, upstream=None,
        input_0=42, input_1=7.5, input_2=True, input_3="text",
    )
    assert out.values[0].context["as_int"] == 42
    assert out.values[0].context["as_float"] == 7.5
    assert out.values[0].context["as_bool"] is True
    assert out.values[0].context["as_str"] == "text"


def test_invalid_binding_chars_skipped_with_warning():
    rows = json.dumps({"version": 1, "rows": [_row("input_0", "has spaces")]})
    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0="value")
    assert out.values[0].context == {}
    warnings = out.values[0].debug.get("__wp_warnings__", [])
    assert any(w.get("type") == "injector_invalid_binding" for w in warnings)


def test_reserved_binding_skipped_with_warning():
    rows = json.dumps({"version": 1, "rows": [_row("input_0", "_meta")]})
    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0="value")
    assert out.values[0].context == {}
    warnings = out.values[0].debug.get("__wp_warnings__", [])
    assert any(w.get("type") == "injector_reserved_binding" for w in warnings)


def test_valid_bindings_with_underscore_inside_pass():
    rows = json.dumps({"version": 1, "rows": [_row("input_0", "my_var")]})
    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0="ok")
    assert out.values[0].context["my_var"] == "ok"


def test_internal_flag_appends_to_internal_keys_set():
    rows = json.dumps({
        "version": 1,
        "rows": [_row("input_0", "cfg", internal=True)],
    })
    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0=7.5)
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
    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0=7.5, input_1="x")
    flags = out.values[0].internals.get("__wp_internal_flags__", {})
    assert flags.get("cfg") is True
    assert "shown" not in flags


def test_non_internal_row_does_not_pollute_internal_keys():
    rows = json.dumps({"version": 1, "rows": [_row("input_0", "public_var")]})
    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0="x")
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
    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0="x", input_1="y")
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
    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0="puppies")
    assert out.values[0].context["phrase"] == "i love puppies"


def test_socket_row_template_only_substitutes_own_slot():
    # Two-tier model: a SOCKET row's template may reference ONLY its own
    # socket. A `$input_0` ref from the row bound to input_1 is out of
    # scope and stays literal — rows resolve top-to-bottom, so an early
    # row must not read a later socket. (Use a GENERAL row to compose
    # across sockets.)
    rows = json.dumps({
        "version": 1,
        "rows": [
            _row("input_0", "raw_name"),
            _row_with_template("input_1", "greeting", "hello $input_0 / $input_1"),
        ],
    })
    out = WPContextInjector.execute(
        wp_rows=rows, upstream=None, input_0="Alice", input_1="Bob"
    )
    # Only $input_1 (own slot) resolved; $input_0 left literal.
    assert out.values[0].context["greeting"] == "hello $input_0 / Bob"


def test_template_unknown_ref_left_literal():
    rows = json.dumps({
        "version": 1,
        "rows": [_row_with_template("input_0", "phrase", "value=$missing")],
    })
    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0="x")
    assert out.values[0].context["phrase"] == "value=$missing"


def test_template_double_dollar_escapes_to_literal():
    rows = json.dumps({
        "version": 1,
        "rows": [_row_with_template("input_0", "phrase", "$$5.00 paid by $input_0")],
    })
    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0="Bob")
    assert out.values[0].context["phrase"] == "$5.00 paid by Bob"


def test_socket_row_template_renders_even_when_own_slot_unwired():
    # A socket row's template path does NOT require its own slot to be
    # wired — the row still renders. The own-slot ref resolves to empty
    # (`slot_values.get(slot_name, "")`) when unwired.
    rows = json.dumps({
        "version": 1,
        "rows": [_row_with_template("input_1", "shout", "[$input_1] IS HERE")],
    })
    out = WPContextInjector.execute(wp_rows=rows, upstream=None)
    assert out.values[0].context["shout"] == "[] IS HERE"


def test_template_empty_or_whitespace_falls_back_to_pass_through():
    rows = json.dumps({
        "version": 1,
        "rows": [
            _row_with_template("input_0", "a", ""),
            _row_with_template("input_1", "b", "   "),
        ],
    })
    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0="raw_a", input_1="raw_b")
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
    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0=True)
    assert out.values[0].context["flag"] == "is_on=True"
    out2 = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0=False)
    assert out2.values[0].context["flag"] == "is_on=False"


def test_template_trace_kind_marks_template_row():
    rows = json.dumps({
        "version": 1,
        "rows": [_row_with_template("input_0", "phrase", "hi $input_0")],
    })
    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0="x")
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
        wp_rows=rows, upstream=None, input_0="alpha", input_1=42,
    )
    trace = out.values[0].debug.get("__wp_trace__", [])
    by_binding = {t.get("binding"): t for t in trace}
    assert by_binding["a"]["value"] == "alpha"
    assert by_binding["b"]["value"] == "42 boom"


# ─── General-template rows (two-tier row model) ──────────────────────────────


def _general_row(
    binding: str, template: str | None, enabled: bool = True, internal: bool = False
) -> dict:
    return {
        "_uid": f"gen_{binding}",
        "kind": "general",
        "binding": binding,
        "template": template,
        "enabled": enabled,
        "internal": internal,
    }


def test_general_row_resolves_against_sockets_and_socket_row_bindings():
    # Socket row input_0 has a template bound to $test; a general row
    # composes from BOTH $test (a socket-row output) AND $input_0 (the
    # raw socket). This is the worked example from the spec.
    rows = json.dumps({
        "version": 1,
        "rows": [
            _row_with_template("input_0", "test", "i love $input_0"),
            _general_row("combo", "$test, also $input_0"),
        ],
    })
    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0="puppies")
    assert out.values[0].context["test"] == "i love puppies"
    assert out.values[0].context["combo"] == "i love puppies, also puppies"


def test_general_row_runs_after_all_socket_rows():
    # Even though the general row is listed FIRST in the array, it
    # resolves AFTER the socket rows so it can read their bindings.
    rows = json.dumps({
        "version": 1,
        "rows": [
            _general_row("combo", "$a + $b"),
            _row("input_0", "a"),
            _row("input_1", "b"),
        ],
    })
    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0="X", input_1="Y")
    assert out.values[0].context["combo"] == "X + Y"


def test_general_row_reads_earlier_general_row_binding():
    # General rows resolve in order, so a later general row can read an
    # earlier general row's binding.
    rows = json.dumps({
        "version": 1,
        "rows": [
            _row("input_0", "base"),
            _general_row("first", "$base!"),
            _general_row("second", "$first?"),
        ],
    })
    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0="hi")
    assert out.values[0].context["first"] == "hi!"
    assert out.values[0].context["second"] == "hi!?"


def test_general_row_survives_socket_disconnect_via_raw_ref():
    # A general row referencing a socket whose wire is gone resolves the
    # missing socket to empty (it's not in slot_values), but the row
    # still produces a value — durability of the general row.
    rows = json.dumps({
        "version": 1,
        "rows": [_general_row("note", "prefix=[$input_0]")],
    })
    out = WPContextInjector.execute(wp_rows=rows, upstream=None)
    # $input_0 not wired → out of scope → left literal.
    assert out.values[0].context["note"] == "prefix=[$input_0]"


def test_general_row_needs_binding_and_template():
    # A general row with no binding, or no template, writes nothing.
    rows = json.dumps({
        "version": 1,
        "rows": [
            _general_row("", "$input_0"),       # missing binding
            _general_row("only_binding", ""),     # missing template
            _general_row("only_binding2", None),  # null template
        ],
    })
    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0="x")
    assert out.values[0].context == {}


def test_general_row_honors_internal_flag():
    rows = json.dumps({
        "version": 1,
        "rows": [
            _row("input_0", "shown"),
            _general_row("secret", "$input_0-derived", internal=True),
        ],
    })
    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0="v")
    assert out.values[0].context["secret"] == "v-derived"
    flags = out.values[0].internals.get("__wp_internal_flags__", {})
    assert flags.get("secret") is True
    assert "shown" not in flags


def test_general_row_disabled_skipped():
    rows = json.dumps({
        "version": 1,
        "rows": [_general_row("nope", "$input_0", enabled=False)],
    })
    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0="x")
    assert "nope" not in out.values[0].context


def test_general_row_reserved_binding_warns():
    rows = json.dumps({
        "version": 1,
        "rows": [_general_row("_reserved", "$input_0")],
    })
    out = WPContextInjector.execute(wp_rows=rows, upstream=None, input_0="x")
    assert out.values[0].context == {}
    warnings = out.values[0].debug.get("__wp_warnings__", [])
    assert any(w.get("type") == "injector_reserved_binding" for w in warnings)


def test_general_row_does_not_leak_internal_ctx_keys_into_template_scope():
    # Internal bookkeeping keys (`__wp_*`) carried from upstream must NOT
    # be exposed as `$__wp_...` refs in a general row's merged scope.
    upstream = ContextPayload(
        context={"existing": "up", "__wp_internal_keys__": ["existing"]},
        debug={},
        internals={},
    )
    rows = json.dumps({
        "version": 1,
        "rows": [_general_row("combo", "$existing")],
    })
    out = WPContextInjector.execute(wp_rows=rows, upstream=upstream, input_0="x")
    assert out.values[0].context["combo"] == "up"
