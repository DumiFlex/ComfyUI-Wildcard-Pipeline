"""Constraint reach-selector targeting (SP3) — every constraint whose
`target_select` covers a firing target instance is applied, combined.
A per-constraint hit counter (`__wp_constraint_hits__`) drives
first/next/all/pick coverage; the pre-SP3 one-shot consumed-set is
retired. Core reach matrix lives in
tests/engine/modules/test_constraint_reach.py; this file covers the
chain-level + nested-ref + finalisation behaviour.
"""
from __future__ import annotations

import random

from engine.modules.constraint_handler import ConstraintHandler
from engine.modules.wildcard_handler import WildcardHandler


def _wildcard(uuid: str, var: str, options, sub_categories=None):
    return {
        "id": uuid,
        "type": "wildcard",
        "var_binding": var,
        "payload": {
            "options": options,
            "sub_categories": list(sub_categories or []),
            "var_binding": var,
        },
    }


def _constraint(
    module_id, source_uuid, target_uuid,
    matrix=None, exceptions=None, target_select=None,
):
    payload = {
        "source_wildcard_id": source_uuid,
        "target_wildcard_id": target_uuid,
        "matrix": matrix or {},
        "exceptions": exceptions or [],
    }
    if target_select is not None:
        payload["target_select"] = target_select
    return {
        "id": module_id,
        "type": "constraint",
        "payload": payload,
    }


def _empty_ctx(rng_seed: int = 0):
    return {
        "__wp_rng__": random.Random(rng_seed),
        "__wp_warnings__": [],
        "__wp_catalog__": {},
        "__wp_constraints__": [],
        "__wp_picks__": {},
        "__wp_constraint_hits__": {},
    }


def test_constraint_registration_includes_module_id():
    """When a constraint module runs, the dict pushed into
    `ctx['__wp_constraints__']` must carry `__constraint_module_id__`
    so the consumed-set can key on it."""
    ctx = _empty_ctx()
    ctx["__wp_current_module_id__"] = "cn_aa"
    constraint = _constraint("cn_aa", "wc_src", "wc_tgt")
    ConstraintHandler.resolve(constraint["payload"], instance={}, ctx=ctx)
    bucket = ctx.get("__wp_constraints__") or []
    assert len(bucket) == 1
    assert bucket[0].get("__constraint_module_id__") == "cn_aa", (
        "constraint handler must wrap the registered payload with the "
        "owning module id so apply_constraints_for_target can mark "
        "consumed"
    )


# reach selector: `first` mode (the old one-shot, now explicit)

def test_first_mode_applies_only_to_first_target_instance():
    """Two mood instances downstream of a single `first`-mode constraint
    targeting mood. Only the FIRST mood gets the constraint; the second
    mood rolls free. (Pre-SP3 this was the implicit one-shot default;
    SP3 makes it an explicit `target_select={mode:"first"}`.)"""
    from engine.modules._constraints import apply_constraints_for_target

    ctx = _empty_ctx()
    hits = ctx["__wp_constraint_hits__"]
    src_pick = {"value": "rain", "sub_categories": ["wet"]}
    ctx["__wp_picks__"]["wc_src"] = src_pick
    constraints = [{
        "source_wildcard_id": "wc_src",
        "target_wildcard_id": "wc_tgt",
        "matrix": {"wet": {"warm": {"mode": "exclude", "factor": 1}}},
        "exceptions": [],
        "target_select": {"mode": "first"},
        "__constraint_module_id__": "cn_aa",
    }]

    options_1 = [{"id": "a", "value": "red", "weight": 1, "sub_categories": ["warm"]}]
    out_1, applied_1 = apply_constraints_for_target(
        options_1, "wc_tgt", constraints,
        ctx["__wp_picks__"], ctx["__wp_warnings__"],
        hits=hits, firing_uid="u1",
    )
    assert applied_1 is True
    assert out_1[0]["weight"] == 0
    assert hits["cn_aa"] == 1

    # Second target instance — `first` selector no longer covers it.
    options_2 = [{"id": "b", "value": "linen", "weight": 1, "sub_categories": ["warm"]}]
    out_2, applied_2 = apply_constraints_for_target(
        options_2, "wc_tgt", constraints,
        ctx["__wp_picks__"], ctx["__wp_warnings__"],
        hits=hits, firing_uid="u2",
    )
    assert applied_2 is False
    assert out_2[0]["weight"] == 1
    # Hit count still increments (the constraint was encountered) even
    # though the selector didn't cover this instance.
    assert hits["cn_aa"] == 2


