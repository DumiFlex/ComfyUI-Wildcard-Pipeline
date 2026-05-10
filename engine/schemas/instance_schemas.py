"""Type-only validation schema for instance overrides per kind.

Mirrors `src/components/context/editors/_shell.ts:INSTANCE_FIELDS_PER_KIND`
on the engine side. Extending field set: add to BOTH this schema AND the
TS registry. Cross-language parity test (`tests/test_instance_schema_parity.py`)
asserts both sides have identical kind→field mappings.

See: docs/superpowers/specs/2026-05-07-instance-overrides-modal-design.md §7.6
"""
from __future__ import annotations

from typing import Any, Literal

InstanceFieldType = Literal[
    "string", "list[string]", "dict[string,number]", "dict[string,dict]",
    "boolean", "number", "list[dict]",
]

INSTANCE_SCHEMAS: dict[str, dict[str, InstanceFieldType]] = {
    "wildcard": {
        "variable_binding": "string",
        "enabled_options": "list[string]",
        "option_weights": "dict[string,number]",
        "category_filter": "list[string]",
        "locked_seed": "number",
        "internal": "boolean",
        # `mode` and `pinned_option_id` removed in v2 — resolve mode is
        # implicit in pool state. Engine handler still reads them when
        # present in legacy snapshots; the schema validator now flags
        # them as unknown fields with an advisory warning.
    },
    "fixed_values": {
        "values_overrides": "list[dict]",
        "enabled_options": "list[string]",
        # Added in 2026-05-08 syntax-parity cycle: per-value `{a|b|c}`
        # resolution gives fixed_values seed-lock parity with wildcard
        # + combine. Locked seed pins the alternation outcome.
        "locked_seed": "number",
    },
    "combine": {
        # v2 single-pane modal exposes a richer override surface:
        #   - template_override: per-instance template string
        #   - variable_binding: rebind the produced var (mirrors wildcard)
        #   - locked_seed: pin {a|b|c} resolution
        #   - internal: hide-from-prompt toggle
        "template_override": "string",
        "variable_binding": "string",
        "locked_seed": "number",
        "internal": "boolean",
    },
    "derivation": {
        "disabled_rule_ids": "list[string]",
        # Tier-D modal expansion (2026-05-10 cycle):
        #   - disabled_branch_keys: list of "{rule_id}:{branch_idx}" or
        #     "{rule_id}:else" entries the engine skips during evaluation
        #   - action_value_overrides / condition_value_overrides:
        #     per-rule per-branch value swaps (engine reads override
        #     before payload value)
        #   - rule_order_override: list of rule_ids in evaluation order
        #   - locked_seed + internal: standard runtime fields the
        #     pipeline already honored on other kinds; surfaced here so
        #     RESET_FIELDS_PER_KIND + INSTANCE_FIELDS_PER_KIND keep
        #     parity with what the modal writes.
        "disabled_branch_keys": "list[string]",
        "action_value_overrides": "dict[string,dict]",
        "condition_value_overrides": "dict[string,dict]",
        "rule_order_override": "list[string]",
        "locked_seed": "number",
        "internal": "boolean",
    },
    "constraint": {
        "disabled_exception_keys": "list[string]",
        "disabled_matrix_cells": "list[string]",
    },
    # pipeline: no instance fields (scoped out)
}


def _matches_type(value: Any, spec: InstanceFieldType) -> bool:
    if spec == "string":
        return isinstance(value, str)
    if spec == "boolean":
        return isinstance(value, bool)
    if spec == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if spec == "list[string]":
        return isinstance(value, list) and all(isinstance(x, str) for x in value)
    if spec == "list[dict]":
        return isinstance(value, list) and all(isinstance(x, dict) for x in value)
    if spec == "dict[string,number]":
        return (
            isinstance(value, dict)
            and all(isinstance(k, str) for k in value.keys())
            and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in value.values())
        )
    if spec == "dict[string,dict]":
        return (
            isinstance(value, dict)
            and all(isinstance(k, str) for k in value.keys())
            and all(isinstance(v, dict) for v in value.values())
        )
    return False


def validate_instance(kind: str, instance: dict[str, Any]) -> list[str]:
    """Returns list of warnings (empty = clean). Does NOT raise — disabled-malformed
    items surface as warnings per spec §7.3/§7.4 design. Caller decides escalation."""
    schema = INSTANCE_SCHEMAS.get(kind, {})
    warnings: list[str] = []
    for field, value in instance.items():
        if field == "_ui" or field.startswith("__"):
            continue  # UI scratch / engine-internal namespace ignored
        spec = schema.get(field)
        if spec is None:
            warnings.append(f"unknown instance field: {kind}.{field}")
            continue
        if value is None:
            continue  # null = no override, always valid
        if not _matches_type(value, spec):
            warnings.append(
                f"{kind}.{field} type mismatch: expected {spec}, got {type(value).__name__}"
            )
    return warnings
