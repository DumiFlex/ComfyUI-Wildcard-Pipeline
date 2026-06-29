from engine.pipeline import PipelineEngine
from engine.seed_derive import effective_chain_seed


def _run(modules, *, widget_seed, loop_index):
    """Run the engine the way wp_nodes/context_node.py does: a per-iteration
    chain seed plus a held seed (loop_index pinned to 0)."""
    chain_seed = effective_chain_seed(
        widget_seed=widget_seed, seed_override=None, loop_index=loop_index
    )
    hold_seed = effective_chain_seed(
        widget_seed=widget_seed, seed_override=None, loop_index=0
    )
    return PipelineEngine().run(
        modules, seed=chain_seed, hold_seed=hold_seed, loop_index=loop_index
    )


def test_run_exposes_hold_seed_and_loop_index_in_ctx():
    ctx = _run([], widget_seed=42, loop_index=3)
    expected_hold = effective_chain_seed(
        widget_seed=42, seed_override=None, loop_index=0
    )
    assert ctx["__wp_loop_index__"] == 3
    assert ctx["__wp_node_seed_hold__"] == expected_hold
    assert ctx["__wp_node_seed__"] != ctx["__wp_node_seed_hold__"]


def _wildcard(binding, values, *, seed_scope=None):
    instance = {"variable_binding": binding}
    if seed_scope is not None:
        instance["seed_scope"] = seed_scope
    options = [{"id": str(i), "value": v, "weight": 1.0} for i, v in enumerate(values)]
    return {
        "type": "wildcard",
        "payload": {"var_binding": binding, "options": options},
        "instance": instance,
    }


VALUES = ["a", "b", "c", "d", "e", "f", "g", "h"]


def test_hold_wildcard_is_identical_across_iterations():
    held = [
        _run([_wildcard("x", VALUES, seed_scope="hold")], widget_seed=42, loop_index=k)["x"]
        for k in range(4)
    ]
    assert len(set(held)) == 1


def test_vary_wildcard_changes_across_iterations():
    varied = [_run([_wildcard("x", VALUES)], widget_seed=42, loop_index=k)["x"] for k in range(6)]
    assert len(set(varied)) > 1


def test_locked_seed_wins_over_hold():
    m = _wildcard("x", VALUES, seed_scope="hold")
    m["instance"]["locked_seed"] = 12345
    a = _run([m], widget_seed=42, loop_index=0)["x"]
    b = _run([m], widget_seed=999, loop_index=7)["x"]
    assert a == b


def _combine(output_var, template, *, seed_scope=None):
    instance = {}
    if seed_scope is not None:
        instance["seed_scope"] = seed_scope
    return {
        "type": "combine",
        "payload": {"output_var": output_var, "template": template},
        "instance": instance,
    }


COMBINE_TMPL = "{alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel}"


def test_hold_combine_is_identical_across_iterations():
    held = [
        _run([_combine("y", COMBINE_TMPL, seed_scope="hold")], widget_seed=42, loop_index=k)["y"]
        for k in range(4)
    ]
    assert len(set(held)) == 1


def test_vary_combine_changes_across_iterations():
    varied = [
        _run([_combine("y", COMBINE_TMPL)], widget_seed=42, loop_index=k)["y"]
        for k in range(6)
    ]
    assert len(set(varied)) > 1


# fixed_values: single entry with name="z" and alternation value so the resolver
# picks one of the 8 options based on the seed — same mechanic as combine.
FIXED_TMPL = "{a|b|c|d|e|f|g|h}"


def _fixed(binding, *, seed_scope=None):
    instance = {}
    if seed_scope is not None:
        instance["seed_scope"] = seed_scope
    return {
        "type": "fixed_values",
        "payload": {"values": [{"name": binding, "value": FIXED_TMPL}]},
        "instance": instance,
    }


def test_hold_fixed_values_is_identical_across_iterations():
    held = [
        _run([_fixed("z", seed_scope="hold")], widget_seed=42, loop_index=k)["z"]
        for k in range(4)
    ]
    assert len(set(held)) == 1


# ── hold the VALUE, not the seed: constrained + nested-ref cases ─────────────
#
# Holding the seed isn't enough. A held wildcard whose POOL moves per iteration
# (a constraint reshapes it from a varying source) would pick a different value
# from the same seed. And a held value that contains a nested @{} ref would let
# the ref re-roll each frame. Hold must freeze the frame-0 RESOLVED value and
# reuse it verbatim. The engine does this via a base pass at loop_index=0.


