"""First-instance constraint targeting — one-shot, consumed-set,
runtime walk semantics. See
docs/superpowers/specs/2026-05-24-constraint-first-instance-design.md.
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


def _constraint(module_id, source_uuid, target_uuid, matrix=None, exceptions=None):
    return {
        "id": module_id,
        "type": "constraint",
        "payload": {
            "source_wildcard_id": source_uuid,
            "target_wildcard_id": target_uuid,
            "matrix": matrix or {},
            "exceptions": exceptions or [],
        },
    }


def _empty_ctx(rng_seed: int = 0):
    return {
        "__wp_rng__": random.Random(rng_seed),
        "__wp_warnings__": [],
        "__wp_catalog__": {},
        "__wp_constraints__": [],
        "__wp_picks__": {},
        "__wp_consumed_constraints__": set(),
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


# one-shot semantic

def test_constraint_consumed_after_first_target_instance():
    """Two mood instances downstream of a single constraint targeting
    mood. Only the FIRST mood gets the constraint; the second mood
    rolls free."""
    from engine.modules._constraints import apply_constraints_for_target

    ctx = _empty_ctx()
    consumed = ctx["__wp_consumed_constraints__"]
    src_pick = {"value": "rain", "sub_category": "wet"}
    ctx["__wp_picks__"]["wc_src"] = src_pick
    constraints = [{
        "source_wildcard_id": "wc_src",
        "target_wildcard_id": "wc_tgt",
        "matrix": {"wet": {"warm": {"mode": "exclude", "factor": 1}}},
        "exceptions": [],
        "__constraint_module_id__": "cn_aa",
    }]

    options_1 = [{"id": "a", "value": "red", "weight": 1, "sub_category": "warm"}]
    out_1, applied_1 = apply_constraints_for_target(
        options_1, "wc_tgt", constraints,
        ctx["__wp_picks__"], ctx["__wp_warnings__"],
        consumed=consumed,
    )
    assert applied_1 is True
    assert out_1[0]["weight"] == 0
    assert "cn_aa" in consumed

    # Second target instance — same constraint should NOT re-fire.
    options_2 = [{"id": "b", "value": "linen", "weight": 1, "sub_category": "warm"}]
    out_2, applied_2 = apply_constraints_for_target(
        options_2, "wc_tgt", constraints,
        ctx["__wp_picks__"], ctx["__wp_warnings__"],
        consumed=consumed,
    )
    assert applied_2 is False
    assert out_2[0]["weight"] == 1


def test_multiple_constraints_claim_in_chain_order():
    """Two constraints targeting mood + two mood instances. C1 (chain
    index 0) claims mood-1; C2 (chain index 1) claims mood-2. Each
    target instance gets exactly ONE constraint applied — not both."""
    from engine.modules._constraints import apply_constraints_for_target

    ctx = _empty_ctx()
    consumed = ctx["__wp_consumed_constraints__"]
    ctx["__wp_picks__"]["wc_src"] = {"value": "rain", "sub_category": "wet"}
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

    options_1 = [{"id": "a", "value": "red", "weight": 1, "sub_category": "warm"}]
    out_1, _ = apply_constraints_for_target(
        options_1, "wc_tgt", constraints,
        ctx["__wp_picks__"], ctx["__wp_warnings__"],
        consumed=consumed,
    )
    # mood-1 got C1's boost only, NOT C2's reduce on top.
    assert out_1[0]["weight"] == 3
    assert consumed == {"c1"}

    options_2 = [{"id": "b", "value": "blue", "weight": 1, "sub_category": "warm"}]
    out_2, _ = apply_constraints_for_target(
        options_2, "wc_tgt", constraints,
        ctx["__wp_picks__"], ctx["__wp_warnings__"],
        consumed=consumed,
    )
    # mood-2 got C2's reduce, C1 already consumed.
    assert out_2[0]["weight"] == 0.5
    assert consumed == {"c1", "c2"}


def test_three_nested_refs_in_one_option_consume_one_constraint():
    """Parent A option value '@{tgt} @{tgt} @{tgt}' — the FIRST
    resolution of @{tgt} consumes the constraint. Subsequent two
    resolutions of @{tgt} in the same option roll free.
    """
    target_uuid = "aabbccdd"  # 8-hex per tokenizer regex
    source_uuid = "ddccbbaa"
    target_options = [
        # Two options — one weighted exclude target, one allowed.
        # Constraint excludes the warm-tagged option on FIRST roll;
        # subsequent rolls pick from the full pool.
        {"id": "ex", "value": "BAD", "weight": 1, "sub_category": "warm"},
        {"id": "ok", "value": "ok", "weight": 9, "sub_category": "neutral"},
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
        "__wp_picks__": {source_uuid: {"value": "rain", "sub_category": "wet"}},
        "__wp_consumed_constraints__": set(),
    }
    out = WildcardHandler.resolve(
        parent["payload"], instance={"variable_binding": "$parent"}, ctx=ctx,
    )
    # After resolve the consumed set should contain c1 exactly once.
    assert ctx["__wp_consumed_constraints__"] == {"c1"}
    parts = (out.get("$parent") or "").split()
    assert len(parts) == 3
    # First roll never picks BAD (excluded by constraint).
    assert parts[0] != "BAD"


def test_unfired_constraint_emits_never_applied_warning():
    """Pipeline ends with a constraint unconsumed → emit warning."""
    from engine.pipeline import PipelineEngine

    src = _wildcard(
        "aabbccdd", "src",
        [{"id": "s1", "value": "rain", "weight": 1, "sub_category": "wet"}],
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


def test_constraint_fires_on_ref_inside_nested_wildcard():
    """Parent option '@{moodref}'. moodref's only option '@{mood}'.
    The chain parent → moodref → mood is a SINGLE first-instance
    encounter that consumes the constraint."""
    mood_uuid = "11aa22bb"
    moodref_uuid = "33cc44dd"
    source_uuid = "ddccbbaa"
    mood = {
        "id": mood_uuid,
        "type": "wildcard",
        "var_binding": "mood",
        "options": [
            {"id": "ex", "value": "BAD", "weight": 1, "sub_category": "warm"},
            {"id": "ok", "value": "ok", "weight": 9, "sub_category": "neutral"},
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
        "__wp_picks__": {source_uuid: {"value": "rain", "sub_category": "wet"}},
        "__wp_consumed_constraints__": set(),
    }
    out = WildcardHandler.resolve(
        parent["payload"], instance={"variable_binding": "$parent"}, ctx=ctx,
    )
    assert ctx["__wp_consumed_constraints__"] == {"c1"}
    # Constraint excludes warm option (BAD); output should be "ok".
    assert out.get("$parent") == "ok"


def test_constraint_skipped_when_id_already_consumed():
    """Pre-populating the consumed set should make the call a no-op."""
    from engine.modules._constraints import apply_constraints_for_target

    ctx = _empty_ctx()
    consumed = {"cn_aa"}
    ctx["__wp_picks__"]["wc_src"] = {"value": "rain", "sub_category": "wet"}
    constraints = [{
        "source_wildcard_id": "wc_src",
        "target_wildcard_id": "wc_tgt",
        "matrix": {"wet": {"warm": {"mode": "exclude", "factor": 1}}},
        "exceptions": [],
        "__constraint_module_id__": "cn_aa",
    }]
    options = [{"id": "a", "value": "red", "weight": 1, "sub_category": "warm"}]
    out, applied = apply_constraints_for_target(
        options, "wc_tgt", constraints,
        ctx["__wp_picks__"], ctx["__wp_warnings__"],
        consumed=consumed,
    )
    assert applied is False
    assert out[0]["weight"] == 1
