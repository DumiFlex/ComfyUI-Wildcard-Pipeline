"""Simulation of user's reported chain — verifies constraints actually
fire end-to-end through the engine.

Chain order (matches screenshot 2026-05-26):

    1. hair_style  wildcard (source for hair_x_mood)
    2. shirt       wildcard (source for shirt_x_color_compat)
    3. hair_x_mood constraint #1 (source=hair_style, target=mood)
    4. shirt_x_color_compat constraint #1 (source=shirt, target=color)
    5. backdrop    wildcard — options carry `@{color}` AND `@{mood}` refs
    6. (final framing bundle)
       6a. hair_x_mood constraint #2 (second instance of same constraint)
       6b. mood     wildcard (top-level instance)
       6c. outfit   wildcard

Expected behaviour:

    - hair_x_mood #1 fires on backdrop's nested `@{mood}` resolution
    - shirt_x_color_compat #1 fires on backdrop's nested `@{color}`
    - hair_x_mood #2 fires on the top-level `mood` wildcard in final framing
    - all three constraints land in `__wp_consumed_constraints__`
    - zero `constraint_never_applied` warnings

If any of those expectations fail the constraint runtime is broken in
some subtle way — useful diagnostic for the "never_applied" warnings
the user saw on iteration 1.
"""
from __future__ import annotations

from engine.pipeline import PipelineEngine

# UUIDs — 8 hex chars, matching the runtime regex `[0-9a-f]{8}`.
HAIR_STYLE = "a1a1a1a1"
SHIRT = "b2b2b2b2"
MOOD = "c3c3c3c3"
COLOR = "d4d4d4d4"
BACKDROP = "e5e5e5e5"
OUTFIT = "f6f6f6f6"

CN_HAIR_X_MOOD_1 = "cc111111"
CN_SHIRT_X_COLOR = "cc222222"
CN_HAIR_X_MOOD_2 = "cc333333"


def _wildcard(uuid: str, var: str, options, sub_categories=None):
    """Match the shape `WildcardHandler` expects post-coerce."""
    return {
        "id": uuid,
        "type": "wildcard",
        "enabled": True,
        "payload": {
            "var_binding": var,
            "options": options,
            "sub_categories": list(sub_categories or []),
        },
    }


def _constraint(module_id: str, source_uuid: str, target_uuid: str, matrix=None):
    return {
        "id": module_id,
        "type": "constraint",
        "enabled": True,
        "payload": {
            "source_wildcard_id": source_uuid,
            "target_wildcard_id": target_uuid,
            "matrix": matrix or {},
            "exceptions": [],
        },
    }


def _build_catalog():
    """Catalog seen by `_resolve_ref` for nested `@{uuid}` lookups.
    Includes mood + color because backdrop references them, plus every
    other wildcard so the constraint sources are findable."""
    return {
        HAIR_STYLE: _wildcard(HAIR_STYLE, "hair_style", [
            {"id": "h1", "value": "long", "weight": 1, "sub_category": "long"},
            {"id": "h2", "value": "short", "weight": 1, "sub_category": "short"},
        ]),
        SHIRT: _wildcard(SHIRT, "shirt", [
            {"id": "s1", "value": "tee", "weight": 1, "sub_category": "casual"},
            {"id": "s2", "value": "blouse", "weight": 1, "sub_category": "formal"},
        ]),
        MOOD: _wildcard(MOOD, "mood", [
            {"id": "m1", "value": "BAD_warm", "weight": 1, "sub_category": "warm"},
            {"id": "m2", "value": "ok_cool", "weight": 1, "sub_category": "cool"},
        ]),
        COLOR: _wildcard(COLOR, "color", [
            {"id": "c1", "value": "BAD_red", "weight": 1, "sub_category": "warm"},
            {"id": "c2", "value": "ok_blue", "weight": 1, "sub_category": "cool"},
        ]),
        BACKDROP: _wildcard(BACKDROP, "backdrop", [
            # Carrier option — references BOTH nested wildcards in one
            # option value so a single backdrop roll exercises both
            # constraints on the nested-ref path.
            {"id": "bd1", "value": f"under @{{{COLOR}}} sky with @{{{MOOD}}} air", "weight": 1},
        ]),
        OUTFIT: _wildcard(OUTFIT, "outfit", [
            {"id": "o1", "value": "jacket", "weight": 1},
        ]),
    }


