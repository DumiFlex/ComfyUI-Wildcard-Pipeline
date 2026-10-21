"""The chat's `ask` tool: a few questions the user answers by clicking.

The model calls ``ask`` with up to 4 questions, each with 2-5 ready
answers. The server checks them here (`prepare`), the turn pauses like a
page tool (`meta.pending`), the drawer shows the questions inline
(`AiAsk.vue`) and the browser sends back only which answers were picked
(question and choice numbers, the user's own words, or "decide for me").
`result` turns that into one short line for the model and the decisions
the chat keeps (`meta["decisions"]`), which are never asked again and
survive compaction.

See `/pr-drafts/ai-chat-formatting-and-questions.md` §4.
"""
from __future__ import annotations

import re
from typing import Any

from engine.ai import safety

MAX_QUESTIONS = 4
MIN_CHOICES = 2
MAX_CHOICES = 5
MAX_HEADER = 24
MAX_QUESTION = 200
MAX_LABEL = 48
MAX_HINT = 120
MAX_OTHER = 300
#: Ask pauses per user message; past this the model decides itself.
MAX_ASKS = 2
#: Settled answers a chat keeps (oldest go first).
MAX_DECISIONS = 40

DECIDE = "you decide"
OWN_WORDS = "ask: the user answered in their own words in the next message"
TOO_MANY = ("ask: you already asked twice for this message. Don't ask again: decide "
            "yourself and say what you assumed.")
EXAMPLE = ('{"questions": [{"header": "Style", "question": "Which art style?", '
           '"choices": ["Anime", "Realistic: photo-like"]}]}')

#: Questions that ask nothing useful.
_GENERIC = re.compile(
    r"\b(?:anything else|any(?:thing)? other (?:preferences?|requests?|details?|questions?|"
    r"changes?|ideas?|wishes|requirements?)|anything (?:to add|i should know)|"
    r"(?:should|shall|can|may) i (?:proceed|go ahead|continue|start|begin|go on)|"
    r"(?:is|does) (?:that|this|it) (?:ok(?:ay)?|fine|alright|sound good|look good)|"
    r"ready (?:to|for me to) (?:proceed|go|start|begin))\b", re.I)
#: "Do you want me to …?" is a permission question when its answers are yes / no.
_PERMISSION = re.compile(
    r"\b(?:do you want me to|would you like me to|want me to|shall i|should i)\b", re.I)
_YES_NO = re.compile(
    r"^(?:yes|no|yeah|nope|sure|ok(?:ay)?|go ahead|proceed|do it|don'?t|not now|cancel|"
    r"yes,? please|no,? thanks)\b", re.I)
_NUMBERING = re.compile(r"^\s*(?:[-*•]|\d{1,2}[.)]|[a-eA-E][.)])\s+")
_PAREN_HINT = re.compile(r"^(.+?)\s*\(([^()]+)\)$")
_LEAD = re.compile(
    r"^(?:which|what|how many|how much|how|do you want|would you like|should (?:it|the|i|we)|"
    r"shall (?:i|we)|is|are|do|does)\s+", re.I)


class Settled(Exception):
    """Every question was answered before: the message is the call's result."""


def _text(value: Any, n: int) -> str:
    out = safety.strip_invisible(value) if isinstance(value, str) else ""
    out = " ".join(out.split())
    return out if len(out) <= n else out[: n - 1].rstrip() + "…"


