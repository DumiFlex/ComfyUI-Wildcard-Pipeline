"""What a module is for, as the prompts show it.

A module's description and its library tags (the labels on the module itself,
not its options' tags) say what it is meant for: "outfits for a cozy winter
set", tagged ``fantasy, portrait``. Every AI request passes them on so the
model writes in that direction instead of guessing from the name alone.
"""
from __future__ import annotations

import re
from typing import Any

MAX_DESCRIPTION = 600
MAX_LABELS = 20


def clean(description: Any, tags: Any) -> tuple[str, list[str]]:
    """Request fields → (description, labels), trimmed and capped."""
    desc = re.sub(r"\s+", " ", description).strip() if isinstance(description, str) else ""
    labels = [
        t.strip() for t in (tags if isinstance(tags, list) else [])
        if isinstance(t, str) and t.strip()
    ]
    return desc[:MAX_DESCRIPTION], list(dict.fromkeys(labels))[:MAX_LABELS]


def lines(description: str, labels: list[str], *, indent: str = "") -> list[str]:
    """Prompt lines for a module's description and labels (none when empty)."""
    out: list[str] = []
    if description:
        out.append(f"{indent}Description: {description}")
    if labels:
        out.append(f"{indent}Labels (the module's own tags): {', '.join(labels)}")
    return out
