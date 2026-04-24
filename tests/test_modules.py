"""Unit tests for engine.modules."""

from __future__ import annotations

import pytest

from engine.modules import (
    FixedValueEntry,
    FixedValueModule,
    ModuleMeta,
    module_from_dict,
    module_to_dict,
)


class TestFixedValueModuleDefaults:
    def test_minimal_instantiation(self):
        m = FixedValueModule(id="abcd1234")
        assert m.id == "abcd1234"
        assert m.type == "fixed_values"
        assert m.enabled is True
        assert m.entries == []
        assert m.meta == ModuleMeta()

    def test_with_entries(self):
        m = FixedValueModule(
            id="abcd1234",
            entries=[FixedValueEntry(variable_name="style", value="photo")],
        )
        assert m.entries[0].variable_name == "style"
        assert m.entries[0].value == "photo"


class TestModuleMeta:
    def test_defaults(self):
        meta = ModuleMeta()
        assert meta.name == ""
        assert meta.description == ""
        assert meta.category == ""
        assert meta.tags == []

    def test_custom(self):
        meta = ModuleMeta(name="style defaults", tags=["character", "style"])
        assert meta.name == "style defaults"
        assert meta.tags == ["character", "style"]


class TestModuleFromDict:
    def test_fixed_values_minimal(self):
        d = {"id": "abcd1234", "type": "fixed_values"}
        m = module_from_dict(d)
        assert isinstance(m, FixedValueModule)
        assert m.id == "abcd1234"
        assert m.enabled is True
        assert m.entries == []

    def test_fixed_values_full(self):
        d = {
            "id": "abcd1234",
            "type": "fixed_values",
            "enabled": False,
            "meta": {
                "name": "style defaults",
                "description": "portrait baseline",
                "category": "style",
                "tags": ["portrait"],
            },
            "entries": [
                {"variable_name": "style", "value": "photoreal"},
                {"variable_name": "light", "value": "soft"},
            ],
        }
        m = module_from_dict(d)
        assert isinstance(m, FixedValueModule)
        assert m.enabled is False
        assert m.meta.name == "style defaults"
        assert m.meta.tags == ["portrait"]
        assert len(m.entries) == 2
        assert m.entries[1].variable_name == "light"

    def test_unknown_type_raises(self):
        with pytest.raises(ValueError, match="Unknown module type"):
            module_from_dict({"id": "x", "type": "mystery"})

    def test_missing_type_raises(self):
        with pytest.raises(ValueError, match="missing 'type'"):
            module_from_dict({"id": "x"})

    def test_missing_id_raises(self):
        with pytest.raises(ValueError, match="missing 'id'"):
            module_from_dict({"type": "fixed_values"})


class TestModuleToDict:
    def test_minimal_round_trip(self):
        m = FixedValueModule(id="abcd1234")
        d = module_to_dict(m)
        assert d["id"] == "abcd1234"
        assert d["type"] == "fixed_values"
        assert d["enabled"] is True
        assert d["entries"] == []
        assert d["meta"] == {
            "name": "",
            "description": "",
            "category": "",
            "tags": [],
        }

    def test_full_round_trip(self):
        original = FixedValueModule(
            id="abcd1234",
            enabled=False,
            meta=ModuleMeta(name="n", tags=["t1"]),
            entries=[FixedValueEntry(variable_name="v", value="x")],
        )
        d = module_to_dict(original)
        reconstructed = module_from_dict(d)
        assert reconstructed == original
