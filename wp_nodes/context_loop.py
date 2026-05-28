"""WP_ContextLoop — optional loop-head node for WP_Context chains.

Emits N PIPELINE_CONTEXT outputs (`is_list=True`) so ComfyUI auto-iterates
the entire downstream chain N times in a single run. Each emitted payload
carries `__wp_loop_index__` + (optionally) `__wp_seed_override__` in its
`internals` dict; WP_Context downstream picks these up via
`engine.seed_derive.effective_chain_seed` and varies per-iteration without
disturbing locked-seed modules (whose precedence runs at the per-module
handler level, untouched by this node).
"""

import json

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine.seed_derive import derive_loop_seeds
from wp_nodes.types import (
    ContextLoopConfigInput,
    ContextLoopWidgetInput,
    ContextPayload,
    PipelineContext,
)

_STRATEGIES = {"sequential", "hash_index", "prime_stride"}


def _parse_config(raw: str) -> dict[str, object]:
    """Recovery-friendly JSON parse for the DOM widget value.

    Unknown keys ignored; missing keys backfilled from defaults; type
    mismatches collapse to defaults. Mirrors the TS-side recovery path
    so a workflow with a malformed widget value still loads instead of
    crashing the run.
    """
    defaults: dict[str, object] = {
        "strategy": "hash_index",
        "override_seed": False,
        "iteration_var_name": "iteration",
        "bypass": False,
        "iteration_internal": True,
        "total_internal": True,
    }
    if not raw or not isinstance(raw, str):
        return defaults
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return defaults
    if not isinstance(parsed, dict):
        return defaults
    out = dict(defaults)
    if parsed.get("strategy") in _STRATEGIES:
        out["strategy"] = parsed["strategy"]
    out["override_seed"] = bool(parsed.get("override_seed", False))
    name = parsed.get("iteration_var_name", "iteration")
    if isinstance(name, str) and name.strip():
        out["iteration_var_name"] = name.strip()
    out["bypass"] = bool(parsed.get("bypass", False))
    out["iteration_internal"] = bool(parsed.get("iteration_internal", True))
    out["total_internal"] = bool(parsed.get("total_internal", True))
    return out


class WPContextLoop(io.ComfyNode):
    """Optional loop head — emits N PIPELINE_CONTEXT outputs in one run."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_ContextLoop",
            display_name="WP Context Loop",
            category="wildcard-pipeline",
            inputs=[
                io.Int.Input(
                    "seed",
                    default=0,
                    min=0,
                    max=0xFFFFFFFFFFFFFFFF,
                    control_after_generate=True,
                    tooltip=(
                        "Starting point for randomisation. Change for a different "
                        "roll; keep the same to reproduce. Right-click → Convert "
                        "widget to input to drive from another seed node."
                    ),
                ),
                io.Int.Input(
                    "count",
                    default=1,
                    min=1,
                    max=999,
                    tooltip=(
                        "How many iterations the series runs (1–999). Set to 1 "
                        "to disable looping without removing the node."
                    ),
                ),
                # Widget-only TYPE (`WP_CONTEXT_LOOP_WIDGET`), distinct
                # from the wire-payload type (`WP_CONTEXT_LOOP_CONFIG`)
                # used on the output below + on WP_SeedList's
                # `loop_config` socket. Separating the two types lets the
                # `getCustomWidgets` factory register against the widget
                # type only — the wire type has NO factory, so ComfyUI
                # renders consumers (SeedList) as plain sockets and
                # Loop's own input stays a DOM widget. The previous
                # single-type design forced an `inputName` gate in
                # main.ts that ended up hiding SeedList's socket
                # entirely.
                ContextLoopWidgetInput.Input(
                    "wp_context_loop_config",
                    socketless=True,
                    default="{}",
                ),
            ],
            outputs=[
                # `is_output_list=True` is the V3 contract for emitting a
                # list that ComfyUI auto-iterates downstream. Not `is_list`
                # (that was wrong — stub accepted any kwarg, real API
                # rejects). See `comfy_api/latest/_io.py:Output.__init__`.
                PipelineContext.Output("context", is_output_list=True),
                # Single-value side output: the resolved config payload
                # so sibling helpers (WP_SeedList etc.) can mirror the
                # loop's count / strategy / base_seed without the user
                # double-wiring widgets. Plain (non-list) — receiving
                # nodes get one dict per graph run regardless of the
                # context-fan-out happening on the first output.
                ContextLoopConfigInput.Output("loop_config"),
            ],
            not_idempotent=False,
        )

    @classmethod
    def execute(cls, seed, count, wp_context_loop_config):
        cfg = _parse_config(wp_context_loop_config)
        override_seed = bool(cfg["override_seed"])
        strategy = cfg["strategy"]
        iteration_var_name = cfg["iteration_var_name"]
        bypass = bool(cfg["bypass"])
        iteration_internal = bool(cfg["iteration_internal"])
        total_internal = bool(cfg["total_internal"])

        # Resolve effective count. `bypass` collapses to single-run while
        # preserving the list-shape output contract — downstream still
        # sees an `is_list=True` socket with one element.
        effective_count = 1 if bypass else max(1, int(count))
        has_override = override_seed
        derived = (
            derive_loop_seeds(int(seed), effective_count, strategy)
            if has_override else None
        )
        # Build the loop_config payload once so the same dict drives both
        # the per-iteration internals AND the side output. `count` here
        # is the EFFECTIVE count (post-bypass) so downstream sees what
        # the loop is actually running, not the raw widget value.
        # `base_seed` carries the user's `seed` input verbatim so
        # WP_SeedList can re-derive the same series locally.
        loop_config_payload: dict[str, object] = {
            "count": effective_count,
            "strategy": strategy,
            "base_seed": int(seed),
            "override_seed": has_override,
        }

        # Build the internal-flags map once — same across iterations
        # (per-iteration values differ but their internal-ness doesn't).
        # Engine reads `__wp_internal_flags__` from the payload internals
        # at downstream merge time; PromptAssembler then strips internal
        # keys at render so they never leak into prompts.
        total_var_name = f"{iteration_var_name}_total"
        internal_flags: dict[str, bool] = {}
        if iteration_internal:
            internal_flags[iteration_var_name] = True
        if total_internal:
            internal_flags[total_var_name] = True

        payloads = []
        for idx in range(effective_count):
            # User-facing iteration counter is 1-based — reads naturally
            # in PromptAssembler templates (`iteration 1 of 4`) and in
            # the debug viewer. The internal `__wp_loop_index__` below
            # stays 0-based because `derive_loop_seeds[idx]` indexes the
            # derived series + `effective_chain_seed` math assumes
            # zero-origin (loop_index=0 means "no XOR shift").
            context_vars = {
                iteration_var_name: str(idx + 1),
                total_var_name: str(effective_count),
            }
            internals: dict[str, object] = {
                "__wp_loop_index__": idx,
                "__wp_seed_override__": (derived[idx] if has_override else None),
            }
            # Only stamp the derived series when override is active —
            # otherwise the values would be meaningless (downstream uses
            # widget seeds). WP_Debug renders this only when present.
            if has_override:
                internals["__wp_loop_seeds__"] = list(derived)
            if internal_flags:
                # Merge by-value so successive iterations don't share
                # the same dict reference; downstream WP_Context copies
                # internals defensively but explicit copy here is safer.
                internals["__wp_internal_flags__"] = dict(internal_flags)
            payloads.append(ContextPayload(
                context=context_vars,
                debug={},
                internals=internals,
            ))
        return io.NodeOutput(payloads, loop_config_payload)
