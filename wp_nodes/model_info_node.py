"""WP_ModelInfo — writes $model_family / $model_variant / $model_name into the
context so derivations (and, through a wildcard, constraints) can branch on
the loaded checkpoint.

Detection logic lives in ``engine/model_info.py``; this node only reads the
two facts ComfyUI hands it — the MODEL's config class and the checkpoint file
name behind the MODEL wire — and writes the result like a Context Injector.
"""
from __future__ import annotations

from typing import Any

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine import model_info, negatives
from wp_nodes.types import ModelInfoWidgetInput, PipelineContext


def _config_class_name(model: Any) -> str:
    """``model.model.model_config``'s class name (``SDXL``, ``Flux``, …).

    ``model`` is a ComfyUI ModelPatcher. Read defensively: anything that is
    not shaped like one yields ``""`` and the family is left empty.
    """
    inner = getattr(model, "model", None)
    config = getattr(inner, "model_config", None)
    return type(config).__name__ if config is not None else ""


class WPModelInfo(io.ComfyNode):
    """Chain source that names the loaded model."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_ModelInfo",
            display_name="WP Model Info",
            category="wildcard-pipeline",
            description=(
                "Writes $model_family, $model_variant and $model_name so rules "
                "can branch on the checkpoint. Put it first in the chain."
            ),
            inputs=[
                PipelineContext.Input(
                    "upstream",
                    optional=True,
                    tooltip=(
                        "Optional upstream Context to extend. Only nodes AFTER "
                        "this one see the model variables, so it usually goes "
                        "first."
                    ),
                ),
                io.Model.Input(
                    "model",
                    optional=True,
                    tooltip=(
                        "The model from your checkpoint loader. Gives "
                        "$model_family (sdxl, flux, …) and, through the "
                        "loader, the file name. If a node that loads LoRAs "
                        "from the prompt sits on the model, take MODEL from "
                        "BEFORE it, or the graph loops."
                    ),
                ),
                # Detected values, pins and the variant rules all live in one
                # DOM widget (src/components/model-info/ModelInfoWidget.vue).
                ModelInfoWidgetInput.Input(
                    "wp_model_info", socketless=True, default="", optional=True,
                ),
            ],
            outputs=[PipelineContext.Output("context")],
            hidden=[io.Hidden.unique_id, io.Hidden.prompt],
            not_idempotent=True,
        )

    @classmethod
    def execute(
        cls,
        upstream: PipelineContext | None = None,
        model: Any = None,
        wp_model_info: str = "",
    ):
        cfg = model_info.parse_config(wp_model_info)
        upstream_ctx: dict = upstream.context if upstream is not None else {}
        upstream_debug: dict = upstream.debug if upstream is not None else {}
        upstream_internals: dict = upstream.internals if upstream is not None else {}

        hidden = getattr(cls, "hidden", None)
        node_id = getattr(hidden, "unique_id", None) if hidden is not None else None
        prompt = getattr(hidden, "prompt", None) if hidden is not None else None

        warnings: list[dict] = []

        file_name = cfg.name
        name_source = "pinned" if file_name else "loader"
        if not file_name and model is not None:
            file_name = model_info.find_checkpoint_name(prompt, node_id)
            name_source = "loader"

        rules, problems = model_info.compile_variant_rules(cfg.rules)
        for problem in problems:
            warnings.append({
                "type": "model_info_bad_rule",
                "severity": "warn",
                "message": f"WP Model Info skipped a variant rule: {problem}",
            })

        family = cfg.family or model_info.family_from_config_name(
            _config_class_name(model),
        )
        stem = model_info.model_stem(file_name)
        variant = cfg.variant or model_info.detect_variant(stem, rules)

        if model is None and not file_name and not family and not variant:
            warnings.append({
                "type": "model_info_nothing_detected",
                "severity": "warn",
                "message": (
                    "WP Model Info has no model wired and nothing pinned, so "
                    "the model variables are empty."
                ),
            })

        values = {
            model_info.FAMILY_VAR: family,
            model_info.VARIANT_VAR: variant,
            model_info.NAME_VAR: stem,
        }

        ctx: dict = dict(upstream_ctx)
        ctx.update(values)

        out_internals = dict(upstream_internals)
        # A write replaces a variable's negatives (send-to-negative rule).
        neg_table = out_internals.get(negatives.NEG_KEY)
        if isinstance(neg_table, dict) and any(k in neg_table for k in values):
            out_internals[negatives.NEG_KEY] = {
                k: v for k, v in neg_table.items() if k not in values
            }
        # Internal-ness is last-write-wins like the value: this write decides
        # it for all three names, flagging the ones the widget marks internal
        # and clearing any flag an earlier writer left on the others.
        internal_vars = {f"model_{k}" for k in cfg.internal}
        flags = {
            k: v for k, v in (out_internals.get("__wp_internal_flags__") or {}).items()
            if k not in values
        }
        flags.update({k: True for k in values if k in internal_vars})
        if flags or "__wp_internal_flags__" in out_internals:
            out_internals["__wp_internal_flags__"] = flags

        sources = {
            model_info.FAMILY_VAR: "pinned" if cfg.family else "model",
            model_info.VARIANT_VAR: "pinned" if cfg.variant else "rules",
            model_info.NAME_VAR: name_source,
        }
        traces = [
            {
                "node": "WP_ModelInfo",
                "binding": name,
                "internal": name in internal_vars,
                "type": sources[name],
                "value": value,
            }
            for name, value in values.items()
        ]

        debug = dict(upstream_debug)
        if node_id is not None:
            for row in traces + warnings:
                row["node_id"] = str(node_id)
        debug["__wp_trace__"] = list(debug.get("__wp_trace__", [])) + traces
        if warnings:
            debug["__wp_warnings__"] = list(debug.get("__wp_warnings__", [])) + warnings

        # What the widget shows under DETECTED until the next run: the family
        # is only knowable here, and the rest confirms the canvas preview.
        detected = {
            "family": family,
            "variant": variant,
            "name": stem,
            "sources": {k.removeprefix("model_"): v for k, v in sources.items()},
        }
        return io.NodeOutput(
            PipelineContext.Type(context=ctx, debug=debug, internals=out_internals),
            ui={"wp_model_info": [detected]},
        )
