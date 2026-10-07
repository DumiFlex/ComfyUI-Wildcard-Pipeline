"""WP_ImageFilter — pause the run, pick which images go on.

Meant to sit between two passes (first KSampler → upscaler / hires KSampler).
When it runs it sends the images to the canvas, waits for the user to pick,
and passes on only the picks. Every other slot wired through it follows the
same picks — latents, masks, positive/negative conditionings and prompt
strings, the pipeline context and two any-type slots — so the outputs stay
lined up for the next sampler. The pick/follow logic lives in
``engine/image_filter.py``; this module is the ComfyUI side: previews, the
websocket message, the wait, and ComfyUI's ``ExecutionBlocker`` for "stop this
branch".

``is_input_list`` so a Context Loop's N frames arrive in ONE call and show in
ONE picker. Every output is a list for the same reason.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from typing import Any

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine import image_filter as f
from wp_nodes.types import ImageFilterWidgetInput, PipelineContext

logger = logging.getLogger(__name__)

#: Websocket event names. The canvas opens the picker on REQUEST and closes it
#: on DONE (answered elsewhere, timed out, or the run was cancelled).
EVENT_REQUEST = "wp-image-filter"
EVENT_DONE = "wp-image-filter-done"

POLL_SECONDS = 0.15

#: Outputs in `define_schema` (blocked together on "stop this branch").
_OUTPUT_COUNT = 11

_extra_1 = io.MatchType.Template("wp_image_filter_extra_1")
_extra_2 = io.MatchType.Template("wp_image_filter_extra_2")


def _first(values: Any, default: Any = None) -> Any:
    """A widget's value under ``is_input_list`` (ComfyUI wraps it in a list)."""
    if isinstance(values, list):
        return values[0] if values else default
    return default if values is None else values


def _save_previews(images: list[Any]) -> list[list[dict[str, str]]]:
    """Write every frame's images to ComfyUI's temp folder for the picker.

    Returns ``[[{filename, subfolder, type}, …] per frame]`` — the same refs a
    PreviewImage node sends, so the canvas loads them through ``/view``.
    """
    import folder_paths  # type: ignore[import-not-found]
    import numpy as np
    from PIL import Image

    out_dir = folder_paths.get_temp_directory()
    os.makedirs(out_dir, exist_ok=True)
    stem = f"wp_filter_{uuid.uuid4().hex[:10]}"
    frames: list[list[dict[str, str]]] = []
    for fi, batch in enumerate(images):
        refs: list[dict[str, str]] = []
        for ii in range(int(batch.shape[0])):
            arr = np.clip(255.0 * batch[ii].cpu().numpy(), 0, 255).astype(np.uint8)
            name = f"{stem}_{fi:03d}_{ii:03d}.png"
            # compress_level 1: these are throwaway previews, speed wins.
            Image.fromarray(arr).save(os.path.join(out_dir, name), compress_level=1)
            refs.append({"filename": name, "subfolder": "", "type": "temp"})
        frames.append(refs)
    return frames


def _frame_labels(contexts: list[Any] | None, frames: int) -> list[dict[str, Any]]:
    """Per-frame label data from the optional context: loop index + sweep pins.

    Kept small on purpose (step 1); the picker shows ``#n`` and the pinned
    sweep values when there are any.
    """
    aligned = f.align(contexts, frames)
    labels: list[dict[str, Any]] = []
    for ctx in aligned:
        internals = getattr(ctx, "internals", None) or {}
        label: dict[str, Any] = {}
        if "__wp_loop_index__" in internals:
            label["loop_index"] = internals["__wp_loop_index__"]
        pins = internals.get("__wp_pin_overrides__")
        if isinstance(pins, dict) and pins:
            label["pins"] = {str(k): str(v) for k, v in pins.items()}
        labels.append(label)
    return labels


