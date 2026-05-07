"""Unit tests for engine.modules.snapshot."""

from __future__ import annotations

from engine.modules.snapshot import _fresh_instance


def test_fresh_instance_includes_tier2_fields_with_none_default():
    inst = _fresh_instance()
    assert inst["disabled_rule_ids"] is None
    assert inst["disabled_exception_keys"] is None
    assert inst["disabled_matrix_cells"] is None


def test_fresh_instance_does_not_include_ui_namespace():
    inst = _fresh_instance()
    # _ui is set lazily by UI on first interaction, not by snapshot baseline.
    assert "_ui" not in inst
