"""How much a model can hold, and how hard to push it.

Local servers keep a fixed context window and quietly cut a prompt that
doesn't fit (Ollama's default is 2-4k tokens; the chat's first step alone is
about 5k). So every request sizes the window it needs (`num_ctx`), and the
chat keeps its history inside a budget. A profile per model size decides
how much each prompt carries: a 9B model gets a short prompt, a low
temperature and small tool results; a 27B model or a cloud model gets all
of it.
"""
from __future__ import annotations

import json
import re
from typing import Any

#: Characters per token, on the low side: ids, JSON and tags tokenize worse
#: than prose, and asking for too little context is what goes wrong.
CHARS_PER_TOKEN = 3.2
#: Room left for the answer when sizing the window.
ANSWER_TOKENS = 3072
CONTEXT_MIN = 4096
CONTEXT_MAX = 131072
CONTEXT_DEFAULT = 16384

SIZES = ("small", "medium", "large")

#: What each size gets. `chat_temp` is for picking tools (low = steadier);
#: writing tasks keep their own temperatures. `result_chars` caps one tool
#: result, `history_chars` the earlier steps the chat re-sends.
PROFILES: dict[str, dict[str, Any]] = {
    "small": {"chat_temp": 0.15, "result_chars": 3500, "history_chars": 14000, "slim": True},
    "medium": {"chat_temp": 0.25, "result_chars": 7000, "history_chars": 30000, "slim": False},
    "large": {"chat_temp": 0.4, "result_chars": 14000, "history_chars": 90000, "slim": False},
}

_PARAMS = re.compile(r"(?<![\d.])(\d+(?:\.\d+)?)\s*b(?![a-z])", re.IGNORECASE)
_ACTIVE = re.compile(r"\ba(\d+(?:\.\d+)?)b\b", re.IGNORECASE)


def size_from_name(model: str) -> str | None:
    """'qwen3.6-27b-heretic' → large, 'gemma-4-12b' → small. The largest
    "<N>b" in the name is the total size; a MoE's active size ("a3b") is not
    counted. None when the name doesn't say."""
    name = model.lower().replace("_", "-")
    active = {m.group(1) for m in _ACTIVE.finditer(name)}
    sizes = [
        float(m.group(1)) for m in _PARAMS.finditer(name)
        if not (m.start() > 0 and name[m.start() - 1] == "a" and m.group(1) in active)
    ]
    if not sizes:
        return None
    total = max(sizes)
    if total < 20:
        return "small"
    if total < 60:
        return "medium"
    return "large"


def model_size(cfg: dict[str, Any]) -> str:
    """The size the user set, else the name's, else medium for a local
    server and large for a cloud provider."""
    chosen = cfg.get("model_size")
    if chosen in SIZES:
        return str(chosen)
    if not cfg.get("local"):
        return "large"
    return size_from_name(str(cfg.get("model") or "")) or "medium"


def profile(cfg: dict[str, Any]) -> dict[str, Any]:
    return {"size": model_size(cfg), **PROFILES[model_size(cfg)]}


def tokens(chars: int) -> int:
    return int(chars / CHARS_PER_TOKEN) + 1


def num_ctx(prompt_chars: int, cap: int, *, answer_tokens: int = ANSWER_TOKENS) -> int:
    """The window a request needs: prompt + answer, rounded up to a power of
    two (so Ollama reuses a loaded model instead of reloading it for every
    slightly different size), between CONTEXT_MIN and the user's cap."""
    need = tokens(prompt_chars) + answer_tokens
    size = CONTEXT_MIN
    while size < need and size < CONTEXT_MAX:
        size *= 2
    return max(CONTEXT_MIN, min(size, cap))


def prompt_chars(system: str, history: list[tuple[str, Any]], user: str,
                 schema: dict[str, Any] | None = None) -> int:
    total = len(system) + len(user)
    for asked, answer in history:
        total += len(asked) + len(json.dumps(answer, ensure_ascii=False))
    if schema is not None:
        total += len(json.dumps(schema))
    return total


def clip(text: str, limit: int) -> str:
    """Keep the start of a long tool result and say what was left out."""
    if len(text) <= limit:
        return text
    cut = text.rfind("\n", 0, limit)
    if cut < limit // 2:
        cut = limit
    left = text[cut:].count("\n") + 1
    return (text[:cut] + f"\n… ({left} more lines left out to save room; "
            "read a narrower part if you need them)")


def fit_history(history: list[tuple[str, Any]], limit: int,
                keep_last: int = 1) -> list[tuple[str, Any]]:
    """Shorten the oldest tool results until the history fits `limit`.

    The model keeps every step's own answer (what it called and said); only
    the results it was shown are cut, oldest first, down to their first
    line. The last `keep_last` steps stay whole.
    """
    def size(h: list[tuple[str, Any]]) -> int:
        return prompt_chars("", h, "")

    out = list(history)
    for i in range(max(0, len(out) - keep_last)):
        if size(out) <= limit:
            break
        asked, answer = out[i]
        if len(asked) > 400:
            first = asked.split("\n", 2)
            head = "\n".join(first[:2])[:300]
            out[i] = (head + "\n… (older tool results left out to save room)", answer)
    return out
