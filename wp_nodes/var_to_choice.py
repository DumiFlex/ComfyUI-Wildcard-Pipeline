"""WP_VarToChoice — reads a named $var from PipelineContext and sends it into a
dropdown input (checkpoint, sampler, scheduler, VAE, …).

ComfyUI never checks a LINKED dropdown value against its options, so a bad
name only fails inside the loader. This node reads the option list of
whatever its output is wired into (through the hidden ``prompt``), matches the
text against it (``engine/choice.py``) and falls back, or stops the run, on a
miss. The output is ``*`` because V1 nodes declare dropdowns as a Python
list, which a ``COMBO`` output does not pass type validation against.
"""

from __future__ import annotations

import logging
from typing import Any

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine import choice
from engine.converters import lookup_var
from wp_nodes.types import PipelineContext, VarPickerInput

_log = logging.getLogger(__name__)


def _input_types_for(class_type: str) -> Any:
    """``INPUT_TYPES()`` of a registered node class, or ``None``."""
    try:
        import nodes  # pyright: ignore[reportMissingImports]  # ComfyUI's nodes.py

        cls = nodes.NODE_CLASS_MAPPINGS.get(class_type)
        return cls.INPUT_TYPES() if cls is not None else None
    except Exception:  # noqa: BLE001 - a broken consumer must not break the run
        return None


class WPVarToChoice(io.ComfyNode):
    """PipelineContext $var → a dropdown value."""

    #: Swapped in tests; reads a node class's ``INPUT_TYPES()``.
    input_types_for = staticmethod(_input_types_for)

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_VarToChoice",
            display_name="WP Var → Choice",
            category="wildcard-pipeline",
            description=(
                "Send a $variable into a dropdown input (checkpoint, sampler, "
                "scheduler, VAE…). Matches it against that input's options."
            ),
            inputs=[
                PipelineContext.Input(
                    "context",
                    tooltip=(
                        "The resolved $variable context from any upstream "
                        "WP Context / Loop / Injector chain."
                    ),
                ),
                VarPickerInput.Input("wp_var_name", socketless=True),
                io.Combo.Input(
                    "match",
                    options=list(choice.MATCH_MODES),
                    default="loose",
                    tooltip=(
                        "exact: the text must equal an option. loose: ignores "
                        "case, folders, the file extension and spaces, then "
                        "takes the shortest option that starts with or "
                        "contains the text. closest: also forgives typos."
                    ),
                ),
                io.Combo.Input(
                    "fallback",
                    # The widget fills this list with the options of the
                    # input `choice` is wired into (src/widgets/var_picker.ts);
                    # validate_inputs lets any of them through.
                    options=[choice.FIRST_OPTION],
                    default=choice.FIRST_OPTION,
                    tooltip=(
                        "Used when nothing matches or the variable is empty. "
                        "Lists the options of the input choice is wired into."
                    ),
                ),
                io.Combo.Input(
                    "if_no_match",
                    options=list(choice.NO_MATCH_MODES),
                    default="use fallback",
                    tooltip=(
                        "use fallback: carry on with the fallback and warn. "
                        "stop the run: fail here with the options listed."
                    ),
                ),
            ],
            outputs=[
                io.AnyType.Output(
                    "choice",
                    tooltip=(
                        "Wire into a dropdown input: ckpt_name, sampler_name, "
                        "scheduler, vae_name, lora_name and so on."
                    ),
                ),
            ],
            hidden=[io.Hidden.unique_id, io.Hidden.prompt],
            # Pure function of inputs — let ComfyUI cache outputs across runs
            # so the loader downstream doesn't reload on every run.
            not_idempotent=False,
        )

    @classmethod
    def validate_inputs(cls, fallback: str = ""):
        # The fallback list is filled on the canvas from whatever the output
        # feeds, so ComfyUI's own "value not in list" check can't know it.
        # resolve_choice checks it against the real options at run time.
        del fallback
        return True

    @classmethod
    def execute(
        cls,
        context,
        wp_var_name: str = "",
        match: str = "loose",
        fallback: str = choice.FIRST_OPTION,
        if_no_match: str = "use fallback",
    ):
        text = lookup_var(context, wp_var_name)

        hidden = getattr(cls, "hidden", None)
        node_id = getattr(hidden, "unique_id", None) if hidden is not None else None
        prompt = getattr(hidden, "prompt", None) if hidden is not None else None

        targets = [
            choice.Target(
                cid, class_type, input_name,
                choice.options_from_input_types(cls.input_types_for(class_type), input_name),
            )
            for cid, class_type, input_name in choice.find_consumers(prompt, node_id)
        ]
        result = choice.resolve_choice(
            text,
            targets,
            mode=match if match in choice.MATCH_MODES else "loose",
            fallback=fallback,
            stop_on_no_match=if_no_match == "stop the run",
            titles=choice.titles_from_prompt(prompt),
        )
        if result.status == "no_match":
            raise ValueError(f"WP Var → Choice: {result.note}")
        for w in result.warnings:
            _log.warning("wildcard-pipeline: WP Var → Choice: %s", w)

        # Same `wp_varpicker_*` strip as the other converters (null parsed =
        # the amber fallback state), plus what the output feeds and how the
        # value was found.
        matched = result.status not in ("fallback",)
        return io.NodeOutput(
            result.value,
            ui={
                "wp_varpicker_source": [text],
                "wp_varpicker_parsed": [result.value if matched else None],
                "wp_varpicker_default": [result.value],
                "wp_choice_status": [{
                    "status": result.status,
                    "note": result.note,
                    "target": result.target,
                    "options": result.option_count,
                    "warnings": result.warnings,
                }],
            },
        )
