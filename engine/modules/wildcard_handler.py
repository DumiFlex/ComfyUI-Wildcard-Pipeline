"""Wildcard module resolver — weighted RNG over options, ``@{ref}`` expansion."""
from __future__ import annotations

import random
import re
from typing import Any

from engine.modules.dispatcher import ModuleHandler

_REF_RE = re.compile(r"@\{([a-zA-Z0-9_\-]+)\}")
MAX_REF_DEPTH = 8


class RecursionLimitExceeded(RuntimeError):
    """Raised when ``@{ref}`` chain exceeds ``MAX_REF_DEPTH``."""


def _pick_weighted(options: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not options:
        return None
    total = sum(max(0.0, float(o.get("weight", 1))) for o in options)
    if total <= 0:
        return options[0]
    r = random.random() * total
    acc = 0.0
    for opt in options:
        acc += max(0.0, float(opt.get("weight", 1)))
        if r <= acc:
            return opt
    return options[-1]


def _expand_refs(value: str, ctx: Any, depth: int) -> str:
    if depth >= MAX_REF_DEPTH:
        raise RecursionLimitExceeded(f"max @{{ref}} depth at {value!r}")
    if ctx is None or not hasattr(ctx, "resolve_ref"):
        return _REF_RE.sub("", value)

    def _sub(match: re.Match[str]) -> str:
        return ctx.resolve_ref(match.group(1), depth=depth + 1)

    return _REF_RE.sub(_sub, value)


class WildcardHandler(ModuleHandler):
    type_id = "wildcard"

    @classmethod
    def resolve(
        cls,
        payload: dict[str, Any],
        instance: dict[str, Any],
        ctx: Any,
        *,
        _depth: int = 0,
    ) -> dict[str, str]:
        binding = instance.get("variable_binding") or ""
        if not binding:
            return {}
        options: list[dict[str, Any]] = list(payload.get("options", []))
        enabled = instance.get("enabled_options")
        if enabled is not None:
            allowed = set(enabled)
            options = [o for o in options if o.get("id") in allowed]
        if not options:
            return {binding: ""}
        chosen = _pick_weighted(options)
        if chosen is None:
            return {binding: ""}
        value = str(chosen.get("value", ""))
        expanded = _expand_refs(value, ctx, depth=_depth)
        return {binding: expanded}
