"""Fixed-values module resolver. Emits one binding per named value."""
from __future__ import annotations

from typing import Any

from engine.modules.dispatcher import ModuleHandler


class FixedValuesHandler(ModuleHandler):
    type_id = "fixed_values"

    @classmethod
    def resolve(
        cls,
        payload: dict[str, Any],
        instance: dict[str, Any],
        ctx: Any,
    ) -> dict[str, str]:
        # Two-tier model mirroring wildcard:
        #   - `payload.values` = library-truth (immutable while picked).
        #   - `instance.values_overrides` = optional full-replacement
        #     list of `{id, name, value}` written by the modal when the
        #     user edits a library-tracked fixed_values.
        # When overrides are present (and non-empty), they fully replace
        # the library values. Inline-created modules (no `payload_hash`,
        # no library link) keep editing `payload.values` directly so
        # their behaviour is unchanged.
        overrides = instance.get("values_overrides")
        if isinstance(overrides, list) and overrides:
            values: list[dict[str, Any]] = [v for v in overrides if isinstance(v, dict)]
        else:
            values = list(payload.get("values", []))
        enabled = instance.get("enabled_options")
        if enabled is not None:
            allowed = set(enabled)
            values = [v for v in values if v.get("id") in allowed]
        out: dict[str, str] = {}
        for v in values:
            name = (v.get("name") or "").strip()
            if not name:
                continue
            out[name] = str(v.get("value", ""))
        return out