def test_all_mode_default_applies_to_every_target_instance():
    """The new DEFAULT (`all`): a constraint with no explicit selector
    re-weights EVERY downstream target instance, not just the first.
    This is the behaviour flip from the pre-SP3 one-shot model."""
    from engine.modules._constraints import apply_constraints_for_target

    ctx = _empty_ctx()
    hits = ctx["__wp_constraint_hits__"]
    ctx["__wp_picks__"]["wc_src"] = {"value": "rain", "sub_categories": ["wet"]}
    constraints = [{
        "source_wildcard_id": "wc_src",
        "target_wildcard_id": "wc_tgt",
        "matrix": {"wet": {"warm": {"mode": "exclude", "factor": 1}}},
        "exceptions": [],
        # No target_select → defaults to {mode:"all"}.
        "__constraint_module_id__": "cn_aa",
    }]
    for _ in range(3):
        opts = [{"id": "a", "value": "red", "weight": 1, "sub_categories": ["warm"]}]
        out, applied = apply_constraints_for_target(
            opts, "wc_tgt", constraints,
            ctx["__wp_picks__"], ctx["__wp_warnings__"],
            hits=hits, firing_uid="u",
        )
        assert applied is True
        assert out[0]["weight"] == 0
    assert hits["cn_aa"] == 3


def test_multiple_constraints_combine_on_every_instance():
    """Two `all` constraints targeting mood + two mood instances. Under
    the SP3 reach model BOTH constraints apply to BOTH instances,
    combining sequentially (boost×3 then reduce×0.5 = ×1.5) — there's no
    one-shot distribution where each instance claims a single constraint.
    Each constraint's hit counter increments once per instance."""
    from engine.modules._constraints import apply_constraints_for_target

    ctx = _empty_ctx()
    hits = ctx["__wp_constraint_hits__"]
    ctx["__wp_picks__"]["wc_src"] = {"value": "rain", "sub_categories": ["wet"]}
    constraints = [
        {
            "source_wildcard_id": "wc_src",
            "target_wildcard_id": "wc_tgt",
            "matrix": {"wet": {"warm": {"mode": "boost", "factor": 3}}},
            "exceptions": [],
            "__constraint_module_id__": "c1",
        },
        {
            "source_wildcard_id": "wc_src",
            "target_wildcard_id": "wc_tgt",
            "matrix": {"wet": {"warm": {"mode": "reduce", "factor": 0.5}}},
            "exceptions": [],
            "__constraint_module_id__": "c2",
        },
    ]

    options_1 = [{"id": "a", "value": "red", "weight": 1, "sub_categories": ["warm"]}]
    out_1, _ = apply_constraints_for_target(
        options_1, "wc_tgt", constraints,
        ctx["__wp_picks__"], ctx["__wp_warnings__"],
        hits=hits, firing_uid="u1",
    )
    # mood-1: C1 boost×3 then C2 reduce×0.5 → 1 * 3 * 0.5 = 1.5.
    assert out_1[0]["weight"] == 1.5
    assert hits == {"c1": 1, "c2": 1}

    options_2 = [{"id": "b", "value": "blue", "weight": 1, "sub_categories": ["warm"]}]
    out_2, _ = apply_constraints_for_target(
        options_2, "wc_tgt", constraints,
        ctx["__wp_picks__"], ctx["__wp_warnings__"],
        hits=hits, firing_uid="u2",
    )
    # mood-2: same combined factor — both constraints cover every instance.
    assert out_2[0]["weight"] == 1.5
    assert hits == {"c1": 2, "c2": 2}


