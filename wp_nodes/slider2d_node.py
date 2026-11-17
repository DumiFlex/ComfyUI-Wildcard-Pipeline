"""WP_Slider2D — two numbers picked at once on one XY pad.

The widget holds the same JSON as WP_Slider with exactly two slider rows,
X then Y (plus ``pad`` looks the frontend draws), so each axis writes its
variable (number, text or words), its ``$name.num`` and its negative the way
a slider does; the run is ``WPSlider._context``. The node always has two
number outputs, ``x`` and ``y``, typed INT or FLOAT by the frontend from
each axis (``out_type``, else its decimals).
"""
from __future__ import annotations

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine import sliders
from wp_nodes.slider_node import WPSlider
from wp_nodes.types import PipelineContext, SliderPadWidgetInput, carry_frame0


class WPSlider2D(WPSlider):
    """An XY pad: two variables and an X and a Y output."""

    NODE = "WP_Slider2D"
    LABEL = "WP Slider 2D"

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_Slider2D",
            display_name="WP Slider 2D",
            category="wildcard-pipeline",
            description=(
                "One XY pad: drag a point to set two numbers at once (a width "
                "and a height, a mood from calm to wild). Each axis writes "
                "$its_variable like a WP Slider and has its own output."
            ),
            inputs=[
                PipelineContext.Input(
                    "upstream",
                    optional=True,
                    tooltip=(
                        "Optional upstream Context to extend. Only nodes after "
                        "this one see the pad's variables."
                    ),
                ),
                SliderPadWidgetInput.Input(
                    "wp_sliders", socketless=True, default="", optional=True,
                ),
            ],
            outputs=[
                PipelineContext.Output("context"),
                io.AnyType.Output("x"),
                io.AnyType.Output("y"),
            ],
            hidden=[io.Hidden.unique_id],
            not_idempotent=True,
        )

    @classmethod
    def execute(
        cls,
        upstream: PipelineContext | None = None,
        wp_sliders: str = "",
    ):
        out = cls._execute(upstream, wp_sliders)
        carry_frame0(upstream, out.args[0], lambda up: cls._execute(up, wp_sliders).args[0])
        return out

    @classmethod
    def _execute(
        cls,
        upstream: PipelineContext | None = None,
        wp_sliders: str = "",
    ):
        cfg = sliders.parse_config(wp_sliders)
        axes = cfg.sliders[:2]
        cfg = sliders.Config(sliders=axes)
        outs = [sliders.output_number(s) for s in axes] + [0, 0]
        return io.NodeOutput(cls._context(upstream, cfg), outs[0], outs[1])
