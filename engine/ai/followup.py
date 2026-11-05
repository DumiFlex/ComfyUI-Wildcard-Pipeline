"""Follow-ups: refine an answer instead of asking from scratch.

The editor keeps the conversation and sends it back with each follow-up:

    history: [{"instruction": str, "answer": {...}, "note"?: str}, ...]

oldest first. `answer` is the model's own raw answer for that turn (every
route returns it next to the compiled result) and `note` says what the user
did with it (which items they kept). The server rebuilds the first prompt
from the first instruction, replays the answers as the model's turns, and
sends the new instruction as a follow-up asking for a complete revised
answer, so every compiler keeps working on a full answer.
"""
from __future__ import annotations

import json
from typing import Any

#: Earlier turns a follow-up may carry.
MAX_TURNS = 8
#: Size of one earlier answer, as JSON.
MAX_ANSWER_CHARS = 60_000
MAX_NOTE = 2000
MAX_INSTRUCTION = 2000


class HistoryError(ValueError):
    """The history the editor sent can't be used. The message is shown."""


def parse_history(raw: Any) -> list[dict[str, Any]]:
    """Validated turns, oldest first. Missing means a fresh request."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise HistoryError("history must be a list")
    if len(raw) > MAX_TURNS:
        raise HistoryError(
            f"that conversation is {len(raw)} answers long; start over to keep it focused",
        )
    turns: list[dict[str, Any]] = []
    for t in raw:
        if not isinstance(t, dict):
            raise HistoryError("each earlier turn must be an object")
        instruction = t.get("instruction", "")
        answer = t.get("answer")
        note = t.get("note", "")
        if not isinstance(instruction, str) or len(instruction) > MAX_INSTRUCTION:
            raise HistoryError("an earlier request is too long")
        if not isinstance(answer, dict):
            raise HistoryError("an earlier answer is missing")
        if len(json.dumps(answer, ensure_ascii=False)) > MAX_ANSWER_CHARS:
            raise HistoryError("an earlier answer is too large to send back")
        if not isinstance(note, str):
            note = ""
        turns.append({"instruction": instruction, "answer": answer, "note": note[:MAX_NOTE]})
    return turns


def first_instruction(turns: list[dict[str, Any]], instruction: str) -> str:
    """What the conversation started with: the first prompt is built from it."""
    return turns[0]["instruction"] if turns else instruction


def follow_up_text(instruction: str, note: str = "") -> str:
    lines: list[str] = []
    if note.strip():
        lines.append(f"What the user did with your last answer: {note.strip()}")
        lines.append("")
    if instruction.strip():
        lines.append("Follow-up from the user:")
        lines.append(instruction.strip())
    else:
        lines.append("The user wants another take on your last answer.")
    lines.append("")
    lines.append(
        "Answer again in the same format with the complete revised answer. It "
        "replaces your last one, so include everything that should stay and change "
        "only what the follow-up asks for. The request and rules from the first "
        "message still apply.",
    )
    return "\n".join(lines)


def conversation(
    first_prompt: str, turns: list[dict[str, Any]], instruction: str,
) -> tuple[list[tuple[str, Any]], str]:
    """``(history, user)`` for `complete_json`: earlier (asked, answer) pairs
    and the message to send now."""
    if not turns:
        return [], first_prompt
    pairs: list[tuple[str, Any]] = [(first_prompt, turns[0]["answer"])]
    for prev, turn in zip(turns, turns[1:], strict=False):
        pairs.append((follow_up_text(turn["instruction"], prev["note"]), turn["answer"]))
    return pairs, follow_up_text(instruction, turns[-1]["note"])
