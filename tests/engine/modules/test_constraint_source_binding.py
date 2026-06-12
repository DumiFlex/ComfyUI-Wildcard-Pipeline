"""Constraint source-instance binding (task_5200c1fc).

A constraint registered while a `bundle_origin` is stamped must carry that
origin on its meta as `__constraint_bundle_origin__`, so the apply step can
bind to the source pick from the SAME bundle copy. These tests pin the
capture + the double-insert behavior + the exact fallbacks.
"""
from __future__ import annotations

from engine.pipeline import PipelineEngine


def _wildcard(uuid: str, var_binding: str, options: list[dict],
              *, uid: str = "", bundle_origin: str | None = None) -> dict:
    m: dict = {
        "id": uuid,
        "type": "wildcard",
        "enabled": True,
        "payload": {"var_binding": var_binding, "options": options},
        "instance": {},
    }
    if uid:
        m["_uid"] = uid
    if bundle_origin is not None:
        m["bundle_origin"] = bundle_origin
    return m


def _constraint(source_uuid: str, target_uuid: str, matrix: dict,
                *, uid: str = "", bundle_origin: str | None = None) -> dict:
    m: dict = {
        "id": f"c_{source_uuid[:4]}_{target_uuid[:4]}",
        "type": "constraint",
        "enabled": True,
        "payload": {
            "source_wildcard_id": source_uuid,
            "target_wildcard_id": target_uuid,
            "matrix": matrix,
            "exceptions": [],
        },
        "instance": {},
    }
    if uid:
        m["_uid"] = uid
    if bundle_origin is not None:
        m["bundle_origin"] = bundle_origin
    return m


def _run(modules: list[dict], seed: int = 0):
    return PipelineEngine().run(modules, seed=seed)


def test_constraint_meta_captures_its_bundle_origin():
    """A constraint that runs while `bundle_origin` is stamped records it
    on the registered meta entry as `__constraint_bundle_origin__`."""
    src = _wildcard("aaaa1111", "hair", [
        {"id": "h1", "value": "long", "weight": 1, "sub_categories": ["long"]},
    ], uid="uidsrc000001", bundle_origin="originA")
    con = _constraint(
        "aaaa1111", "bbbb2222",
        matrix={"long": {"formal": {"mode": "exclude", "factor": 1}}},
        uid="uidcon000001", bundle_origin="originA",
    )
    ctx = _run([src, con])
    bucket = ctx["__wp_constraints__"]
    assert len(bucket) == 1
    assert bucket[0]["__constraint_bundle_origin__"] == "originA"


def test_constraint_meta_bundle_origin_none_when_absent():
    """No `bundle_origin` stamped → meta carries `__constraint_bundle_origin__`
    as a falsy value (None / empty), never raising."""
    con = _constraint(
        "aaaa1111", "bbbb2222",
        matrix={"long": {"formal": {"mode": "exclude", "factor": 1}}},
    )
    ctx = _run([con])
    bucket = ctx["__wp_constraints__"]
    assert len(bucket) == 1
    assert not bucket[0].get("__constraint_bundle_origin__")


def _outfit_target(uuid: str = "bbbb2222", *, uid: str = "",
                   bundle_origin: str | None = None) -> dict:
    return _wildcard(uuid, "outfit", [
        {"id": "o1", "value": "kimono", "weight": 1, "sub_categories": ["formal"]},
        {"id": "o2", "value": "tshirt", "weight": 1, "sub_categories": ["casual"]},
    ], uid=uid, bundle_origin=bundle_origin)


def test_fallback_single_instance_unchanged():
    """Single source instance + single constraint, no by_origin match path
    needed: behaves exactly as today (source 'long' excludes 'formal')."""
    from engine.context import strip_internals
    src = _wildcard("aaaa1111", "hair", [
        {"id": "h1", "value": "long", "weight": 1, "sub_categories": ["long"]},
    ])
    con = _constraint(
        "aaaa1111", "bbbb2222",
        matrix={"long": {"formal": {"mode": "exclude", "factor": 1}}},
    )
    for seed in range(20):
        ctx = _run([src, con, _outfit_target()], seed=seed)
        assert strip_internals(ctx)["outfit"] == "tshirt"


def test_fallback_constraint_source_outside_its_bundle():
    """A constraint INSIDE a bundle (origin B) whose SOURCE wildcard is
    OUTSIDE the bundle (no origin) has no shared origin → falls back to the
    top-level source pick (today's behavior)."""
    from engine.context import strip_internals
    # Source has NO bundle_origin (lives outside the bundle).
    src = _wildcard("aaaa1111", "hair", [
        {"id": "h1", "value": "long", "weight": 1, "sub_categories": ["long"]},
    ])
    # Constraint carries origin B; its by_origin lookup on the source will
    # miss (source filed nothing under B) → fallback to top-level entry.
    con = _constraint(
        "aaaa1111", "bbbb2222",
        matrix={"long": {"formal": {"mode": "exclude", "factor": 1}}},
        uid="uidcon000001", bundle_origin="originB",
    )
    for seed in range(20):
        ctx = _run([src, con, _outfit_target()], seed=seed)
        assert strip_internals(ctx)["outfit"] == "tshirt"


def test_fallback_no_bundle_anywhere_unchanged():
    """Neither source nor constraint carries an origin (pure legacy chain):
    identical to the pre-fix engine."""
    from engine.context import strip_internals
    src = _wildcard("aaaa1111", "hair", [
        {"id": "h1", "value": "short", "weight": 1, "sub_categories": ["short"]},
    ])
    con = _constraint(
        "aaaa1111", "bbbb2222",
        matrix={"short": {"casual": {"mode": "exclude", "factor": 1}}},
    )
    for seed in range(20):
        ctx = _run([src, con, _outfit_target()], seed=seed)
        assert strip_internals(ctx)["outfit"] == "kimono"