def _build_modules():
    """Flat module list — same order as user's WP_Context view."""
    return [
        _wildcard(HAIR_STYLE, "hair_style", [
            {"id": "h1", "value": "long", "weight": 1, "sub_category": "long"},
        ]),
        _wildcard(SHIRT, "shirt", [
            {"id": "s1", "value": "tee", "weight": 1, "sub_category": "casual"},
        ]),
        _constraint(
            CN_HAIR_X_MOOD_1, HAIR_STYLE, MOOD,
            # Matrix: source sub_category "long" excludes target sub_category "warm".
            # That kills the BAD_warm mood option, leaving only ok_cool.
            matrix={"long": {"warm": {"mode": "exclude", "factor": 1}}},
        ),
        _constraint(
            CN_SHIRT_X_COLOR, SHIRT, COLOR,
            # Source "casual" excludes color "warm" — kills BAD_red.
            matrix={"casual": {"warm": {"mode": "exclude", "factor": 1}}},
        ),
        _wildcard(BACKDROP, "backdrop", [
            {"id": "bd1", "value": f"under @{{{COLOR}}} sky with @{{{MOOD}}} air", "weight": 1},
        ]),
        # Final framing bundle contents (engine sees them flat).
        _constraint(
            CN_HAIR_X_MOOD_2, HAIR_STYLE, MOOD,
            matrix={"long": {"warm": {"mode": "exclude", "factor": 1}}},
        ),
        _wildcard(MOOD, "mood", [
            {"id": "m1", "value": "BAD_warm", "weight": 1, "sub_category": "warm"},
            {"id": "m2", "value": "ok_cool", "weight": 1, "sub_category": "cool"},
        ]),
        _wildcard(OUTFIT, "outfit", [
            {"id": "o1", "value": "jacket", "weight": 1},
        ]),
    ]


def _run(seed: int = 7) -> dict:
    """Drive the real `PipelineEngine` with a seeded ctx that has the
    library catalog pre-populated — same shape `WP_Context.execute`
    builds via `deserialize_node_input` + `_expand_catalog_via_live_db`."""
    ctx = {"__wp_catalog__": _build_catalog()}
    engine = PipelineEngine()
    return engine.run(_build_modules(), ctx=ctx, seed=seed)


# ─────────────────────────────────────────────────────────────────────
# Tests


def test_chain_runs_without_engine_exception():
    ctx = _run()
    assert "__wp_trace__" in ctx


def test_backdrop_resolves_with_both_nested_refs():
    """Backdrop's only option carries `@{color}` and `@{mood}`. After
    resolve the `backdrop` ctx var should hold the rolled color + mood
    inline — proves both nested refs actually fired."""
    ctx = _run()
    val = ctx.get("backdrop") or ""
    assert "sky with" in val, f"backdrop didn't resolve: {val!r}"
    # Both nested wildcards rolled — their resolved values should be
    # substituted into the carrier text.
    assert "@{" not in val, f"unresolved ref token in backdrop: {val!r}"


def test_constraint_hair_x_mood_1_consumed():
    """First hair_x_mood should fire when backdrop's @{mood} rolls."""
    ctx = _run()
    consumed = ctx.get("__wp_consumed_constraints__", set())
    assert CN_HAIR_X_MOOD_1 in consumed, (
        f"hair_x_mood #1 never consumed. consumed={consumed}, "
        f"warnings={[w.get('detail') for w in ctx.get('__wp_warnings__', [])]}"
    )


def test_constraint_shirt_x_color_consumed():
    """shirt_x_color_compat should fire when backdrop's @{color} rolls."""
    ctx = _run()
    consumed = ctx.get("__wp_consumed_constraints__", set())
    assert CN_SHIRT_X_COLOR in consumed, (
        f"shirt_x_color_compat never consumed. consumed={consumed}, "
        f"warnings={[w.get('detail') for w in ctx.get('__wp_warnings__', [])]}"
    )


