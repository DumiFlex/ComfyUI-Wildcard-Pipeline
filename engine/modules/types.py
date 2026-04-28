"""Module dataclasses and JSON round-trip helpers.

Each module type is a separate dataclass with a ``type`` literal tag. The
discriminated union ``Module`` widens as new types land (wildcard, combine,
constraint, derivation — follow-up specs).
"""

from dataclasses import asdict, dataclass, field
from typing import Any, Literal, TypeAlias


@dataclass
class ModuleMeta:
    """Shared metadata on every module. SPA library uses these for listing."""

    name: str = ""
    description: str = ""
    category: str = ""
    tags: list[str] = field(default_factory=list)


@dataclass
class FixedValueEntry:
    """One literal assignment inside a fixed_values module."""

    variable_name: str
    value: str


@dataclass
class FixedValueModule:
    """Module type: sets one or more variables to literal strings."""

    id: str
    type: Literal["fixed_values"] = "fixed_values"
    enabled: bool = True
    meta: ModuleMeta = field(default_factory=ModuleMeta)
    entries: list[FixedValueEntry] = field(default_factory=list)


# Discriminated union of all module types. Currently a single member; widens
# as new module types (wildcard, combine, constraint, derivation) land.
Module: TypeAlias = FixedValueModule


def module_to_dict(module: Module) -> dict[str, Any]:
    """Serialize a module dataclass to a plain dict (widget payload shape)."""
    return asdict(module)


def module_from_dict(data: dict[str, Any]) -> Module:
    """Deserialize a plain dict (widget payload shape) into a module dataclass.

    Raises ``ValueError`` for missing ``id``, missing ``type``, or unknown type.
    """
    if "type" not in data:
        raise ValueError(f"missing 'type' in module data: {data!r}")
    if "id" not in data:
        raise ValueError(f"missing 'id' in module data: {data!r}")

    type_tag = data["type"]
    if type_tag == "fixed_values":
        return _fixed_value_from_dict(data)

    raise ValueError(f"Unknown module type: {type_tag!r}")


def _fixed_value_from_dict(data: dict[str, Any]) -> FixedValueModule:
    meta_data = data.get("meta", {}) or {}
    meta = ModuleMeta(
        name=meta_data.get("name", ""),
        description=meta_data.get("description", ""),
        category=meta_data.get("category", ""),
        tags=list(meta_data.get("tags", []) or []),
    )
    entries = [
        FixedValueEntry(
            variable_name=entry.get("variable_name", ""),
            value=entry.get("value", ""),
        )
        for entry in (data.get("entries") or [])
    ]
    return FixedValueModule(
        id=data["id"],
        enabled=bool(data.get("enabled", True)),
        meta=meta,
        entries=entries,
    )
