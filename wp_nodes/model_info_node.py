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
from wp_nodes.types import PipelineContext


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
                io.String.Input(
                    "model_name",
                    default="",
                    tooltip=(
                        "Checkpoint file name. Leave empty to read it from "
                        "the loader the model comes from."
                    ),
                ),
                io.String.Input(
                    "variant_rules",
                    default=model_info.DEFAULT_VARIANT_RULES,
                    multiline=True,
                    tooltip=(
                        "One 'variant: pattern' per line. The first pattern "
                        "found in the file name sets $model_variant "
                        "(case-insensitive, | separates alternatives)."
                    ),
                ),
                io.String.Input(
                    "family_override",
                    default="",
                    tooltip="Use this instead of the detected family.",
                ),
                io.String.Input(
                    "variant_override",
                    default="",
                    tooltip=(
                        "Use this instead of the detected variant, e.g. to "
                        "try your pony rules without switching checkpoint."
                    ),
                ),
            ],
            outputs=[
                PipelineContext.Output("context"),
                io.String.Output("model_family"),
                io.String.Output("model_variant"),
                io.String.Output("model_name"),
            ],
            hidden=[io.Hidden.unique_id, io.Hidden.prompt],
            not_idempotent=True,
        )

    @classmethod
    def execute(
        cls,
        upstream: PipelineContext | None = None,
        model: Any = None,
        model_name: str = "",
        variant_rules: str = model_info.DEFAULT_VARIANT_RULES,
        family_override: str = "",
        variant_override: str = "",
    ):
        upstream_ctx: dict = upstream.context if upstream is not None else {}
        upstream_debug: dict = upstream.debug if upstream is not None else {}
        upstream_internals: dict = upstream.internals if upstream is not None else {}

        hidden = getattr(cls, "hidden", None)
        node_id = getattr(hidden, "unique_id", None) if hidden is not None else None
        prompt = getattr(hidden, "prompt", None) if hidden is not None else None

        warnings: list[dict] = []

        file_name = (model_name or "").strip()
        name_source = "input"
        if not file_name and model is not None:
            file_name = model_info.find_checkpoint_name(prompt, node_id)
            name_source = "loader"

        rules, problems = model_info.parse_variant_rules(variant_rules)
        for problem in problems:
            warnings.append({
                "type": "model_info_bad_rule",
                "severity": "warn",
                "message": f"WP Model Info skipped a variant rule: {problem}",
            })

        family = (family_override or "").strip() or model_info.family_from_config_name(
            _config_class_name(model),
        )
        stem = model_info.model_stem(file_name)
        variant = (variant_override or "").strip() or model_info.detect_variant(stem, rules)

        if model is None and not file_name and not family and not variant:
            warnings.append({
                "type": "model_info_nothing_detected",
                "severity": "warn",
                "message": (
                    "WP Model Info has no model wired and no model_name, so "
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
        # A previous writer may have flagged one of these names internal; this
        # write is public, so the closest writer wins (last-write-wins).
        flags = out_internals.get("__wp_internal_flags__")
        if isinstance(flags, dict) and any(k in flags for k in values):
            out_internals["__wp_internal_flags__"] = {
                k: v for k, v in flags.items() if k not in values
            }

        sources = {
            model_info.FAMILY_VAR: "override" if (family_override or "").strip() else "model",
            model_info.VARIANT_VAR: "override" if (variant_override or "").strip() else "rules",
            model_info.NAME_VAR: name_source,
        }
        traces = [
            {
                "node": "WP_ModelInfo",
                "binding": name,
                "internal": False,
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

        return io.NodeOutput(
            PipelineContext.Type(context=ctx, debug=debug, internals=out_internals),
            family,
            variant,
            stem,
        )