def test_constraint_hair_x_mood_2_consumed():
    """Second hair_x_mood should fire on top-level `mood` in final framing."""
    ctx = _run()
    consumed = ctx.get("__wp_consumed_constraints__", set())
    assert CN_HAIR_X_MOOD_2 in consumed, (
        f"hair_x_mood #2 never consumed. consumed={consumed}, "
        f"warnings={[w.get('detail') for w in ctx.get('__wp_warnings__', [])]}"
    )


def test_no_constraint_never_applied_warnings():
    """End-of-run check should emit zero never_applied warnings — all
    three constraints fired (two on backdrop's nested refs + one on
    top-level mood)."""
    ctx = _run()
    never_applied = [
        w for w in ctx.get("__wp_warnings__", [])
        if w.get("type") == "constraint_never_applied"
    ]
    detail = [w.get("detail") for w in never_applied]
    assert never_applied == [], (
        f"expected zero never_applied warnings, got {len(never_applied)}: {detail}"
    )


def test_top_level_mood_respects_constraint():
    """hair_style rolled 'long' → matrix excludes 'warm' sub_category →
    top-level mood must pick `ok_cool`, never `BAD_warm`."""
    ctx = _run()
    mood_val = ctx.get("mood") or ""
    assert mood_val == "ok_cool", (
        f"mood ignored constraint: rolled {mood_val!r} but matrix "
        f"should have excluded the 'warm' option"
    )


def test_backdrop_nested_color_respects_constraint():
    """Backdrop's `@{color}` resolution should also be constrained by
    shirt_x_color_compat — rolled color sub_category must NOT be 'warm'
    (shirt rolled 'casual' → matrix excludes 'warm')."""
    ctx = _run()
    val = ctx.get("backdrop") or ""
    # The carrier text is `under <color> sky with <mood> air`.
    # `BAD_red` is the warm color option — must not appear.
    assert "BAD_red" not in val, (
        f"backdrop nested @{{color}} ignored constraint: {val!r}"
    )


def test_multiple_seeds_consistent_constraint_consumption():
    """Sanity check across seeds — every seed should consume all three
    constraints (the only roll that varies is which option within a
    given sub-category wins, not whether the constraint fires)."""
    for seed in (0, 1, 7, 42, 99, 1234):
        ctx = {"__wp_catalog__": _build_catalog()}
        engine = PipelineEngine()
        ctx = engine.run(_build_modules(), ctx=ctx, seed=seed)
        consumed = ctx.get("__wp_consumed_constraints__", set())
        assert {CN_HAIR_X_MOOD_1, CN_SHIRT_X_COLOR, CN_HAIR_X_MOOD_2}.issubset(consumed), (
            f"seed {seed}: missing constraints in consumed={consumed}"
        )


# ─────────────────────────────────────────────────────────────────────
# Carrier-claim failsafe (2026-05-26) — no spill past a carrier.


