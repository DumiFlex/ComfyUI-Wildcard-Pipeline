"""Short playbooks for common asks, sent with the message they fit (research
note "Small model tool use", T10).

A small model follows three numbered steps it is handed for this ask far
better than the general guide it read at the start of the chat. Each
recipe is matched on the user's words; at most one goes with a message,
and only to small and medium models (`_ai_turn`).
"""
from __future__ import annotations

import re

#: (name, what the message says, the steps). First match wins.
RECIPES: tuple[tuple[str, re.Pattern[str], str], ...] = (
    ("never", re.compile(r"\b(?:never|rarely|hardly ever|almost never)\s+(?:get|gets|see|"
                         r"shows?|comes? up|picks?|picked)\b|\bwhy (?:don't|doesn't|do i "
                         r"never)\b", re.I),
     "1. read the wildcard that should give it. 2. run_test a stack with it (and the items "
     "before it) to see options never picked and the warnings. 3. Answer with the cause (a "
     "weight, a constraint, a filter) and propose the fix."),
    ("warnings", re.compile(r"\b(?:warnings?|conflicts?|errors?)\b.*\b(?:fix|why|mean|explain)"
                            r"\b|\b(?:fix|explain)\b.*\b(?:warnings?|conflicts?)\b", re.I),
     "1. run_test the stack to get the warnings with counts. 2. read the items they name. 3. "
     "Propose one fix per warning, and say what each warning meant."),
    ("negatives", re.compile(r"\bnegatives?\b", re.I),
     "1. read the item to see its option numbers. 2. edit_options with \"negatives\": "
     "[{\"n\", \"negative\"}] (fixed values: edit_values). 3. Say which options got which "
     "negative."),
    ("rename_var", re.compile(r"\brename\b.*\$?\w+.*\bvariable\b|\bvariable\b.*\brename\b",
                              re.I),
     "1. variables {\"var\"} to list every item that sets or reads it. 2. Propose a change to "
     "each of them. 3. Say what else reads it, if anything stays."),
    ("weights", re.compile(r"\b(?:rarer|more often|less often|more common|less common|"
                           r"weights?|odds|chance)\b", re.I),
     "1. read the wildcard for its option numbers. 2. edit_options with \"weights\": "
     "[{\"n\", \"weight\"}] (1 is normal, 0.3 rare, 3 common). 3. Say the old and new odds."),
    ("how_to", re.compile(r"^\s*(?:how (?:do|can|does|to)|what (?:is|are|does)|explain)\b",
                          re.I),
     "1. explain {\"topic\"} (or docs_search then docs_read). 2. Answer from that section in "
     "your own words, with the link as Docs › page › section. Don't propose changes unless "
     "asked."),
)


def recipe(text: str) -> str:
    """The steps for the first recipe the message fits, or ""."""
    for _name, pat, steps in RECIPES:
        if pat.search(text or ""):
            return f"(Steps that work for this kind of ask: {steps})"
    return ""
