"""Tests for ConstraintHandler — pass-through stub that records metadata."""
import json

import pytest

from engine.modules.constraint_handler import ConstraintHandler


def _payload():
    return {
        "source_wildcard_id": "wc_outfit",
        "target_wildcard_id": "wc_pose",
        "matrix": {
            "kimono": {"casual": {"mode": "exclude", "factor": 1.0}},
        },
        "exceptions": [],
    }


def test_handler_type_id_is_constraint():
    assert ConstraintHandler.type_id == "constraint"


def test_validate_payload_accepts_well_formed():
    ConstraintHandler.validate_payload(_payload())


def test_validate_payload_rejects_blank_source_id():
    payload = _payload()
    payload["source_wildcard_id"] = ""
    with pytest.raises(ValueError, match="source_wildcard_id"):
        ConstraintHandler.validate_payload(payload)


def test_validate_payload_rejects_unknown_mode():
    payload = _payload()
    payload["matrix"]["kimono"]["casual"]["mode"] = "weird"
    with pytest.raises(ValueError, match="mode"):
        ConstraintHandler.validate_payload(payload)


def test_validate_payload_accepts_zero_factor():
    """factor=0 is canonical for "exclude this pair" — both `mode: exclude`
    and a zero factor encode the same intent. Strict > 0 was rejecting
    legitimate SPA-saved payloads where the editor surfaced an explicit
    zero weight (a real QA-reported regression). Negative factors stay
    rejected — they have no defined semantics in the weighted-pick
    model."""
    payload = _payload()
    payload["matrix"]["kimono"]["casual"]["factor"] = 0.0
    ConstraintHandler.validate_payload(payload)  # must not raise


def test_validate_payload_rejects_negative_factor():
    payload = _payload()
    payload["matrix"]["kimono"]["casual"]["factor"] = -1.0
    with pytest.raises(ValueError, match="factor"):
        ConstraintHandler.validate_payload(payload)


def test_validate_payload_rejects_non_numeric_factor():
    payload = _payload()
    payload["matrix"]["kimono"]["casual"]["factor"] = "1.0"
    with pytest.raises(ValueError, match="factor"):
        ConstraintHandler.validate_payload(payload)


def test_validate_payload_rejects_bool_factor():
    """``True`` is technically an int, but a bool factor is meaningless here."""
    payload = _payload()
    payload["matrix"]["kimono"]["casual"]["factor"] = True
    with pytest.raises(ValueError, match="factor"):
        ConstraintHandler.validate_payload(payload)


def test_validate_payload_accepts_exceptions():
    payload = _payload()
    payload["exceptions"] = [
        {"source": "kimono", "target": "casual", "mode": "boost", "factor": 1.5},
    ]
    ConstraintHandler.validate_payload(payload)


def test_validate_payload_rejects_exception_with_bad_mode():
    payload = _payload()
    payload["exceptions"] = [
        {"source": "kimono", "target": "casual", "mode": "huh", "factor": 1.0},
    ]
    with pytest.raises(ValueError, match="mode"):
        ConstraintHandler.validate_payload(payload)


def test_resolve_records_metadata_into_ctx_constraints_list():
    ctx: dict = {}
    out = ConstraintHandler.resolve(_payload(), instance={}, ctx=ctx)
    # Pass-through stub returns no bindings; mutates ctx instead.
    assert out == {}
    assert isinstance(ctx["__wp_constraints__"], list)
    assert len(ctx["__wp_constraints__"]) == 1
    meta = ctx["__wp_constraints__"][0]
    assert meta["source_wildcard_id"] == "wc_outfit"
    assert meta["target_wildcard_id"] == "wc_pose"
    assert meta["matrix"] == {"kimono": {"casual": {"mode": "exclude", "factor": 1.0}}}
    assert meta["exceptions"] == []


def test_resolve_appends_to_existing_constraints():
    ctx: dict = {"__wp_constraints__": [{"source_wildcard_id": "earlier"}]}
    ConstraintHandler.resolve(_payload(), instance={}, ctx=ctx)
    assert len(ctx["__wp_constraints__"]) == 2
    assert ctx["__wp_constraints__"][0]["source_wildcard_id"] == "earlier"
    assert ctx["__wp_constraints__"][1]["source_wildcard_id"] == "wc_outfit"


def test_resolve_rejects_malformed_payload():
    with pytest.raises(ValueError):
        ConstraintHandler.resolve(
            {"source_wildcard_id": "", "target_wildcard_id": "x", "matrix": {}},
            instance={},
            ctx={},
        )


