"""Plan once, code loops: a small model's multi-item ask made one item per
step (research note "Small model tool use", T1).

A small model asks each step for one call (`budget` profile ``act_calls``
1) within a few steps, so "make five wildcards" could never finish: it
made two, read something, and ran out of steps. Here the first step of
such an ask may only list the items (`plan_tool`, a call the turn
intercepts); code then keeps the list (`ItemQueue`) and asks for one item
per step, offering only that item's tool and the read tools, and saying
what is done and what is left. The model writes each item's content;
code owns the order, the count and when it is finished.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from engine.ai.tools.registry import Tool, arr, obj, s

TOOL = "plan_items"
#: The most items one plan holds (a card each; `chat.MAX_PROPOSALS` is 12).
MAX_ITEMS = 8
#: The most steps an answer with a plan may take.
MAX_STEPS = 20
#: Steps one item may take (reads included) before it is skipped.
MAX_TRIES = 3
#: Change tools a plan may list: one item each. Whole-library tools
#: (deletes, many-at-once, tag renames) and the Pack builder are not items.
PLANNABLE = ("create_wildcard", "add_options", "edit_options", "create_derivation",
             "add_rules", "edit_rules", "create_constraint", "edit_constraint",
             "create_fixed_values", "edit_values", "create_combine", "edit_combine",
             "create_template", "edit_template", "create_bundle", "edit_bundle",
             "update_info")
#: Read tools an item's step may call before making it.
ITEM_READS = ("read", "search", "variables")

_NOUN = (r"(?:wildcards?|fixed[ -]?values?|derivations?|constraints?|combines?|templates?"
         r"|bundles?|presets?)")
_WORDS = {"two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
          "nine": 9, "ten": 10, "a couple of": 2, "a few": 3, "several": 4, "some": 3}
#: Up to three words between a count and its noun ("5 short weather
#: wildcards"), none of them one that makes the count about something
#: else ("50 options for a wildcard").
_GAP = r"(?:(?!(?:for|of|in|to|with|from|options?|tags?|rules?|values)\b)[\w-]+\s+){0,3}?"
_COUNT = re.compile(
    r"\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|a couple of|a few|several"
    r"|some)\s+" + _GAP + _NOUN + r"\b", re.I)
_VERB = re.compile(r"\b(?:make|create|build|write|generate|set\s+up|add|give\s+me|draft|"
                   r"propose|need|want)\b", re.I)
#: "wildcards for hair, eyes, outfit and pose": a plural noun and a list.
_LIST = re.compile(_NOUN + r"\s+(?:for|about|of|covering|:)\s+([^.?!\n]+)", re.I)
_ONE = re.compile(r"\b(?:a|an|one|another)\s+" + _GAP + _NOUN + r"\b", re.I)
#: A whole pack goes to the Pack builder (`_ai_turn._PACK_ASK`).
_PACK = re.compile(r"\bpacks?\b", re.I)


def multi_ask(text: str) -> int:
    """How many items a message asks to make (2 to `MAX_ITEMS`), or 0 when
    it isn't a request for several items. "make 5 wildcards", "three
    derivations", "wildcards for hair, eyes and pose", "a wildcard and a
    constraint"."""
    if not text or not _VERB.search(text) or _PACK.search(text):
        return 0
    # Counted nouns plus single ones: "two fixed values and a template" is 3.
    best, spans = 0, []
    for m in _COUNT.finditer(text):
        word = m.group(1).lower()
        best += int(word) if word.isdigit() else _WORDS.get(word, 0)
        spans.append(m.span())
    best += sum(1 for m in _ONE.finditer(text)
                if not any(a <= m.start() < b for a, b in spans))
    for m in _LIST.finditer(text):
        parts = [p for p in re.split(r",|\band\b|&|/", m.group(1)) if p.strip()]
        if len(parts) >= 2 and re.match(r"[\w-]+s\b|fixed", m.group(0), re.I):
            best = max(best, len(parts))
    return min(best, MAX_ITEMS) if best >= 2 else 0


