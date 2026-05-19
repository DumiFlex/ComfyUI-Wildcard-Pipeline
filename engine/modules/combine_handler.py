"""Combine module resolver — syntax-aware template fill.

Reads payload.template (or instance.template_override when set), resolves
all $var / {a|b|c} / {N$$sep$$...} constructs against the runtime ctx,
binds the result to payload.output_var.

Surface-gated: combine resolves $var (it's the consumer) but not @{uuid}
(refs only resolve from wildcard option values — RefOutOfSurfaceError).

Seed lock: instance.locked_seed pins {a|b|c} resolution per instance;
without it, derives from chain seed via the shared
engine.modules._seed.derive_module_rng helper.
"""
from __future__ import annotations

import re
from typing import Any

from engine.modules import build_resolve_ctx
from engine.modules._seed import derive_module_rng
from engine.modules.dispatcher import ModuleHandler
from engine.syntax import resolve_text

_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
_MAX_IDENT_LEN = 64
_MAX_TEMPLATE_LEN = 8000


class CombineHandler(ModuleHandler):
    """Template-fill module: full syntax surface, output bound."""

    type_id = "combine"

    @classmethod
    def validate_payload(cls, payload: dict[str, Any]) -> None:
        if not isinstance(payload, dict):
            raise ValueError("combine payload must be an object")
        template = payload.get("template")
        if not isinstance(template, str):
            raise ValueError("combine payload.template must be a string")
        # Empty template means the module emits an empty string for its
        # output_var — almost always a config mistake (the user removed
        # the template content but forgot the module is still in the
        # chain). Reject so the broken state surfaces at save time.
        if not template:
            raise ValueError("combine payload.template must not be empty")
        if len(template) > _MAX_TEMPLATE_LEN:
            raise ValueError(
                f"combine payload.template must be at most {_MAX_TEMPLATE_LEN} "
                f"chars (got {len(template)})"
            )
        output_var = payload.get("output_var")
        if not isinstance(output_var, str) or not output_var:
            raise ValueError("combine payload.output_var must be a non-empty string")
        if len(output_var) > _MAX_IDENT_LEN:
            raise ValueError(
                f"combine payload.output_var must be at most {_MAX_IDENT_LEN} "
                f"chars (got {len(output_var)})"
            )
        if output_var.startswith("__"):
            raise ValueError(
                "combine payload.output_var must not start with '__' "
                "(reserved for engine-internal keys)"
            )
        if not _IDENT_RE.match(output_var):
            raise ValueError(
                f"combine payload.output_var {output_var!r} is not a valid identifier"
            )
        input_vars = payload.get("input_vars", [])
        if not isinstance(input_vars, list):
            raise ValueError("combine payload.input_vars must be a list")
        for v in input_vars:
            if not isinstance(v, str):
                raise ValueError("combine payload.input_vars entries must be strings")

    @classmethod
    def resolve(
        cls,
        payload: dict[str, Any],
        instance: dict[str, Any],
        ctx: Any,
    ) -> dict[str, str]:
        cls.validate_payload(payload)
        # instance.template_override wins over payload.template — same
        # precedence pattern wildcard's option_weights / fixed_values'
        # values_overrides use.
        override = instance.get("template_override")
        template: str = override if isinstance(override, str) else payload["template"]
        # instance.variable_binding rebinds the produced var (mirrors
        # wildcard precedence). Empty string / non-string falls back to
        # payload.output_var. Strip leading `$` so callers can write
        # either `$foo` or `foo` in the modal.
        binding_override = instance.get("variable_binding")
        if isinstance(binding_override, str) and binding_override.strip():
            output_var: str = binding_override.lstrip("$").strip()
        else:
            output_var = payload["output_var"]

        # Effective seed selection (mirrors WildcardHandler):
        #   - locked_seed when present  → reproducible per-instance
        #   - chain seed otherwise      → re-rolls each queue
        # Both feed derive_module_rng(seed, output_var) so locking with
        # locked_seed = chain_seed reproduces the unlocked roll exactly.
        chain_seed = int(ctx.get("__wp_node_seed__", 0) or 0)
        locked_seed = instance.get("locked_seed")
        if isinstance(locked_seed, (int, float)):
            effective_seed = int(locked_seed)
        else:
            effective_seed = chain_seed
        rng = derive_module_rng(effective_seed, output_var)

        # Patch ctx for the scope of this resolve so build_resolve_ctx
        # picks up our derived RNG instead of the chain RNG.
        ctx_local = {**ctx, "__wp_rng__": rng}
        resolve_ctx = build_resolve_ctx(ctx_local, surface="combine")
        result = resolve_text(template, resolve_ctx)
        return {output_var: result}
