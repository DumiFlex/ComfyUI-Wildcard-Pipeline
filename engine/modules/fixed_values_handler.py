"""Fixed-values module resolver.

Two-tier model mirroring wildcard:
  - `payload.values` = library-truth (immutable while picked).
  - `instance.values_overrides` = optional full-replacement list of
    `{id, name, value}` written by the modal when the user edits a
    library-tracked fixed_values.

Per-value syntax resolution (Phase: combine v2 + syntax parity cycle):
each emitted value passes through resolve_text with surface="fixed_values"
so {a|b|c} alternations + {N$$sep$$...} repeats + escapes resolve.
$var reads + @{uuid} refs are gated off — the surface is a binding
PRODUCER, not a consumer. Lenient mode renders unsupported tokens as
literal text + emits warnings (see engine/syntax/resolve.py).

Seed lock: instance.locked_seed pins {a|b|c} resolution per instance
via the shared engine.modules._seed.derive_module_rng helper, keyed by
the module id when present (ctx["__wp_module_id__"]).
"""
from __future__ import annotations

import re
from typing import Any

from engine import negatives
from engine.modules import build_resolve_ctx
from engine.modules._seed import derive_module_rng
from engine.modules.dispatcher import ModuleHandler
from engine.syntax import resolve_text

_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
_MAX_IDENT_LEN = 64


