"""Per-site random streams for the resolver.

A resolve context that carries a `stream_key` gives every pick site its
own RNG, derived from the key plus the site: the token text, the words
right after it, and how many identical sites came before it. So a
`{a|b}` rolls the same whether or not an earlier rule fired, an earlier
value was added or an earlier pick gained an option. Recursion extends
the key, so a pick inside a ref or a branch is its own site too.

A context without a `stream_key` (unit tests, the corpus, previews) keeps
the old single shared stream.
"""
from __future__ import annotations

import hashlib
import random
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any


def stream_rng(key: str) -> random.Random:
    digest = hashlib.sha256(key.encode()).hexdigest()
    return random.Random(int(digest[:16], 16))


@contextmanager
def sub_stream(ctx: Any, label: str) -> Iterator[None]:
    """Run the body on the child stream `label` of ctx's current stream.

    No-op when ctx has no stream key. Restores the parent stream after,
    so whatever the body draws never moves the parent's next draw.
    """
    base = getattr(ctx, "stream_key", None)
    if not base:
        yield
        return
    key = f"{base}|{label}"
    saved = ctx.rng
    ctx.rng = stream_rng(key)
    ctx.stream_key = key
    try:
        yield
    finally:
        ctx.rng = saved
        ctx.stream_key = base


def site_label(raw: str, after: str, seen: dict[str, int]) -> str:
    """A pick site's label: its token text, the words right after it, and
    how many identical sites came before. The words tell two identical
    picks apart ("@{Colors} jacket" vs "@{Colors} jeans"), so adding one
    never moves the other; the count settles exact repeats."""
    site = f"{raw}>{after.strip()}"
    n = seen.get(site, 0)
    seen[site] = n + 1
    return f"{site}#{n}"
