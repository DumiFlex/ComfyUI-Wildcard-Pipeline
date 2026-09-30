"""Send-to-negative (schema v8): per-variable negatives in the engine.

Negatives follow usage, never shift a seed, resolve refs quietly, and are
replaced by any later write to their variable.
"""
from __future__ import annotations

import pytest

from engine import negatives
from engine.context import strip_internals, with_resolver_tables
from engine.modules import (
    CombineHandler,
    DerivationHandler,
    FixedValuesHandler,
    WildcardHandler,
)
from engine.pipeline import PipelineEngine
from engine.template import resolve_variables, resolve_variables_raw
from wp_nodes.assembler_node import assemble_negative

COLOR = "c0100100"
BAD = "b0200200"


def _wc(binding, options, **instance):
    return {
        "type": "wildcard",
        "id": f"{binding}-uuid",
        "payload": {"var_binding": binding, "options": options},
        "instance": {"variable_binding": binding, **instance},
    }


def _opt(i, value, negative=None, weight=1.0):
    o = {"id": f"o{i}", "value": value, "weight": weight}
    if negative is not None:
        o["negative"] = negative
    return o


def _catalog():
    return {
        COLOR: {
            "id": COLOR, "type": "wildcard", "name": "color",
            "payload": {"var_binding": "color", "options": [
                {"id": "c0", "value": "green", "weight": 1.0, "negative": "grey"},
                {"id": "c1", "value": "red", "weight": 1.0, "negative": "grey"},
            ]},
        },
        BAD: {
            "id": BAD, "type": "wildcard", "name": "bad",
            "payload": {"var_binding": "bad", "options": [
                {"id": "b0", "value": "blurry", "weight": 1.0, "negative": "CHAINED"},
                {"id": "b1", "value": "jpeg artifacts", "weight": 1.0,
                 "negative": "CHAINED"},
            ]},
        },
    }


def _run(modules, seed=7, **ctx):
    return PipelineEngine().run(
        modules, ctx={"__wp_catalog__": _catalog(), **ctx}, seed=seed,
    )


def _texts(ctx, name):
    return [e["text"] for e in negatives.get_entries(ctx, name)]


def _assemble(ctx, template, negative_template=""):
    rctx = with_resolver_tables(strip_internals(ctx), ctx)
    reads: list = []
    prompt = resolve_variables(template, rctx, reads=reads)
    neg = assemble_negative(
        ctx, reads, negative_template, lambda t: resolve_variables_raw(t, rctx),
    )
    return prompt, neg


# ── filing ──────────────────────────────────────────────────────────────


def test_option_negative_files_under_its_variable():
    ctx = _run([_wc("hair", [_opt(0, "strawberry hair", "fruit")])])
    assert ctx["hair"] == "strawberry hair"
    assert _texts(ctx, "hair") == ["fruit"]


def test_null_option_can_carry_a_negative():
    null = {"id": "n", "value": "", "is_null": True, "weight": 1.0, "negative": "hat"}
    ctx = _run([_wc("headwear", [null])])
    assert ctx["headwear"] == ""
    assert _texts(ctx, "headwear") == ["hat"]


def test_ref_option_negative_goes_to_the_carrier():
    ctx = _run([_wc("outfit", [_opt(0, f"@{{{COLOR}}} jeans", "shorts")])])
    assert _texts(ctx, "outfit") == ["shorts", "grey"]


def test_later_write_replaces_negatives():
    ctx = _run([
        _wc("hair", [_opt(0, "red hair", "blonde")]),
        _wc("hair", [_opt(0, "black hair")]),
    ])
    assert ctx["hair"] == "black hair"
    assert _texts(ctx, "hair") == []


def test_multi_pick_keeps_one_entry_per_pick():
    m = _wc("props", [_opt(0, "sword", "gun"), _opt(1, "shield", "tank")],
            pick_min=2, pick_max=2)
    ctx = _run([m])
    rows = negatives.get_entries(ctx, "props")
    assert sorted(r["pick"] for r in rows) == [0, 1]
    assert set(ctx["props"].items) == {"sword", "shield"}
    # `$props.1` carries only pick 1's negative.
    first = ctx["props"].items[1]
    want = "gun" if first == "sword" else "tank"
    _, neg = _assemble(ctx, "holding $props.1")
    assert neg == want
    _, neg_all = _assemble(ctx, "holding $props")
    assert set(neg_all.split(", ")) == {"gun", "tank"}


# ── quiet refs ──────────────────────────────────────────────────────────


