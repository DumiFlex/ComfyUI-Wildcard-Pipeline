"""Derivation module resolver — IF/ELIF/ELSE rules over the runtime context.

Each rule has an ordered list of branches (index 0 == IF, the rest == ELIF)
and an optional ``else`` clause. Rules evaluate independently top-to-bottom:
the first branch whose condition matches wins; if none match, the ``else``
action (if any) fires; otherwise the rule is a no-op.

Actions mutate the runtime context directly. Multiple rules can target the
same variable; later rules see earlier mutations. Action ``value`` strings
are resolved through resolve_text with surface="derivation" so $var tokens
and {a|b|c} picks work inside derivation action values.
"""
from __future__ import annotations

import re
from typing import Any

from engine.modules import build_resolve_ctx
from engine.modules.dispatcher import ModuleHandler
from engine.syntax import resolve_text

_VALID_OPS = {
    "equals", "not_equals", "contains", "matches",
    # Presence-check ops added in 2026-05-09 cycle. `exists`/`not_exists`
    # check key presence in ctx regardless of value (empty string still
    # counts as present); `is_set`/`is_unset` additionally require the
    # value to be non-empty. Both pairs ship so users can pick the
    # semantics they need — wildcards can pick options with empty
    # values, leaving keys present-but-empty.
    "exists", "not_exists", "is_set", "is_unset",
}
_VALID_MODES = {"replace", "append", "prepend"}


def _ctx_get(ctx: Any, name: str) -> str:
    if ctx is None:
        return ""
    getter = getattr(ctx, "get", None)
    if callable(getter):
        try:
            value = getter(name, "")
        except TypeError:
            try:
                value = getter(name)
            except Exception:
                return ""
        return "" if value is None else str(value)
    try:
        if name in ctx:  # type: ignore[operator]
            return str(ctx[name])  # type: ignore[index]
    except Exception:
        return ""
    return ""


def _ctx_has(ctx: Any, name: str) -> bool:
    """Whether `name` is a known key in `ctx`, regardless of value.

    Mirrors `_ctx_get`'s indirection chain (callable getter →
    `__contains__` / dict lookup) but returns bool. Required so the
    `exists` / `not_exists` ops can distinguish "key absent" from
    "key present but value is empty string" — `_ctx_get` collapses
    both into `""`. Used only by presence-check ops; non-presence
    ops continue to read through `_ctx_get`.
    """
    if ctx is None:
        return False
    # Engine ctx is a dict in tests + at runtime; check `__contains__`
    # before falling back to a getter probe so we get the cheap path.
    try:
        return name in ctx  # type: ignore[operator]
    except Exception:
        pass
    getter = getattr(ctx, "get", None)
    if callable(getter):
        # Use a sentinel default so a "missing" key can be told apart
        # from a key whose value is `None` or `""`.
        sentinel = object()
        try:
            value = getter(name, sentinel)
        except TypeError:
            try:
                value = getter(name)
            except Exception:
                return False
        return value is not sentinel
    return False


def _ctx_set(ctx: Any, name: str, value: str) -> None:
    if ctx is None:
        return
    setter = getattr(ctx, "set", None)
    if callable(setter):
        setter(name, value)
        return
    try:
        ctx[name] = value  # type: ignore[index]
    except Exception:
        return


def _match_condition(condition: dict[str, Any], ctx: Any) -> bool:
    var = condition.get("var", "")
    op = condition.get("op", "")
    value = condition.get("value", "")
    # Presence-check ops short-circuit before reading the value — they
    # only care about key presence (and, for is_set/is_unset, whether
    # the stored value is non-empty). The `value` field is ignored by
    # these ops; the SPA disables the value input when one is selected.
    if op == "exists":
        return _ctx_has(ctx, var)
    if op == "not_exists":
        return not _ctx_has(ctx, var)
    if op == "is_set":
        return _ctx_has(ctx, var) and _ctx_get(ctx, var) != ""
    if op == "is_unset":
        return not _ctx_has(ctx, var) or _ctx_get(ctx, var) == ""
    actual = _ctx_get(ctx, var)
    if op == "equals":
        return actual == value
    if op == "not_equals":
        return actual != value
    if op == "contains":
        return value in actual
    if op == "matches":
        try:
            return re.search(value, actual) is not None
        except re.error:
            return False
    return False