def test_three_nested_refs_in_one_option_all_constrained():
    """Parent A option value '@{tgt} @{tgt} @{tgt}'. Under the default
    `all` reach, EVERY nested resolution of @{tgt} is constrained (not
    just the first — that was the pre-SP3 one-shot). The constraint's
    hit counter reaches 3, and none of the three parts is the excluded
    BAD option.
    """
    target_uuid = "aabbccdd"  # 8-hex per tokenizer regex
    source_uuid = "ddccbbaa"
    target_options = [
        # Two options — the warm-tagged one is excluded by the
        # constraint on EVERY roll now (default `all`), so all three
        # nested resolutions pick the neutral option.
        {"id": "ex", "value": "BAD", "weight": 1, "sub_categories": ["warm"]},
        {"id": "ok", "value": "ok", "weight": 9, "sub_categories": ["neutral"]},
    ]
    target = {
        "id": target_uuid,
        "type": "wildcard",
        "var_binding": "tgt",
        "options": target_options,
    }
    parent = _wildcard(
        "11223344", "parent",
        [{
            "id": "p1",
            "value": f"@{{{target_uuid}}} @{{{target_uuid}}} @{{{target_uuid}}}",
            "weight": 1,
        }],
    )
    ctx = {
        "__wp_rng__": random.Random(42),
        "__wp_warnings__": [],
        "__wp_catalog__": {target_uuid: target},
        "__wp_constraints__": [{
            "source_wildcard_id": source_uuid,
            "target_wildcard_id": target_uuid,
            "matrix": {"wet": {"warm": {"mode": "exclude", "factor": 1}}},
            "exceptions": [],
            "__constraint_module_id__": "c1",
        }],
        "__wp_picks__": {source_uuid: {"value": "rain", "sub_categories": ["wet"]}},
        "__wp_constraint_hits__": {},
    }
    out = WildcardHandler.resolve(
        parent["payload"], instance={"variable_binding": "$parent"}, ctx=ctx,
    )
    # All three nested resolutions counted toward the same constraint.
    assert ctx["__wp_constraint_hits__"] == {"c1": 3}
    parts = (out.get("$parent") or "").split()
    assert len(parts) == 3
    # Every roll avoids BAD — the constraint excludes it on each.
    assert all(p != "BAD" for p in parts)


def test_unfired_constraint_emits_never_applied_warning():
    """Pipeline ends with a constraint whose selector covered zero
    target instances (hits==0) → emit constraint_never_applied."""
    from engine.pipeline import PipelineEngine

    src = _wildcard(
        "aabbccdd", "src",
        [{"id": "s1", "value": "rain", "weight": 1, "sub_categories": ["wet"]}],
    )
    constraint = _constraint("ee11ff22", "aabbccdd", "deadbeef")  # ghost target uuid
    modules = [src, constraint]
    engine = PipelineEngine()
    ctx = engine.run(modules, seed=0)
    warns = [
        w for w in ctx.get("__wp_warnings__", [])
        if w.get("type") == "constraint_never_applied"
    ]
    assert len(warns) == 1
    assert warns[0]["detail"]["constraint_id"] == "ee11ff22"
    assert warns[0]["detail"]["target_wildcard_id"] == "deadbeef"


def test_next_n_underreach_emits_partial_reach_warning():
    """A `next 3` constraint with only ONE downstream target instance
    fires once but under-reaches → constraint_partial_reach with
    requested=3, reached=1. No never_applied (it DID fire)."""
    from engine.pipeline import PipelineEngine

    src = _wildcard(
        "aabbccdd", "src",
        [{"id": "s1", "value": "rain", "weight": 1, "sub_categories": ["wet"]}],
    )
    constraint = _constraint(
        "ee11ff22", "aabbccdd", "c3c3c3c3",
        matrix={"wet": {"warm": {"mode": "exclude", "factor": 1}}},
        target_select={"mode": "next", "count": 3},
    )
    # One downstream mood instance (the target) after the constraint.
    mood = _wildcard(
        "c3c3c3c3", "mood",
        [
            {"id": "m1", "value": "warm_bad", "weight": 1, "sub_categories": ["warm"]},
            {"id": "m2", "value": "cool_ok", "weight": 1, "sub_categories": ["cool"]},
        ],
    )
    modules = [src, constraint, mood]
    ctx = PipelineEngine().run(modules, seed=0)
    partial = [
        w for w in ctx.get("__wp_warnings__", [])
        if w.get("type") == "constraint_partial_reach"
    ]
    never = [
        w for w in ctx.get("__wp_warnings__", [])
        if w.get("type") == "constraint_never_applied"
    ]
    assert never == []
    assert len(partial) == 1
    assert partial[0]["detail"]["constraint_id"] == "ee11ff22"
    assert partial[0]["detail"]["requested"] == 3
    assert partial[0]["detail"]["reached"] == 1


