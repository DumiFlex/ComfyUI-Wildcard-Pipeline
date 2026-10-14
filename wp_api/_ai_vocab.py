"""The user's LoRAs, embeddings and Danbooru tags for the AI features.

Backs `engine.ai.vocab.Lookup` with the same data the autocomplete uses:
ComfyUI's `loras` / `embeddings` folders (`models._hits`) and the
downloaded tag list (`tags._get_index`). Nothing here touches the network
or reads a path the request names. A source is used only when the browser
says its autocomplete is on (`vocab` in the request) AND its data exists.
"""
from __future__ import annotations

from typing import Any

from engine.ai import vocab as ai_vocab
from wp_api import models as _models
from wp_api import tags as _tags
from wp_api._model_index import search as _search_models
from wp_api._tag_index import CATEGORY_NAMES

_FOLDER = {"loras": "loras", "embeddings": "embeddings"}


def available(raw_flags: Any) -> set[str]:
    """The sources a request may use: switched on in the browser and with
    data behind them. The first call may build the tag index (a few MB of
    CSV), so routes run it in an executor."""
    out: set[str] = set()
    for kind in ai_vocab.flags(raw_flags):
        if kind == "tags":
            if _tags._get_index() is not None:
                out.add(kind)
        elif _models._hits(_FOLDER[kind]):
            out.add(kind)
    return out


def lookup(kind: str, query: str, limit: int) -> list[dict[str, Any]]:
    """`engine.ai.vocab.Lookup`. An empty query lists the first files
    alphabetically (LoRAs, embeddings) or nothing (tags)."""
    limit = max(1, min(int(limit), 50))
    if kind == "tags":
        idx = _tags._get_index()
        if idx is None:
            return []
        return [{"name": t.aliased_to or t.name, "matched": t.name, "count": t.count,
                 "category": CATEGORY_NAMES.get(t.category) if t.category is not None
                 else None} for t in idx.search(query, limit=limit)]
    if kind not in _FOLDER:
        return []
    hits = _models._hits(_FOLDER[kind])
    found = _search_models(hits, query, limit) if query.strip() else \
        sorted(hits, key=lambda h: h.name.lower())[:limit]
    return [{"name": h.name, "path": h.path} for h in found]