def test_resolve_via_dispatcher_after_import():
    from engine.modules import resolve_module
    ctx: dict = {}
    snap = {"type": "constraint", "payload": _payload(), "instance": {}}
    out = resolve_module(snap, ctx=ctx)
    assert out == {}
    assert len(ctx["__wp_constraints__"]) == 1


def test_constraint_bucket_does_not_leak_to_public_socket():
    """`strip_internals` must drop the `__wp_constraints__` bucket so the
    assembler / downstream user-facing payload never sees it as a
    spurious `_constraints` variable. Regression: pre-rename the bucket
    used a single-underscore key that bypassed the strip filter, so
    autocomplete in the assembler showed `$_constraints` as a pickable
    var even though no module had bound it."""
    from engine.context import strip_internals

    ctx: dict = {}
    ConstraintHandler.resolve(_payload(), instance={}, ctx=ctx)
    # Internal bucket lives in ctx during the run.
    assert "__wp_constraints__" in ctx
    # Public socket strip drops it — no `_constraints`, no
    # `__wp_constraints__`, nothing constraint-flavoured surfaces.
    public = strip_internals(ctx)
    assert "_constraints" not in public
    assert "__wp_constraints__" not in public


def _instance(**kwargs):
    """Fresh instance dict with explicit overrides."""
    base = {
        "disabled_rule_ids": None,
        "disabled_exception_keys": None,
        "disabled_matrix_cells": None,
    }
    base.update(kwargs)
    return base


def test_constraint_resolve_disabled_matrix_cells_excluded_from_ctx():
    payload = {
        "source_wildcard_id": "src-uuid",
        "target_wildcard_id": "tgt-uuid",
        "matrix": {
            "s1": {"t1": {"mode": "allow", "factor": 1}, "t2": {"mode": "exclude", "factor": 0}},
        },
        "exceptions": [],
    }
    instance = _instance(disabled_matrix_cells=[json.dumps(["s1", "t1"], separators=(",", ":"))])
    ctx: dict = {"__wp_constraints__": []}
    ConstraintHandler.resolve(payload, instance, ctx)
    matrix = ctx["__wp_constraints__"][0]["matrix"]
    assert "t1" not in matrix.get("s1", {})
    assert "t2" in matrix.get("s1", {})


def test_constraint_resolve_disabled_exception_keys_excluded():
    payload = {
        "source_wildcard_id": "src-uuid",
        "target_wildcard_id": "tgt-uuid",
        "matrix": {},
        "exceptions": [
            {"source_value": "red", "target_value": "blue", "mode": "allow", "factor": 1},
            {"source_value": "x", "target_value": "y", "mode": "allow", "factor": 1},
        ],
    }
    instance = _instance(
        disabled_exception_keys=[json.dumps(["red", "blue"], separators=(",", ":"))]
    )
    ctx: dict = {"__wp_constraints__": []}
    ConstraintHandler.resolve(payload, instance, ctx)
    excs = ctx["__wp_constraints__"][0]["exceptions"]
    assert len(excs) == 1
    assert excs[0]["source_value"] == "x"


def test_constraint_resolve_empty_disable_lists_unchanged_output():
    payload = {
        "source_wildcard_id": "src",
        "target_wildcard_id": "tgt",
        "matrix": {"s": {"t": {"mode": "allow", "factor": 1}}},
        "exceptions": [{"source_value": "a", "target_value": "b", "mode": "allow", "factor": 1}],
    }
    ctx: dict = {"__wp_constraints__": []}
    ConstraintHandler.resolve(payload, _instance(), ctx)
    meta = ctx["__wp_constraints__"][0]
    assert meta["matrix"] == payload["matrix"]
    assert meta["exceptions"] == payload["exceptions"]


# ── Tier-D override fields (2026-05-10 modal expansion) ─────────────


def _payload_with_two_cells():
    return {
        "source_wildcard_id": "wc_outfit",
        "target_wildcard_id": "wc_pose",
        "matrix": {
            "kimono": {
                "casual": {"mode": "boost", "factor": 2.0},
                "formal": {"mode": "allow", "factor": 1.0},
            },
        },
        "exceptions": [
            {"source_value": "red", "target_value": "black", "mode": "exclude", "factor": 1.0},
        ],
    }


