"""Tests for CombineHandler — template-fill from runtime context bindings."""
import pytest

from engine.modules.combine_handler import CombineHandler


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
    ctx: dict = {"name": "Alice", "age": "30"}
    out = CombineHandler.resolve(
        {
            "template": "$name, a $age-year-old",
            "output_var": "subject",
        },
        instance={},
        ctx=ctx,
    )
    assert out == {"subject": "Alice, a 30-year-old"}
    assert ctx["subject"] == "Alice, a 30-year-old"


def test_resolve_leaves_unknown_var_token_in_place():
    ctx: dict = {"name": "Bob"}
    out = CombineHandler.resolve(
        {"template": "$name and $missing", "output_var": "out"},
        instance={},
        ctx=ctx,
    )
    assert out == {"out": "Bob and $missing"}


def test_resolve_with_none_ctx_keeps_all_tokens():
    out = CombineHandler.resolve(
        {"template": "$a $b", "output_var": "phrase"},
        instance={},
        ctx=None,
    )
    assert out == {"phrase": "$a $b"}


def test_resolve_rejects_malformed_payload():
    with pytest.raises(ValueError):
        CombineHandler.resolve(
            {"template": 5, "output_var": "x"}, instance={}, ctx={},
        )


def test_resolve_via_dispatcher_after_import():
    from engine.modules import resolve_module
    snap = {
        "type": "combine",
        "payload": {"template": "hi $name", "output_var": "greeting"},
        "instance": {},
    }
    out = resolve_module(snap, ctx={"name": "Carol"})
    assert out == {"greeting": "hi Carol"}
