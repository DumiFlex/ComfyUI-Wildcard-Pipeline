"""Wildcard fallback option (schema v9).

A wildcard may mark one non-null option ``fallback: true``. That option rolls
like any other (its weight, the node's filters + toggles and constraints all
apply), and is ALSO taken, without an rng draw, when nothing is left to pick:
every option, the fallback included, was excluded by a constraint (an Only
rule included) or weighted 0. Without a fallback such a wildcard binds an
empty string, which is what it did before v9 and still does. Flagging an
option never changes a normal draw. A fallback weighted 0 is only ever used
as the fallback.

Shared by the top-level wildcard handler and the nested ``@{uuid}`` resolver
so both surfaces agree. The node's filters + toggles decide whether the
fallback is available at all (``find_fallback`` runs after them).
"""
from __future__ import annotations

from typing import Any


def is_fallback(option: Any) -> bool:
    """True for an option flagged as the wildcard's fallback. The null option
    can't be one (an empty fallback is what having none already means)."""
    return (
        isinstance(option, dict)
        and option.get("fallback") is True
        and not option.get("is_null")
    )


def find_fallback(options: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The first flagged option in ``options`` (validation allows one), as it
    was before weights + constraints. It stays in the draw pool."""
    return next((o for o in options if is_fallback(o)), None)


def pool_is_dead(options: list[dict[str, Any]]) -> bool:
    """True when a weighted draw over ``options`` has nothing to pick."""
    total = 0.0
    for o in options:
        try:
            total += max(0.0, float(o.get("weight", 1)))
        except (TypeError, ValueError):
            continue
    return total <= 0


def fallback_warning(
    target_uuid: str, fallback: dict[str, Any], *, constrained: bool,
) -> dict[str, Any]:
    """The info-level ``fallback_used`` note WP Debug and the Test Runner show
    in place of ``constraint_excludes_all_options``."""
    why = "constraints excluded every option" if constrained else "no option was left to pick"
    return {
        "type": "fallback_used",
        "severity": "info",
        "module_id": target_uuid,
        "source_field": "",
        "position": 0,
        "token_index": None,
        "detail": {
            "target_wildcard_id": target_uuid,
            "option_id": fallback.get("id"),
            "value": fallback.get("value", ""),
            "reason": "constraints" if constrained else "empty_pool",
        },
        "message": f"{why}; used the fallback {fallback.get('value', '')!r}",
    }
