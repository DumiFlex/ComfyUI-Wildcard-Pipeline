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


def _hair_src(uuid: str, value: str, sub: str, *, uid: str,
              bundle_origin: str) -> dict:
    # Single-option pool → the source pick is deterministic across seeds.
    return _wildcard(uuid, "hair", [
        {"id": f"h_{value}", "value": value, "weight": 1, "sub_categories": [sub]},
    ], uid=uid, bundle_origin=bundle_origin)


def _mood_target(uuid: str, *, uid: str, bundle_origin: str) -> dict:
    return _wildcard(uuid, "mood", [
        {"id": "m_pos", "value": "joyful", "weight": 1, "sub_categories": ["positive"]},
        {"id": "m_neg", "value": "melancholic", "weight": 1, "sub_categories": ["negative"]},
    ], uid=uid, bundle_origin=bundle_origin)


# Both constraints carry the SAME two-row matrix so that whichever source
# tag a constraint actually reads forces a DEFINITE, seed-independent target
# (exclude collapses the 2-option pool to exactly one survivor):
#     source 'long'  -> exclude negative -> target MUST be joyful
#     source 'short' -> exclude positive -> target MUST be melancholic
# This makes the broken-vs-fixed outcome deterministic per seed: a constraint
# reading the WRONG source flips its target to the wrong mood every time, not
# just statistically.
_BOTH_ROWS = {
    "long": {"negative": {"mode": "exclude", "factor": 1}},
    "short": {"positive": {"mode": "exclude", "factor": 1}},
}


def test_double_insert_each_constraint_reads_its_own_source_pick():
    """Two copies of a bundle `[W ← C ← T]`. W is the SAME library uuid in
    both copies (that's the collision); copy-1 pins source 'long', copy-2
    pins source 'short'. Both constraints carry `_BOTH_ROWS`, so:
        copy-1 reads 'long'  -> target tttt0001 MUST be joyful
        copy-2 reads 'short' -> target tttt0002 MUST be melancholic

    CHAIN ORDER is load-bearing: BOTH sources run BEFORE either target, so
    the top-level `__wp_picks__['wwww0001']` bucket holds the LAST writer
    ('short') by the time any target resolves. Pre-fix, both constraints
    read that survivor 'short' → BOTH targets exclude positive → BOTH become
    melancholic; copy-1's `joyful` expectation fails on EVERY seed. Post-fix,
    each constraint reads its own copy's source via `by_origin[B_n]`, so the
    two targets diverge as specified.

    The mood targets use DISTINCT library uuids so each constraint's
    `target_wildcard_id` resolves to exactly one target instance — keeps the
    test about the SOURCE bucket, not target reach (SP3 untouched).
    """
    from engine.context import strip_internals

    w1 = _hair_src("wwww0001", "long", "long",
                   uid="uidw1000001", bundle_origin="B1")
    c1 = _constraint(
        "wwww0001", "tttt0001", matrix=_BOTH_ROWS,
        uid="uidc1000001", bundle_origin="B1",
    )
    t1 = _mood_target("tttt0001", uid="uidt1000001", bundle_origin="B1")

    w2 = _hair_src("wwww0001", "short", "short",
                   uid="uidw2000001", bundle_origin="B2")
    c2 = _constraint(
        "wwww0001", "tttt0002", matrix=_BOTH_ROWS,
        uid="uidc2000001", bundle_origin="B2",
    )
    t2 = _mood_target("tttt0002", uid="uidt2000001", bundle_origin="B2")

    # BOTH sources first, THEN both constraint+target pairs. This is what
    # makes the top-level bucket hold the wrong (survivor) source when each
    # target resolves — the precise condition the collision needs.
    for seed in range(20):
        ctx = _run([w1, w2, c1, t1, c2, t2], seed=seed)
        out = strip_internals(ctx)
        picks = ctx["__wp_picks__"]
        # Per-instance truth is read from each target's recorded pick: both
        # targets bind `mood`, so the flattened `mood` var only shows the
        # last write (tttt0002 = melancholic). The diverging assertion is on
        # the per-target picks.
        assert out["mood"] == "melancholic"  # last write (copy-2's target)
        assert picks["tttt0001"]["value"] == "joyful", (
            f"seed {seed}: copy-1 must read its OWN source 'long' "
            f"(exclude negative -> joyful), not the survivor 'short'"
        )
        assert picks["tttt0002"]["value"] == "melancholic", (
            f"seed {seed}: copy-2 must read its OWN source 'short' "
            f"(exclude positive -> melancholic)"
        )
