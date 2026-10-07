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
from engine.syntax.types import deref_var_value
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


#: Longest prompt text sent to the picker per frame (it is shown and edited
#: there; anything longer is cut, and an untouched prompt is never sent back).
_MAX_LABEL_TEXT = 20_000
#: The zoom's Details panel lists the frame's variables; cap what one label
#: carries so a huge context can't bloat the websocket message.
_MAX_LABEL_VARS = 80
_MAX_VAR_TEXT = 300


def _frame_seed(internals: dict[str, Any]) -> int | None:
    """The seed a Context Loop gave this frame, when there is one."""
    seed = internals.get("__wp_seed_override__")
    if isinstance(seed, int) and not isinstance(seed, bool):
        return seed
    seeds = internals.get("__wp_loop_seeds__")
    idx = internals.get("__wp_loop_index__")
    if isinstance(seeds, list) and isinstance(idx, int) and 0 <= idx < len(seeds):
        value = seeds[idx]
        if isinstance(value, int) and not isinstance(value, bool):
            return value
    return None


def _frame_vars(ctx: Any) -> dict[str, str]:
    """The frame's resolved `$variables` as text, for the zoom's Details panel."""
    values = getattr(ctx, "context", None)
    out: dict[str, str] = {}
    if not isinstance(values, dict):
        return out
    for name, raw in values.items():
        if not isinstance(name, str) or name.startswith("__"):
            continue
        try:
            text = deref_var_value(raw, None)
        except Exception:  # noqa: BLE001 - a value we can't render is just skipped
            continue
        if isinstance(text, str) and text.strip():
            out[name] = text[:_MAX_VAR_TEXT]
            if len(out) >= _MAX_LABEL_VARS:
                break
    return out


def _frame_labels(
    contexts: list[Any] | None,
    positive_text: list[Any] | None,
    negative_text: list[Any] | None,
    frames: int,
) -> list[dict[str, Any]]:
    """Per-frame label data for the picker: loop index, sweep pins, seed,
    variables and the frame's prompt texts (shown on hover and editable in
    zoom)."""
    labels: list[dict[str, Any]] = []
    for ctx, pos, neg in zip(
        f.align(contexts, frames),
        f.align(positive_text, frames),
        f.align(negative_text, frames),
        strict=True,
    ):
        internals = getattr(ctx, "internals", None) or {}
        label: dict[str, Any] = {}
        if "__wp_loop_index__" in internals:
            label["loop_index"] = internals["__wp_loop_index__"]
        pins = internals.get("__wp_pin_overrides__")
        if isinstance(pins, dict) and pins:
            label["pins"] = {str(k): str(v) for k, v in pins.items()}
        seed = _frame_seed(internals)
        if seed is not None:
            label["seed"] = seed
        frame_vars = _frame_vars(ctx)
        if frame_vars:
            label["vars"] = frame_vars
        if isinstance(pos, str):
            label["positive"] = pos[:_MAX_LABEL_TEXT]
        if isinstance(neg, str):
            label["negative"] = neg[:_MAX_LABEL_TEXT]
        labels.append(label)
    return labels


def _encode(clip: Any, text: str) -> Any:
    """CLIPTextEncode, inline: an edited prompt's new conditioning."""
    tokens = clip.tokenize(text)
    return clip.encode_from_tokens_scheduled(tokens)


def _decode_mask(url: str, height: int, width: int) -> Any:
    """A painted PNG data URL as a ``[H, W]`` float mask.

    The picker sends the mask in the alpha channel (painted = opaque); a PNG
    without alpha is read by brightness (white = masked).
    """
    import base64
    import io as _io

    import numpy as np
    import torch
    from PIL import Image

    raw = base64.b64decode(url[len(f.MASK_PREFIX):])
    src = Image.open(_io.BytesIO(raw))
    if src.mode in ("RGBA", "LA", "PA") or "transparency" in src.info:
        img = src.convert("RGBA").getchannel("A")
    else:
        img = src.convert("L")
    if img.size != (width, height):
        img = img.resize((width, height), Image.BILINEAR)
    return torch.from_numpy(np.asarray(img, dtype=np.float32) / 255.0)


def _fit_mask(mask: Any, height: int, width: int) -> Any:
    import torch

    if tuple(mask.shape[-2:]) == (height, width):
        return mask
    resized = torch.nn.functional.interpolate(
        mask.reshape(1, 1, *mask.shape[-2:]).float(), size=(height, width), mode="bilinear",
    )
    return resized.reshape(height, width)


