"""Constraint module resolver — pass-through stub.

A constraint module declares a re-weighting matrix from one wildcard module's
options to another's. The actual mutation is intentionally **not** done here:
WildcardHandler will eventually inspect ``ctx["_constraints"]`` and apply the
matrix when picking options. This handler only validates the payload and
records metadata in the context for the wildcard handler to consume.

TODO: When WildcardHandler grows constraint awareness, switch from recording
metadata to applying it here, or keep it as a pure metadata channel and let
the consumer drive resolution. The current decision is metadata-only.
"""
from __future__ import annotations

from typing import Any

from engine.modules.dispatcher import ModuleHandler

_VALID_MODES = {"allow", "exclude", "boost", "reduce"}


def _ctx_set_constraint(ctx: Any, meta: dict[str, Any]) -> None:
    """Append ``meta`` to ``ctx['_constraints']`` (best-effort)."""
    if ctx is None:
        return
    # Try setter-based access first (engine Context API).
    setter = getattr(ctx, "set", None)
    getter = getattr(ctx, "get", None)
    if callable(setter) and callable(getter):
        try:
            existing = getter("_constraints", None)
        except TypeError:
            existing = None
        bucket = list(existing) if isinstance(existing, list) else []
        bucket.append(meta)
        try:
            setter("_constraints", bucket)
            return
        except Exception:
            pass
    # Fall back to dict-like __getitem__/__setitem__.
    try:
        existing = ctx["_constraints"] if "_constraints" in ctx else []  # type: ignore[operator,index]
    except Exception:
        existing = []
    bucket = list(existing) if isinstance(existing, list) else []
    bucket.append(meta)
    try:
        ctx["_constraints"] = bucket  # type: ignore[index]
    except Exception:
        return


def _validate_cell(cell: Any, where: str) -> None:
    if not isinstance(cell, dict):
        raise ValueError(f"constraint {where} must be an object")
    mode = cell.get("mode")
    if mode not in _VALID_MODES:
        raise ValueError(
            f"constraint {where}.mode must be one of {sorted(_VALID_MODES)}"
        )
    factor = cell.get("factor")
    if not isinstance(factor, (int, float)) or isinstance(factor, bool):
        raise ValueError(f"constraint {where}.factor must be a number")
    if float(factor) <= 0:
        raise ValueError(f"constraint {where}.factor must be a positive number")


class ConstraintHandler(ModuleHandler):
    """Records a constraint matrix into the context for downstream consumers."""

    type_id = "constraint"

    @classmethod
    def validate_payload(cls, payload: dict[str, Any]) -> None:
        if not isinstance(payload, dict):
            raise ValueError("constraint payload must be an object")
        for key in ("source_wildcard_id", "target_wildcard_id"):
            value = payload.get(key)
            if not isinstance(value, str) or not value:
                raise ValueError(f"constraint payload.{key} must be a non-empty string")
        matrix = payload.get("matrix", {})
        if not isinstance(matrix, dict):
            raise ValueError("constraint payload.matrix must be an object")
        for source, sub in matrix.items():
            if not isinstance(source, str):
                raise ValueError("constraint payload.matrix keys must be strings")
            if not isinstance(sub, dict):
                raise ValueError(
                    f"constraint payload.matrix[{source!r}] must be an object"
                )
            for target, cell in sub.items():
                if not isinstance(target, str):
                    raise ValueError(
                        f"constraint payload.matrix[{source!r}] keys must be strings"
                    )
                _validate_cell(cell, f"matrix[{source!r}][{target!r}]")
        exceptions = payload.get("exceptions", [])
        if not isinstance(exceptions, list):
            raise ValueError("constraint payload.exceptions must be a list")
        for i, exc in enumerate(exceptions):
            if not isinstance(exc, dict):
                raise ValueError(
                    f"constraint payload.exceptions[{i}] must be an object"
                )
            for key in ("source", "target"):
                v = exc.get(key)
                if not isinstance(v, str) or not v:
                    raise ValueError(
                        f"constraint payload.exceptions[{i}].{key} must be a "
                        f"non-empty string"
                    )
            mode = exc.get("mode")
            if mode not in _VALID_MODES:
                raise ValueError(
                    f"constraint payload.exceptions[{i}].mode must be one of "
                    f"{sorted(_VALID_MODES)}"
                )
            factor = exc.get("factor")
            if not isinstance(factor, (int, float)) or isinstance(factor, bool):
                raise ValueError(
                    f"constraint payload.exceptions[{i}].factor must be a number"
                )
            if float(factor) <= 0:
                raise ValueError(
                    f"constraint payload.exceptions[{i}].factor must be positive"
                )

    @classmethod
    def resolve(
        cls,
        payload: dict[str, Any],
        instance: dict[str, Any],
        ctx: Any,
    ) -> dict[str, str]:
        cls.validate_payload(payload)
        meta = {
            "source_wildcard_id": payload["source_wildcard_id"],
            "target_wildcard_id": payload["target_wildcard_id"],
            "matrix": payload.get("matrix", {}),
            "exceptions": payload.get("exceptions", []),
        }
        _ctx_set_constraint(ctx, meta)
        # Pass-through stub: return no bindings — WildcardHandler is expected
        # to consume ctx["_constraints"] when it grows constraint awareness.
        return {}
