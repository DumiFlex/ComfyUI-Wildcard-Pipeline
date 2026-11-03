"""A stand-in image generator for the docs pictures (scripts/docs-shots).

The shooting ComfyUI has no checkpoint, so the scenes that need images (WP
Image Filter, WP Label & Grid) wire their prompt into this node instead of a
sampler. It draws a landscape from the words it finds: the time of day sets
the sky (dawn, noon, golden hour / dusk, night), a style word the colours
(pastel, vivid, ink, watercolor), and the rest of the text the shape of the
hills, so every prompt gets its own picture. No people, ever.

Not part of the extension. To use it, link this file into ComfyUI:

    ln -s "$PWD/scripts/docs-shots/docs_demo_images.py" ComfyUI/custom_nodes/

"""
from __future__ import annotations

import hashlib
import math

import numpy as np
import torch
from comfy_api.latest import ComfyExtension, io

SKIES = {
    "dawn": ((236, 152, 128), (250, 206, 160), (255, 236, 200), 0.62),
    "noon": ((92, 150, 226), (176, 212, 246), (255, 252, 236), 0.18),
    "golden": ((246, 156, 72), (252, 214, 140), (255, 230, 170), 0.55),
    "dusk": ((96, 72, 140), (236, 132, 110), (255, 200, 150), 0.66),
    "night": ((14, 20, 52), (40, 52, 98), (236, 236, 220), 0.2),
}
SKY_WORDS = {"dawn": "dawn", "sunrise": "dawn", "morning": "dawn", "noon": "noon", "day": "noon",
             "midday": "noon", "golden": "golden", "sunset": "dusk", "dusk": "dusk",
             "evening": "dusk", "night": "night", "moonlight": "night", "midnight": "night"}
PALETTES = {
    "pastel": [(196, 170, 222), (150, 200, 196), (124, 106, 170)],
    "vivid": [(40, 74, 170), (36, 140, 84), (52, 40, 132)],
    "ink": [(150, 150, 156), (96, 96, 102), (54, 54, 60)],
}
#: Colours for a prompt that names no style word, picked by the rest of its text.
MIXED = [
    [(150, 110, 150), (90, 120, 110), (70, 70, 110)],
    [(120, 170, 190), (90, 140, 120), (70, 90, 130)],
    [(214, 150, 110), (150, 96, 80), (96, 60, 70)],
    [(110, 160, 120), (60, 110, 90), (40, 70, 80)],
    [(170, 150, 200), (110, 100, 160), (70, 60, 110)],
]


def _rng(text: str) -> np.random.Generator:
    return np.random.default_rng(int(hashlib.sha256(text.encode()).hexdigest()[:12], 16))


def _pick(words: str, table: dict, fallback):
    for w, key in table.items():
        if w in words:
            return key
    return fallback


def draw(text: str, width: int, height: int) -> np.ndarray:
    words = text.lower()
    rng = _rng(text)
    sky_key = _pick(words, SKY_WORDS, ["dawn", "noon", "dusk", "night"][rng.integers(4)])
    top, low, sun, sun_y = SKIES[sky_key]
    pal_key = next((k for k in PALETTES if k in words), None)
    palette = PALETTES[pal_key] if pal_key else MIXED[int(rng.integers(len(MIXED)))]

    ys = np.linspace(0, 1, height)[:, None, None]
    img = np.array(top)[None, None, :] * (1 - ys) + np.array(low)[None, None, :] * ys
    img = np.broadcast_to(img, (height, width, 3)).copy()

    yy, xx = np.mgrid[0:height, 0:width]
    cx, cy, r = width * rng.uniform(0.25, 0.75), height * sun_y * 0.6, min(width, height) * 0.06
    img[(xx - cx) ** 2 + (yy - cy) ** 2 < r * r] = sun

    x = np.arange(width) / width
    for layer, colour in enumerate(palette):
        base = 0.48 + layer * 0.14
        y = base + sum(
            rng.uniform(0.015, 0.06) / (k + 1)
            * np.sin(2 * math.pi * (k + 1) * rng.uniform(0.8, 2.2) * x + rng.uniform(0, 6))
            for k in range(4)
        )
        ridge = (y * height).astype(int)
        img[yy >= ridge[None, :]] = colour
    return img.astype(np.float32) / 255.0


class DocsDemoLandscape(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="DocsDemoLandscape",
            display_name="Your images",
            category="docs",
            inputs=[
                io.String.Input("text", force_input=True),
                io.Int.Input("width", default=512, min=64, max=2048),
                io.Int.Input("height", default=512, min=64, max=2048),
                io.Int.Input("count", default=1, min=1, max=8),
            ],
            outputs=[io.Image.Output()],
        )

    @classmethod
    def execute(cls, text: str, width: int, height: int, count: int) -> io.NodeOutput:
        frames = [draw(f"{text}#{i}" if i else text, width, height) for i in range(count)]
        return io.NodeOutput(torch.from_numpy(np.stack(frames)))


class _Ext(ComfyExtension):
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [DocsDemoLandscape]


async def comfy_entrypoint() -> ComfyExtension:
    return _Ext()
