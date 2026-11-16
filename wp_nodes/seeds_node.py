"""WP_Seeds — one node for every seed in a workflow.

Each row is a named seed. A row can follow the node's base seed (made from
the base seed and the row's name; the base seed can come from the Context
Loop), keep its own random or fixed value, give each
Context Loop frame its own seed or the same one, and lock any frame. A pinned
row also has an INT output for samplers, detailers and upscalers; a WP Context
set to "Seed from: <row>" reads the row through the context wire instead.

Placed after a Context Loop (in the context chain) the node runs once per
frame, so its outputs are one seed per frame and line up with the frames the
Loop keeps. ComfyUI V3 has no dynamic outputs: the schema declares the context
plus :data:`engine.seeds.MAX_OUTPUTS` INTs and the frontend
(``src/widgets/seeds.ts``) shows the pinned ones.

Row logic lives in ``engine/seeds.py``.
"""
from __future__ import annotations

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine import seeds
from engine.seed_derive import MAX_SAFE_SEED
from wp_nodes.types import PipelineContext, SeedsWidgetInput, carry_frame0


class WPSeeds(io.ComfyNode):
    """Named seed rows: per frame, lockable, readable by WP Context nodes."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_Seeds",
            display_name="WP Seeds",
            category="wildcard-pipeline",
            description=(
                "Every seed of a workflow in one node. Each row is a named "
                "seed that follows the base seed or keeps its own value, gets a "
                "new seed per loop frame and can be locked per frame. WP "
                "Context nodes pick a row by name; pinned rows have an INT "
                "output for samplers and detailers."
            ),
            inputs=[
                PipelineContext.Input(
                    "upstream",
                    optional=True,
                    tooltip=(
                        "Optional upstream Context. Wire it from a Context Loop "
                        "(or anything after one) so every row gets a seed per "
                        "frame and the Contexts after this node can read them."
                    ),
                ),
                io.Int.Input(
                    "base_seed",
                    default=0,
                    min=0,
                    max=MAX_SAFE_SEED,
                    control_after_generate=True,
                    tooltip=(
                        "The seed rows set to Follow are made from. Change it "
                        "to reroll every Follow row at once; locked rows stay. "
                        "With Base seed from Loop on, the Context Loop's seed "
                        "is used instead."
                    ),
                ),
                SeedsWidgetInput.Input(
                    "wp_seeds", socketless=True, default="", optional=True,
                ),
            ],
            outputs=[
                PipelineContext.Output("context"),
                *(io.Int.Output(f"seed_{i}") for i in range(1, seeds.MAX_OUTPUTS + 1)),
            ],
            hidden=[io.Hidden.unique_id],
            not_idempotent=True,
        )

    @classmethod
    def execute(
        cls,
        upstream: PipelineContext | None = None,
        base_seed: int = 0,
        wp_seeds: str = "",
    ):
        out = cls._execute(upstream, base_seed, wp_seeds)
        carry_frame0(
            upstream, out.args[0], lambda up: cls._execute(up, base_seed, wp_seeds).args[0],
        )
        return out

    @classmethod
    def _execute(
        cls,
        upstream: PipelineContext | None = None,
        base_seed: int = 0,
        wp_seeds: str = "",
    ):
        cfg = seeds.parse_config(wp_seeds)
        upstream_ctx: dict = upstream.context if upstream is not None else {}
        upstream_debug: dict = upstream.debug if upstream is not None else {}
        upstream_internals: dict = upstream.internals if upstream is not None else {}
        index = upstream_internals.get("__wp_loop_index__", 0)
        if not isinstance(index, int) or isinstance(index, bool) or index < 0:
            index = 0
        base = seeds.node_base(cfg, base_seed, upstream_internals)

        table = seeds.resolve(cfg, base, index)
        out_internals = dict(upstream_internals)
        out_internals[seeds.ROWS_KEY] = {
            **(upstream_internals.get(seeds.ROWS_KEY) or {}),
            **table,
        }

        ctx: dict = dict(upstream_ctx)

        hidden = getattr(cls, "hidden", None)
        node_id = getattr(hidden, "unique_id", None) if hidden is not None else None
        traces = [
            {
                "node": "WP_Seeds",
                "binding": row.name,
                "internal": True,
                "type": "seed",
                "value": str(seeds.row_seed(row, base, index)),
                "detail": {
                    "row": row.name,
                    "mode": row.mode,
                    "frame": index,
                    **({"locked": True} if index in row.locks else {}),
                },
                **({"node_id": str(node_id)} if node_id is not None else {}),
            }
            for row in cfg.rows
        ]
        debug = dict(upstream_debug)
        if traces:
            debug["__wp_trace__"] = list(debug.get("__wp_trace__", [])) + traces

        frame_seeds = {row.id: seeds.row_seed(row, base, index) for row in cfg.rows if row.id}
        return io.NodeOutput(
            PipelineContext.Type(context=ctx, debug=debug, internals=out_internals),
            *seeds.output_values(cfg, base, index),
            # One entry per frame run; the canvas keeps them as "last run" so
            # the Seeds window can lock what a frame actually used.
            ui={"seed_frames": [{
                "frame": index,
                "base": base,
                "seeds": frame_seeds,
                # Each row's seed before frames and locks, for "Use last run".
                "bases": {row.id: seeds.row_base(row, base) for row in cfg.rows if row.id},
            }]},
        )
