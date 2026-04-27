"""Pipeline module resolver — runs an ordered list of sub-modules.

Each step references a module in the library by id. The repository is
threaded through ``ctx["_repo"]``; without it the handler can still validate
its payload but ``resolve`` will raise ``RuntimeError`` because it cannot load
sub-modules. Steps marked ``enabled=False`` are skipped.
"""
from __future__ import annotations

from typing import Any

from engine.modules.dispatcher import ModuleHandler, resolve_module


def _ctx_get(ctx: Any, name: str, default: Any = None) -> Any:
    if ctx is None:
        return default
    getter = getattr(ctx, "get", None)
    if callable(getter):
        try:
            return getter(name, default)
        except TypeError:
            try:
                return getter(name)
            except Exception:
                return default
    try:
        if name in ctx:  # type: ignore[operator]
            return ctx[name]  # type: ignore[index]
    except Exception:
        return default
    return default


class PipelineHandler(ModuleHandler):
    """Composes other modules into an ordered execution list."""

    type_id = "pipeline"

    @classmethod
    def validate_payload(cls, payload: dict[str, Any]) -> None:
        if not isinstance(payload, dict):
            raise ValueError("pipeline payload must be an object")
        steps = payload.get("steps")
        if not isinstance(steps, list):
            raise ValueError("pipeline payload.steps must be a list")
        for i, step in enumerate(steps):
            if not isinstance(step, dict):
                raise ValueError(f"pipeline payload.steps[{i}] must be an object")
            module_id = step.get("module_id")
            if not isinstance(module_id, str) or not module_id:
                raise ValueError(
                    f"pipeline payload.steps[{i}].module_id must be a non-empty string"
                )
            step_id = step.get("id")
            if not isinstance(step_id, str) or not step_id:
                raise ValueError(
                    f"pipeline payload.steps[{i}].id must be a non-empty string"
                )
            enabled = step.get("enabled", True)
            if not isinstance(enabled, bool):
                raise ValueError(
                    f"pipeline payload.steps[{i}].enabled must be a boolean"
                )
            instance = step.get("instance", {})
            if not isinstance(instance, dict):
                raise ValueError(
                    f"pipeline payload.steps[{i}].instance must be an object"
                )

    @classmethod
    def resolve(
        cls,
        payload: dict[str, Any],
        instance: dict[str, Any],
        ctx: Any,
    ) -> dict[str, str]:
        cls.validate_payload(payload)
        repo = _ctx_get(ctx, "_repo", None)
        if repo is None:
            raise RuntimeError(
                "pipeline handler requires ctx['_repo'] to load sub-modules"
            )

        out: dict[str, str] = {}
        for step in payload.get("steps", []):
            if not step.get("enabled", True):
                continue
            module_id = step["module_id"]
            row = repo.get(module_id)
            sub_snapshot = {
                "type": row["type"],
                "payload": row["payload"],
                "instance": step.get("instance", {}),
            }
            bindings = resolve_module(sub_snapshot, ctx)
            if bindings:
                out.update(bindings)
        return out
