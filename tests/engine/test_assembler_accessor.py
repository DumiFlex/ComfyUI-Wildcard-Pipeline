"""The assembler must resolve the same accessor grammar a Combine does.

`$var.AXIS` and `$var.N` read tables the engine keeps under `__`-prefixed
keys. `strip_internals` runs at the prompt-render boundary and dropped every
such key, so the assembler rendered the accessor as literal text while the
identical template resolved correctly one node upstream.
"""
import random

from engine.context import strip_internals, with_resolver_tables
from engine.template import resolve_variables


def _ctx() -> dict:
    return {
        "outfit": "a white t-shirt and denim skirt",
        "__wp_rng__": random.Random(0),
        "__wp_warnings__": [],
        "__wp_axes__": {"outfit": {"SHOES": "sneakers"}},
        "__wp_picks__": {},
    }


def test_strip_internals_does_not_leak_the_tables_as_variables():
    # The stripped dict IS the variable surface — the assembler's variables
    # panel enumerates it, so a `__wp_axes__` key there renders as a chip
    # named `$__wp_axes__`.
    kept = strip_internals(_ctx())
    assert not any(k.startswith("__") for k in kept)


def test_with_resolver_tables_reattaches_them_for_a_resolver_call():
    kept = with_resolver_tables(strip_internals(_ctx()), _ctx())
    assert kept["__wp_axes__"] == {"outfit": {"SHOES": "sneakers"}}
    assert "__wp_picks__" in kept


def test_strip_internals_still_drops_bookkeeping_and_internal_vars():
    ctx = _ctx()
    ctx["__wp_trace__"] = ["noise"]
    ctx["secret"] = "hidden"
    ctx["__wp_internal_flags__"] = {"secret": True}
    kept = strip_internals(ctx)
    assert "__wp_trace__" not in kept
    assert "secret" not in kept


def test_assembler_resolves_an_axis_read():
    out = resolve_variables(
        "wearing $outfit.SHOES", with_resolver_tables(strip_internals(_ctx()), _ctx())
    )
    assert out == "wearing sneakers"


def test_assembler_still_resolves_the_plain_var():
    out = resolve_variables(
        "wearing $outfit", with_resolver_tables(strip_internals(_ctx()), _ctx())
    )
    assert out == "wearing a white t-shirt and denim skirt"