def test_carrier_claims_constraint_no_spill_to_later_instance():
    """A carrier (backdrop) that rolls an option WITHOUT the @{target}
    ref still claims the constraint positionally — so a later top-level
    target instance is NOT constrained (no spill). Matches the pair
    badge, which assigns the constraint to backdrop (the first carrier).

    Chain: shirt → shirt_x_color constraint → backdrop (carries @{color}
    in some options, but we force the no-ref option) → color (top-level
    AFTER backdrop). The top-level color must roll FREE (unconstrained)
    because backdrop already claimed the constraint."""
    SHIRT = "b2b2b2b2"
    COLOR = "a361dbdc"
    BACKDROP = "b0b0b0b0"
    CN = "cc222222"
    modules = [
        _wildcard(SHIRT, "shirt", [
            {"id": "s1", "value": "tee", "weight": 1, "sub_category": "casual"},
        ]),
        _constraint(
            CN, SHIRT, COLOR,
            matrix={"casual": {"warm": {"mode": "exclude", "factor": 1}}},
        ),
        # Backdrop CARRIES @{color} (it's a carrier) but the ONLY option
        # has no ref — forces the "carrier rolled, ref omitted" path.
        # A second option WITH the ref makes it a genuine carrier in the
        # static sense; weight 0 so RNG never picks it (deterministic).
        _wildcard(BACKDROP, "backdrop", [
            {"id": "bd1", "value": "plain studio", "weight": 1},
            {"id": "bd2", "value": f"with @{{{COLOR}}}", "weight": 0},
        ]),
        # Top-level color AFTER backdrop — should NOT be constrained.
        _wildcard(COLOR, "color", [
            {"id": "c1", "value": "warm_red", "weight": 1, "sub_category": "warm"},
            {"id": "c2", "value": "cool_blue", "weight": 1, "sub_category": "cool"},
        ]),
    ]
    catalog = {
        COLOR: _wildcard(COLOR, "color", [
            {"id": "c1", "value": "warm_red", "weight": 1, "sub_category": "warm"},
            {"id": "c2", "value": "cool_blue", "weight": 1, "sub_category": "cool"},
        ]),
    }
    # Across seeds the top-level color should sometimes roll warm_red —
    # proving it's NOT being constrained (constraint excludes warm).
    saw_warm = False
    for seed in range(20):
        ctx = {"__wp_catalog__": dict(catalog)}
        ctx = PipelineEngine().run(modules, ctx=ctx, seed=seed)
        consumed = ctx.get("__wp_consumed_constraints__", set())
        # Backdrop claimed the constraint (consumed-as-skipped).
        assert CN in consumed, f"seed {seed}: carrier didn't claim constraint"
        if "warm_red" in (ctx.get("color") or ""):
            saw_warm = True
    assert saw_warm, (
        "top-level color never rolled warm across 20 seeds — it's being "
        "constrained, meaning the constraint spilled past the carrier"
    )


def test_carrier_claim_noop_when_source_not_picked():
    """The carrier only claims when the constraint's source is already
    picked. If the source rolls AFTER the carrier, the carrier must NOT
    claim (leaves the constraint free to apply once the source + a real
    target resolution land later)."""
    SHIRT = "b2b2b2b2"
    COLOR = "a361dbdc"
    BACKDROP = "b0b0b0b0"
    CN = "cc222222"
    # Carrier (backdrop) comes BEFORE the source (shirt) — source not
    # picked when carrier rolls, so no claim.
    modules = [
        _constraint(
            CN, SHIRT, COLOR,
            matrix={"casual": {"warm": {"mode": "exclude", "factor": 1}}},
        ),
        _wildcard(BACKDROP, "backdrop", [
            {"id": "bd1", "value": "plain studio", "weight": 1},
            {"id": "bd2", "value": f"with @{{{COLOR}}}", "weight": 0},
        ]),
        _wildcard(SHIRT, "shirt", [
            {"id": "s1", "value": "tee", "weight": 1, "sub_category": "casual"},
        ]),
    ]
    ctx = {"__wp_catalog__": {}}
    ctx = PipelineEngine().run(modules, ctx=ctx, seed=0)
    consumed = ctx.get("__wp_consumed_constraints__", set())
    assert CN not in consumed, (
        "carrier claimed the constraint despite source not being picked "
        "yet — claim must wait for source readiness"
    )


def test_never_applied_message_distinguishes_present_vs_absent():
    """The end-of-run warning wording differs by cause: target present
    in chain (ordering issue) vs target uuid absent (typo)."""
    # Absent target — no instance, no carrier anywhere.
    GHOST = "deadbeef"
    modules_absent = [
        _wildcard("11111111", "src", [
            {"id": "s1", "value": "a", "weight": 1, "sub_category": "x"},
        ]),
        _constraint("22222222", "11111111", GHOST),
    ]
    ctx = PipelineEngine().run(modules_absent, ctx={"__wp_catalog__": {}}, seed=0)
    w = next(
        x for x in ctx["__wp_warnings__"]
        if x.get("type") == "constraint_never_applied"
    )
    assert w["detail"]["target_present"] is False
    assert "no @{deadbeef}" in w["message"]

    # Present target — instance exists but rolled BEFORE the constraint.
    TGT = "33333333"
    modules_present = [
        _wildcard(TGT, "tgt", [
            {"id": "t1", "value": "early", "weight": 1, "sub_category": "warm"},
        ]),
        _wildcard("11111111", "src", [
            {"id": "s1", "value": "a", "weight": 1, "sub_category": "x"},
        ]),
        _constraint("22222222", "11111111", TGT),
    ]
    ctx = PipelineEngine().run(modules_present, ctx={"__wp_catalog__": {}}, seed=0)
    w = next(
        x for x in ctx["__wp_warnings__"]
        if x.get("type") == "constraint_never_applied"
    )
    assert w["detail"]["target_present"] is True
    assert "exists in the chain" in w["message"]