def _painted_masks(images: Any, incoming: Any, urls: list[str]) -> Any:
    """One item's mask batch: painted masks where the user painted, the
    incoming mask (sliced or broadcast) elsewhere, empty when there is none."""
    import torch

    n, height, width = int(images.shape[0]), int(images.shape[1]), int(images.shape[2])
    out = []
    for j in range(n):
        url = urls[j] if j < len(urls) else ""
        if url:
            out.append(_decode_mask(url, height, width))
            continue
        base = None
        if incoming is not None and hasattr(incoming, "shape"):
            if incoming.ndim == 2:
                base = incoming
            elif incoming.ndim == 3 and incoming.shape[0] == n:
                base = incoming[j]
            elif incoming.ndim == 3 and incoming.shape[0] >= 1:
                base = incoming[0]
        if base is None:
            out.append(torch.zeros((height, width), dtype=torch.float32))
        else:
            out.append(_fit_mask(base.float().cpu(), height, width))
    return torch.stack(out)


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
                io.Clip.Input(
                    "clip", optional=True,
                    tooltip=(
                        "Optional. Re-encodes a prompt you edit in the picker, so "
                        "the positive/negative conditioning follows the edit."
                    ),
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
        clip: list[Any] | None = None,
        wp_image_filter: list[Any] | None = None,
    ):
        cfg = f.parse_config(_first(wp_image_filter, ""))
        batch_sizes = [int(f.batch_len(b) or 0) for b in (images or [])]
        hidden = getattr(cls, "hidden", None)
        node_id = str(getattr(hidden, "unique_id", "") or "")

        picks: list[f.Pick] | None = None
        edits: dict[f.Pick, f.Edit] = {}
        clip_model = _first(clip)
        how = cfg["mode"]
        if cfg["mode"] == "pass_all":
            picks = f.all_picks(batch_sizes)
        elif cfg["mode"] == "reuse":
            picks = f.reusable_picks(f.LAST_PICKS.get(node_id), batch_sizes)
            if picks is None:
                how = "pause"
        if picks is None:
            labels = _frame_labels(context, positive_text, negative_text, len(batch_sizes))
            answer = await cls._ask(
                images, labels, batch_sizes, cfg, node_id, has_clip=clip_model is not None,
            )
            if answer.action == "stop":
                return cls._blocked()
            picks = list(answer.picks)
            edits = dict(answer.edits)

        # The picker can't send an empty pick; an API caller can. Nothing to
        # pass on, so stop the branch.
        if not picks:
            return cls._blocked()

        if how == "pause":
            f.LAST_PICKS[node_id] = list(picks)

        plan = f.plan_output(picks, cfg["send_as"])

        def follow(values: list[Any] | None) -> list[Any]:
            return f.follow_slot(values, plan, batch_sizes)

        out_images = follow(images)
        out_masks = follow(masks)
        out_pos, out_neg = follow(positive), follow(negative)
        out_pos_text, out_neg_text = follow(positive_text), follow(negative_text)
        edited = 0
        for k, (pos, neg) in enumerate(zip(
            f.item_text_edits(plan, edits, "positive"),
            f.item_text_edits(plan, edits, "negative"),
            strict=True,
        )):
            if pos is not None:
                edited += 1
                out_pos_text[k] = pos
                if clip_model is not None:
                    out_pos[k] = _encode(clip_model, pos)
            if neg is not None:
                edited += 1
                out_neg_text[k] = neg
                if clip_model is not None:
                    out_neg[k] = _encode(clip_model, neg)
        painted = 0
        for k, urls in enumerate(f.item_mask_edits(plan, edits)):
            if urls is not None:
                painted += sum(1 for u in urls if u)
                out_masks[k] = _painted_masks(out_images[k], out_masks[k], urls)
        if painted:
            # Lists go downstream item by item: with nothing wired into
            # `masks`, the unpainted items still need a mask, an empty one.
            for k, m in enumerate(out_masks):
                if m is None:
                    out_masks[k] = _painted_masks(out_images[k], None, [])

        return io.NodeOutput(
            out_images,
            follow(latent),
            out_masks,
            out_pos,
            out_neg,
            out_pos_text,
            out_neg_text,
            follow(context),
            follow(extra_1),
            follow(extra_2),
            f.format_picks(picks),
            ui={"wp_image_filter": [{
                "picks": [list(p) for p in picks],
                "frames": len(batch_sizes),
                "total": sum(batch_sizes),
                "mode": how,
                "edited": edited,
                "masks": painted,
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
        labels: list[dict[str, Any]],
        batch_sizes: list[int],
        cfg: dict[str, Any],
        node_id: str,
        has_clip: bool = False,
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
            "labels": labels,
            "send_as": cfg["send_as"],
            "has_clip": has_clip,
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
