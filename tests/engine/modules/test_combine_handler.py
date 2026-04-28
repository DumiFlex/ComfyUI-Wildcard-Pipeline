"""Tests for CombineHandler — syntax-aware template fill from runtime context."""
import random

import pytest

from engine.modules.combine_handler import CombineHandler


def _ctx(**extra):
    """Return a minimal valid runtime ctx dict with rng + warnings."""
    return {
        "__wp_rng__": random.Random(0),
        "__wp_warnings__": [],
        **extra,
    }


def test_handler_type_id_is_combine():
    assert CombineHandler.type_id == "combine"


def test_validate_payload_accepts_well_formed():
    CombineHandler.validate_payload({
        "template": "$name, a $age-year-old",
        "output_var": "subject_phrase",
        "input_vars": ["name", "age"],
    })


def test_validate_payload_rejects_non_string_template():
    with pytest.raises(ValueError, match="template"):
        CombineHandler.validate_payload({
            "template": 123,
            "output_var": "x",
        })


def test_validate_payload_rejects_blank_output_var():
    with pytest.raises(ValueError, match="output_var"):
        CombineHandler.validate_payload({"template": "x", "output_var": ""})


def test_validate_payload_rejects_invalid_identifier():
    with pytest.raises(ValueError, match="identifier"):
        CombineHandler.validate_payload({
            "template": "x", "output_var": "1bad-name",
        })


def test_validate_payload_rejects_non_list_input_vars():
    with pytest.raises(ValueError, match="input_vars"):
        CombineHandler.validate_payload({
            "template": "x", "output_var": "y", "input_vars": "abc",
        })


def test_resolve_substitutes_known_vars():
    # resolve_text returns "" for unknown vars; resolve does not write back to ctx.
    ctx = _ctx(name="Alice", age="30")
    out = CombineHandler.resolve(
        {
            "template": "$name, a $age-year-old",
            "output_var": "subject",
        },
        instance={},
        ctx=ctx,
    )
    assert out == {"subject": "Alice, a 30-year-old"}


def test_resolve_leaves_unknown_var_empty():
    # resolve_text emits "" for unbound $var tokens (surface="combine").
    ctx = _ctx(name="Bob")
    out = CombineHandler.resolve(
        {"template": "$name and $missing", "output_var": "out"},
        instance={},
        ctx=ctx,
    )
    assert out == {"out": "Bob and "}


def test_resolve_inline_pick():
    # {a|b|c} syntax works in combine surface.
    ctx = _ctx()
    out = CombineHandler.resolve(
        {"template": "{hello|hi}", "output_var": "greeting"},
        instance={},
        ctx=ctx,
    )
    assert out["greeting"] in {"hello", "hi"}


def test_resolve_rejects_malformed_payload():
    with pytest.raises(ValueError):
        CombineHandler.resolve(
            {"template": 5, "output_var": "x"}, instance={}, ctx=_ctx(),
        )


def test_resolve_via_dispatcher_after_import():
    from engine.modules import resolve_module
    snap = {
        "type": "combine",
        "payload": {"template": "hi $name", "output_var": "greeting"},
        "instance": {},
    }
    ctx = _ctx(name="Carol")
    out = resolve_module(snap, ctx=ctx)
    assert out == {"greeting": "hi Carol"}


def test_combine_handler_uses_resolve_text_with_combine_surface():
    # $var + {a|b} both resolved; result bound to output_var.
    ctx = {
        "__wp_rng__": random.Random(42),
        "__wp_warnings__": [],
        "style": "anime",
    }
    out = CombineHandler.resolve(
        {"template": "$style {a|b}", "output_var": "result"},
        instance={},
        ctx=ctx,
    )
    assert out["result"].startswith("anime ")
    assert out["result"][-1] in ("a", "b")


def test_combine_handler_ref_emits_empty_with_warning():
    """@{uuid} in combine surface is lenient — emits empty string + warning."""
    ctx = {
        "__wp_rng__": random.Random(42),
        "__wp_warnings__": [],
        "__wp_catalog__": {
            "a4f7b2e1": {
                "type": "wildcard",
                "var_binding": "color",
                "options": [{"value": "red", "weight": 1}],
            },
        },
    }
    out = CombineHandler.resolve(
        {"template": "x @{a4f7b2e1} y", "output_var": "result"},
        instance={},
        ctx=ctx,
    )
    assert out["result"] == "x  y"
    assert any(w["type"] == "ref_out_of_surface" for w in ctx["__wp_warnings__"])
