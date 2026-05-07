"""Type-only validation schema for instance overrides per kind."""
from engine.schemas.instance_schemas import INSTANCE_SCHEMAS, validate_instance


def test_schemas_cover_all_kinds_with_instance_fields():
    expected_kinds = {"wildcard", "fixed_values", "combine", "derivation", "constraint"}
    assert set(INSTANCE_SCHEMAS.keys()) == expected_kinds


def test_validate_instance_clean_returns_empty_warnings():
    inst = {"variable_binding": "foo", "locked_seed": 42}
    warnings = validate_instance("wildcard", inst)
    assert warnings == []


def test_validate_instance_null_values_are_valid():
    inst = {"enabled_options": None, "option_weights": None}
    warnings = validate_instance("wildcard", inst)
    assert warnings == []


def test_validate_instance_unknown_field_warns():
    inst = {"bogus_field": "value"}
    warnings = validate_instance("wildcard", inst)
    assert any("unknown instance field" in w for w in warnings)


def test_validate_instance_type_mismatch_warns():
    inst = {"locked_seed": "not-a-number"}
    warnings = validate_instance("wildcard", inst)
    assert any("type mismatch" in w for w in warnings)


def test_validate_instance_ignores_underscore_namespace():
    inst = {"_ui": {"last_locked_seed": 42}, "__internal": "anything"}
    warnings = validate_instance("wildcard", inst)
    assert warnings == []


def test_validate_instance_constraint_disabled_lists():
    inst = {
        "disabled_exception_keys": ['["red","blue"]'],
        "disabled_matrix_cells": ['["s","t"]'],
    }
    warnings = validate_instance("constraint", inst)
    assert warnings == []
