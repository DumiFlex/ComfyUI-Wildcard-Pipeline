"""WP_Slider3D — three numbers picked together.

The widget holds the same JSON as WP_Slider: three slider rows, X, Y then Z,
and optionally a fourth row in text mode, the *phrase* (for the Orbit
style's camera or light words: ``$view_side view, $view_height, $view_shot``),
which reads the axes' variables like any slider text. ``pad`` looks are for
the frontend only (Pad + Z, or Orbit). The run is ``WPSlider._context``; the
node has three number outputs, ``x``, ``y`` and ``z``, typed INT or FLOAT by
the frontend from each axis.
"""
from __future__ import annotations

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine import sliders
from wp_nodes.slider_node import WPSlider
from wp_nodes.types import PipelineContext, Slider3DWidgetInput, carry_frame0

#: The axes the node reads (X, Y, Z).
AXES = 3


def axes_and_phrase(cfg: sliders.Config) -> sliders.Config:
    """The three axes, plus the first later row in text mode (the phrase)."""
    axes = cfg.sliders[:AXES]
    phrase = next((s for s in cfg.sliders[AXES:] if s.mode == "text"), None)
    return sliders.Config(sliders=[*axes, *([phrase] if phrase else [])])


class WPSlider3D(WPSlider):
    """Three numbers: a pad + Z fader, or a camera / light orbit."""

    NODE = "WP_Slider3D"
    LABEL = "WP Slider 3D"

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_Slider3D",
            display_name="WP Slider 3D",
            category="wildcard-pipeline",
            description=(
                "Three numbers set together: an XY pad with a Z fader, or an "
                "orbit around the subject for a camera or a light (angle, "
                "height, distance) that can write words like \"front-left "
                "view, high angle, medium shot\". Each axis writes $its_variable "
                "like a WP Slider and has its own output."
            ),
            inputs=[
                PipelineContext.Input(
                    "upstream",
                    optional=True,
                    tooltip=(
                        "Optional upstream Context to extend. Only nodes after "
                        "this one see the variables."
                    ),
                ),
                Slider3DWidgetInput.Input(
                    "wp_sliders", socketless=True, default="", optional=True,
                ),
            ],
            outputs=[
                PipelineContext.Output("context"),
                io.AnyType.Output("x"),
                io.AnyType.Output("y"),
                io.AnyType.Output("z"),
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
        cfg = axes_and_phrase(sliders.parse_config(wp_sliders))
        outs = [sliders.output_number(s) for s in cfg.sliders[:AXES]] + [0] * AXES
        return io.NodeOutput(cls._context(upstream, cfg), outs[0], outs[1], outs[2])
