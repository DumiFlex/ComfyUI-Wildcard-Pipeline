"""Match variable on editor text and one level into lone-ref options.

A wildcard option ``red @{hat00001}`` reads ``red @Hat`` in the editor, so a
variable holding ``red @Hat`` picks it. An option that is just a ref
(``@{plac0001}``) matches when one of the referenced wildcard's options does,
and the ref then takes that option instead of rolling.
"""
from __future__ import annotations

import copy
from typing import Any

from engine.modules import REF_PINS_KEY
from engine.pipeline import PipelineEngine

PLACES = "9ace0001"
HAT = "4a700001"


def _opt(oid: str, value: str, **extra: Any) -> dict:
    return {"id": oid, "value": value, "weight": 1, **extra}


def _wc(uid: str, binding: str, options: list[dict], **instance: Any) -> dict:
    return {"type": "wildcard", "id": uid, "_uid": f"row-{uid}", "enabled": True,
            "payload": {"var_binding": binding, "options": options},
            "instance": {"variable_binding": binding, **instance}}


def _catalog() -> dict:
    return {
        PLACES: {"id": PLACES, "type": "wildcard", "name": "Places", "payload": {
            "var_binding": "places",
            "options": [_opt("p1", "beach"), _opt("p2", "forest"), _opt("p3", "city")],
        }},
        HAT: {"id": HAT, "type": "wildcard", "name": "Hat", "payload": {
            "var_binding": "hat", "options": [_opt("h1", "cap"), _opt("h2", "beret")],
        }},
    }


def _run(modules: list[dict], seed: int, **pins: Any) -> dict:
    ctx: dict[str, Any] = {**pins, "__wp_catalog__": _catalog()}
    return PipelineEngine().run(copy.deepcopy(modules), ctx=ctx, seed=seed)


def _scene() -> dict:
    return _wc("scen0001", "scene", [
        _opt("s1", "indoors"),
        _opt("s2", f"@{{{PLACES}}}"),
        _opt("s3", f"red @{{{HAT}#Hat}}"),
    ], match_variable="want")


def test_editor_text_picks_the_option_with_the_ref():
    for seed in range(10):
        ctx = _run([_scene()], seed, want="Red @Hat")
        assert ctx["scene"] in {"red cap", "red beret"}


def test_deep_match_takes_the_inner_option():
    for seed in range(15):
        ctx = _run([_scene()], seed, want="forest")
        assert ctx["scene"] == "forest"
        assert REF_PINS_KEY not in ctx


def test_exact_text_still_wins_first():
    ctx = _run([_scene()], 0, want="indoors")
    assert ctx["scene"] == "indoors"


def test_pin_does_not_leak_into_a_later_ref():
    later = _wc("late0001", "later", [_opt("l1", f"@{{{PLACES}}}")])
    seen = set()
    for seed in range(30):
        ctx = _run([_scene(), later], seed, want="forest")
        assert ctx["scene"] == "forest"
        seen.add(ctx["later"])
    assert len(seen) > 1


def test_no_match_still_falls_back_or_rolls():
    seen = {_run([_scene()], seed, want="desert")["scene"] for seed in range(30)}
    assert "indoors" in seen and len(seen) > 1
