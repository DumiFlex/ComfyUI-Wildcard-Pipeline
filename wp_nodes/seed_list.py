"""WP_SeedList — emits a list of derived seeds for a downstream loop.

Two roles in one node:
1. **Standalone** — feed N seeds into any node that fans out on
   ``is_input_list=True`` (KSampler etc.). The widget values
   (``base_seed``, ``count``, and the DOM widget's ``strategy``) fully
   describe the series.
2. **Loop-linked** — wire ``loop_config`` from WP_ContextLoop's side
   output, then flip one or more override toggles in the DOM widget:
   - ``override_seed``     → take ``base_seed`` from the loop's config.
   - ``override_count``    → take ``count`` from the loop's config.
   - ``override_strategy`` → take ``strategy`` from the loop's config.
   The three toggles are independent so the user can mix sources: e.g.
   "use the loop's count + own strategy + own base seed". The widget
   values stay as the unwired fallback so the workflow still runs if
   the link is later removed.

   Connecting the wire auto-flips ``override_count`` + ``override_strategy``
   on (UX nudge — when you wire a Loop in, the natural default is
   "the loop is now in charge of the series shape"). ``override_seed``
   stays an explicit opt-in because mixing seed sources is common.

The strategy + override toggles live inside ONE socketless DOM widget
(``wp_seed_list_config``) instead of three separate stock widgets so
the canvas isn't littered with chrome — same pattern WP_ContextLoop
uses for its strategy / override / iteration-var block.

All emitted seeds are masked to 50 bits via ``derive_loop_seeds`` so
they sit inside ComfyUI's frontend randomize range — see
``engine/seed_derive.py::MAX_SAFE_SEED``.
"""

import json
from typing import Any

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine.seed_derive import MAX_SAFE_SEED, apply_seed_locks, derive_loop_seeds
from wp_nodes.types import ContextLoopConfigInput, SeedListConfigInput

_STRATEGIES = ("hash_index", "sequential", "prime_stride")


def _parse_config(raw: Any) -> dict[str, Any]:
    """Decode the ``wp_seed_list_config`` widget value.

    Recovery-friendly: unknown strategy → ``"hash_index"``; non-bool
    values → ``False``; missing keys → defaults. Mirrors
    ``WPContextLoop._parse_config`` so a corrupt widget value still
    loads instead of crashing the run.

    Legacy migration: workflows saved before the split carry a single
    ``override_config`` boolean. When neither of the new keys is set,
    mirror that legacy flag to both ``override_count`` +
    ``override_strategy`` so pre-split workflows produce identical
    output post-split.
    """
    defaults: dict[str, Any] = {
        "strategy": "hash_index",
        "override_seed": False,
        "override_count": False,
        "override_strategy": False,
        "seed_locks": {},
    }
    if raw is None:
        return defaults
    if isinstance(raw, dict):
        parsed: Any = raw
    elif isinstance(raw, str):
        if not raw:
            return defaults
        try:
            parsed = json.loads(raw)
        except (TypeError, ValueError):
            return defaults
    else:
        return defaults
    if not isinstance(parsed, dict):
        return defaults
    out = dict(defaults)
    strategy = parsed.get("strategy")
    if strategy in _STRATEGIES:
        out["strategy"] = strategy
    out["override_seed"] = bool(parsed.get("override_seed", False))

    has_new_count = "override_count" in parsed
    has_new_strategy = "override_strategy" in parsed
    if has_new_count:
        out["override_count"] = bool(parsed.get("override_count", False))
    if has_new_strategy:
        out["override_strategy"] = bool(parsed.get("override_strategy", False))

    # Legacy `override_config` fills whichever new field the user
    # hasn't explicitly set yet. Same precedence as the TS parser.
    if "override_config" in parsed:
        legacy = bool(parsed.get("override_config", False))
        if not has_new_count:
            out["override_count"] = legacy
        if not has_new_strategy:
            out["override_strategy"] = legacy

    locks_raw = parsed.get("seed_locks", {})
    locks: dict[int, int] = {}
    if isinstance(locks_raw, dict):
        for k, v in locks_raw.items():
            try:
                locks[int(k)] = int(v)
            except (TypeError, ValueError):
                continue
    out["seed_locks"] = locks
    return out