def test_resolve_applies_cell_mode_override():
    payload = _payload_with_two_cells()
    instance = {"cell_mode_overrides": {'["kimono","casual"]': "exclude"}}
    ctx: dict = {}
    ConstraintHandler.resolve(payload, instance, ctx)
    bucket = ctx["__wp_constraints__"]
    assert bucket[0]["matrix"]["kimono"]["casual"]["mode"] == "exclude"
    # Factor untouched.
    assert bucket[0]["matrix"]["kimono"]["casual"]["factor"] == 2.0


def test_resolve_applies_cell_factor_override():
    payload = _payload_with_two_cells()
    instance = {"cell_factor_overrides": {'["kimono","casual"]': 5.0}}
    ctx: dict = {}
    ConstraintHandler.resolve(payload, instance, ctx)
    bucket = ctx["__wp_constraints__"]
    assert bucket[0]["matrix"]["kimono"]["casual"]["factor"] == 5.0
    assert bucket[0]["matrix"]["kimono"]["casual"]["mode"] == "boost"


def test_resolve_cell_overrides_skipped_when_cell_disabled():
    payload = _payload_with_two_cells()
    instance = {
        "disabled_matrix_cells": ['["kimono","casual"]'],
        "cell_mode_overrides": {'["kimono","casual"]': "exclude"},
    }
    ctx: dict = {}
    ConstraintHandler.resolve(payload, instance, ctx)
    bucket = ctx["__wp_constraints__"]
    assert "casual" not in bucket[0]["matrix"]["kimono"]


def test_resolve_cell_override_for_unknown_key_creates_new_matrix_entry():
    """Phase B: per-instance authoring — overrides for keys absent from
    the library matrix populate a new entry. Implicit baseline is mode
    "allow" + factor 1.0; the override fills whichever side(s) the user
    set. Keeps original library cells untouched."""
    payload = _payload_with_two_cells()
    instance = {"cell_mode_overrides": {'["ghost","spectre"]': "exclude"}}
    ctx: dict = {}
    ConstraintHandler.resolve(payload, instance, ctx)
    bucket = ctx["__wp_constraints__"]
    matrix = bucket[0]["matrix"]
    # New entry created from override; default factor 1.0.
    assert matrix["ghost"]["spectre"]["mode"] == "exclude"
    assert matrix["ghost"]["spectre"]["factor"] == 1.0
    # Original cells unchanged.
    assert matrix["kimono"]["casual"]["mode"] == "boost"


def test_resolve_factor_override_alone_for_empty_cell_uses_allow_default():
    """Factor-only override on an empty cell defaults mode to 'allow'."""
    payload = _payload_with_two_cells()
    instance = {"cell_factor_overrides": {'["ghost","spectre"]': 2.5}}
    ctx: dict = {}
    ConstraintHandler.resolve(payload, instance, ctx)
    matrix = ctx["__wp_constraints__"][0]["matrix"]
    assert matrix["ghost"]["spectre"]["mode"] == "allow"
    assert matrix["ghost"]["spectre"]["factor"] == 2.5


def test_resolve_disabled_set_skips_empty_cell_overrides():
    """Disabled set wins over instance-only overrides — the cell is
    omitted from the resolved matrix entirely."""
    payload = _payload_with_two_cells()
    instance = {
        "disabled_matrix_cells": ['["ghost","spectre"]'],
        "cell_mode_overrides": {'["ghost","spectre"]': "exclude"},
    }
    ctx: dict = {}
    ConstraintHandler.resolve(payload, instance, ctx)
    matrix = ctx["__wp_constraints__"][0]["matrix"]
    assert "ghost" not in matrix


def test_resolve_malformed_key_in_cell_overrides_skipped_silently():
    """Defensive guard: bogus key (not a 2-string-array JSON) is
    skipped, not raised. Library cells continue resolving."""
    payload = _payload_with_two_cells()
    instance = {"cell_mode_overrides": {"not-a-json-key": "exclude"}}
    ctx: dict = {}
    ConstraintHandler.resolve(payload, instance, ctx)
    matrix = ctx["__wp_constraints__"][0]["matrix"]
    assert matrix["kimono"]["casual"]["mode"] == "boost"


def test_resolve_applies_exception_overrides():
    payload = _payload_with_two_cells()
    instance = {
        "exception_mode_overrides": {'["red","black"]': "boost"},
        "exception_factor_overrides": {'["red","black"]': 3.0},
    }
    ctx: dict = {}
    ConstraintHandler.resolve(payload, instance, ctx)
    exc = ctx["__wp_constraints__"][0]["exceptions"][0]
    assert exc["mode"] == "boost"
    assert exc["factor"] == 3.0


