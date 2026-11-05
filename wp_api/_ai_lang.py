"""The request frame call (`engine/ai/lang.py`): one small typed call that
turns a message the gate doesn't read as English into an English
restatement and a few fields, for the code checks.

`frame` asks the model, or returns None when the message is English (or
Settings says so), when the call fails, or when its answer is unusable;
the checks then read the raw text as before. Answers are kept per model
and text for the session (`_CACHE`), so the Pack builder's later calls,
which send the request back, and a retried chat message don't ask again.
"""
from __future__ import annotations

from collections import OrderedDict
from typing import Any

from engine.ai import lang as ai_lang
from wp_api import _ai_client

#: Answers kept, newest last: (provider, model, text) → frame.
_CACHE: OrderedDict[tuple[str, str, str], dict[str, Any]] = OrderedDict()
CACHE_SIZE = 128
#: The form is short: room for the restatement and the fields.
MAX_TOKENS = 700
#: Longer messages are cut for the call (the restatement is for checks).
MAX_CHARS = 2400


def setting(cfg: dict[str, Any]) -> str:
    got = cfg.get("request_language")
    return got if got in ai_lang.LANGUAGES else "auto"


async def frame(cfg: dict[str, Any], text: Any, emit: Any = None) -> dict[str, Any] | None:
    """The request frame for ``text``, or None (see the module docstring).
    ``emit``: the chat's stream, told while the call runs."""
    if not isinstance(text, str) or not ai_lang.needs_frame(text, setting(cfg)):
        return None
    text = text.strip()
    key = (str(cfg.get("provider") or ""), str(cfg.get("model") or ""), text)
    if key in _CACHE:
        _CACHE.move_to_end(key)
        return _CACHE[key]
    if emit:
        await emit({"type": "status", "v": "Reading the request"})
    try:
        raw = await _ai_client.complete_json(
            cfg, system=ai_lang.SYSTEM_PROMPT,
            user=ai_lang.frame_prompt(text[:MAX_CHARS]), schema=ai_lang.SCHEMA,
            schema_name="request_frame", temperature=0.0, max_tokens=MAX_TOKENS, quick=True)
    except _ai_client.AIError:
        return None
    got = ai_lang.compile_frame(raw, text)
    if got is None:
        return None
    _CACHE[key] = got
    while len(_CACHE) > CACHE_SIZE:
        _CACHE.popitem(last=False)
    return got


async def check_text(cfg: dict[str, Any], text: Any) -> str:
    """What the English checks read for ``text``: its restatement when it
    isn't English, else the text itself."""
    got = await frame(cfg, text)
    return ai_lang.check_text(got, text if isinstance(text, str) else "")
