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
            # Non-None but non-list (string/dict/number) is malformed
            # state — almost certainly a workflow saved by an old SPA
            # or hand-edited JSON. Surface a warning so the user sees
            # their edits were dropped, instead of silently reverting
            # to library values without explanation.
            if overrides is not None and not isinstance(overrides, list):
                warnings = None
                if ctx is not None:
                    try:
                        warnings = ctx.get("__wp_warnings__") if hasattr(ctx, "get") else None
                    except Exception:
                        warnings = None
                if isinstance(warnings, list):
                    warnings.append({
                        "type": "fixed_values_overrides_malformed",
                        "severity": "warn",
                        "module_id": "",
                        "source_field": "instance.values_overrides",
                        "position": 0,
                        "token_index": None,
                        "detail": {
                            "got_type": type(overrides).__name__,
                            "fell_back_to": "payload.values",
                        },
                        "message": (
                            "fixed_values.instance.values_overrides was "
                            f"{type(overrides).__name__}, expected list — "
                            "fell back to library payload.values"
                        ),
                    })
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