def test_ref_inside_a_negative_resolves_quietly():
    log: list = []
    ctx = _run(
        [_wc("style", [_opt(0, "oil painting", f"photo, @{{{BAD}}}")])],
        __wp_ref_log__=log,
    )
    text = _texts(ctx, "style")[0]
    assert text.startswith("photo, ")
    assert text.split(", ")[1] in {"blurry", "jpeg artifacts"}
    # No chaining: the ref'd option's own negative is ignored.
    assert "CHAINED" not in text
    # Nothing logged, nothing bound.
    assert log == []
    assert "bad" not in ctx


def test_negatives_never_shift_picks():
    plain = [
        _wc("a", [_opt(i, f"a{i}") for i in range(6)]),
        _wc("b", [_opt(i, f"b{i} @{{{COLOR}}}") for i in range(6)]),
        {"type": "combine", "payload": {"output_var": "c", "template": "{x|y|z} $a"}},
        {"type": "fixed_values", "id": "fv", "payload": {"values": [
            {"id": "f0", "name": "f", "value": "{p|q|r}"}]}},
    ]
    with_neg = [
        _wc("a", [_opt(i, f"a{i}", "{n1|n2|n3}") for i in range(6)]),
        _wc("b", [_opt(i, f"b{i} @{{{COLOR}}}", f"@{{{BAD}}}") for i in range(6)]),
        {"type": "combine", "payload": {"output_var": "c", "template": "{x|y|z} $a",
                                        "negative": "{u|v}"}},
        {"type": "fixed_values", "id": "fv", "payload": {"values": [
            {"id": "f0", "name": "f", "value": "{p|q|r}", "negative": "{s|t}"}]}},
    ]
    for seed in range(200):
        a = _run(plain, seed=seed)
        b = _run(with_neg, seed=seed)
        for k in ("a", "b", "c", "f"):
            assert str(a[k]) == str(b[k]), (seed, k)


# ── fixed values + combine ──────────────────────────────────────────────


def test_fixed_value_negative_comes_from_the_library_row():
    fv = {
        "type": "fixed_values", "id": "fv",
        "payload": {"values": [
            {"id": "f0", "name": "style", "value": "oil", "negative": "photo"}]},
        "instance": {"values_overrides": [
            {"id": "f0", "name": "style", "value": "watercolor", "negative": "NOPE"}]},
    }
    ctx = _run([fv])
    assert ctx["style"] == "watercolor"
    assert _texts(ctx, "style") == ["photo"]


def test_combine_carries_its_reads_plus_its_own():
    ctx = _run([
        _wc("hair", [_opt(0, "red hair", "blonde")]),
        _wc("outfit", [_opt(0, "armor", "torn clothes")]),
        _wc("unused", [_opt(0, "x", "NOT READ")]),
        {"type": "combine", "payload": {
            "output_var": "scene", "template": "$hair, $outfit",
            "negative": "cropped"}},
    ])
    assert _texts(ctx, "scene") == ["blonde", "torn clothes", "cropped"]


# ── derivation ──────────────────────────────────────────────────────────


def _deriv(mode, value, target="hair"):
    return {
        "type": "derivation", "id": "d1",
        "payload": {"rules": [{"id": "r1", "branches": [{
            "condition": {"var": "hair", "op": "exists", "value": ""},
            "action": {"target_var": target, "mode": mode, "value": value},
        }]}]},
    }


def test_derivation_replace_swaps_negatives():
    ctx = _run([_wc("hair", [_opt(0, "red hair", "blonde")]),
                _deriv("replace", "bald")])
    assert ctx["hair"] == "bald"
    assert _texts(ctx, "hair") == []


def test_derivation_append_keeps_negatives():
    ctx = _run([_wc("hair", [_opt(0, "red hair", "blonde")]),
                _deriv("append", " @{" + COLOR + "} ribbon")])
    assert _texts(ctx, "hair") == ["blonde", "grey"]


def test_add_to_negative_writes_no_value():
    ctx = _run([_wc("hair", [_opt(0, "red hair", "blonde")]),
                _deriv("negative", "{short|long} hair")])
    assert ctx["hair"] == "red hair"
    texts = _texts(ctx, "hair")
    assert texts[0] == "blonde"
    assert texts[1] in {"short hair", "long hair"}
    trace = [t for t in ctx["__wp_trace__"] if t["type"] == "derivation"][0]
    assert trace["writes"] == []


def test_derivation_validates_negative_mode():
    DerivationHandler.validate_payload(_deriv("negative", "x")["payload"])
    with pytest.raises(ValueError):
        DerivationHandler.validate_payload(_deriv("sideways", "x")["payload"])


# ── Assembler ───────────────────────────────────────────────────────────