def test_resolve_appends_extra_exceptions():
    payload = _payload_with_two_cells()
    instance = {
        "extra_exceptions": [
            {"source_value": "blue", "target_value": "green", "mode": "boost", "factor": 2.5},
        ],
    }
    ctx: dict = {}
    ConstraintHandler.resolve(payload, instance, ctx)
    exceptions = ctx["__wp_constraints__"][0]["exceptions"]
    assert len(exceptions) == 2
    extra = exceptions[-1]
    assert extra["source_value"] == "blue"
    assert extra["mode"] == "boost"


def test_resolve_extra_exception_with_invalid_mode_rejected():
    payload = _payload_with_two_cells()
    instance = {
        "extra_exceptions": [
            {"source_value": "blue", "target_value": "green", "mode": "weird", "factor": 1.0},
        ],
    }
    with pytest.raises(ValueError, match="mode"):
        ConstraintHandler.resolve(payload, instance, {})


def test_resolve_extra_exception_with_negative_factor_rejected():
    payload = _payload_with_two_cells()
    instance = {
        "extra_exceptions": [
            {"source_value": "blue", "target_value": "green", "mode": "boost", "factor": -1.0},
        ],
    }
    with pytest.raises(ValueError, match="factor"):
        ConstraintHandler.resolve(payload, instance, {})


def test_resolve_cell_factor_zero_accepted():
    payload = _payload_with_two_cells()
    instance = {"cell_factor_overrides": {'["kimono","casual"]': 0.0}}
    ctx: dict = {}
    ConstraintHandler.resolve(payload, instance, ctx)
    assert ctx["__wp_constraints__"][0]["matrix"]["kimono"]["casual"]["factor"] == 0.0


# ── SP3: target_select reach selector (shape + plumbing only) ───────
#
# {mode: "first"|"next"|"all"|"pick", count?, picks?}, default {mode:"all"}.
# These cover validation + registration into ctx metadata; reach
# *behaviour* lands in a later task and is NOT exercised here.


def _ts_payload(**extra):
    """Minimal valid constraint payload, optionally carrying target_select."""
    base = {
        "source_wildcard_id": "aaaaaaaa",
        "target_wildcard_id": "bbbbbbbb",
        "matrix": {},
        "exceptions": [],
    }
    base.update(extra)
    return base


def test_target_select_defaults_all_when_absent():
    # Absent target_select validates fine (defaults applied at resolve).
    ConstraintHandler.validate_payload(_ts_payload())  # no raise


def test_target_select_none_is_allowed():
    ConstraintHandler.validate_payload(_ts_payload(target_select=None))  # no raise


def test_target_select_explicit_all_accepted():
    ConstraintHandler.validate_payload(
        _ts_payload(target_select={"mode": "all"})
    )  # no raise


def test_target_select_rejects_non_object():
    with pytest.raises(ValueError, match="target_select"):
        ConstraintHandler.validate_payload(_ts_payload(target_select="all"))


def test_target_select_rejects_bad_mode():
    with pytest.raises(ValueError, match="target_select.mode"):
        ConstraintHandler.validate_payload(
            _ts_payload(target_select={"mode": "sometimes"})
        )


def test_target_select_next_requires_positive_count():
    with pytest.raises(ValueError, match="count"):
        ConstraintHandler.validate_payload(
            _ts_payload(target_select={"mode": "next", "count": 0})
        )


def test_target_select_next_rejects_bool_count():
    # bool is an int subclass; reject it explicitly.
    with pytest.raises(ValueError, match="count"):
        ConstraintHandler.validate_payload(
            _ts_payload(target_select={"mode": "next", "count": True})
        )


def test_target_select_next_accepts_positive_count():
    ConstraintHandler.validate_payload(
        _ts_payload(target_select={"mode": "next", "count": 3})
    )  # no raise


def test_target_select_pick_requires_list():
    with pytest.raises(ValueError, match="picks"):
        ConstraintHandler.validate_payload(
            _ts_payload(target_select={"mode": "pick", "picks": "nope"})
        )


def test_target_select_pick_rejects_bad_kind():
    with pytest.raises(ValueError, match=r"picks\[0\].kind"):
        ConstraintHandler.validate_payload(
            _ts_payload(target_select={"mode": "pick", "picks": [{"kind": "weird"}]})
        )