def _key(text: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", text.lower()))


def _split(raw: str) -> tuple[str, str]:
    """"Label: hint", "Label - hint", "Label (hint)" → (label, hint)."""
    text = _NUMBERING.sub("", " ".join(raw.split()))
    for sep in (": ", " - ", " — ", " – "):
        if sep in text:
            label, hint = text.split(sep, 1)
            if label.strip() and hint.strip():
                return label.strip(), hint.strip()
    m = _PAREN_HINT.match(text)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return text.strip(), ""


def _choice(raw: Any, where: str) -> dict[str, str]:
    if isinstance(raw, dict):
        label = raw.get("label") or raw.get("text") or raw.get("value") or raw.get("name")
        hint = raw.get("hint") or raw.get("description") or ""
        if isinstance(label, str) and not hint:
            label, hint = _split(label)
        elif isinstance(label, str):
            label = _NUMBERING.sub("", label)
    elif isinstance(raw, (str, int, float)) and not isinstance(raw, bool):
        label, hint = _split(str(raw))
    else:
        raise ValueError(f"{where}: each choice is a label, \"Label: hint\" or "
                         "{\"label\", \"hint\"}")
    out = {"label": _text(label, MAX_LABEL)}
    if not out["label"]:
        raise ValueError(f"{where}: a choice has no label")
    hint = _text(hint, MAX_HINT)
    if hint:
        out["hint"] = hint
    return out


def _multi(raw: Any) -> bool:
    if isinstance(raw, str):
        return raw.strip().lower() in ("true", "yes", "1", "y")
    return raw is True


def _header(raw: Any, question: str) -> str:
    head = _text(raw, MAX_HEADER + 20) if isinstance(raw, str) else ""
    if not head:
        # Derived from the question: its first words after "which", "what", ….
        words = _LEAD.sub("", question.rstrip("?")).split()
        head = " ".join(words[:3])
        head = head[:1].upper() + head[1:]
    if len(head) > MAX_HEADER:
        cut = head.rfind(" ", 0, MAX_HEADER)
        head = head[:cut if cut > 4 else MAX_HEADER].rstrip(" ,;:-")
    return head


def _question(raw: Any, n: int) -> dict[str, Any]:
    where = f"question {n}"
    if isinstance(raw, str):
        raise ValueError(f"{where} has no choices: give each question 2-5 \"choices\", like "
                         + EXAMPLE)
    if not isinstance(raw, dict):
        raise ValueError(f"{where} must be an object, like " + EXAMPLE)
    text = _text(raw.get("question") or raw.get("q") or raw.get("text"), MAX_QUESTION)
    if not text:
        raise ValueError(f"{where} has no \"question\" text")
    if _GENERIC.search(text):
        raise ValueError(f"{where} ({text!r}) is too general. Ask only what changes what you "
                         "build; otherwise act and say what you assumed.")
    raw_choices = raw.get("choices", raw.get("options", raw.get("answers")))
    if isinstance(raw_choices, str):
        raw_choices = [c for c in re.split(r"\s*[|;\n]\s*", raw_choices) if c.strip()]
    if not isinstance(raw_choices, list):
        raise ValueError(f"{where} needs 2-5 \"choices\", like " + EXAMPLE)
    choices: list[dict[str, str]] = []
    seen: set[str] = set()
    for i, c in enumerate(raw_choices):
        got = _choice(c, f"{where} choice {i + 1}")
        k = got["label"].lower()
        if k not in seen:  # the same answer twice is one answer
            seen.add(k)
            choices.append(got)
    if not MIN_CHOICES <= len(choices) <= MAX_CHOICES:
        raise ValueError(f"{where} has {len(choices)} different choices; give 2-5 (the user "
                         "can also type their own or let you decide)")
    if _PERMISSION.search(text) and all(_YES_NO.match(c["label"]) for c in choices):
        raise ValueError(f"{where} asks permission. Don't: a proposal already waits for the "
                         "user's Apply, so make the change and say what you assumed.")
    return {"header": _header(raw.get("header"), text), "question": text,
            "multi": _multi(raw.get("multi", raw.get("multiple", raw.get("multiSelect")))),
            "choices": choices}


def settled_line(d: dict[str, Any]) -> str:
    return f"{d.get('header')} → {d.get('answer')}"


def _settled(q: dict[str, Any], decisions: list[dict[str, Any]]) -> dict[str, Any] | None:
    head, text = q["header"].lower(), _key(q["question"])
    for d in decisions:
        if str(d.get("header") or "").lower() == head or (
                text and _key(str(d.get("question") or "")) == text):
            return d
    return None


def prepare(args: dict[str, Any], decisions: list[dict[str, Any]] | None = None,
            ) -> tuple[dict[str, Any], str]:
    """(the questions for the browser, the steps-list label). Raises
    ValueError for a call to refuse, `Settled` when nothing is left to ask.
    Questions already answered are left out and named in ``settled``, which
    the model reads back with the answers."""
    raw = args.get("questions")
    if isinstance(raw, dict):
        raw = [raw]
    if not isinstance(raw, list) or not raw:
        raise ValueError("ask needs \"questions\", like " + EXAMPLE)
    if len(raw) > MAX_QUESTIONS:
        raise ValueError(f"ask takes at most {MAX_QUESTIONS} questions; you gave {len(raw)}. "
                         "Keep the ones that change what you build.")
    questions = [_question(q, i + 1) for i, q in enumerate(raw)]
    heads: set[str] = set()
    for q in questions:
        base, k = q["header"], 2
        while q["header"].lower() in heads:
            q["header"] = f"{base[:MAX_HEADER - 2]} {k}"
            k += 1
        heads.add(q["header"].lower())
    settled: list[str] = []
    left: list[dict[str, Any]] = []
    for q in questions:
        d = _settled(q, decisions or [])
        if d is None:
            left.append(q)
        else:
            settled.append(settled_line(d))
    if not left:
        raise Settled("ask: already answered: " + "; ".join(settled)
                      + ". Don't ask again; go on with those answers.")
    out: dict[str, Any] = {"questions": left}
    if settled:
        out["settled"] = settled
    n = len(left)
    label = f"Asked {n} question" + ("" if n == 1 else "s")
    return out, label


def _picked(q: dict[str, Any], raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    labels: list[str] = []
    for i in raw:
        if isinstance(i, int) and not isinstance(i, bool) and 0 <= i < len(q["choices"]):
            label = q["choices"][i]["label"]
            if label not in labels:
                labels.append(label)
    return labels if q.get("multi") else labels[:1]


def answers(cargs: dict[str, Any], answer: dict[str, Any]) -> list[dict[str, Any]]:
    """Each question's answer, from what the browser sent: ``{answers:
    [{q, picked: [choice numbers]} | {q, other: text} | {q, decide: true}]}``
    (numbers from 0). Only numbers are trusted: labels come from the stored
    call. A question with no usable answer is left to the model."""
    questions = cargs.get("questions") or []
    got: dict[int, dict[str, Any]] = {}
    for a in answer.get("answers") or [] if isinstance(answer.get("answers"), list) else []:
        if isinstance(a, dict) and isinstance(a.get("q"), int) and not isinstance(a["q"], bool):
            got.setdefault(a["q"], a)
    out: list[dict[str, Any]] = []
    for i, q in enumerate(questions):
        a = got.get(i) or {}
        entry = {"header": q["header"], "question": q["question"]}
        other = _text(a.get("other"), MAX_OTHER) if isinstance(a.get("other"), str) else ""
        picked = _picked(q, a.get("picked"))
        if other and not a.get("decide"):
            entry.update(answer=f"\"{other}\"", by="user", own=True)
        elif picked and not a.get("decide"):
            entry.update(answer=", ".join(picked), by="user")
        else:
            entry.update(answer=DECIDE, by="assistant")
        out.append(entry)
    return out


def result_text(cargs: dict[str, Any], got: list[dict[str, Any]]) -> str:
    """The one line the model reads back."""
    parts = []
    for a in got:
        if a["by"] == "assistant":
            parts.append(f"{a['header']} → you decide (choose, and say what you chose)")
        elif a.get("own"):
            parts.append(f"{a['header']} → {a['answer']} (their own words)")
        else:
            parts.append(f"{a['header']} → {a['answer']}")
    text = "ask: The user answered: " + "; ".join(parts)
    if cargs.get("settled"):
        text += ". Already answered before: " + "; ".join(cargs["settled"])
    return text


def settle(decisions: Any, got: list[dict[str, Any]], call: str = "") -> list[dict[str, Any]]:
    """The chat's decisions with these answers added (a header answered
    again replaces its old answer), at most MAX_DECISIONS. `call` is the ask
    call's id, so Try again can drop the answers its turn gave."""
    out = [d for d in decisions if isinstance(d, dict)] if isinstance(decisions, list) else []
    for a in got:
        out = [d for d in out if str(d.get("header") or "").lower() != a["header"].lower()]
        d = {"header": a["header"], "question": a["question"], "answer": a["answer"],
             "by": a["by"]}
        if call:
            d["call"] = call
        out.append(d)
    return out[-MAX_DECISIONS:]


def shown(got: list[dict[str, Any]]) -> dict[str, Any]:
    """What a reopened chat shows for an answered ask."""
    return {"answers": [{"header": a["header"], "answer": a["answer"]} for a in got]}


def decisions_text(decisions: Any) -> str:
    """The settled answers as lines for a compacted summary, or ""."""
    rows = [d for d in decisions if isinstance(d, dict)] if isinstance(decisions, list) else []
    if not rows:
        return ""
    return ("Settled answers (the user answered these; never ask them again):\n"
            + "\n".join(f"- {settled_line(d)}" for d in rows))


#: What a page call that waits for a step's ask reads back.
DEFERRED = ("not run: this step also asks the user, and the ask goes first. Make this "
            "call again after their answers if you still need it.")


def deferred_page_calls(calls: list[dict[str, Any]], *, change: tuple[str, ...],
                        pause: tuple[str, ...], web: tuple[str, ...]) -> set[int]:
    """Page calls (open, read_page, highlight…) sent in one step with an
    ask, which wait so the ask runs alone, else empty. Small models send
    ``open`` + ``ask`` together every time and the refusal never got them
    to ask: the questions box never showed. Not with change tools or web
    tools, which keep their refusal (asking is meant to come before
    building, and a web call needs the user's Allow)."""
    tools = [c["tool"] for c in calls]
    if tools.count("ask") != 1 or any(t in change or t in web for t in tools):
        return set()
    return {i for i, t in enumerate(tools) if t != "ask" and t in pause}


def step_problem(calls: list[dict[str, Any]], index: int, *, change: tuple[str, ...],
                 pause: tuple[str, ...]) -> str:
    """Why the ask at ``calls[index]`` can't run in this step, else ""."""
    others = [c["tool"] for i, c in enumerate(calls) if i != index]
    if any(t in change for t in others):
        return ("ask first, then propose: ask can't share a step with change tools. Ask alone "
                "(after any reads), then build with the answers.")
    if any(t in pause for t in others if t != "ask"):
        return "ask can't share a step with page tools or web_search; call those first."
    if index != len(calls) - 1:
        return "put ask last in its step, after any reads, and ask once per step."
    return ""
