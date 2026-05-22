"""v0 -> v1: no-op stub. Tags every entity with migrated_from=0.

NOTE: explicitly enumerates all seven known entity arrays (bundles,
wildcards, fixed_values, combines, derivations, constraints, categories).
If a future schema version adds an eighth entity array to the payload
shape, update BOTH this migration AND every subsequent migration in the
chain to tag the new array. Otherwise migrations will silently pass the
new array through untagged.
"""
from __future__ import annotations

from typing import Any


def migrate_v0_to_v1(payload: dict[str, Any]) -> dict[str, Any]:
    def tag(e: dict[str, Any]) -> dict[str, Any]:
        return {**e, "migrated_from": 0}
    return {
        "schema_version": 1,
        "bundles": [tag(b) for b in payload["bundles"]],
        "wildcards": [tag(w) for w in payload["wildcards"]],
        "fixed_values": [tag(v) for v in payload["fixed_values"]],
        "combines": [tag(v) for v in payload["combines"]],
        "derivations": [tag(v) for v in payload["derivations"]],
        "constraints": [tag(c) for c in payload["constraints"]],
        "categories": [tag(v) for v in payload["categories"]],
    }
