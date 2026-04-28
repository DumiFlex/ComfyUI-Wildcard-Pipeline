"""Wildcard module resolver — weighted RNG over options, syntax via resolve_text.

Each option's `value` may contain $var, @{uuid}, {a|b|c}, {N$$sep$$...}, and
escapes. After picking the option, resolve_text expands the syntax against
the runtime context.
"""
from __future__ import annotations

from typing import Any

from engine.modules import build_resolve_ctx
from engine.modules.dispatcher import ModuleHandler
from engine.syntax import resolve_text


def _pick_weighted(options: list[dict[str, Any]], rng) -> dict[str, Any] | None:
    """Pick one option weighted by `weight`. Uses rng (no module-global random)."""
    if not options:
        return None
    total = sum(max(0.0, float(o.get("weight", 1))) for o in options)
    if total <= 0:
        return options[0]
    r = rng.random() * total
    acc = 0.0
    for opt in options:
        acc += max(0.0, float(opt.get("weight", 1)))
        if r <= acc:
            return opt
    return options[-1]


class WildcardHandler(ModuleHandler):
    type_id = "wildcard"

    @classmethod
    def resolve(
        cls,
        payload: dict[str, Any],
        instance: dict[str, Any],
        ctx: Any,
    ) -> dict[str, str]:
        binding = instance.get("variable_binding") or payload.get("var_binding") or ""
        if not binding:
            return {}

        options: list[dict[str, Any]] = list(payload.get("options", []))
        enabled = instance.get("enabled_options")
        if enabled is not None:
            allowed = set(enabled)
            options = [o for o in options if o.get("id") in allowed]

        if not options:
            return {binding: ""}

        rng = ctx["__wp_rng__"]
        chosen = _pick_weighted(options, rng)
        if chosen is None:
            return {binding: ""}

        value = str(chosen.get("value", ""))
        if not value:
            return {binding: ""}

        resolve_ctx = build_resolve_ctx(ctx, surface="wildcard")
        resolved = resolve_text(value, resolve_ctx)
        return {binding: resolved}
