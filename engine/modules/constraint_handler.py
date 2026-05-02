"""Constraint module resolver — pass-through stub.

A constraint module declares a re-weighting matrix from one wildcard module's
options to another's. The actual mutation is intentionally **not** done here:
WildcardHandler will eventually inspect ``ctx["__wp_constraints__"]`` and apply the
matrix when picking options. This handler only validates the payload and
records metadata in the context for the wildcard handler to consume.

The bucket key uses the canonical ``__wp_*__`` engine-internal prefix so
``strip_internals`` drops it from the public socket payload — without the
``__`` prefix the constraint metadata leaked to the assembler as a
user-facing ``_constraints`` variable, polluting autocomplete + templates.

TODO: When WildcardHandler grows constraint awareness, switch from recording
metadata to applying it here, or keep it as a pure metadata channel and let
the consumer drive resolution. The current decision is metadata-only.
"""
from __future__ import annotations

from typing import Any

from engine.modules.dispatcher import ModuleHandler

_VALID_MODES = {"allow", "exclude", "boost", "reduce"}


def _ctx_set_constraint(ctx: Any, meta: dict[str, Any]) -> None:
    """Append ``meta`` to ``ctx['__wp_constraints__']`` (best-effort).

    On total failure (both setter API and dict-like access raise), emit a
    `constraint_register_failed` warning so the user gets a debug-viewer
    signal — pre-fix the constraint silently never registered and the
    wildcard handler ran unconstrained with zero indication that the
    user's constraint was even loaded.
    """
    if ctx is None:
        return
    # Try setter-based access first (engine Context API).
    setter = getattr(ctx, "set", None)
    getter = getattr(ctx, "get", None)
    if callable(setter) and callable(getter):
        try:
            existing = getter("__wp_constraints__", None)
        except TypeError:
            existing = None
        bucket = list(existing) if isinstance(existing, list) else []
        bucket.append(meta)
        try:
            setter("__wp_constraints__", bucket)
            return
        except Exception:
            pass
    # Fall back to dict-like __getitem__/__setitem__.
    try:
        existing = ctx["__wp_constraints__"] if "__wp_constraints__" in ctx else []  # type: ignore[operator,index]
    except Exception:
        existing = []
    bucket = list(existing) if isinstance(existing, list) else []
    bucket.append(meta)
    try:
        ctx["__wp_constraints__"] = bucket  # type: ignore[index]
        return
    except Exception as e:
        # Both setter + dict paths failed. Emit a warning so the
        # constraint failure surfaces in WP_Debug instead of being a
        # silent no-op (pre-fix users had no signal that their
        # constraint never made it into ctx — the wildcard handler
        # then ran unconstrained with zero indication).
        warnings = None
        try:
            warnings = ctx.get("__wp_warnings__") if hasattr(ctx, "get") else None
        except Exception:
            warnings = None
        if isinstance(warnings, list):
            warnings.append({
                "type": "constraint_register_failed",
                "severity": "error",
                "module_id": "",
                "source_field": "",
                "position": 0,
                "token_index": None,
                "detail": {
                    "exception_type": type(e).__name__,
                    "exception_message": str(e),
                    "source_wildcard_id": meta.get("source_wildcard_id"),
                    "target_wildcard_id": meta.get("target_wildcard_id"),
                },
                "message": (
                    "constraint failed to register in ctx — "
                    f"{type(e).__name__}: {e}"
                ),
            })


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
    # factor >= 0 — factor=0 is meaningful (effectively excludes the
    # option, same as `mode: exclude`). Strict `> 0` rejected legitimate
    # SPA-saved payloads where the editor surfaced an explicit zero
    # weight, breaking the entire constraint at runtime. Negative
    # factors stay rejected since they have no defined semantics in the
    # weighted-pick model.
    if float(factor) < 0:
        raise ValueError(f"constraint {where}.factor must not be negative")


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
            # factor >= 0 — factor=0 is the canonical exception form for
            # "always exclude this pair". Same logic as the matrix-cell
            # check above; SPA payloads surface zero factors and the
            # strict > 0 rejected them, killing the whole constraint.
            if float(factor) < 0:
                raise ValueError(
                    f"constraint payload.exceptions[{i}].factor must not be negative"
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
        # to consume ctx["__wp_constraints__"] when it grows constraint awareness.
        return {}
