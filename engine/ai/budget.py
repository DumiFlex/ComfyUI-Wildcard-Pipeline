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
    # `two_phase`: on a server that checks schemas, a JSON step is asked in
    # two parts, first which one tool (at chat_temp), then its arguments or
    # the answer (at write_temp), so the choice isn't made while writing.
    "small": {"chat_temp": 0.15, "result_chars": 3500, "history_chars": 14000, "slim": True,
              "scoped": True, "two_phase": True, "write_temp": 0.4},
    # Medium models pick better among fewer tools too: the page's tools plus
    # the common ones, the rest one more_tools call away.
    "medium": {"chat_temp": 0.25, "result_chars": 7000, "history_chars": 30000, "slim": False,
               "scoped": True},
    "large": {"chat_temp": 0.4, "result_chars": 14000, "history_chars": 90000, "slim": False,
              "scoped": False},
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


#: Room a chat keeps beside its fixed part (instructions, tools, library
#: summary): the answer, the user's message and a tool result.
CHAT_RESERVE = 4096
#: How lean a new chat's fixed part gets when the model's window is small,
#: leanest last: the size's own prompt; the small-model prompt and tool set
#: with a 40-item library summary; that with a 12-item summary and no
#: examples. A chat keeps the level it started with (`meta["lean"]`), so
#: its prompt prefix stays the same for caching.
LEVELS: tuple[dict[str, Any], ...] = (
    {},
    {"slim": True, "overview": 40},
    {"slim": True, "overview": 12, "examples": False},
)


def fits(fixed_chars: int, window: int) -> bool:
    """Whether a chat whose fixed part is `fixed_chars` leaves room for a
    turn in a `window`-token model."""
    return tokens(fixed_chars) + CHAT_RESERVE <= window


def room_chars(window: int, fixed_chars: int) -> int:
    """Characters of history and tool results a turn can carry beside the
    fixed part (never under 2000, so the newest result still shows)."""
    return max(2000, int((window - tokens(fixed_chars) - CHAT_RESERVE) * CHARS_PER_TOKEN))


def suggest_window(fixed_chars: int) -> int:
    """The smallest power-of-two window a chat with this fixed part runs in."""
    need = tokens(fixed_chars) + CHAT_RESERVE * 2
    size = CONTEXT_MIN
    while size < need and size < CONTEXT_MAX:
        size *= 2
    return size


_OVERFLOW = (
    # llama.cpp / LM Studio: "request (17339 tokens) exceeds the available
    # context size (16384 tokens)", with n_prompt_tokens / n_ctx alongside.
    re.compile(r"request \((\d+) tokens\) exceeds the available context size \((\d+) tokens\)"),
    re.compile(r'"n_prompt_tokens"\s*:\s*(\d+)\s*,\s*"n_ctx"\s*:\s*(\d+)'),
    # OpenAI-style servers (vLLM, OpenRouter): "maximum context length is
    # 16384 tokens. However, you requested 17339 tokens".
    re.compile(r"maximum context length is (\d+) tokens.{0,80}?requested (\d+) tokens", re.S),
)


def overflow(message: str) -> tuple[int, int] | None:
    """(prompt tokens, window) when a server refused a request for not
    fitting its context window, else None."""
    for i, rx in enumerate(_OVERFLOW):
        m = rx.search(message or "")
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            return (b, a) if i == 2 else (a, b)
    if re.search(r"exceed_context_size|context (?:size|length|window) exceeded", message or "",
                 re.I):
        return (0, 0)
    return None


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
