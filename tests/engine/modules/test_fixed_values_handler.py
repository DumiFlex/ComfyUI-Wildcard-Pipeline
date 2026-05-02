"""Tests for FixedValuesHandler — emits one mapping per named value."""
from engine.modules.fixed_values_handler import FixedValuesHandler


def _payload(values):
    return {"values": values}


def test_resolve_returns_all_values():
    payload = _payload([
        {"id": "v1", "name": "$lens", "value": "85mm"},
        {"id": "v2", "name": "$angle", "value": "wide"},
    ])
    out = FixedValuesHandler.resolve(payload, instance={}, ctx=None)
    assert out == {"$lens": "85mm", "$angle": "wide"}


def test_resolve_empty_values_returns_empty_dict():
    out = FixedValuesHandler.resolve(_payload([]), instance={}, ctx=None)
    assert out == {}


def test_resolve_filters_by_enabled_options():
    payload = _payload([
        {"id": "v1", "name": "$a", "value": "1"},
        {"id": "v2", "name": "$b", "value": "2"},
    ])
    out = FixedValuesHandler.resolve(
        payload, instance={"enabled_options": ["v2"]}, ctx=None,
    )
    assert out == {"$b": "2"}


def test_resolve_skips_blank_names():
    payload = _payload([
        {"id": "v1", "name": "", "value": "x"},
        {"id": "v2", "name": "   ", "value": "y"},
        {"id": "v3", "name": "$ok", "value": "z"},
    ])
    out = FixedValuesHandler.resolve(payload, instance={}, ctx=None)
    assert out == {"$ok": "z"}


def test_resolve_handles_missing_value_key():
    """A value without 'value' resolves to empty string."""
    payload = _payload([{"id": "v1", "name": "$x"}])
    out = FixedValuesHandler.resolve(payload, instance={}, ctx=None)
    assert out == {"$x": ""}


def test_resolve_coerces_value_to_string():
    payload = _payload([{"id": "v1", "name": "$n", "value": 42}])
    out = FixedValuesHandler.resolve(payload, instance={}, ctx=None)
    assert out == {"$n": "42"}


def test_handler_type_id_is_fixed_values():
    assert FixedValuesHandler.type_id == "fixed_values"


def test_resolve_via_dispatcher_after_import():
    """Importing engine.modules auto-registers FixedValuesHandler."""
    from engine.modules import resolve_module
    snap = {
        "type": "fixed_values",
        "payload": _payload([{"id": "v1", "name": "$lens", "value": "85mm"}]),
        "instance": {},
    }
    out = resolve_module(snap, ctx=None)
    assert out == {"$lens": "85mm"}


# ── Two-tier override path (mirrors wildcard's instance overrides) ──

def test_resolve_uses_instance_values_overrides_when_present():
    """Library-tracked fixed_values: edits go to `instance.values_overrides`,
    payload.values stays as the immutable library snapshot. Engine reads
    overrides when present; only falls through to library values otherwise."""
    payload = _payload([
        {"id": "v1", "name": "$lens", "value": "85mm"},   # library default
        {"id": "v2", "name": "$angle", "value": "wide"},  # library default
    ])
    overrides = [
        {"id": "v1", "name": "$lens", "value": "50mm"},   # user edited
        {"id": "v2", "name": "$angle", "value": "wide"},  # unchanged but copied
    ]
    out = FixedValuesHandler.resolve(
        payload, instance={"values_overrides": overrides}, ctx=None,
    )
    assert out == {"$lens": "50mm", "$angle": "wide"}


def test_resolve_falls_back_to_payload_when_overrides_empty():
    """Empty overrides list = no effective override → use payload.values.
    Edge case for the modal's "reset to library" path which clears
    overrides; engine must NOT treat the empty list as "hide all values"."""
    payload = _payload([{"id": "v1", "name": "$x", "value": "1"}])
    out = FixedValuesHandler.resolve(
        payload, instance={"values_overrides": []}, ctx=None,
    )
    assert out == {"$x": "1"}


def test_resolve_overrides_can_add_entries_not_in_library_payload():
    """Full-replacement semantics — overrides aren't a delta map. The
    user can add new entries via the modal that don't exist in the
    library row, and they must surface."""
    payload = _payload([{"id": "v1", "name": "$a", "value": "1"}])
    overrides = [
        {"id": "v1", "name": "$a", "value": "1"},
        {"id": "v_new", "name": "$b", "value": "2"},  # new — not in library
    ]
    out = FixedValuesHandler.resolve(
        payload, instance={"values_overrides": overrides}, ctx=None,
    )
    assert out == {"$a": "1", "$b": "2"}


def test_resolve_overrides_can_drop_library_entries():
    """If user removes an entry in the modal, override list excludes it.
    Engine must not surface the dropped name from library payload."""
    payload = _payload([
        {"id": "v1", "name": "$a", "value": "1"},
        {"id": "v2", "name": "$b", "value": "2"},
    ])
    overrides = [{"id": "v1", "name": "$a", "value": "1"}]  # $b removed
    out = FixedValuesHandler.resolve(
        payload, instance={"values_overrides": overrides}, ctx=None,
    )
    assert out == {"$a": "1"}


def test_resolve_ignores_non_list_overrides():
    """Defensive — malformed `values_overrides` (string, dict) is ignored,
    library payload still resolves. Cheap insurance against legacy
    workflow JSON or future shape drift."""
    payload = _payload([{"id": "v1", "name": "$x", "value": "1"}])
    out = FixedValuesHandler.resolve(
        payload, instance={"values_overrides": "not a list"}, ctx=None,
    )
    assert out == {"$x": "1"}


def test_resolve_emits_warning_when_overrides_malformed():
    """Pre-fix: a malformed `values_overrides` (string/dict from an old
    SPA save or hand-edited JSON) silently fell back to library payload.
    User's edits dropped without explanation. Now the engine emits a
    `fixed_values_overrides_malformed` warning so the fallback is
    visible in WP_Debug."""
    payload = _payload([{"id": "v1", "name": "$x", "value": "1"}])
    ctx = {"__wp_warnings__": []}
    FixedValuesHandler.resolve(
        payload, instance={"values_overrides": {"id": "v1"}}, ctx=ctx,
    )
    warnings = [
        w for w in ctx["__wp_warnings__"]
        if w["type"] == "fixed_values_overrides_malformed"
    ]
    assert len(warnings) == 1
    assert warnings[0]["detail"]["got_type"] == "dict"


def test_resolve_no_warning_when_overrides_absent():
    """Sanity: the malformed-warning path must NOT fire when overrides
    are simply absent (the common case). Pre-fix this test would have
    flagged my over-eager check that fires on `None`."""
    payload = _payload([{"id": "v1", "name": "$x", "value": "1"}])
    ctx = {"__wp_warnings__": []}
    FixedValuesHandler.resolve(payload, instance={}, ctx=ctx)
    assert ctx["__wp_warnings__"] == []
