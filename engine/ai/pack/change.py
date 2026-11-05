"""Pack builder: change one item of a plan (`change_prompt`, `apply_change`)."""
from __future__ import annotations

from typing import Any

from engine.ai.pack._common import ITEM_SCHEMA, PlanError, _item, _obj
from engine.ai.pack.plan import compile_plan, plan_answer
from engine.ai.pack.prompts import decisions_note, run_note
from engine.ai.pack.settings import PLAN_SYSTEM, parse_run

CHANGE_SCHEMA: dict[str, Any] = _obj({"items": {"type": "array", "items": ITEM_SCHEMA}})

CHANGE_SYSTEM = PLAN_SYSTEM + """

Now you change ONE item of an existing plan, as the user asks. Answer with \
items: the changed item first (same kind unless asked otherwise), plus any \
new items the change needs (a vocabulary it points at, a constraint it \
asks for). Keep everything else about the item that the user didn't ask to \
change. Use the plan's style, sections and variable names."""


def _plan_lines(plan: dict[str, Any]) -> list[str]:
    lines = [f"Pack: {plan['title']}: {plan.get('summary', '')}",
             f"Style: {plan.get('style') or 'tags'}; anchor: "
             f"{('$' + plan['anchor']) if plan.get('anchor') else 'none'}"]
    note = run_note(parse_run(plan.get("run")))
    if note:
        lines.append(note)
    if plan.get("sections"):
        lines.append("Sections: " + ", ".join(s["name"] for s in plan["sections"]))
    for i in plan["items"]:
        bits = [i["kind"], i["name"]]
        if i["var"]:
            bits.append("$" + i["var"])
        if i.get("section"):
            bits.append("in " + i["section"])
        if i["kind"] == "constraint":
            bits.append(f"${i['source']} → ${i['target']}")
        if i["tags"]:
            bits.append("tags " + ", ".join(i["tags"]))
        if i.get("use"):
            bits.append("use " + i["use"])
        lines.append("- " + " · ".join(bits) + (f": {i['about']}" if i["about"] else ""))
    return lines


def change_prompt(plan: dict[str, Any], key: str, instruction: str) -> str:
    """Ask for one item changed (``key``), or a new item (``key`` "")."""
    lines = _plan_lines(plan)
    if plan.get("decisions"):
        lines += ["", decisions_note(plan["decisions"])]
    if key:
        item = _item(plan, key)
        lines += ["", f"Change this item: {item['kind']} {item['name']}"
                  + (f" (${item['var']})" if item["var"] else ""),
                  f"The user asks: {instruction.strip()}"]
    else:
        lines += ["", f"Add to the plan what the user asks: {instruction.strip()}"]
    return "\n".join(lines)


def apply_change(plan: dict[str, Any], key: str, answer: Any,
                 library: list[dict[str, Any]] | None = None,
                 base: dict[str, Any] | None = None) -> dict[str, Any]:
    """The plan with item ``key`` replaced by the model's first item (it
    keeps the key and id) and any others added after it; with ``key`` ""
    the items are added at the end (before the template). Checked again."""
    new = [i for i in (answer.get("items") if isinstance(answer, dict) else None) or []
           if isinstance(i, dict)]
    if not new:
        raise PlanError("the answer had no item")
    raw = plan_answer(plan)
    own = [i for i in plan["items"] if not i.get("existing")]
    raw["items"] = [dict(i, key=p["key"], id=p["id"]) for i, p in zip(
        raw["items"], own, strict=True)]
    if key:
        at = next((n for n, i in enumerate(own) if i["key"] == key), None)
        if at is None:
            raise PlanError("that item is already in the bundle; change it there")
        first = dict(new[0], key=key, id=own[at]["id"])
        raw["items"][at:at + 1] = [first, *new[1:]]
    else:
        at = next((n for n, i in enumerate(raw["items"]) if i["kind"] == "template"),
                  len(raw["items"]))
        raw["items"][at:at] = new
    return compile_plan(raw, library, decisions=plan.get("decisions"),
                        settings=plan.get("settings"), base=base)