# ─────────────────────────────────────────────────────────────────────
# Cross-node propagation regression (2026-05-26)
#
# Before today's fix, two sequential WP_Context nodes downstream of
# each other duplicated `constraint_never_applied` warnings: Context A
# ran the never_applied check at end of run + emitted warnings, then
# Context B inherited `__wp_constraints__` (which IS cross-node) but
# NOT `__wp_consumed_constraints__` (which used to NOT propagate), so
# B re-ran the same check with a fresh consumed set and re-warned for
# every constraint already consumed in A. The user saw 4 warnings for
# a 3-constraint chain.
#
# Repro: build A's bucket + consumed via PipelineEngine, copy the same
# pattern the cross-node copy in `WP_Context.execute` does, run a
# second pipeline on a different module set, then count warnings after
# the `build_payload` merge.


def test_end_of_run_dedupes_warnings_by_cid():
    """Two sibling constraint instances with the same library uuid
    register two entries in the bucket. End-of-run check used to emit
    a warning per entry — now emits one per distinct cid."""
    # Use a target uuid that NEVER rolls so neither constraint can
    # consume. Two siblings, same library uuid, registered twice.
    GHOST_TGT = "00000000"
    modules = [
        # Source for both — needs to roll so source_pick exists.
        _wildcard("11111111", "src", [
            {"id": "s1", "value": "a", "weight": 1, "sub_category": "x"},
        ]),
        # Two sibling constraints, same library uuid → same
        # `__constraint_module_id__`.
        _constraint("22222222", "11111111", GHOST_TGT),
        _constraint("22222222", "11111111", GHOST_TGT),
    ]
    ctx = {"__wp_catalog__": {}}
    ctx = PipelineEngine().run(modules, ctx=ctx, seed=0)
    never_applied = [
        w for w in ctx.get("__wp_warnings__", [])
        if w.get("type") == "constraint_never_applied"
    ]
    assert len(never_applied) == 1, (
        f"expected 1 deduped warning, got {len(never_applied)}: "
        f"{[w.get('module_id') for w in never_applied]}"
    )


def test_consumed_set_propagates_cross_node():
    """`__wp_consumed_constraints__` must be in cross-node-internals so
    a downstream Context doesn't re-warn constraints already consumed
    upstream. Simulates the WP_Context.execute cross-node copy step
    + the build_payload warning dedup."""
    from wp_nodes.types import _CROSS_NODE_INTERNAL_KEYS, build_payload

    assert "__wp_consumed_constraints__" in _CROSS_NODE_INTERNAL_KEYS, (
        "consumed bookkeeping must propagate cross-node — otherwise "
        "downstream Contexts re-warn every constraint upstream already "
        "consumed"
    )

    # Sanity: build_payload writes the consumed set into internals
    # (verifies _CROSS_NODE_INTERNAL_KEYS is actually consulted).
    ctx = {
        "__wp_consumed_constraints__": {"abc12345"},
        "__wp_constraints__": [],
        "__wp_picks__": {},
        "__wp_trace__": [],
        "__wp_warnings__": [],
    }
    payload = build_payload(ctx, upstream_debug={}, seed=0)
    assert payload.internals.get("__wp_consumed_constraints__") == {"abc12345"}


