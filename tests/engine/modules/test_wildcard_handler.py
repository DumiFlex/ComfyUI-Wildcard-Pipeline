"""Tests for WildcardHandler — weighted RNG + @{ref} resolution."""
import random

import pytest

from engine.modules.wildcard_handler import RecursionLimitExceeded, WildcardHandler


def _payload(options):
    return {"options": options}


def test_resolve_picks_one_option(monkeypatch):
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": 1},
        {"id": "b", "value": "beta", "weight": 1},
    ])
    monkeypatch.setattr(random, "random", lambda: 0.0)
    out = WildcardHandler.resolve(
        payload, instance={"variable_binding": "$x"}, ctx=None,
    )
    assert out == {"$x": "alpha"}


def test_resolve_respects_weights_heavy_b(monkeypatch):
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": 1},
        {"id": "b", "value": "beta", "weight": 99},
    ])
    monkeypatch.setattr(random, "random", lambda: 0.5)  # → cumulative 0.5*100 = 50, beta wins
    out = WildcardHandler.resolve(
        payload, instance={"variable_binding": "$x"}, ctx=None,
    )
    assert out == {"$x": "beta"}


def test_resolve_empty_options_returns_empty_string():
    out = WildcardHandler.resolve(
        _payload([]), instance={"variable_binding": "$x"}, ctx=None,
    )
    assert out == {"$x": ""}


def test_resolve_filters_by_enabled_options(monkeypatch):
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": 1},
        {"id": "b", "value": "beta", "weight": 1},
    ])
    monkeypatch.setattr(random, "random", lambda: 0.0)
    out = WildcardHandler.resolve(
        payload,
        instance={"variable_binding": "$x", "enabled_options": ["b"]},
        ctx=None,
    )
    assert out == {"$x": "beta"}


def test_resolve_at_ref_calls_ctx_resolve(monkeypatch):
    payload = _payload([{"id": "a", "value": "@{other_wc}", "weight": 1}])
    monkeypatch.setattr(random, "random", lambda: 0.0)

    class Ctx:
        def __init__(self):
            self.calls = []

        def resolve_ref(self, ref_id, *, depth):
            self.calls.append((ref_id, depth))
            return "expanded"

    ctx = Ctx()
    out = WildcardHandler.resolve(
        payload, instance={"variable_binding": "$x"}, ctx=ctx,
    )
    assert out == {"$x": "expanded"}
    assert ctx.calls == [("other_wc", 1)]


def test_resolve_at_ref_max_depth_raises(monkeypatch):
    payload = _payload([{"id": "a", "value": "@{a}", "weight": 1}])
    monkeypatch.setattr(random, "random", lambda: 0.0)

    class Ctx:
        def resolve_ref(self, ref_id, *, depth):
            return WildcardHandler.resolve(
                payload, instance={"variable_binding": "$x"},
                ctx=self, _depth=depth,
            )["$x"]

    with pytest.raises(RecursionLimitExceeded):
        WildcardHandler.resolve(
            payload, instance={"variable_binding": "$x"}, ctx=Ctx(),
        )


def test_resolve_returns_empty_when_no_binding():
    payload = _payload([{"id": "a", "value": "x", "weight": 1}])
    out = WildcardHandler.resolve(payload, instance={}, ctx=None)
    assert out == {}


def test_resolve_at_ref_strips_when_ctx_none(monkeypatch):
    """No ctx → @{ref} expands to empty string."""
    payload = _payload([{"id": "a", "value": "before @{x} after", "weight": 1}])
    monkeypatch.setattr(random, "random", lambda: 0.0)
    out = WildcardHandler.resolve(
        payload, instance={"variable_binding": "$y"}, ctx=None,
    )
    assert out == {"$y": "before  after"}


def test_resolve_zero_weight_falls_back_to_first(monkeypatch):
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": 0},
        {"id": "b", "value": "beta", "weight": 0},
    ])
    monkeypatch.setattr(random, "random", lambda: 0.7)
    out = WildcardHandler.resolve(
        payload, instance={"variable_binding": "$x"}, ctx=None,
    )
    assert out == {"$x": "alpha"}  # falls back to first option


def test_resolve_negative_weight_clamped_to_zero(monkeypatch):
    payload = _payload([
        {"id": "a", "value": "alpha", "weight": -5},
        {"id": "b", "value": "beta", "weight": 1},
    ])
    monkeypatch.setattr(random, "random", lambda: 0.5)
    out = WildcardHandler.resolve(
        payload, instance={"variable_binding": "$x"}, ctx=None,
    )
    assert out == {"$x": "beta"}  # negative clamped, only beta has positive weight


def test_resolve_default_weight_is_1(monkeypatch):
    """Options without 'weight' key default to weight=1."""
    payload = _payload([
        {"id": "a", "value": "alpha"},  # no weight
        {"id": "b", "value": "beta"},   # no weight
    ])
    monkeypatch.setattr(random, "random", lambda: 0.0)
    out = WildcardHandler.resolve(
        payload, instance={"variable_binding": "$x"}, ctx=None,
    )
    assert out == {"$x": "alpha"}


def test_handler_type_id_is_wildcard():
    assert WildcardHandler.type_id == "wildcard"


def test_resolve_via_dispatcher_after_import():
    """Importing engine.modules auto-registers WildcardHandler in the dispatcher."""
    from engine.modules import resolve_module
    snap = {
        "type": "wildcard",
        "payload": _payload([{"id": "a", "value": "x", "weight": 1}]),
        "instance": {"variable_binding": "$z"},
    }
    out = resolve_module(snap, ctx=None)
    assert out == {"$z": "x"}
