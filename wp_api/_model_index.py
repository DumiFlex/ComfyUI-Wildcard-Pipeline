"""Prefix search over the LoRA and embedding files ComfyUI already knows about.

Nothing is downloaded and nothing is parsed from disk by us: ComfyUI enumerates
both folders for its own node combos, so the entire source is one call into
`folder_paths`. That is the whole reason these two sources cost so little next
to the booru tag list, which needed a fetch, a cache, a byte cap and a parser.

Kept separate from `wp_api/models.py` (the HTTP layer) so the matching rules are
testable without aiohttp, and separate from `_tag_index.py` because the two have
almost nothing in common — tags rank by post count, these have no count at all.
"""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class ModelHit:
    """One matched file."""

    #: What goes on screen — the filename without extension or folder.
    name: str
    #: The full relative path as ComfyUI knows it, e.g. `style/foo.safetensors`.
    #: This is what the insert syntax must use: two folders can hold a `foo`
    #: and ComfyUI resolves by the full path, so showing the short name while
    #: inserting the short name would silently pick the wrong file.
    path: str
    #: Folder prefix when the file is nested, else "". Shown as the row's
    #: subtitle so two same-named files are tellable apart.
    folder: str


def _display_name(path: str) -> str:
    base = path.replace("\\", "/").rsplit("/", 1)[-1]
    return os.path.splitext(base)[0]


def _folder_of(path: str) -> str:
    norm = path.replace("\\", "/")
    return norm.rsplit("/", 1)[0] if "/" in norm else ""


def build_hits(paths: list[str]) -> list[ModelHit]:
    """Turn ComfyUI's raw relative paths into displayable rows."""
    return [
        ModelHit(name=_display_name(p), path=p, folder=_folder_of(p))
        for p in paths
    ]


def search(hits: list[ModelHit], query: str, limit: int) -> list[ModelHit]:
    """Case-insensitive match, prefix hits before substring hits.

    No score beyond that ordering. These lists are tens to low hundreds of
    entries — the user broadly knows what they installed — so the useful job is
    "get it in front of me", not "rank it". Anything cleverer would also have to
    invent a comparison with the tag list's post counts, which is exactly the
    comparison that made a single flat result list the wrong shape.

    Ties break on name so the order is stable between calls; an unstable list
    under a moving keyboard selection is how you press Enter on the wrong row.
    """
    q = query.strip().lower()
    if not q:
        return []
    prefix: list[ModelHit] = []
    contains: list[ModelHit] = []
    for h in hits:
        low = h.name.lower()
        if low.startswith(q):
            prefix.append(h)
        elif q in low or q in h.path.replace("\\", "/").lower():
            contains.append(h)
    prefix.sort(key=lambda h: h.name.lower())
    contains.sort(key=lambda h: h.name.lower())
    return (prefix + contains)[:limit]
