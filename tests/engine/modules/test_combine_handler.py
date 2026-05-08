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


def test_resolve_leaves_unknown_var_empty_and_warns():
    # resolve_text emits "" for unbound $var tokens. Engine also emits
    # a `unknown_var` warning so the user gets a light signal that the
    # combine template references a var nothing upstream has bound —
    # the missing var collapses silently into empty string otherwise.
    ctx = _ctx(name="Bob")
    out = CombineHandler.resolve(
        {"template": "$name and $missing", "output_var": "out"},
        instance={},
        ctx=ctx,
    )
    assert out == {"out": "Bob and "}
    warnings = [w for w in ctx["__wp_warnings__"] if w["type"] == "unknown_var"]
    assert len(warnings) == 1
    assert warnings[0]["severity"] == "warn"
    assert warnings[0]["detail"]["name"] == "missing"
    assert warnings[0]["detail"]["surface"] == "combine"


def test_resolve_does_not_warn_on_bound_var():
    # Sanity check the new warning doesn't fire for vars that ARE present.
    ctx = _ctx(name="Bob")
    CombineHandler.resolve(
        {"template": "hi $name", "output_var": "out"},
        instance={},
        ctx=ctx,
    )
    assert all(w["type"] != "unknown_var" for w in ctx["__wp_warnings__"])


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


# ── Phase: combine v2 + syntax parity cycle ──────────────────────────


def _make_seedctx(seed: int = 0) -> dict:
    """Build a ctx dict with chain seed + max_ref_depth so build_resolve_ctx
    composes a valid ResolveContext."""
    return {
        "__wp_rng__": random.Random(0),
        "__wp_node_seed__": seed,
        "__wp_warnings__": [],
        "__wp_max_ref_depth__": 8,
        "__wp_catalog__": {},
        "__wp_developer_mode__": False,
    }


def test_combine_reads_template_override():
    """instance.template_override wins over payload.template — same
    precedence pattern wildcard's option_weights and fixed_values'
    values_overrides use."""
    payload = {
        "template": "library template",
        "output_var": "result",
        "input_vars": [],
    }
    instance = {"template_override": "instance template"}
    ctx = _make_seedctx(seed=0)
    out = CombineHandler.resolve(payload, instance, ctx)
    assert out == {"result": "instance template"}


def test_combine_falls_back_to_payload_template_when_override_null():
    payload = {
        "template": "library template",
        "output_var": "result",
        "input_vars": [],
    }
    instance = {"template_override": None}
    ctx = _make_seedctx(seed=0)
    out = CombineHandler.resolve(payload, instance, ctx)
    assert out == {"result": "library template"}


def test_combine_locked_seed_makes_alternation_deterministic():
    """Same locked_seed + same template = same {a|b|c} output across runs."""
    payload = {
        "template": "{a|b|c|d|e|f|g|h}",
        "output_var": "pick",
        "input_vars": [],
    }
    out1 = CombineHandler.resolve(payload, {"locked_seed": 12345}, _make_seedctx(0))
    out2 = CombineHandler.resolve(payload, {"locked_seed": 12345}, _make_seedctx(0))
    assert out1 == out2


def test_combine_different_locked_seeds_can_yield_different_picks():
    """Sanity check that the seed actually affects RNG (statistical)."""
    payload = {
        "template": "{a|b|c|d|e|f|g|h}",
        "output_var": "pick",
        "input_vars": [],
    }
    picks = set()
    for seed in range(20):
        out = CombineHandler.resolve(payload, {"locked_seed": seed}, _make_seedctx(0))
        picks.add(out["pick"])
    assert len(picks) > 1


def test_combine_unlocked_uses_chain_seed():
    """Without locked_seed, RNG derives from ctx __wp_node_seed__."""
    payload = {
        "template": "{a|b|c|d|e|f|g|h}",
        "output_var": "pick",
        "input_vars": [],
    }
    ctx_a = _make_seedctx(seed=11111)
    out_a = CombineHandler.resolve(payload, {}, ctx_a)
    assert out_a["pick"] in {"a", "b", "c", "d", "e", "f", "g", "h"}
