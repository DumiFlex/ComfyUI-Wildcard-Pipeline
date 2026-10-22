"""Best of N plan drafts: the planner is asked several times on the first
plan and the code keeps the draft that fits the request best.

A small model's plans vary a lot from one sample to the next: one draft
names every part the request asked for and wires the rule it gave, the
next drops the rule or a slot. Choosing is what code does well, so
``score_plan`` grades a compiled graph plan with no model call:

- relations that named nothing (``bad_refs``, after the repair call);
- the review's ``fix`` findings (what Fix all would have to change);
- request words the graph says nowhere (``request_gaps``);
- a request that states a rule ("never", "only", "matches") with no
  relation in the plan;
- slots and relations the compile left out;
- a plan with fewer than two prompt slots.

``pick_draft`` returns the highest score; a tie keeps the earliest draft
(the one asked at the lowest temperature).
"""
from __future__ import annotations

import re
from typing import Any

from engine.ai.pack.graph import request_gaps

#: Drafts the "three" setting asks for, and the temperature of each.
DRAFT_TEMPERATURES = (0.4, 0.7, 0.9)


def images_seen(plan: dict[str, Any]) -> str:
    """What the first draft took from the reference images, for the
    drafts asked without them (``from_images`` lines)."""
    lines = [str(x) for x in plan.get("from_images") or [] if str(x).strip()]
    if not lines:
        return ("The reference images were read with the first draft; they aren't attached "
                "again.")
    return ("The reference images were read with the first draft and aren't attached again; "
            "they showed: " + "; ".join(lines) + ". Plan from that.")

_RULE_CUE = re.compile(
    r"\b(never|nothing but|only|always|without|except|unless|matching|match(?:es)?|"
    r"goes? with|depends? on|no \w+ (?:in|with|for|on|when)|not \w+ (?:in|with|for|on))\b",
    re.I)

#: Points per problem. A relation that never compiled and a review fix are
#: what the user would see first; a missing request word is softer (the
#: word may be prose).
BAD_REF = 6
REVIEW_FIX = 4
GAP = 2
NO_RULE = 8
LEFT_OUT = 1
FEW_SLOTS = 5


def _left_out(plan: dict[str, Any]) -> int:
    return sum(1 for w in plan.get("warnings") or []
               if isinstance(w, str) and w.startswith("Left out"))


def score_plan(plan: dict[str, Any], request: str,
               library: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """``{score, reasons}`` for a compiled graph plan: 0 is a plan with no
    problem the code can see, each problem takes points off."""
    from engine.ai.pack.review import review_plan

    graph = _got if isinstance(_got := plan.get("graph"), dict) else None
    reasons: list[str] = []
    score = 0
    bad = len(plan.get("bad_refs") or [])
    if bad:
        score -= BAD_REF * bad
        reasons.append(f"{bad} relation(s) named nothing")
    fixes = [f for f in review_plan(plan, library, request=request) if f["level"] == "fix"]
    if fixes:
        score -= REVIEW_FIX * len(fixes)
        reasons.append(f"{len(fixes)} review fix(es)")
    if graph is not None:
        gaps = request_gaps(graph, request)
        if gaps:
            score -= GAP * len(gaps)
            reasons.append("request words left out: " + ", ".join(gaps))
        if _RULE_CUE.search(request or "") and not graph["relations"]:
            score -= NO_RULE
            reasons.append("the request states a rule and the plan has no relation")
        prompt = [s for s in graph["slots"] if s["show"] == "prompt"]
        if len(prompt) < 2:
            score -= FEW_SLOTS
            reasons.append(f"{len(prompt)} prompt slot(s)")
    left = _left_out(plan)
    if left:
        score -= LEFT_OUT * left
        reasons.append(f"{left} part(s) left out")
    return {"score": score, "reasons": reasons}


def pick_draft(drafts: list[dict[str, Any]], request: str,
               library: list[dict[str, Any]] | None = None) -> tuple[int, list[dict[str, Any]]]:
    """``(index, scores)``: the best of ``drafts`` (compiled plans) and
    every draft's ``{score, reasons, title}``. Raises ValueError on an
    empty list."""
    if not drafts:
        raise ValueError("no draft to pick from")
    scores = [{**score_plan(p, request, library), "title": p.get("title") or ""}
              for p in drafts]
    best = max(range(len(drafts)), key=lambda i: (scores[i]["score"], -i))
    return best, scores


def draft_line(best: int, scores: list[dict[str, Any]]) -> str:
    """What ``plan["applied"]`` says about the pick."""
    if len(scores) < 2:
        return ""
    s = scores[best]
    why = "; ".join(s["reasons"]) or "no problem found"
    others = ", ".join(str(x["score"]) for i, x in enumerate(scores) if i != best)
    return (f"Kept draft {best + 1} of {len(scores)} (score {s['score']}: {why}; "
            f"the others scored {others})")
