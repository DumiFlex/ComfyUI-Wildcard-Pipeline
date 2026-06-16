"""Unit tests for engine.modules.snapshot."""

from __future__ import annotations

from engine.modules.snapshot import _fresh_instance


def test_fresh_instance_includes_tier2_fields_with_none_default():
    inst = _fresh_instance()
    assert inst["disabled_rule_ids"] is None
    assert inst["disabled_exception_keys"] is None
    assert inst["disabled_matrix_cells"] is None


def test_fresh_instance_includes_sp2a_pick_fields_and_exclude_null():
    """SP2a: the multi-select pick range + the null toggle must be part of
    the snapshot baseline so a frozen instance carries every override the
    instance schema knows (all default None)."""
    inst = _fresh_instance()
    assert inst["exclude_null"] is None
    assert inst["pick_min"] is None
    assert inst["pick_max"] is None
    assert inst["pick_separator"] is None


def test_fresh_instance_does_not_include_ui_namespace():
    inst = _fresh_instance()
    # _ui is set lazily by UI on first interaction, not by snapshot baseline.
    assert "_ui" not in inst


def test_fresh_instance_all_fields_default_to_none():
    """Every field MUST default to ``None`` so the frontend's
    ``instanceModified`` predicate (``value != null``) does not falsely
    flag a pristine snapshot as modified. Engine readers already coerce
    ``None`` to the appropriate runtime sentinel — see comments inside
    ``_fresh_instance``."""
    inst = _fresh_instance()
    for field, value in inst.items():
        assert value is None, (
            f"{field} must default to None (got {value!r}); "
            f"non-None sentinels falsely flag the Instance tab as modified."
        )