def test_constraint_fires_on_ref_inside_nested_wildcard():
    """Parent option '@{moodref}'. moodref's only option '@{mood}'.
    The chain parent → moodref → mood reaches a single mood occurrence;
    the default `all` constraint covers it (hits c1 once)."""
    mood_uuid = "11aa22bb"
    moodref_uuid = "33cc44dd"
    source_uuid = "ddccbbaa"
    mood = {
        "id": mood_uuid,
        "type": "wildcard",
        "var_binding": "mood",
        "options": [
            {"id": "ex", "value": "BAD", "weight": 1, "sub_categories": ["warm"]},
            {"id": "ok", "value": "ok", "weight": 9, "sub_categories": ["neutral"]},
        ],
    }
    moodref = {
        "id": moodref_uuid,
        "type": "wildcard",
        "var_binding": "moodref",
        "options": [{"id": "r1", "value": f"@{{{mood_uuid}}}", "weight": 1}],
    }
    parent = _wildcard(
        "55ee66ff", "parent",
        [{"id": "p1", "value": f"@{{{moodref_uuid}}}", "weight": 1}],
    )
    ctx = {
        "__wp_rng__": random.Random(7),
        "__wp_warnings__": [],
        "__wp_catalog__": {mood_uuid: mood, moodref_uuid: moodref},
        "__wp_constraints__": [{
            "source_wildcard_id": source_uuid,
            "target_wildcard_id": mood_uuid,
            "matrix": {"wet": {"warm": {"mode": "exclude", "factor": 1}}},
            "exceptions": [],
            "__constraint_module_id__": "c1",
        }],
        "__wp_picks__": {source_uuid: {"value": "rain", "sub_categories": ["wet"]}},
        "__wp_constraint_hits__": {},
    }
    out = WildcardHandler.resolve(
        parent["payload"], instance={"variable_binding": "$parent"}, ctx=ctx,
    )
    assert ctx["__wp_constraint_hits__"] == {"c1": 1}
    # Constraint excludes warm option (BAD); output should be "ok".
    assert out.get("$parent") == "ok"


def test_first_mode_does_not_recover_after_skipped_instance():
    """`first` mode: once the hit counter has passed 1, the selector
    stops covering — re-expresses the old 'already consumed → no-op'
    intent in the SP3 model. (The pre-SP3 test pre-seeded a consumed
    set; that concept is gone, so we drive the counter to >1 directly.)"""
    from engine.modules._constraints import apply_constraints_for_target

    ctx = _empty_ctx()
    # Pre-seed the hit counter as if the constraint already fired once.
    hits = {"cn_aa": 1}
    ctx["__wp_picks__"]["wc_src"] = {"value": "rain", "sub_categories": ["wet"]}
    constraints = [{
        "source_wildcard_id": "wc_src",
        "target_wildcard_id": "wc_tgt",
        "matrix": {"wet": {"warm": {"mode": "exclude", "factor": 1}}},
        "exceptions": [],
        "target_select": {"mode": "first"},
        "__constraint_module_id__": "cn_aa",
    }]
    options = [{"id": "a", "value": "red", "weight": 1, "sub_categories": ["warm"]}]
    out, applied = apply_constraints_for_target(
        options, "wc_tgt", constraints,
        ctx["__wp_picks__"], ctx["__wp_warnings__"],
        hits=hits, firing_uid="u2",
    )
    # n becomes 2 → `first` no longer covers → not applied.
    assert applied is False
    assert out[0]["weight"] == 1
    assert hits["cn_aa"] == 2