class FixedValuesHandler(ModuleHandler):
    type_id = "fixed_values"

    @classmethod
    def validate_payload(cls, payload: dict[str, Any]) -> None:
        if not isinstance(payload, dict):
            raise ValueError("fixed_values payload must be an object")
        values = payload.get("values")
        if not isinstance(values, list):
            raise ValueError("fixed_values payload.values must be a list")
        seen_names: set[str] = set()
        for i, v in enumerate(values):
            if not isinstance(v, dict):
                raise ValueError(
                    f"fixed_values payload.values[{i}] must be an object"
                )
            name = v.get("name")
            if name is not None and not isinstance(name, str):
                raise ValueError(
                    f"fixed_values payload.values[{i}].name must be a string"
                )
            # Empty name is allowed (resolver skips those entries) but a
            # non-empty name must be a valid identifier — it gets emitted
            # as a $var into the runtime ctx.
            if isinstance(name, str) and name:
                if len(name) > _MAX_IDENT_LEN:
                    raise ValueError(
                        f"fixed_values payload.values[{i}].name must be at most "
                        f"{_MAX_IDENT_LEN} chars (got {len(name)})"
                    )
                if name.startswith("__"):
                    raise ValueError(
                        f"fixed_values payload.values[{i}].name must not start "
                        f"with '__' (reserved for engine-internal keys)"
                    )
                if not _IDENT_RE.match(name):
                    raise ValueError(
                        f"fixed_values payload.values[{i}].name {name!r} is not a valid identifier"
                    )
                # Names must be unique across rows — two rows with the
                # same name silently last-write-wins at runtime, hiding
                # the earlier row's value.
                if name in seen_names:
                    raise ValueError(
                        f"fixed_values payload.values[{i}].name {name!r} "
                        f"duplicates an earlier row"
                    )
                seen_names.add(name)
            value = v.get("value", "")
            if not isinstance(value, str):
                raise ValueError(
                    f"fixed_values payload.values[{i}].value must be a string"
                )
            neg = v.get("negative")
            if neg is not None and not isinstance(neg, str):
                raise ValueError(
                    f"fixed_values payload.values[{i}].negative must be a string"
                )

    @classmethod
    def resolve(
        cls,
        payload: dict[str, Any],
        instance: dict[str, Any],
        ctx: Any,
    ) -> dict[str, str]:
        # Values source-of-truth: instance.values_overrides wins when
        # set + non-empty, else payload.values. Existing two-tier model
        # preserved.
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
            keys = _row_keys(values)
            values = [v for v, k in zip(values, keys, strict=True) if k in allowed]

        # Syntax-aware emission path. When ctx is missing required keys
        # for build_resolve_ctx (legacy callers passing None / minimal
        # dicts), fall back to raw emission so existing tests + workflows
        # keep working.
        if not _ctx_supports_resolve(ctx):
            out: dict[str, str] = {}
            for v in values:
                name = (v.get("name") or "").strip()
                if not name:
                    continue
                out[name] = str(v.get("value", ""))
            return out

        # Effective seed selection (mirrors WildcardHandler + CombineHandler):
        if instance.get("seed_scope") == "hold":
            # Held: reuse each name's frame-0 resolved value verbatim (from the
            # pipeline's base pass) so a held fixed-values alternation stays
            # frozen across the whole run.
            _hb = ctx.get("__wp_hold_base_ctx__")
            if isinstance(_hb, dict):
                _names = [n for n in ((v.get("name") or "").strip() for v in values) if n]
                if _names and all(n in _hb for n in _names):
                    negatives.copy_from(ctx, _hb, _names)
                    return {n: _hb[n] for n in _names}
            chain_seed = int(
                ctx.get("__wp_node_seed_hold__", ctx.get("__wp_node_seed__", 0)) or 0
            )
        else:
            chain_seed = int(ctx.get("__wp_node_seed__", 0) or 0)
        locked_seed = instance.get("locked_seed")
        if isinstance(locked_seed, (int, float)):
            effective_seed = int(locked_seed)
        else:
            effective_seed = chain_seed
        # Use module id as the per-module RNG key when ctx carries one;
        # fall back to "fixed_values" literal so two co-resident
        # fixed_values modules in the same chain still derive distinct
        # RNG streams from the same seed (independence property).
        module_key = str(ctx.get("__wp_module_id__") or "fixed_values")
        rng = derive_module_rng(effective_seed, module_key)

        ctx_local = {**ctx, "__wp_rng__": rng}
        resolve_ctx = build_resolve_ctx(ctx_local, surface="fixed_values")

        # Negatives are library content, like the value itself: an instance
        # override list can re-word values but never re-words a negative, so
        # look each one up on the library row (by id, then by name).
        lib_rows = [v for v in payload.get("values", []) if isinstance(v, dict)]
        lib_by_id = {v.get("id"): v for v in lib_rows if v.get("id")}
        lib_by_name = {(v.get("name") or "").strip(): v for v in lib_rows}
        n_rng = negatives.neg_rng(effective_seed, module_key)

        out_resolved: dict[str, str] = {}
        for v in values:
            name = (v.get("name") or "").strip()
            if not name:
                continue
            raw = str(v.get("value", ""))
            out_resolved[name] = resolve_text(raw, resolve_ctx)
            lib = lib_by_id.get(v.get("id")) or lib_by_name.get(name) or {}
            own = negatives.clean_negative(lib.get("negative"))
            negatives.set_entries(ctx, name, negatives.own_entries(
                [own] if own else [], resolve_ctx, n_rng, pick=None, source=name,
            ))
        return out_resolved


def _row_keys(values: list[Any]) -> list[str]:
    """The key each row is toggled by: its ``id``, or ``#<index>`` when the id
    is missing, blank or repeats an earlier row's. Imported packs can carry
    rows without ids. Mirrors ``withRowKeys`` in
    src/components/context/editors/fixed-values/defaults.ts."""
    seen: set[str] = set()
    keys: list[str] = []
    for i, v in enumerate(values):
        rid = v.get("id") if isinstance(v, dict) else None
        key = rid if isinstance(rid, str) and rid.strip() and rid not in seen else f"#{i}"
        seen.add(key)
        keys.append(key)
    return keys


def _ctx_supports_resolve(ctx: Any) -> bool:
    """build_resolve_ctx requires __wp_rng__ + __wp_warnings__ in ctx.
    Legacy test/usage passes None or minimal dicts — detect those and
    skip the syntax-resolution path so behavior matches pre-rewrite.
    """
    if ctx is None:
        return False
    if not hasattr(ctx, "__getitem__"):
        return False
    try:
        return "__wp_rng__" in ctx and "__wp_warnings__" in ctx
    except (TypeError, KeyError):
        return False
