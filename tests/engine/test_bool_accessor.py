"""`$name.bool`: WP Toggles' on/off, in the text resolver and in conditions."""
from engine import template
from engine.modules.derivation_handler import _ctx_get, _ctx_has


def test_resolver_reads_the_table_then_a_true_false_value():
    ctx = {"rain": "heavy rain", "wind": "false", "mood": "calm",
           "__wp_toggle_bools__": {"rain": True}}
    assert template.resolve_variables("$rain.bool $wind.bool [$mood.bool]", ctx) == "true false []"


def test_unknown_variable_warns():
    ctx: dict = {"__wp_warnings__": []}
    assert template.resolve_variables("$ghost.bool", ctx) == ""
    assert any(w.get("type") == "unknown_var" for w in ctx["__wp_warnings__"])


def test_conditions_read_bool():
    ctx = {"rain": "heavy rain", "__wp_toggle_bools__": {"rain": True, "fog": False}}
    assert _ctx_get(ctx, "rain.bool") == "true"
    assert _ctx_get(ctx, "fog.bool") == "false"
    assert _ctx_has(ctx, "rain.bool") is True
    assert _ctx_get(ctx, "mood.bool") == ""
    assert _ctx_has(ctx, "mood.bool") is False