def test_constraint_targets_next_color_not_source_nested():
    """User's mental model (2026-05-26): when the SOURCE wildcard's own
    option carries a nested `@{target}` ref AND the constraint sits
    after the source, the constraint should NOT try to grab the
    source's own nested roll (it happened before the constraint
    registered). It should claim the NEXT target instance downstream —
    e.g. a `@{color}` inside a backdrop wildcard placed after the
    constraint.

    Chain: shirt (option = `@{color} t-shirt`) → shirt_x_color
    constraint → backdrop (option = `studio with @{color} accents`).

    Expected: shirt's nested color rolls FREE (no constraint yet),
    backdrop's nested color is CONSTRAINED (warm excluded → ok_blue),
    constraint consumed, zero warnings."""
    SHIRT = "b2b2b2b2"
    COLOR = "a361dbdc"
    BACKDROP = "b0219910"
    CN = "cc222222"
    modules = [
        _wildcard(SHIRT, "shirt", [
            {"id": "s1", "value": f"@{{{COLOR}}} t-shirt", "weight": 1, "sub_category": "casual"},
        ]),
        _constraint(
            CN, SHIRT, COLOR,
            matrix={"casual": {"warm": {"mode": "exclude", "factor": 1}}},
        ),
        _wildcard(BACKDROP, "backdrop", [
            {"id": "bd1", "value": f"studio with @{{{COLOR}}} accents", "weight": 1},
        ]),
    ]
    catalog = {
        COLOR: _wildcard(COLOR, "color", [
            {"id": "c1", "value": "BAD_red", "weight": 1, "sub_category": "warm"},
            {"id": "c2", "value": "ok_blue", "weight": 1, "sub_category": "cool"},
        ]),
    }
    for seed in (0, 1, 7, 42, 99):
        ctx = {"__wp_catalog__": dict(catalog)}
        ctx = PipelineEngine().run(modules, ctx=ctx, seed=seed)
        consumed = ctx.get("__wp_consumed_constraints__", set())
        warns = [
            w for w in ctx.get("__wp_warnings__", [])
            if w.get("type") == "constraint_never_applied"
        ]
        backdrop_val = ctx.get("backdrop") or ""
        assert CN in consumed, f"seed {seed}: constraint didn't fire on backdrop's color"
        assert warns == [], f"seed {seed}: unexpected warnings {warns}"
        # Backdrop's nested color must respect the constraint → ok_blue.
        assert "BAD_red" not in backdrop_val, (
            f"seed {seed}: backdrop color ignored constraint: {backdrop_val!r}"
        )


def test_build_payload_dedupes_constraint_never_applied():
    """`build_payload` merges upstream + this-run warnings. Without
    dedup, the same constraint_never_applied row from A's end-of-run
    appears AGAIN in B's end-of-run (because B inherited the constraint
    bucket + ran the check again). Dedup key is (type, module_id)."""
    from wp_nodes.types import build_payload

    upstream_debug = {
        "__wp_warnings__": [
            {
                "type": "constraint_never_applied",
                "severity": "info",
                "module_id": "ghost001",
                "detail": {"constraint_id": "ghost001"},
                "message": "...",
            },
        ],
    }
    ctx = {
        "__wp_warnings__": [
            # Same constraint id — should be deduped against upstream.
            {
                "type": "constraint_never_applied",
                "severity": "info",
                "module_id": "ghost001",
                "detail": {"constraint_id": "ghost001"},
                "message": "...",
            },
            # Different cid — should survive.
            {
                "type": "constraint_never_applied",
                "severity": "info",
                "module_id": "ghost002",
                "detail": {"constraint_id": "ghost002"},
                "message": "...",
            },
            # Unrelated warning type — not deduped.
            {
                "type": "unknown_wildcard_ref",
                "severity": "warn",
                "module_id": "x",
                "message": "...",
            },
        ],
        "__wp_trace__": [],
        "__wp_constraints__": [],
        "__wp_picks__": {},
        "__wp_consumed_constraints__": set(),
    }
    payload = build_payload(ctx, upstream_debug=upstream_debug, seed=0)
    out_warnings = payload.debug["__wp_warnings__"]
    cids = [
        w.get("module_id") for w in out_warnings
        if w.get("type") == "constraint_never_applied"
    ]
    # One ghost001 (the duplicate dropped), one ghost002.
    assert cids == ["ghost001", "ghost002"], f"unexpected dedup result: {cids}"
    # Non-constraint warning survived unchanged.
    assert any(w.get("type") == "unknown_wildcard_ref" for w in out_warnings)