def test_hold_wildcard_with_constraint_holds_value_not_seed():
    """A held target wildcard downstream of a constraint whose SOURCE varies
    keeps its frame-0 value across iterations — even though the constraint
    reshapes the target pool each frame. Holding the seed alone fails (same
    seed, different pool → different value); the base-pass value-hold is
    correct."""
    # Source VARIES per iteration (no seed_scope) → its pick drives the matrix row.
    src = {
        "type": "wildcard", "id": "src-uuid",
        "payload": {"var_binding": "src", "options": [
            {"id": "s0", "value": "s1", "weight": 1.0},
            {"id": "s1", "value": "s2", "weight": 1.0},
        ]},
        "instance": {"variable_binding": "src"},
    }
    # Constraint: a huge boost ties the target's winning option to the source —
    # s1 → t1, s2 → t2 — so the target pool genuinely depends on the source.
    con = {
        "type": "constraint", "id": "con-uuid",
        "payload": {
            "source_wildcard_id": "src-uuid", "target_wildcard_id": "tgt-uuid",
            "matrix": {
                "s1": {"t1": {"mode": "boost", "factor": 1000.0}},
                "s2": {"t2": {"mode": "boost", "factor": 1000.0}},
            },
            "exceptions": [],
        },
        "instance": {},
    }
    tgt = {
        "type": "wildcard", "id": "tgt-uuid",
        "payload": {"var_binding": "tgt", "options": [
            {"id": "0", "value": "t1", "weight": 1.0},
            {"id": "1", "value": "t2", "weight": 1.0},
        ]},
        "instance": {"variable_binding": "tgt", "seed_scope": "hold"},
    }
    held = [_run([src, con, tgt], widget_seed=42, loop_index=k)["tgt"] for k in range(8)]
    assert len(set(held)) == 1, f"held target must be constant across frames, got {held}"


def test_hold_wildcard_freezes_nested_ref_value():
    """A held wildcard whose picked option contains a nested @{uuid} ref keeps
    the FULLY-RESOLVED frame-0 value — the nested ref can't re-roll. So if
    "@{color} jeans" resolves to "green jeans" at frame 0, every frame is
    "green jeans"."""
    color_uuid = "c0100100"  # 8-hex — the ref parser only treats hex as a uuid
    # Nested color wildcard, reachable via the catalog @{} resolves against.
    color = {
        "id": color_uuid, "type": "wildcard",
        "payload": {"var_binding": "color", "options": [
            {"id": "c0", "value": "green", "weight": 1.0},
            {"id": "c1", "value": "red", "weight": 1.0},
            {"id": "c2", "value": "blue", "weight": 1.0},
        ]},
    }
    # Held outfit wildcard whose only option embeds the nested ref.
    outfit = {
        "type": "wildcard", "id": "outfit-uuid",
        "payload": {"var_binding": "outfit", "options": [
            {"id": "o0", "value": f"@{{{color_uuid}}} jeans", "weight": 1.0},
        ]},
        "instance": {"variable_binding": "outfit", "seed_scope": "hold"},
    }
    ctxs = [
        PipelineEngine().run(
            [outfit],
            ctx={"__wp_catalog__": {color_uuid: color}},
            seed=effective_chain_seed(widget_seed=42, seed_override=None, loop_index=k),
            hold_seed=effective_chain_seed(widget_seed=42, seed_override=None, loop_index=0),
            loop_index=k,
        )
        for k in range(8)
    ]
    held = [c["outfit"] for c in ctxs]
    # The ref must actually RESOLVE (not stay literal "@{...}") — else the test
    # would be trivially constant for the wrong reason.
    assert held[0] in {"green jeans", "red jeans", "blue jeans"}, (
        f"nested ref did not resolve to a colour, got {held[0]!r}"
    )
    assert len(set(held)) == 1, f"nested ref must be frozen across frames, got {held}"


# ── derivation hold ─────────────────────────────────────────────────────────
#
# A derivation is a TRANSFORM (reads inputs, writes outputs) and writes a
# DYNAMIC set of vars (whichever rules fire), so its hold can't read a single
# flat binding — the engine captures each module's frame-0 output dict and the
# handler replays it. Two things must freeze: the inline {a|b} roll, and the
# output even when the derivation's INPUT varies (the same value-freeze
# trade-off a constrained wildcard makes).

# trigger var so the derivation's rule always fires.
_DERIV_TRIGGER = {
    "type": "fixed_values", "id": "trig-uuid",
    "payload": {"values": [{"name": "trigger", "value": "go"}]},
    "instance": {},
}
_DERIV_INLINE = "{warm|cool|bright|dark|crimson|amber}"


