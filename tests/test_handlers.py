"""Unit tests for engine.handlers."""

from __future__ import annotations

import random

from engine.handlers import handle_fixed_values
from engine.modules import FixedValueEntry, FixedValueModule


class TestHandleFixedValues:
    def _rng(self):
        return random.Random(0)

    def test_single_entry(self):
        module = FixedValueModule(
            id="a",
            entries=[FixedValueEntry("style", "photoreal")],
        )
        ctx = handle_fixed_values(module, {}, self._rng())
        assert ctx == {"style": "photoreal"}

    def test_multiple_entries_preserve_order(self):
        module = FixedValueModule(
            id="a",
            entries=[
                FixedValueEntry("style", "photoreal"),
                FixedValueEntry("light", "soft"),
            ],
        )
        ctx = handle_fixed_values(module, {}, self._rng())
        assert ctx == {"style": "photoreal", "light": "soft"}

    def test_later_entry_overwrites_earlier(self):
        module = FixedValueModule(
            id="a",
            entries=[
                FixedValueEntry("style", "photoreal"),
                FixedValueEntry("style", "painted"),
            ],
        )
        ctx = handle_fixed_values(module, {}, self._rng())
        assert ctx == {"style": "painted"}

    def test_dollar_prefix_stripped(self):
        module = FixedValueModule(
            id="a",
            entries=[FixedValueEntry("$style", "photoreal")],
        )
        ctx = handle_fixed_values(module, {}, self._rng())
        assert ctx == {"style": "photoreal"}

    def test_empty_variable_name_skipped(self):
        module = FixedValueModule(
            id="a",
            entries=[
                FixedValueEntry("", "nothing"),
                FixedValueEntry("$", "also nothing"),
                FixedValueEntry("kept", "here"),
            ],
        )
        ctx = handle_fixed_values(module, {}, self._rng())
        assert ctx == {"kept": "here"}

    def test_mutates_passed_ctx(self):
        module = FixedValueModule(id="a", entries=[FixedValueEntry("x", "1")])
        ctx: dict[str, object] = {"existing": "value"}
        returned = handle_fixed_values(module, ctx, self._rng())
        assert returned is ctx
        assert ctx == {"existing": "value", "x": "1"}

    def test_overwrites_existing_key(self):
        module = FixedValueModule(id="a", entries=[FixedValueEntry("x", "new")])
        ctx = handle_fixed_values(module, {"x": "old"}, self._rng())
        assert ctx == {"x": "new"}

    def test_empty_entries_noop(self):
        module = FixedValueModule(id="a")
        ctx = handle_fixed_values(module, {"k": "v"}, self._rng())
        assert ctx == {"k": "v"}


def test_wildcard_handler_uses_resolve_text_for_refs():
    """The handler now delegates to resolve_text for option values."""
    import random  # noqa: PLC0415

    from engine.modules.wildcard_handler import WildcardHandler  # noqa: PLC0415

    payload = {
        "var_binding": "color",
        "options": [{"value": "@{a0000001}", "weight": 1}],
    }
    instance = {"variable_binding": "color"}
    ctx = {
        "__wp_rng__": random.Random(42),
        "__wp_warnings__": [],
        "__wp_catalog__": {
            "a0000001": {
                "type": "wildcard", "var_binding": "x",
                "options": [{"value": "red", "weight": 1}],
            },
        },
    }
    out = WildcardHandler.resolve(payload, instance, ctx)
    assert out == {"color": "red"}


def test_wildcard_handler_inline_pick_in_option():
    """Option values can use {a|b|c} inline picks."""
    import random  # noqa: PLC0415

    from engine.modules.wildcard_handler import WildcardHandler  # noqa: PLC0415

    payload = {
        "var_binding": "color",
        "options": [{"value": "{red|blue|green}", "weight": 1}],
    }
    instance = {"variable_binding": "color"}
    ctx = {"__wp_rng__": random.Random(42), "__wp_warnings__": []}
    out = WildcardHandler.resolve(payload, instance, ctx)
    assert out["color"] in {"red", "blue", "green"}


def test_combine_handler_uses_resolve_text_with_combine_surface():
    import random  # noqa: PLC0415

    from engine.modules.combine_handler import CombineHandler  # noqa: PLC0415

    payload = {"template": "$style {a|b}", "output_var": "result"}
    ctx = {
        "__wp_rng__": random.Random(42),
        "__wp_warnings__": [],
        "style": "anime",
    }
    out = CombineHandler.resolve(payload, {}, ctx)
    assert out["result"].startswith("anime ")
    assert out["result"][-1] in ("a", "b")


def test_combine_handler_ref_emits_empty_with_warning():
    """@{uuid} in combine surface is lenient → empty + warning."""
    import random  # noqa: PLC0415

    from engine.modules.combine_handler import CombineHandler  # noqa: PLC0415

    payload = {"template": "x @{a4f7b2e1} y", "output_var": "result"}
    ctx = {
        "__wp_rng__": random.Random(42),
        "__wp_warnings__": [],
        "__wp_catalog__": {
            "a4f7b2e1": {"type": "wildcard", "var_binding": "color",
                         "options": [{"value": "red", "weight": 1}]},
        },
    }
    out = CombineHandler.resolve(payload, {}, ctx)
    assert out["result"] == "x  y"
    assert any(w["type"] == "ref_out_of_surface" for w in ctx["__wp_warnings__"])