def _resolve_config(
    *,
    base_seed: int,
    count: int,
    strategy: str,
    override_seed: bool,
    override_count: bool,
    override_strategy: bool,
    loop_config: Any,
) -> tuple[int, int, str]:
    """Pick which side wins per field: widgets vs. wired loop_config.

    The three override toggles are independent — the user can opt INTO
    mirroring the loop's base seed, its count, its strategy, any
    combination, or none. With a toggle OFF, the widget value wins for
    THAT field even if ``loop_config`` is wired (explicit opt-in keeps
    a stale wire from silently rewriting widgets).

    Defensive: a malformed loop_config (non-dict, missing keys, wrong
    types) silently falls back to widget values for every field.
    Mirrors WP_ContextLoop's ``_parse_config`` recovery so a bad
    upstream payload never crashes the run.
    """
    cfg = loop_config if isinstance(loop_config, dict) else None

    if override_seed and cfg is not None:
        cfg_base = cfg.get("base_seed")
        resolved_base = (
            int(cfg_base) if isinstance(cfg_base, int) and cfg_base >= 0 else int(base_seed)
        )
    else:
        resolved_base = int(base_seed)

    if override_count and cfg is not None:
        cfg_count = cfg.get("count")
        resolved_count = (
            int(cfg_count) if isinstance(cfg_count, int) and cfg_count > 0 else int(count)
        )
    else:
        resolved_count = int(count)

    if override_strategy and cfg is not None:
        cfg_strategy = cfg.get("strategy")
        resolved_strategy = (
            cfg_strategy if cfg_strategy in _STRATEGIES else strategy
        )
    else:
        resolved_strategy = strategy

    return resolved_base, resolved_count, resolved_strategy


class WPSeedList(io.ComfyNode):
    """Emit N derived seeds. Mirrors WP_ContextLoop's series when wired."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_SeedList",
            display_name="WP Seed List",
            category="wildcard-pipeline",
            inputs=[
                io.Int.Input(
                    "base_seed",
                    default=0,
                    min=0,
                    max=MAX_SAFE_SEED,
                    control_after_generate=True,
                    tooltip=(
                        "Starting point for randomisation. Change for a "
                        "different roll; keep the same to reproduce. "
                        "Right-click → Convert widget to input to drive "
                        "from another seed node."
                    ),
                ),
                io.Int.Input(
                    "count",
                    default=4,
                    min=1,
                    max=999,
                    tooltip=(
                        "How many seeds to derive in the series (1–999). "
                        "Set to 1 to emit a single seed without looping."
                    ),
                ),
                # One socketless DOM widget holding the strategy chips +
                # the two independent override toggles. Replaces what
                # used to be three separate stock widgets — keeps the
                # canvas surface compact and matches WP_ContextLoop's
                # config block layout.
                SeedListConfigInput.Input(
                    "wp_seed_list_config",
                    socketless=True,
                    default="{}",
                ),
                ContextLoopConfigInput.Input(
                    "loop_config",
                    optional=True,
                    tooltip=(
                        "Optional WP Context Loop side-output. When wired "
                        "and at least one override toggle is on, the "
                        "matching field (base seed and/or count+strategy) "
                        "mirrors the loop's resolved config."
                    ),
                ),
            ],
            outputs=[io.Int.Output("seed", is_output_list=True)],
            # Honour the widget's seed-randomize control: each queue run
            # must re-roll when the user has control_after_generate set
            # to "randomize". Same flag the loop / context nodes use.
            not_idempotent=True,
        )

    @classmethod
    def execute(
        cls,
        base_seed,
        count,
        wp_seed_list_config="{}",
        loop_config=None,
    ):
        cfg = _parse_config(wp_seed_list_config)
        strategy = cfg["strategy"]
        override_seed = bool(cfg["override_seed"])
        override_count = bool(cfg["override_count"])
        override_strategy = bool(cfg["override_strategy"])

        resolved_base, resolved_count, resolved_strategy = _resolve_config(
            base_seed=base_seed,
            count=count,
            strategy=strategy,
            override_seed=override_seed,
            override_count=override_count,
            override_strategy=override_strategy,
            loop_config=loop_config,
        )
        seeds = apply_seed_locks(
            derive_loop_seeds(resolved_base, resolved_count, resolved_strategy),
            cfg["seed_locks"],
        )
        # Surface the per-iteration series to the node UI so the frontend can
        # offer "lock previous" in the seed modal (captured in seed_list.ts).
        return io.NodeOutput(seeds, ui={"loop_seeds": [[int(s) for s in seeds]]})