def _apply_action(
    action: dict[str, Any],
    ctx: Any,
    resolve_ctx: Any,
) -> tuple[str, str] | None:
    target = action.get("target_var", "")
    if not target:
        return None
    mode = action.get("mode", "replace")
    raw_value = str(action.get("value", ""))
    new_value = resolve_text(raw_value, resolve_ctx)
    if mode == "replace":
        result = new_value
    elif mode == "append":
        result = _ctx_get(ctx, target) + new_value
    elif mode == "prepend":
        result = new_value + _ctx_get(ctx, target)
    else:
        return None
    _ctx_set(ctx, target, result)
    return target, result


def _validate_condition(condition: Any, where: str) -> None:
    if not isinstance(condition, dict):
        raise ValueError(f"derivation {where}.condition must be an object")
    var = condition.get("var")
    if not isinstance(var, str) or not var:
        raise ValueError(f"derivation {where}.condition.var must be a non-empty string")
    op = condition.get("op")
    if op not in _VALID_OPS:
        raise ValueError(
            f"derivation {where}.condition.op must be one of {sorted(_VALID_OPS)}"
        )
    if not isinstance(condition.get("value", ""), str):
        raise ValueError(f"derivation {where}.condition.value must be a string")


def _validate_action(action: Any, where: str) -> None:
    if not isinstance(action, dict):
        raise ValueError(f"derivation {where}.action must be an object")
    target = action.get("target_var")
    if not isinstance(target, str) or not target:
        raise ValueError(
            f"derivation {where}.action.target_var must be a non-empty string"
        )
    mode = action.get("mode", "replace")
    if mode not in _VALID_MODES:
        raise ValueError(
            f"derivation {where}.action.mode must be one of {sorted(_VALID_MODES)}"
        )
    if not isinstance(action.get("value", ""), str):
        raise ValueError(f"derivation {where}.action.value must be a string")


class DerivationHandler(ModuleHandler):
    """IF / ELIF / ELSE rule evaluator that mutates ctx."""

    type_id = "derivation"

    @classmethod
    def validate_payload(cls, payload: dict[str, Any]) -> None:
        if not isinstance(payload, dict):
            raise ValueError("derivation payload must be an object")
        rules = payload.get("rules")
        if not isinstance(rules, list):
            raise ValueError("derivation payload.rules must be a list")
        for ri, rule in enumerate(rules):
            if not isinstance(rule, dict):
                raise ValueError(f"derivation payload.rules[{ri}] must be an object")
            rule_id = rule.get("id")
            if not isinstance(rule_id, str) or not rule_id:
                raise ValueError(
                    f"derivation payload.rules[{ri}].id must be a non-empty string"
                )
            branches = rule.get("branches")
            if not isinstance(branches, list) or not branches:
                raise ValueError(
                    f"derivation payload.rules[{ri}].branches must be a non-empty list"
                )
            for bi, branch in enumerate(branches):
                if not isinstance(branch, dict):
                    raise ValueError(
                        f"derivation payload.rules[{ri}].branches[{bi}] must be an object"
                    )
                _validate_condition(
                    branch.get("condition"), f"rules[{ri}].branches[{bi}]"
                )
                _validate_action(branch.get("action"), f"rules[{ri}].branches[{bi}]")
            else_clause = rule.get("else")
            if else_clause is not None:
                if not isinstance(else_clause, dict):
                    raise ValueError(
                        f"derivation payload.rules[{ri}].else must be an object"
                    )
                _validate_action(else_clause.get("action"), f"rules[{ri}].else")

    @classmethod
    def resolve(
        cls,
        payload: dict[str, Any],
        instance: dict[str, Any],
        ctx: Any,
    ) -> dict[str, str]:
        cls.validate_payload(payload)
        resolve_ctx = build_resolve_ctx(ctx, surface="derivation")
        out: dict[str, str] = {}

        # Tier 2 instance filter — skip rules whose id is disabled.
        disabled_rule_ids = set(instance.get("disabled_rule_ids") or [])

        for rule in payload.get("rules", []):
            if rule.get("id") in disabled_rule_ids:
                continue
            applied = False
            for branch in rule.get("branches", []):
                if _match_condition(branch.get("condition", {}), ctx):
                    pair = _apply_action(branch.get("action", {}), ctx, resolve_ctx)
                    if pair is not None:
                        out[pair[0]] = pair[1]
                    applied = True
                    break
            if not applied:
                else_clause = rule.get("else")
                if isinstance(else_clause, dict):
                    pair = _apply_action(
                        else_clause.get("action", {}), ctx, resolve_ctx
                    )
                    if pair is not None:
                        out[pair[0]] = pair[1]
        return out
