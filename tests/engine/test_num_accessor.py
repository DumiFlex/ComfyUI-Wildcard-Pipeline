"""`$name.num`: WP Slider's number, in the text resolver, conditions and converters."""
from types import SimpleNamespace

from engine import template
from engine.converters import lookup_var
from engine.modules.derivation_handler import _ctx_get, _ctx_has


def test_resolver_reads_the_table_then_a_number_value():
    ctx = {"shot": "medium shot", "cfg": "7", "mood": "calm",
           "__wp_slider_nums__": {"shot": "0.45"}}
    assert template.resolve_variables("$shot.num $cfg.num [$mood.num]", ctx) == "0.45 7 []"


def test_num_is_not_a_read_of_the_variable():
    reads: list = []
    ctx = {"shot": "medium shot", "__wp_slider_nums__": {"shot": "0.45"}}
    assert template.resolve_variables("$shot.num", ctx, reads=reads) == "0.45"
    assert reads == []


def test_unknown_variable_warns():
    ctx: dict = {"__wp_warnings__": []}
    assert template.resolve_variables("$ghost.num", ctx) == ""
    assert any(w.get("type") == "unknown_var" for w in ctx["__wp_warnings__"])


def test_conditions_read_num():
    ctx = {"shot": "wide", "steps": "28", "__wp_slider_nums__": {"shot": "0.9"}}
    assert _ctx_get(ctx, "shot.num") == "0.9"
    assert _ctx_get(ctx, "steps.num") == "28"
    assert _ctx_has(ctx, "shot.num") is True
    assert _ctx_get(ctx, "mood.num") == ""
    assert _ctx_has(ctx, "mood.num") is False


def test_converters_read_num_from_internals():
    payload = SimpleNamespace(
        context={"shot": "wide shot", "cfg": "6.5"},
        internals={"__wp_slider_nums__": {"shot": "0.80"}},
    )
    assert lookup_var(payload, "$shot.num") == "0.80"
    assert lookup_var(payload, "cfg.num") == "6.5"
    assert lookup_var(payload, "$shot") == "wide shot"