def _derivation_inline(target, value, *, seed_scope=None):
    instance = {}
    if seed_scope is not None:
        instance["seed_scope"] = seed_scope
    return {
        "type": "derivation", "id": f"deriv-{target}",
        "payload": {"rules": [{
            "id": "r1",
            "branches": [{
                "condition": {"var": "trigger", "op": "equals", "value": "go"},
                "action": {"target_var": target, "mode": "replace", "value": value},
            }],
        }]},
        "instance": instance,
    }


def test_hold_derivation_freezes_inline_choice():
    """A held derivation with an inline {a|b|c} action value reuses its frame-0
    pick across the run; without hold it re-rolls each frame."""
    held = [
        _run([_DERIV_TRIGGER, _derivation_inline("tone", _DERIV_INLINE, seed_scope="hold")],
             widget_seed=42, loop_index=k)["tone"]
        for k in range(6)
    ]
    assert len(set(held)) == 1, f"held derivation must be constant, got {held}"
    varied = [
        _run([_DERIV_TRIGGER, _derivation_inline("tone", _DERIV_INLINE)],
             widget_seed=42, loop_index=k)["tone"]
        for k in range(6)
    ]
    assert len(set(varied)) > 1, f"vary derivation should change across frames, got {varied}"


def _mood_src():
    return {
        "type": "wildcard", "id": "mood-uuid",
        "payload": {"var_binding": "mood", "options": [
            {"id": "m0", "value": "happy", "weight": 1.0},
            {"id": "m1", "value": "sad", "weight": 1.0},
        ]},
        "instance": {"variable_binding": "mood"},
    }


def _branchy_deriv(seed_scope=None):
    # Two branches, each with its OWN inline roll, selected by $mood.
    instance = {} if seed_scope is None else {"seed_scope": seed_scope}
    return {
        "type": "derivation", "id": "deriv-tone",
        "payload": {"rules": [{
            "id": "r1",
            "branches": [
                {"condition": {"var": "mood", "op": "equals", "value": "happy"},
                 "action": {"target_var": "tone", "mode": "replace", "value": "{warm|gold|amber}"}},
                {"condition": {"var": "mood", "op": "equals", "value": "sad"},
                 "action": {"target_var": "tone", "mode": "replace", "value": "{cool|blue|navy}"}},
            ],
        }]},
        "instance": instance,
    }


def _group_by(keys, vals):
    out: dict[str, set[str]] = {}
    for k, v in zip(keys, vals, strict=True):
        out.setdefault(k, set()).add(v)
    return out


def test_hold_derivation_holds_per_branch_roll_not_branch_selection():
    """Hold freezes each BRANCH's roll, NOT which branch fires. A varying
    input still switches IF↔ELIF live; the value used is that branch's frozen
    frame-0 roll — so all frames that land on the same branch share one value,
    but different branches differ. This is the user's spec: don't reuse
    frame-0's branch value when a later frame picks another branch; use what
    THAT branch would have rolled at frame 0."""
    N = 12
    src = _mood_src()
    moods = [
        _run([src, _branchy_deriv("hold")], widget_seed=42, loop_index=k)["mood"]
        for k in range(N)
    ]
    held = [
        _run([src, _branchy_deriv("hold")], widget_seed=42, loop_index=k)["tone"]
        for k in range(N)
    ]
    # Input genuinely varies (both branches exercised) — else the test is trivial.
    assert len(set(moods)) > 1, f"sanity: mood must vary, got {moods}"
    # Per-branch freeze: every frame on the same branch shares ONE frozen value.
    by_branch = _group_by(moods, held)
    for mood, tones in by_branch.items():
        assert len(tones) == 1, f"branch for mood={mood} must be frozen, got {tones}"
    # Live selection: the two branches resolve to DIFFERENT values, so the
    # output changes when the input flips the branch (it's not freeze-output).
    assert len({next(iter(t)) for t in by_branch.values()}) > 1, (
        f"different branches must give different held values, got {by_branch}"
    )


def test_vary_derivation_rerolls_within_a_branch():
    """Contrast: without hold, the SAME branch re-rolls a different value
    across frames (proves hold's per-branch freeze is doing something)."""
    N = 12
    src = _mood_src()
    moods = [_run([src, _branchy_deriv()], widget_seed=42, loop_index=k)["mood"] for k in range(N)]
    toned = [_run([src, _branchy_deriv()], widget_seed=42, loop_index=k)["tone"] for k in range(N)]
    by_branch = _group_by(moods, toned)
    assert any(len(t) > 1 for t in by_branch.values()), (
        f"vary should re-roll within a branch across frames, got {by_branch}"
    )
