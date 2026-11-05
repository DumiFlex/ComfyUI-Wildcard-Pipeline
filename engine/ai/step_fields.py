"""Step fields a JSON-mode reply leaks into its message text.

A model answering in JSON steps (`{"plan", "message", "calls"}`) sometimes
writes the rest of the step into "message" as well: the reply then ends
with ``calls: []``, ``**calls**: []``, ``"calls": []}`` or the calls list
itself, and the drawer showed it. `strip_step_fields` takes those lines off
the start and end of the text; the words in between are left alone, and a
line inside a code fence never counts (the last line is then the fence).

Mirrored in TS at `src/manager/utils/chat-step-fields.ts` (for stored chats
and live text) via `tests/fixtures/step-fields-corpus.json`.
"""
from __future__ import annotations

import json
import re

_DECODER = json.JSONDecoder()
#: Markup a model puts around a key or value: bold, code, quotes.
_WRAP = r"(?:\*\*|__|[`\"'])*"
#: A field line: optional bullet or quote mark, the key, `:` or `=`, the rest.
_FIELD = re.compile(
    r"^[ \t]*(?:[-*+>][ \t]+)?" + _WRAP
    + r"[ \t]*(calls|tool_calls|function_calls|plan|say|message)[ \t]*" + _WRAP
    + r"[ \t]*[:=][ \t]*(.*?)[ \t]*$", re.I)
#: A value that says nothing: empty, an empty list or object, null, "".
_EMPTY = re.compile(r"^" + _WRAP + r"[ \t]*(?:\[[ \t]*\]|\{[ \t]*\}|null|none|nil|n/a|)?[ \t]*"
                    + _WRAP + r"[ \t]*,?$", re.I)
#: The JSON tail of a step glued to the last words: `…", "calls": []}`.
_JSON_TAIL = re.compile(
    r"[\"\s,]*\"(?:calls|tool_calls|plan|say)\"\s*:\s*(?:\[\s*\]|\{\s*\}|null|\"\")\s*\}?\s*$",
    re.I)
_CALL_KEYS = {"calls", "tool_calls", "function_calls"}


def _json_rest(text: str) -> bool:
    """`text` (from a calls key's value on) is a JSON list or object, or the
    start of one cut off mid-stream, with nothing but closing marks after."""
    text = text.strip().strip("`")
    if not text.startswith(("[", "{")):
        return False
    try:
        _, end = _DECODER.raw_decode(text)
    except ValueError:
        # A list still being written (live text), on one line.
        return "\n" not in text
    return not text[end:].strip(" \t\n,}]`")


def _drop_tail(lines: list[str]) -> bool:
    """Drop the trailing field, if the last lines are one."""
    last = lines[-1]
    m = _FIELD.match(last)
    if m and _EMPTY.match(m.group(2)):
        lines.pop()
        return True
    # A calls list, maybe over several lines: find where it starts.
    for i in range(len(lines) - 1, max(-1, len(lines) - 200), -1):
        if lines[i].lstrip().startswith("```"):
            return False
        m = _FIELD.match(lines[i])
        if m and m.group(1).lower() in _CALL_KEYS:
            rest = "\n".join([m.group(2), *lines[i + 1:]])
            if _json_rest(rest):
                del lines[i:]
                return True
            return False
    return False


def strip_step_fields(text: str) -> str:
    """`text` without the step fields written around its words."""
    if not isinstance(text, str) or not text.strip():
        return text if isinstance(text, str) else ""
    out = text.rstrip()
    while True:
        cut = _JSON_TAIL.sub("", out).rstrip()
        if cut == out:
            break
        out = cut
    lines = out.split("\n")
    while lines and _drop_tail(lines):
        while lines and not lines[-1].strip():
            lines.pop()
    while lines:
        m = _FIELD.match(lines[0])
        if not (m and _EMPTY.match(m.group(2))):
            break
        lines.pop(0)
        while lines and not lines[0].strip():
            lines.pop(0)
    joined = "\n".join(lines)
    return text if joined == text.rstrip() else joined.strip()