class WPImageFilter(io.ComfyNode):
    """Pause the run and pick which images (and everything that follows them) go on."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_ImageFilter",
            display_name="WP Image Filter",
            category="wildcard-pipeline",
            description=(
                "Pauses the run so you can pick which images go on. Latents, "
                "masks, conditionings, prompts and the context wired through "
                "it follow the same picks."
            ),
            inputs=[
                io.Image.Input(
                    "images",
                    tooltip=(
                        "The images to pick from: one batch, or one batch per "
                        "frame when a Context Loop runs upstream."
                    ),
                ),
                io.Latent.Input(
                    "latent", optional=True,
                    tooltip="Latents of the same images. Sliced to the picks.",
                ),
                io.Mask.Input(
                    "masks", optional=True,
                    tooltip="Masks of the same images. Sliced to the picks.",
                ),
                io.Conditioning.Input(
                    "positive", optional=True,
                    tooltip=(
                        "Positive conditioning. One per frame: kept with its "
                        "frame. Batched like the images: sliced to the picks."
                    ),
                ),
                io.Conditioning.Input(
                    "negative", optional=True,
                    tooltip="Negative conditioning, handled like positive.",
                ),
                io.String.Input(
                    "positive_text", optional=True, force_input=True,
                    tooltip="Positive prompt text (one per frame). Kept with its frame.",
                ),
                io.String.Input(
                    "negative_text", optional=True, force_input=True,
                    tooltip="Negative prompt text (one per frame). Kept with its frame.",
                ),
                PipelineContext.Input(
                    "context", optional=True,
                    tooltip=(
                        "WP context (one per frame). Kept with its frame, so a "
                        "later Assembler only sees the picked frames."
                    ),
                ),
                io.MatchType.Input(
                    "extra_1", template=_extra_1, optional=True,
                    tooltip="Anything else to carry along. The output takes its type.",
                ),
                io.MatchType.Input(
                    "extra_2", template=_extra_2, optional=True,
                    tooltip="Anything else to carry along. The output takes its type.",
                ),
                ImageFilterWidgetInput.Input(
                    "wp_image_filter", socketless=True, default="", optional=True,
                ),
            ],
            outputs=[
                io.Image.Output("images", is_output_list=True),
                io.Latent.Output("latent", is_output_list=True),
                io.Mask.Output("masks", is_output_list=True),
                io.Conditioning.Output("positive", is_output_list=True),
                io.Conditioning.Output("negative", is_output_list=True),
                io.String.Output("positive_text", is_output_list=True),
                io.String.Output("negative_text", is_output_list=True),
                PipelineContext.Output("context", is_output_list=True),
                io.MatchType.Output(_extra_1, "extra_1", is_output_list=True),
                io.MatchType.Output(_extra_2, "extra_2", is_output_list=True),
                io.String.Output("picks"),
            ],
            hidden=[io.Hidden.unique_id],
            is_input_list=True,
            not_idempotent=True,
        )

    @classmethod
    def fingerprint_inputs(cls, **kwargs):
        """Always run: a cached result would skip the picker. NaN never equals
        itself, so the cache never matches."""
        return float("nan")

    @classmethod
    async def execute(
        cls,
        images: list[Any],
        latent: list[Any] | None = None,
        masks: list[Any] | None = None,
        positive: list[Any] | None = None,
        negative: list[Any] | None = None,
        positive_text: list[Any] | None = None,
        negative_text: list[Any] | None = None,
        context: list[Any] | None = None,
        extra_1: list[Any] | None = None,
        extra_2: list[Any] | None = None,
        wp_image_filter: list[Any] | None = None,
    ):
        cfg = f.parse_config(_first(wp_image_filter, ""))
        batch_sizes = [int(f.batch_len(b) or 0) for b in (images or [])]
        hidden = getattr(cls, "hidden", None)
        node_id = str(getattr(hidden, "unique_id", "") or "")

        picks: list[f.Pick] | None = None
        how = cfg["mode"]
        if cfg["mode"] == "pass_all":
            picks = f.all_picks(batch_sizes)
        elif cfg["mode"] == "reuse":
            picks = f.reusable_picks(f.LAST_PICKS.get(node_id), batch_sizes)
            if picks is None:
                how = "pause"
        if picks is None:
            answer = await cls._ask(images, context, batch_sizes, cfg, node_id)
            if answer.action == "stop":
                return cls._blocked()
            picks = list(answer.picks)

        if not picks:
            if cfg["nothing_picked"] == "stop":
                return cls._blocked()
            picks = f.all_picks(batch_sizes)

        if how == "pause":
            f.LAST_PICKS[node_id] = list(picks)

        plan = f.plan_output(picks, cfg["send_as"])

        def follow(values: list[Any] | None) -> list[Any]:
            return f.follow_slot(values, plan, batch_sizes)

        return io.NodeOutput(
            follow(images),
            follow(latent),
            follow(masks),
            follow(positive),
            follow(negative),
            follow(positive_text),
            follow(negative_text),
            follow(context),
            follow(extra_1),
            follow(extra_2),
            f.format_picks(picks),
            ui={"wp_image_filter": [{
                "picks": [list(p) for p in picks],
                "frames": len(batch_sizes),
                "total": sum(batch_sizes),
                "mode": how,
            }]},
        )

    @classmethod
    def _blocked(cls):
        """Silently skip everything downstream of this node (not the rest of
        the run): ComfyUI's ExecutionBlocker with no message."""
        from comfy_execution.graph_utils import (  # type: ignore[import-not-found]
            ExecutionBlocker,
        )

        # One blocker per output. A bare ExecutionBlocker return would become
        # `NodeOutput(block_execution=None)`, which ComfyUI reads as "not
        # blocked" when the message is None.
        blockers = [ExecutionBlocker(None) for _ in range(_OUTPUT_COUNT)]
        return io.NodeOutput(
            *blockers,
            ui={"wp_image_filter": [{"picks": [], "stopped": True}]},
        )

    @classmethod
    async def _ask(
        cls,
        images: list[Any],
        contexts: list[Any] | None,
        batch_sizes: list[int],
        cfg: dict[str, Any],
        node_id: str,
    ) -> f.Answer:
        from comfy.model_management import (  # type: ignore[import-not-found]
            throw_exception_if_processing_interrupted,
        )
        from server import PromptServer  # type: ignore[import-not-found]

        server = PromptServer.instance
        token = uuid.uuid4().hex
        timeout = int(cfg["timeout"])
        request = {
            "token": token,
            "node_id": node_id,
            "frames": _save_previews(images),
            "labels": _frame_labels(contexts, len(batch_sizes)),
            "timeout": timeout,
            "started_at": time.time(),
        }
        f.PENDING.open(token, request)
        server.send_sync(EVENT_REQUEST, request)
        deadline = time.monotonic() + timeout if timeout > 0 else None
        try:
            while True:
                raw = f.PENDING.take(token)
                if raw is not None:
                    answer = f.parse_answer(raw, batch_sizes)
                    if answer is not None:
                        return answer
                    logger.warning("wp image filter: ignored a malformed answer")
                # Cancelling the run from the queue sets ComfyUI's interrupt
                # flag; raising here ends the wait like any other node.
                throw_exception_if_processing_interrupted()
                if deadline is not None and time.monotonic() >= deadline:
                    return f.resolve_timeout(cfg["on_timeout"], batch_sizes)
                await asyncio.sleep(POLL_SECONDS)
        finally:
            f.PENDING.close(token)
            server.send_sync(EVENT_DONE, {"token": token, "node_id": node_id})