def plan_tool(names: list[str], count: int) -> Tool:
    """The plan call a multi-item ask's first step must make, offering the
    chat's own change tools that make one item each."""
    choices = [n for n in names if n in PLANNABLE]
    item = obj({"tool": s("the tool that makes this item", enum=choices),
                "name": s("the item's name"),
                "about": s("what it holds or changes, in a few words")},
               ("tool", "name", "about"))
    items = arr(item, "one entry per item, in the order to make them")
    items.update(minItems=1, maxItems=max(1, min(count or MAX_ITEMS, MAX_ITEMS)))
    return Tool(TOOL, "read", "List the items to make, one per entry; each is made next.",
                '{"items": [{"tool", "name", "about"}]}: the items, in order.',
                obj({"items": items}, ("items",)))


#: Told with the user's message when its first step must plan.
HINT = ("(This message asks for several items. Your first call is plan_items: list every item "
        "to make, one entry each, with the tool that makes it. Then you make them one per "
        "step.)")


@dataclass
class ItemQueue:
    """The items still to make, owned by code across the turn's steps."""

    items: list[dict[str, str]]
    at: int = 0
    tries: int = 0
    done: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)

    @classmethod
    def from_args(cls, args: Any, offered: list[str]) -> ItemQueue | None:
        """The plan's items the chat can make (known tool, a name, no
        repeats); None when none are left."""
        raw = args.get("items") if isinstance(args, dict) else None
        items: list[dict[str, str]] = []
        seen: set[tuple[str, str]] = set()
        for it in raw if isinstance(raw, list) else []:
            if not isinstance(it, dict):
                continue
            tool, name = str(it.get("tool") or ""), str(it.get("name") or "").strip()
            if tool not in PLANNABLE or tool not in offered or not name:
                continue
            key = (tool, name.lower())
            if key in seen:
                continue
            seen.add(key)
            items.append({"tool": tool, "name": name[:80],
                          "about": str(it.get("about") or "").strip()[:200]})
        return cls(items[:MAX_ITEMS]) if items else None

    @property
    def active(self) -> bool:
        return self.at < len(self.items)

    def current(self) -> dict[str, str] | None:
        return self.items[self.at] if self.active else None

    def allowed(self) -> list[str]:
        """What the current item's step may call: its tool and the reads."""
        cur = self.current()
        return [cur["tool"], *ITEM_READS] if cur else []

    def steps_left(self) -> int:
        """Steps the rest of the plan may take, at most."""
        return (len(self.items) - self.at) * MAX_TRIES

    def after_step(self, made: bool) -> None:
        """One item step ran: `made` when it proposed a card."""
        cur = self.current()
        if cur is None:
            return
        if made:
            self.done.append(cur["name"])
        else:
            self.tries += 1
            if self.tries < MAX_TRIES:
                return
            self.skipped.append(cur["name"])
        self.at += 1
        self.tries = 0

    def note(self) -> str:
        """What the next step is told: the item to make now, or that the
        plan is finished."""
        done = f" Done: {', '.join(self.done)}." if self.done else ""
        cur = self.current()
        if cur is None:
            skipped = (f" Not made: {', '.join(self.skipped)} (say why in your answer)."
                       if self.skipped else "")
            return (f"\n\nYour plan is finished.{done}{skipped} Answer the user now: say "
                    "what you proposed.")
        left = [it["name"] for it in self.items[self.at + 1:]]
        about = f": {cur['about']}" if cur["about"] else ""
        later = f" Left after it: {', '.join(left)}." if left else " It is the last one."
        return (f"\n\nPlan item {self.at + 1} of {len(self.items)}: {cur['tool']} "
                f"\"{cur['name']}\"{about}. Make only this item now with {cur['tool']} (read "
                f"or search first only if you need to).{done}{later}")

    def started(self) -> str:
        """The plan call's result."""
        names = ", ".join(f"{i + 1}. {it['name']}" for i, it in enumerate(self.items))
        return f"{TOOL}: noted {len(self.items)} items ({names}); you make them one per step."
