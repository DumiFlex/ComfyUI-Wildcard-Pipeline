"""Pure logic behind ``WP_ImageFilter`` — the pause-and-pick node.

The node sits between two passes (first KSampler → upscaler / hires pass) and
lets the user choose which images go on. Everything wired through it follows
the same picks so its outputs stay lined up for the next sampler: the latents
of the picked images, the conditionings and prompt strings of the frames they
came from, the masks, the pipeline context.

Shapes. With ``is_input_list`` the node receives every input as a list. The
``images`` list sets the frames: ``images[f]`` is one IMAGE batch, so a plain
batch is one frame of B images and a Context Loop of N iterations is N frames.
A pick is ``(frame, image)``. Each other slot is aligned to the frames the way
ComfyUI aligns lists (one item per frame, or its last item repeated) and then:

- a value batched like its frame's images (latent ``samples``, a mask, a
  conditioning tensor whose first dimension equals the frame's batch) is
  sliced to the picked images;
- anything else (a string, a context, a batch-1 conditioning shared by the
  whole batch, a model) is kept or dropped with its frame.

Duck-typed on ``.shape`` + list indexing (torch tensors and numpy arrays both
qualify) so this module stays free of torch and ComfyUI imports and is tested
with plain pytest.

The waiting side lives here too: ``PendingAnswers`` is the thread-safe hand-off
between the HTTP route (aiohttp's loop) and the node (ComfyUI runs prompts in a
worker thread with its own event loop, so an ``asyncio.Event`` from one loop
can't be awaited from the other).
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from typing import Any

Pick = tuple[int, int]
#: One output frame: the source frame and the image indexes it keeps.
PlanItem = tuple[int, list[int]]

MODES = ("pause", "reuse", "pass_all")
NOTHING_PICKED = ("stop", "keep_all")
SEND_AS = ("same_shape", "per_image")
ON_TIMEOUT = ("keep_all", "stop", "keep_first")

DEFAULT_CONFIG: dict[str, Any] = {
    "mode": "pause",
    "nothing_picked": "stop",
    "send_as": "same_shape",
    # Seconds; 0 waits until answered (or the run is cancelled).
    "timeout": 600,
    "on_timeout": "keep_all",
}

#: Upper bound for the timeout widget (a day). Guards against a typo turning
#: into a node that can never time out by accident.
MAX_TIMEOUT = 86_400


def parse_config(raw: Any) -> dict[str, Any]:
    """Decode the node's JSON config widget, falling back per key.

    Unknown keys are ignored and bad values collapse to their default, so a
    hand-edited or older workflow still runs (same recovery rule as the
    Context Loop's ``_parse_config``).
    """
    out = dict(DEFAULT_CONFIG)
    if isinstance(raw, str):
        try:
            raw = json.loads(raw) if raw.strip() else {}
        except ValueError:
            raw = {}
    if not isinstance(raw, dict):
        return out
    for key, allowed in (
        ("mode", MODES),
        ("nothing_picked", NOTHING_PICKED),
        ("send_as", SEND_AS),
        ("on_timeout", ON_TIMEOUT),
    ):
        if raw.get(key) in allowed:
            out[key] = raw[key]
    timeout = raw.get("timeout")
    if isinstance(timeout, (int, float)) and not isinstance(timeout, bool):
        out["timeout"] = max(0, min(MAX_TIMEOUT, int(timeout)))
    return out


# ------------------------------------------------------------------ picks ---


def batch_len(value: Any) -> int | None:
    """First dimension of a tensor-like, else None."""
    shape = getattr(value, "shape", None)
    if shape is None:
        return None
    try:
        return int(shape[0]) if len(shape) >= 1 else None
    except (TypeError, ValueError):
        return None


def all_picks(batch_sizes: list[int]) -> list[Pick]:
    return [(f, i) for f, b in enumerate(batch_sizes) for i in range(b)]


def normalize_picks(raw: Any, batch_sizes: list[int]) -> list[Pick]:
    """Keep the in-range ``[frame, image]`` pairs, deduplicated, in order."""
    if not isinstance(raw, (list, tuple)):
        return []
    seen: set[Pick] = set()
    for item in raw:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            continue
        f, i = item
        if isinstance(f, bool) or isinstance(i, bool):
            continue
        if not isinstance(f, int) or not isinstance(i, int):
            continue
        if 0 <= f < len(batch_sizes) and 0 <= i < batch_sizes[f]:
            seen.add((f, i))
    return sorted(seen)


def plan_output(picks: list[Pick], send_as: str = "same_shape") -> list[PlanItem]:
    """Group picks into output frames.

    ``same_shape``: one output frame per source frame that has a pick, holding
    its picked images. ``per_image``: one output frame per picked image.
    """
    ordered = sorted(set(picks))
    if send_as == "per_image":
        return [(f, [i]) for f, i in ordered]
    plan: list[PlanItem] = []
    for f, i in ordered:
        if plan and plan[-1][0] == f:
            plan[-1][1].append(i)
        else:
            plan.append((f, [i]))
    return plan


def format_picks(picks: list[Pick]) -> str:
    """1-based ``frame:image`` list for the ``picks`` output, e.g. ``1:2, 3:1``."""
    return ", ".join(f"{f + 1}:{i + 1}" for f, i in sorted(picks))


# ------------------------------------------------------------- following ---


def align(values: list[Any] | None, frames: int) -> list[Any]:
    """Line a slot's list up with the frames, ComfyUI-style.

    A slot with fewer items than frames repeats its last item (that is how
    ComfyUI pairs lists of different lengths); an unconnected slot is None for
    every frame.
    """
    if not values:
        return [None] * frames
    return [values[f] if f < len(values) else values[-1] for f in range(frames)]


def _take(value: Any, idx: list[int], batch: int) -> Any:
    n = batch_len(value)
    if n is None or n != batch or idx == list(range(batch)):
        return value
    return value[idx]


def _is_conditioning(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) > 0
        and all(
            isinstance(entry, (list, tuple))
            and len(entry) == 2
            and batch_len(entry[0]) is not None
            and isinstance(entry[1], dict)
            for entry in value
        )
    )


def take_images(value: Any, idx: list[int], batch: int) -> Any:
    """Slice one frame's value down to the picked images, when it is batched.

    Values whose batch doesn't match the frame's image batch pass through: a
    batch-1 conditioning broadcast over 4 images, a single mask for the whole
    batch, a string.
    """
    if value is None:
        return None
    if isinstance(value, dict) and "samples" in value:
        # LATENT: slice samples and whatever travels batched beside them.
        out = dict(value)
        out["samples"] = _take(value["samples"], idx, batch)
        if "noise_mask" in value:
            out["noise_mask"] = _take(value["noise_mask"], idx, batch)
        bi = value.get("batch_index")
        if isinstance(bi, list) and len(bi) == batch:
            out["batch_index"] = [bi[i] for i in idx]
        return out
    if _is_conditioning(value):
        sliced = []
        for tensor, extras in value:
            new_extras = {
                k: (_take(v, idx, batch) if batch_len(v) is not None else v)
                for k, v in extras.items()
            }
            sliced.append([_take(tensor, idx, batch), new_extras])
        return sliced
    return _take(value, idx, batch)


def follow_slot(
    values: list[Any] | None,
    plan: list[PlanItem],
    batch_sizes: list[int],
) -> list[Any]:
    """The output list for one slot under ``plan``."""
    aligned = align(values, len(batch_sizes))
    return [take_images(aligned[f], idx, batch_sizes[f]) for f, idx in plan]


# ---------------------------------------------------------------- answers ---


@dataclass(frozen=True)
class Answer:
    """What the picker sent back: ``picks``, ``keep_all`` or ``stop``."""

    action: str
    picks: tuple[Pick, ...] = ()


def parse_answer(payload: Any, batch_sizes: list[int]) -> Answer | None:
    """Validate a picker response body; None when it is unusable."""
    if not isinstance(payload, dict):
        return None
    action = payload.get("action")
    if action == "keep_all":
        return Answer("keep_all", tuple(all_picks(batch_sizes)))
    if action == "stop":
        return Answer("stop")
    if action == "picks":
        return Answer("picks", tuple(normalize_picks(payload.get("picks"), batch_sizes)))
    return None


def resolve_timeout(on_timeout: str, batch_sizes: list[int]) -> Answer:
    if on_timeout == "stop":
        return Answer("stop")
    if on_timeout == "keep_first" and batch_sizes:
        return Answer("picks", ((0, 0),))
    return Answer("keep_all", tuple(all_picks(batch_sizes)))


class PendingAnswers:
    """Thread-safe registry of nodes waiting for a pick.

    ``open`` registers a request (and keeps its payload so a reloaded page can
    show it again), ``answer`` is called from the HTTP route, ``take`` is polled
    by the waiting node, ``close`` drops the request whatever happened.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._requests: dict[str, dict[str, Any]] = {}
        self._answers: dict[str, Any] = {}

    def open(self, token: str, request: dict[str, Any]) -> None:
        with self._lock:
            self._requests[token] = request
            self._answers.pop(token, None)

    def answer(self, token: str, payload: Any) -> bool:
        """Store a response; False when nothing is waiting on ``token``."""
        with self._lock:
            if token not in self._requests:
                return False
            self._answers[token] = payload
            return True

    def take(self, token: str) -> Any:
        with self._lock:
            return self._answers.pop(token, None)

    def close(self, token: str) -> None:
        with self._lock:
            self._requests.pop(token, None)
            self._answers.pop(token, None)

    def pending(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._requests.values())


#: Process-wide registry shared by the node and the route.
PENDING = PendingAnswers()

#: Last picks per node (``unique_id``), for the "Reuse last picks" mode.
#: In memory only: a restart forgets them and the node asks again.
LAST_PICKS: dict[str, list[Pick]] = {}


def reusable_picks(stored: list[Pick] | None, batch_sizes: list[int]) -> list[Pick] | None:
    """Stored picks when they still fit the incoming frames, else None."""
    if not stored:
        return None
    picks = normalize_picks([list(p) for p in stored], batch_sizes)
    return picks if len(picks) == len(stored) else None
