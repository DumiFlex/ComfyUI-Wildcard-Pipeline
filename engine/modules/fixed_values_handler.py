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
        values: list[dict[str, Any]] = list(payload.get("values", []))
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
