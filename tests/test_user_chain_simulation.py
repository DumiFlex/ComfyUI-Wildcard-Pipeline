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

Expected behaviour (SP3 reach selector, default `all`):

    - hair_x_mood #1 (registered first) covers BOTH the backdrop nested
      `@{mood}` AND the top-level `mood` → hit count 2
    - shirt_x_color_compat covers backdrop's nested `@{color}` → hit count 1
    - hair_x_mood #2 (registered after backdrop) covers only the
      top-level `mood` → hit count 1
    - every constraint has a non-zero hit count in `__wp_constraint_hits__`
    - zero `constraint_never_applied` warnings

Pre-SP3 this chain rode the one-shot consumed-set (each constraint
fired exactly once); SP3 retired that for the reach selector, so the
default `all` constraints now re-weight every downstream occurrence.

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


def _constraint(module_id: str, source_uuid: str, target_uuid: str, matrix=None, uid=None):
    out = {
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
    # Per-instance uid — distinct from the library `id`. Two sibling
    # instances of one library constraint entry share `id` but get their
    # own `_uid`; the engine keys the SP3 hit counter on `_uid` so they
    # count independently.
    if uid is not None:
        out["_uid"] = uid
    return out


def _build_catalog():
    """Catalog seen by `_resolve_ref` for nested `@{uuid}` lookups.
    Includes mood + color because backdrop references them, plus every
    other wildcard so the constraint sources are findable."""
    return {
        HAIR_STYLE: _wildcard(HAIR_STYLE, "hair_style", [
            {"id": "h1", "value": "long", "weight": 1, "sub_categories": ["long"]},
            {"id": "h2", "value": "short", "weight": 1, "sub_categories": ["short"]},
        ]),
        SHIRT: _wildcard(SHIRT, "shirt", [
            {"id": "s1", "value": "tee", "weight": 1, "sub_categories": ["casual"]},
            {"id": "s2", "value": "blouse", "weight": 1, "sub_categories": ["formal"]},
        ]),
        MOOD: _wildcard(MOOD, "mood", [
            {"id": "m1", "value": "BAD_warm", "weight": 1, "sub_categories": ["warm"]},
            {"id": "m2", "value": "ok_cool", "weight": 1, "sub_categories": ["cool"]},
        ]),
        COLOR: _wildcard(COLOR, "color", [
            {"id": "c1", "value": "BAD_red", "weight": 1, "sub_categories": ["warm"]},
            {"id": "c2", "value": "ok_blue", "weight": 1, "sub_categories": ["cool"]},
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
            {"id": "h1", "value": "long", "weight": 1, "sub_categories": ["long"]},
        ]),
        _wildcard(SHIRT, "shirt", [
            {"id": "s1", "value": "tee", "weight": 1, "sub_categories": ["casual"]},
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
            {"id": "m1", "value": "BAD_warm", "weight": 1, "sub_categories": ["warm"]},
            {"id": "m2", "value": "ok_cool", "weight": 1, "sub_categories": ["cool"]},
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


def test_constraint_hair_x_mood_1_covers_both_mood_occurrences():
    """hair_x_mood #1 (registered first) covers BOTH the backdrop nested
    @{mood} and the top-level mood under default `all` → hit count 2."""
    ctx = _run()
    hits = ctx.get("__wp_constraint_hits__", {})
    assert hits.get(CN_HAIR_X_MOOD_1) == 2, (
        f"hair_x_mood #1 expected to cover both mood occurrences. hits={hits}, "
        f"warnings={[w.get('detail') for w in ctx.get('__wp_warnings__', [])]}"
    )


def test_constraint_shirt_x_color_fires():
    """shirt_x_color_compat covers backdrop's nested @{color} → hit count 1
    (the only color occurrence downstream of it)."""
    ctx = _run()
    hits = ctx.get("__wp_constraint_hits__", {})
    assert hits.get(CN_SHIRT_X_COLOR) == 1, (
        f"shirt_x_color_compat never fired. hits={hits}, "
        f"warnings={[w.get('detail') for w in ctx.get('__wp_warnings__', [])]}"
    )


def test_constraint_hair_x_mood_2_fires_on_top_level_only():
    """hair_x_mood #2 registers AFTER backdrop, so it misses backdrop's
    nested mood (resolved earlier) and covers only the top-level mood in
    final framing → hit count 1."""
    ctx = _run()
    hits = ctx.get("__wp_constraint_hits__", {})
    assert hits.get(CN_HAIR_X_MOOD_2) == 1, (
        f"hair_x_mood #2 never fired. hits={hits}, "
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


def test_multiple_seeds_consistent_constraint_firing():
    """Sanity check across seeds — every seed should fire all three
    constraints (the only roll that varies is which option within a
    given sub-category wins, not whether the constraint fires)."""
    for seed in (0, 1, 7, 42, 99, 1234):
        ctx = {"__wp_catalog__": _build_catalog()}
        engine = PipelineEngine()
        ctx = engine.run(_build_modules(), ctx=ctx, seed=seed)
        hits = ctx.get("__wp_constraint_hits__", {})
        for cid in (CN_HAIR_X_MOOD_1, CN_SHIRT_X_COLOR, CN_HAIR_X_MOOD_2):
            assert hits.get(cid, 0) >= 1, (
                f"seed {seed}: constraint {cid} never fired, hits={hits}"
            )


# ─────────────────────────────────────────────────────────────────────
# Carrier that doesn't resolve the ref (SP3: no claim, no spill — the
# constraint simply applies on the next ACTUAL target resolution).


def test_carrier_without_ref_does_not_block_later_target():
    """SP3 retired the carrier-claim failsafe. A carrier (backdrop) that
    rolls an option WITHOUT the @{target} ref does NOT count as a target
    occurrence — the constraint just applies on the next ACTUAL target
    resolution (the top-level color after backdrop), which is now
    constrained. (Pre-SP3 the carrier "claimed" the one-shot so the
    later target rolled free — that consumed-set model is gone.)

    Chain: shirt → shirt_x_color constraint → backdrop (rolls a no-ref
    option) → color (top-level AFTER backdrop). The top-level color must
    be CONSTRAINED (warm excluded → never warm_red)."""
    SHIRT = "b2b2b2b2"
    COLOR = "a361dbdc"
    BACKDROP = "b0b0b0b0"
    CN = "cc222222"
    modules = [
        _wildcard(SHIRT, "shirt", [
            {"id": "s1", "value": "tee", "weight": 1, "sub_categories": ["casual"]},
        ]),
        _constraint(
            CN, SHIRT, COLOR,
            matrix={"casual": {"warm": {"mode": "exclude", "factor": 1}}},
        ),
        # Backdrop's only reachable option has no ref (the weight-0
        # ref option never wins) — so backdrop resolves no @{color}.
        _wildcard(BACKDROP, "backdrop", [
            {"id": "bd1", "value": "plain studio", "weight": 1},
            {"id": "bd2", "value": f"with @{{{COLOR}}}", "weight": 0},
        ]),
        # Top-level color AFTER backdrop — IS constrained now.
        _wildcard(COLOR, "color", [
            {"id": "c1", "value": "warm_red", "weight": 1, "sub_categories": ["warm"]},
            {"id": "c2", "value": "cool_blue", "weight": 1, "sub_categories": ["cool"]},
        ]),
    ]
    catalog = {
        COLOR: _wildcard(COLOR, "color", [
            {"id": "c1", "value": "warm_red", "weight": 1, "sub_categories": ["warm"]},
            {"id": "c2", "value": "cool_blue", "weight": 1, "sub_categories": ["cool"]},
        ]),
    }
    for seed in range(20):
        ctx = {"__wp_catalog__": dict(catalog)}
        ctx = PipelineEngine().run(modules, ctx=ctx, seed=seed)
        hits = ctx.get("__wp_constraint_hits__", {})
        # The top-level color is the single actual occurrence → fired once.
        assert hits.get(CN) == 1, f"seed {seed}: expected one firing, hits={hits}"
        # Constrained → warm excluded → never warm_red.
        assert "warm_red" not in (ctx.get("color") or ""), (
            f"seed {seed}: top-level color ignored constraint (rolled warm)"
        )


def test_carrier_null_pick_does_not_count_as_occurrence():
    """A carrier (backdrop) whose winning option is empty/null resolves
    no @{color}, so it does NOT count as a target occurrence — no
    never_applied warning is emitted on its account (the constraint
    legitimately found no downstream color this run). Under SP3 there's
    nothing to "claim"; hits stays 0 and the never_applied warning is
    the correct signal.

    Chain: shirt → shirt_x_color → backdrop (winning option empty,
    weight-0 option carries @{color}). No actual color resolution
    anywhere → constraint never fires → exactly one never_applied."""
    SHIRT = "b2b2b2b2"
    COLOR = "a361dbdc"
    BACKDROP = "b0b0b0b0"
    CN = "cc222222"
    modules = [
        _wildcard(SHIRT, "shirt", [
            {"id": "s1", "value": "tee", "weight": 1, "sub_categories": ["casual"]},
        ]),
        _constraint(
            CN, SHIRT, COLOR,
            matrix={"casual": {"warm": {"mode": "exclude", "factor": 1}}},
        ),
        # Backdrop: the winning option is empty (null); the weight-0
        # option carries @{color} but never wins → no color resolves.
        _wildcard(BACKDROP, "backdrop", [
            {"id": "bd_null", "value": "", "weight": 1},
            {"id": "bd_color", "value": f"@{{{COLOR}}}", "weight": 0},
        ]),
    ]
    catalog = {
        COLOR: _wildcard(COLOR, "color", [
            {"id": "c1", "value": "warm_red", "weight": 1, "sub_categories": ["warm"]},
            {"id": "c2", "value": "cool_blue", "weight": 1, "sub_categories": ["cool"]},
        ]),
    }
    for seed in (0, 1, 7, 42, 99):
        ctx = {"__wp_catalog__": dict(catalog)}
        ctx = PipelineEngine().run(modules, ctx=ctx, seed=seed)
        hits = ctx.get("__wp_constraint_hits__", {})
        warns = [
            w for w in ctx.get("__wp_warnings__", [])
            if w.get("type") == "constraint_never_applied"
        ]
        # No actual color resolution → constraint never fired.
        assert hits.get(CN, 0) == 0, f"seed {seed}: unexpected firing, hits={hits}"
        # The target IS present in the chain (carrier + top-level absent;
        # only the weight-0 carrier ref) → one never_applied warning.
        assert len(warns) == 1, f"seed {seed}: expected one never_applied, got {warns}"


def test_sibling_constraints_same_library_uuid_are_independent_oneshots():
    """User's real case (2026-05-26): TWO hair_x_mood instances share
    the SAME library uuid (id) but have distinct `_uid`. The pair badge
    shows #1 → backdrop (carrier), #2 → mood (direct top-level). The
    engine must honour that: backdrop claims instance #1, the top-level
    mood claims instance #2 → mood IS constrained. Pre-fix both keyed on
    the shared library uuid, so backdrop's claim spent BOTH and mood
    rolled unconstrained.

    Chain: hair_style → hair_x_mood#1 (uid A) → hair_x_mood#2 (uid B) →
    backdrop (carries @{mood}, rolls null) → mood (top-level)."""
    HAIR = "aaaa0001"
    MOOD = "c14e7527"
    BACKDROP = "b0b0b0b0"
    LIB_CID = "e41f5bc4"  # shared library uuid for both hair_x_mood
    modules = [
        _wildcard(HAIR, "hair_style", [
            {"id": "h1", "value": "long", "weight": 1, "sub_categories": ["long"]},
        ]),
        # Two instances, SAME library id, distinct _uid → independently
        # keyed in the hit counter (cid = `_uid`).
        _constraint(
            LIB_CID, HAIR, MOOD,
            matrix={"long": {"warm": {"mode": "exclude", "factor": 1}}},
            uid="uidA",
        ),
        _constraint(
            LIB_CID, HAIR, MOOD,
            matrix={"long": {"warm": {"mode": "exclude", "factor": 1}}},
            uid="uidB",
        ),
        # Backdrop carries @{mood} (weight-0 ref option) but rolls null —
        # resolves no nested mood.
        _wildcard(BACKDROP, "backdrop", [
            {"id": "bd_null", "value": "", "weight": 1},
            {"id": "bd_mood", "value": f"@{{{MOOD}}}", "weight": 0},
        ]),
        # Top-level mood AFTER backdrop — the single actual occurrence.
        _wildcard(MOOD, "mood", [
            {"id": "m1", "value": "warm_bad", "weight": 1, "sub_categories": ["warm"]},
            {"id": "m2", "value": "cool_ok", "weight": 1, "sub_categories": ["cool"]},
        ]),
    ]
    catalog = {
        MOOD: _wildcard(MOOD, "mood", [
            {"id": "m1", "value": "warm_bad", "weight": 1, "sub_categories": ["warm"]},
            {"id": "m2", "value": "cool_ok", "weight": 1, "sub_categories": ["cool"]},
        ]),
    }
    for seed in range(15):
        ctx = {"__wp_catalog__": dict(catalog)}
        ctx = PipelineEngine().run(modules, ctx=ctx, seed=seed)
        hits = ctx.get("__wp_constraint_hits__", {})
        # Both instances register before the top-level mood, so under the
        # default `all` reach BOTH cover it independently → each fired once.
        # (The per-`_uid` keying keeps siblings distinct — pre-SP3 both
        # keyed on the shared library uuid and a single fire spent both.)
        assert hits.get("uidA") == 1 and hits.get("uidB") == 1, (
            f"seed {seed}: both sibling instances should fire independently "
            f"(hits={hits})"
        )
        # mood was constrained → never the warm option.
        assert ctx.get("mood") == "cool_ok", (
            f"seed {seed}: top-level mood rolled {ctx.get('mood')!r} — it "
            f"wasn't constrained"
        )
        # No leftover warnings.
        warns = [
            w for w in ctx.get("__wp_warnings__", [])
            if w.get("type") == "constraint_never_applied"
        ]
        assert warns == [], f"seed {seed}: unexpected warnings {warns}"


def test_constraint_skipped_when_source_not_picked_yet():
    """A constraint whose source rolls AFTER it (so the source pick
    isn't recorded when the target would be reached) does not apply —
    it's skipped with an unknown_constraint_source signal rather than
    firing on stale/absent source data. (Pre-SP3 this was framed as the
    carrier-claim deferring; SP3 has no claim — the apply path itself
    skips + warns when the source pick is missing.)

    Chain: constraint(src=shirt) → backdrop (no-ref roll) → shirt. The
    constraint never reaches an actual color target AND its source rolls
    last, so it never fires."""
    SHIRT = "b2b2b2b2"
    COLOR = "a361dbdc"
    BACKDROP = "b0b0b0b0"
    CN = "cc222222"
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
            {"id": "s1", "value": "tee", "weight": 1, "sub_categories": ["casual"]},
        ]),
    ]
    ctx = {"__wp_catalog__": {}}
    ctx = PipelineEngine().run(modules, ctx=ctx, seed=0)
    hits = ctx.get("__wp_constraint_hits__", {})
    assert hits.get(CN, 0) == 0, (
        f"constraint fired despite no actual target resolution + source "
        f"picked last (hits={hits})"
    )


def test_never_applied_message_distinguishes_present_vs_absent():
    """The end-of-run warning wording differs by cause: target present
    in chain (ordering issue) vs target uuid absent (typo)."""
    # Absent target — no instance, no carrier anywhere.
    GHOST = "deadbeef"
    modules_absent = [
        _wildcard("11111111", "src", [
            {"id": "s1", "value": "a", "weight": 1, "sub_categories": ["x"]},
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
            {"id": "t1", "value": "early", "weight": 1, "sub_categories": ["warm"]},
        ]),
        _wildcard("11111111", "src", [
            {"id": "s1", "value": "a", "weight": 1, "sub_categories": ["x"]},
        ]),
        _constraint("22222222", "11111111", TGT),
    ]
    ctx = PipelineEngine().run(modules_present, ctx={"__wp_catalog__": {}}, seed=0)
    w = next(
        x for x in ctx["__wp_warnings__"]
        if x.get("type") == "constraint_never_applied"
    )
    assert w["detail"]["target_present"] is True
    assert "is in the chain" in w["message"]


# ─────────────────────────────────────────────────────────────────────
# Cross-node propagation regression (2026-05-26)
#
# Before the original fix, two sequential WP_Context nodes downstream
# of each other duplicated `constraint_never_applied` warnings: Context
# A ran the never_applied check at end of run + emitted warnings, then
# Context B inherited `__wp_constraints__` (which IS cross-node) but NOT
# the constraint bookkeeping (which used to NOT propagate), so B re-ran
# the same check with fresh state and re-warned for every constraint A
# already applied. The user saw 4 warnings for a 3-constraint chain.
# SP3 swapped the consumed-set for `__wp_constraint_hits__`, which
# stays in the cross-node key set for the same reason.
#
# Repro: build A's bucket + hits via PipelineEngine, copy the same
# pattern the cross-node copy in `WP_Context.execute` does, run a
# second pipeline on a different module set, then count warnings after
# the `build_payload` merge.


def test_end_of_run_dedupes_warnings_by_cid():
    """Two sibling constraint instances with the same library uuid
    register two entries in the bucket. End-of-run check used to emit
    a warning per entry — now emits one per distinct cid."""
    # Use a target uuid that NEVER rolls so neither constraint can
    # fire. Two siblings, same library uuid, registered twice.
    GHOST_TGT = "00000000"
    modules = [
        # Source for both — needs to roll so source_pick exists.
        _wildcard("11111111", "src", [
            {"id": "s1", "value": "a", "weight": 1, "sub_categories": ["x"]},
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


def test_constraint_hits_propagate_cross_node():
    """`__wp_constraint_hits__` must be in cross-node-internals so a
    downstream Context shares the SP3 reach-selector counters (first/next
    coverage spans nodes) and doesn't re-warn constraints already applied
    upstream. Simulates the WP_Context.execute cross-node copy step + the
    build_payload warning dedup."""
    from wp_nodes.types import _CROSS_NODE_INTERNAL_KEYS, build_payload

    assert "__wp_constraint_hits__" in _CROSS_NODE_INTERNAL_KEYS, (
        "constraint hit counter must propagate cross-node — otherwise "
        "downstream Contexts reset first/next counters and re-warn every "
        "constraint upstream already applied"
    )

    # Sanity: build_payload writes the hit counter into internals
    # (verifies _CROSS_NODE_INTERNAL_KEYS is actually consulted).
    ctx = {
        "__wp_constraint_hits__": {"abc12345": 2},
        "__wp_constraints__": [],
        "__wp_picks__": {},
        "__wp_trace__": [],
        "__wp_warnings__": [],
    }
    payload = build_payload(ctx, upstream_debug={}, seed=0)
    assert payload.internals.get("__wp_constraint_hits__") == {"abc12345": 2}


def test_constraint_targets_next_color_not_source_nested():
    """User's mental model (2026-05-26), still true under SP3's
    downstream-relative reach: when the SOURCE wildcard's own option
    carries a nested `@{target}` ref AND the constraint sits after the
    source, the constraint does NOT reach the source's own nested roll
    (it resolved before the constraint registered). It reaches the NEXT
    target occurrence downstream — e.g. a `@{color}` inside a backdrop
    wildcard placed after the constraint.

    Chain: shirt (option = `@{color} t-shirt`) → shirt_x_color
    constraint → backdrop (option = `studio with @{color} accents`).

    Expected: shirt's nested color rolls FREE (no constraint yet),
    backdrop's nested color is CONSTRAINED (warm excluded → ok_blue),
    constraint fires once, zero warnings."""
    SHIRT = "b2b2b2b2"
    COLOR = "a361dbdc"
    BACKDROP = "b0219910"
    CN = "cc222222"
    modules = [
        _wildcard(SHIRT, "shirt", [
            {
                "id": "s1", "value": f"@{{{COLOR}}} t-shirt", "weight": 1,
                "sub_categories": ["casual"],
            },
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
            {"id": "c1", "value": "BAD_red", "weight": 1, "sub_categories": ["warm"]},
            {"id": "c2", "value": "ok_blue", "weight": 1, "sub_categories": ["cool"]},
        ]),
    }
    for seed in (0, 1, 7, 42, 99):
        ctx = {"__wp_catalog__": dict(catalog)}
        ctx = PipelineEngine().run(modules, ctx=ctx, seed=seed)
        hits = ctx.get("__wp_constraint_hits__", {})
        warns = [
            w for w in ctx.get("__wp_warnings__", [])
            if w.get("type") == "constraint_never_applied"
        ]
        backdrop_val = ctx.get("backdrop") or ""
        # Backdrop's color is the only occurrence AFTER the constraint
        # (shirt's nested color resolved before it) → fired once.
        assert hits.get(CN) == 1, (
            f"seed {seed}: constraint didn't fire on backdrop's color, hits={hits}"
        )
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
                "severity": "warn",
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
                "severity": "warn",
                "module_id": "ghost001",
                "detail": {"constraint_id": "ghost001"},
                "message": "...",
            },
            # Different cid — should survive.
            {
                "type": "constraint_never_applied",
                "severity": "warn",
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
        "__wp_constraint_hits__": {},
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


def test_build_payload_propagates_loop_internals():
    """Loop bookkeeping must survive the socket boundary so a SECOND
    chained WP_Context (the one the user wired rgthree Seed into) still
    varies its seed per iteration + honours override. Pre-fix only the
    first ContextLoop child saw these; downstream defaulted loop_index=0
    + seed_override=None, so its seed was identical every iteration and
    override was ignored (2026-05-26)."""
    from wp_nodes.types import build_payload

    ctx = {
        "__wp_loop_index__": 3,
        "__wp_seed_override__": 12345,
        "__wp_loop_seeds__": [100, 200, 300, 400],
        "__wp_trace__": [],
        "__wp_warnings__": [],
        "__wp_constraints__": [],
        "__wp_picks__": {},
        "__wp_constraint_hits__": {},
    }
    payload = build_payload(ctx, upstream_debug={}, seed=0)
    assert payload.internals.get("__wp_loop_index__") == 3
    assert payload.internals.get("__wp_seed_override__") == 12345
    assert payload.internals.get("__wp_loop_seeds__") == [100, 200, 300, 400]


def test_effective_chain_seed_varies_per_iteration_with_external_seed():
    """End-to-end seed-variation proof for an external (link-driven)
    seed: even when widget_seed is a FIXED value (simulating rgthree
    Seed driving the input), each iteration's loop_index produces a
    distinct chain seed. This is what a downstream chained context now
    gets once the loop internals propagate."""
    from engine.seed_derive import effective_chain_seed

    fixed_external = 303816870871154  # a rgthree-style fixed seed
    # No override — pure widget_seed + loop_index variation.
    seeds = [
        effective_chain_seed(
            widget_seed=fixed_external, seed_override=None, loop_index=i,
        )
        for i in range(4)
    ]
    assert len(set(seeds)) == 4, f"iterations didn't vary: {seeds}"
    # iteration 0 is the unshifted base (backwards-compat).
    assert seeds[0] == fixed_external & 0xFFFFFFFFFFFFFFFF

    # With override ON, the derived series replaces the external seed.
    overridden = [
        effective_chain_seed(
            widget_seed=fixed_external, seed_override=900 + i, loop_index=i,
        )
        for i in range(4)
    ]
    # iteration 0 base is the override, not the external seed.
    assert overridden[0] == 900
    assert all(s != fixed_external for s in overridden[1:]), (
        "override didn't replace the external seed"
    )