def test_assembler_follows_usage_and_dedupes():
    ctx = _run([
        _wc("hair", [_opt(0, "red hair", "blonde, lowres")]),
        _wc("outfit", [_opt(0, "armor", "Lowres, torn clothes")]),
        _wc("unused", [_opt(0, "x", "NOT USED")]),
    ])
    prompt, neg = _assemble(ctx, "$hair, $outfit")
    assert prompt == "red hair, armor"
    assert neg == "blonde, lowres, torn clothes"


def test_assembler_negative_template_slot_and_append():
    ctx = _run([_wc("hair", [_opt(0, "red hair", "blonde, lowres")])])
    _, neg = _assemble(ctx, "$hair", "worst quality, $negatives, lowres")
    assert neg == "worst quality, blonde, lowres"
    _, neg2 = _assemble(ctx, "$hair", "worst quality")
    assert neg2 == "worst quality, blonde, lowres"


def test_negative_template_vars_add_text_not_negatives():
    ctx = _run([
        _wc("hair", [_opt(0, "red hair", "blonde")]),
        _wc("mood", [_opt(0, "happy", "sad")]),
    ])
    _, neg = _assemble(ctx, "$hair", "not $mood, $negatives")
    assert neg == "not happy, blonde"


def test_internal_variables_add_nothing():
    m = _wc("hair", [_opt(0, "red hair", "blonde")], internal=True)
    ctx = _run([m])
    _, neg = _assemble(ctx, "$hair")
    assert neg == ""


# ── validation ──────────────────────────────────────────────────────────


@pytest.mark.parametrize("handler,payload", [
    (WildcardHandler, {"var_binding": "x", "options": [
        {"id": "a", "value": "v", "weight": 1, "negative": 3}]}),
    (FixedValuesHandler, {"values": [{"name": "x", "value": "v", "negative": []}]}),
    (CombineHandler, {"output_var": "x", "template": "t", "negative": 1}),
])
def test_non_string_negative_is_rejected(handler, payload):
    with pytest.raises(ValueError):
        handler.validate_payload(payload)


def test_join_unique_is_paren_aware_and_case_insensitive():
    got = negatives.join_unique(["(bad hands:1.2), a (b, c)", "Bad Hands, A (b, c)"])
    assert got == "(bad hands:1.2), a (b, c)"


# ── hold + injector ─────────────────────────────────────────────────────


def test_held_wildcard_keeps_its_frame0_negatives():
    from engine.seed_derive import effective_chain_seed

    m = _wc("x", [_opt(i, f"v{i}", "{n1|n2|n3|n4}") for i in range(6)],
            seed_scope="hold")
    seen = set()
    for k in range(5):
        ctx = PipelineEngine().run(
            [m], ctx={"__wp_catalog__": _catalog()},
            seed=effective_chain_seed(widget_seed=3, seed_override=None, loop_index=k),
            hold_seed=effective_chain_seed(widget_seed=3, seed_override=None, loop_index=0),
            loop_index=k,
        )
        seen.add((ctx["x"], tuple(_texts(ctx, "x"))))
    assert len(seen) == 1


def test_injector_row_negative_replaces_the_variables_negatives():
    import json

    from wp_nodes.injector_node import WPContextInjector
    from wp_nodes.types import ContextPayload

    upstream = ContextPayload(
        context={"character": "a wizard", "other": "x"}, debug={},
        internals={negatives.NEG_KEY: {
            "character": [{"text": "hat", "pick": None, "source": "character"}],
            "other": [{"text": "keep", "pick": None, "source": "other"}],
        }},
    )
    rows = json.dumps({"version": 1, "rows": [
        {"_uid": "a", "slot_name": "input_1", "binding": "character",
         "enabled": True, "template": "a knight named $input_1",
         "negative": "modern clothing, $input_1 clone"},
        {"_uid": "b", "slot_name": "input_2", "binding": "plain",
         "enabled": True},
    ]})
    out = WPContextInjector.execute(
        wp_rows=rows, upstream=upstream, input_1="Aldric", input_2="y",
    ).values[0]
    table = out.internals[negatives.NEG_KEY]
    assert [e["text"] for e in table["character"]] == ["modern clothing, Aldric clone"]
    assert "plain" not in table
    assert [e["text"] for e in table["other"]] == ["keep"]
    # Upstream payload untouched.
    assert upstream.internals[negatives.NEG_KEY]["character"][0]["text"] == "hat"


def test_trace_writes_carry_the_negative():
    ctx = _run([_wc("hair", [_opt(0, "red hair", "blonde")])])
    write = ctx["__wp_trace__"][0]["writes"][0]
    assert write["negative"] == "blonde"