def test_target_select_pick_direct_needs_string_uid():
    with pytest.raises(ValueError, match=r"picks\[0\].uid"):
        ConstraintHandler.validate_payload(
            _ts_payload(target_select={"mode": "pick", "picks": [{"kind": "direct"}]})
        )


def test_target_select_pick_nested_needs_carrier_and_option():
    with pytest.raises(ValueError, match=r"picks\[0\]"):
        ConstraintHandler.validate_payload(
            _ts_payload(
                target_select={"mode": "pick", "picks": [{"kind": "nested"}]}
            )
        )


def test_target_select_pick_accepts_valid_entries():
    ConstraintHandler.validate_payload(
        _ts_payload(
            target_select={
                "mode": "pick",
                "picks": [
                    {"kind": "direct", "uid": "u1"},
                    {"kind": "nested", "carrier_uid": "c1", "option_id": "o1"},
                ],
            }
        )
    )  # no raise


def test_resolve_registers_target_select_in_meta():
    ctx = {"__wp_current_module_uid__": "u1", "__wp_current_module_id__": "lib1"}
    ConstraintHandler.resolve(
        _ts_payload(target_select={"mode": "next", "count": 2}), {}, ctx
    )
    assert ctx["__wp_constraints__"][-1]["target_select"] == {"mode": "next", "count": 2}


def test_resolve_defaults_target_select_to_all_when_absent():
    ctx = {"__wp_current_module_uid__": "u1", "__wp_current_module_id__": "lib1"}
    ConstraintHandler.resolve(_ts_payload(), {}, ctx)
    assert ctx["__wp_constraints__"][-1]["target_select"] == {"mode": "all"}


def test_resolve_instance_target_select_overrides_payload():
    ctx = {"__wp_current_module_uid__": "u1", "__wp_current_module_id__": "lib1"}
    ConstraintHandler.resolve(
        _ts_payload(target_select={"mode": "all"}),
        {"target_select": {"mode": "first"}},
        ctx,
    )
    assert ctx["__wp_constraints__"][-1]["target_select"] == {"mode": "first"}


# ── SP3: per-instance reach override beats the library default for EVERY
# mode (first / next / all / pick). The canvas modal writes the placement's
# reach to `instance.target_select`; the engine MUST apply that, not the
# published library `payload.target_select`. `apply_constraints_for_target`
# reads `meta["target_select"]`, so these lock the value the apply pass sees.


def _recorded_target_select(payload_ts, instance_ts):
    """Resolve with the given library (payload) + per-instance reach and
    return the `target_select` recorded into ctx — exactly what
    `apply_constraints_for_target` reads to decide coverage."""
    ctx: dict = {"__wp_current_module_uid__": "u1", "__wp_current_module_id__": "lib1"}
    payload = _ts_payload(
        **({"target_select": payload_ts} if payload_ts is not None else {})
    )
    instance = {"target_select": instance_ts} if instance_ts is not None else {}
    ConstraintHandler.resolve(payload, instance, ctx)
    return ctx["__wp_constraints__"][-1]["target_select"]


def test_instance_reach_next_overrides_library():
    # Library default `all`; instance overrides to `next 3` → engine uses next 3.
    assert _recorded_target_select(
        {"mode": "all"}, {"mode": "next", "count": 3}
    ) == {"mode": "next", "count": 3}


def test_instance_reach_pick_overrides_library():
    # Library default `first`; instance overrides to an explicit pick list.
    picks = [{"kind": "direct", "uid": "abc123def456"}]
    assert _recorded_target_select(
        {"mode": "first"}, {"mode": "pick", "picks": picks}
    ) == {"mode": "pick", "picks": picks}


def test_instance_reach_explicit_all_overrides_nonall_library():
    # The critical "all" case: library default `first`, instance explicitly
    # widens to `all`. The engine honors the PRESENT instance value (its
    # `instance or payload or default` chain), so an explicit `{mode:"all"}`
    # override wins over a non-all library default. (The canvas modal must
    # actually SEND `{mode:"all"}` here rather than collapsing it to null —
    # see ConstraintInstanceModal.onTargetSelect.)
    assert _recorded_target_select(
        {"mode": "first"}, {"mode": "all"}
    ) == {"mode": "all"}


def test_library_reach_used_when_instance_absent():
    # No per-instance override → fall back to the published library value.
    assert _recorded_target_select(
        {"mode": "next", "count": 2}, None
    ) == {"mode": "next", "count": 2}
