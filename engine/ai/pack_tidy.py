"""Pack fixes that need no model call.

A small model makes the same few mistakes a large one does, only more
often: the same words from two items ("golden hour" from the time of day
and from the lighting rule), another item printing what a rule keeps out
(snow in a desert scene), a long value-by-value rule, a template answer
that never came back. Each fix here is checked on the engine or keeps the
pack's behaviour exactly, so it can run on every pack without asking.

- `tidy` runs before each pack check: it takes out words the prompt says
  twice (only where taking them out loses nothing in any test run) and
  pieces of a wildcard's options that another wildcard picks.
- `rule_breaks` finds prompts that show what one of the pack's own
  constraints rules out for that run, and names the item that printed it.
- `merge_lookup` folds a rule's "equals X → write Y" branches that write
  the same thing into one branch (X1 or X2 or …).
- `fallback_template` writes a plain template when the model's answers for
  it failed, so the pack still renders.
"""
from __future__ import annotations

import copy
import json
import re
from typing import Any

from engine.ai import pack as P
from engine.modules._constraint_math import EXCLUDE, combine_constraint_factor
from engine.modules.derivation_handler import NEGATIVE_MODES, DerivationHandler
from engine.modules.fixed_values_handler import FixedValuesHandler
from engine.modules.wildcard_handler import WildcardHandler

#: Runs each repeat fix is tested on.
TIDY_SEEDS = 32
#: Candidate fixes tried per check, so a pack full of repeats stays quick.
MAX_TRIES = 24
#: Runs that must show a rule break before it is reported.
BREAK_RUNS = 2
# A piece the fixes never touch: picks, reads, refs, weights, LoRAs.
_LIVE = re.compile(r"[{}$@<>()\[\]|]")


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def _chunks(prompt: str) -> list[str]:
    return [c for c in (_norm(x) for x in prompt.split(",")) if c]


# ── engine runs ─────────────────────────────────────────────────────────


def runs(plan: dict[str, Any], built: dict[str, Any], *, seeds: int = TIDY_SEEDS,
         library: list[dict[str, Any]] | None = None,
         base: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """``[{seed, ctx, prompt, negative}]`` for seeds 1..N, the way the check
    renders them (a story plays one frame per seed). Failed runs are left
    out; no template means empty prompts."""
    from engine.pipeline import PipelineEngine

    modules = P.chain_modules(plan, built) if base is None else P.extend_chain(plan, built, base)
    rows = [*(r for r in library or [] if r.get("type") == "wildcard"),
            *(r for r in P._built_rows(plan, built) if r["type"] == "wildcard")]
    catalog = P.ref_catalog(modules, rows)
    pinned = P.pins(plan)
    frames = P.loop_frames(plan)
    tpl = P._template(plan, built)
    neg = built[tpl[0]["key"]]["payload"].get("negative_template") or "" if tpl else ""
    out = []
    for seed in range(1, max(1, seeds) + 1):
        frame = P.frame_pins(P.frame_of(seed, frames), frames) if frames else {}
        try:
            ctx = PipelineEngine().run(copy.deepcopy(modules),
                                       ctx={**pinned, **frame, "__wp_catalog__": catalog},
                                       seed=seed)
            prompt, negative = P.render(tpl[1], neg, ctx) if tpl else ("", "")
        except Exception:  # noqa: BLE001 - the check reports failed runs
            continue
        out.append({"seed": seed, "ctx": ctx, "prompt": prompt, "negative": negative})
    return out


# ── text slots ──────────────────────────────────────────────────────────


def _slots(kind: str, payload: dict[str, Any]) -> list[tuple[Any, Any, str]]:
    """Every text the prompt can show, as ``(container, key, text)``."""
    out: list[tuple[Any, Any, str]] = []
    if kind == "wildcard":
        for o in payload.get("options") or []:
            if isinstance(o, dict) and not o.get("is_null") and isinstance(o.get("value"), str):
                out.append((o, "value", o["value"]))
    elif kind == "fixed_values":
        for v in payload.get("values") or []:
            if isinstance(v, dict) and isinstance(v.get("value"), str):
                out.append((v, "value", v["value"]))
    elif kind == "derivation":
        for rule in payload.get("rules") or []:
            for clause in [*(rule.get("branches") or []), rule.get("else")]:
                if not isinstance(clause, dict):
                    continue
                for a in [clause.get("action"), *(clause.get("extra_actions") or [])]:
                    if isinstance(a, dict) and isinstance(a.get("value"), str) \
                            and a.get("mode") not in NEGATIVE_MODES:
                        out.append((a, "value", a["value"]))
    elif kind == "combine":
        if isinstance(payload.get("template"), str):
            out.append((payload, "template", payload["template"]))
    elif kind == "template":
        if isinstance(payload.get("template_string"), str):
            out.append((payload, "template_string", payload["template_string"]))
    return out


def _without(text: str, piece: str) -> str | None:
    """``text`` with its comma piece ``piece`` taken out, or None when it
    has no such piece or nothing else would be left."""
    lead = re.match(r"\s*,\s*", text)
    parts = text.split(",")
    kept = [p for p in parts if _norm(p) != piece]
    if len(kept) == len(parts) or not any(_norm(p) for p in kept):
        return None
    joined = ", ".join(p.strip() for p in kept if p.strip())
    return (", " + joined) if lead else joined


def _validate(kind: str, payload: dict[str, Any]) -> None:
    {"wildcard": WildcardHandler, "fixed_values": FixedValuesHandler,
     "derivation": DerivationHandler}.get(kind, _NoCheck).validate_payload(payload)


class _NoCheck:
    @staticmethod
    def validate_payload(_payload: dict[str, Any]) -> None:
        return None


# ── repeats ─────────────────────────────────────────────────────────────


def _same_meaning(before: list[dict[str, Any]], after: list[dict[str, Any]]) -> int:
    """How many runs got shorter, or -1 when a run lost or gained any words
    (or the two sets of runs don't line up)."""
    if [r["seed"] for r in before] != [r["seed"] for r in after]:
        return -1
    shorter = 0
    for a, b in zip(before, after, strict=True):
        if set(_chunks(a["prompt"])) != set(_chunks(b["prompt"])) \
                or set(_chunks(a["negative"])) != set(_chunks(b["negative"])):
            return -1
        shorter += len(_chunks(b["prompt"])) < len(_chunks(a["prompt"]))
    return shorter


def strip_repeats(plan: dict[str, Any], built: dict[str, Any], *,
                  library: list[dict[str, Any]] | None = None,
                  base: dict[str, Any] | None = None,
                  ) -> tuple[dict[str, Any], dict[str, list[str]]]:
    """Words the prompt says twice ("golden hour, …, golden hour"), taken
    out of the later item that writes them. A piece goes only when every
    test run keeps exactly the same words afterwards (the other item always
    says it too), so the fix never changes what an image shows. Returns the
    new ``built`` and ``{key: [what was taken out]}``."""
    base_runs = runs(plan, built, library=library, base=base)
    if not base_runs or not any(r["prompt"] for r in base_runs):
        return built, {}
    items = {i["key"]: i for i in plan["items"]}
    order = _prompt_order(plan, built)
    said: dict[str, list[str]] = {}
    tries = 0
    done: set[tuple[str, int, str]] = set()
    while tries < MAX_TRIES:
        twice: dict[str, int] = {}
        for r in base_runs:
            counts: dict[str, int] = {}
            for c in _chunks(r["prompt"]):
                counts[c] = counts.get(c, 0) + 1
            for c, n in counts.items():
                if n > 1 and len(c) >= 3 and not _LIVE.search(c):
                    twice[c] = twice.get(c, 0) + 1
        if not twice:
            break
        found = False
        # The words said twice most often first; the later writer first.
        for piece in sorted(twice, key=lambda c: (-twice[c], c)):
            for key in reversed(order):
                i = items.get(key)
                if i is None or i.get("existing") or i["kind"] in ("constraint", "library"):
                    continue
                payload = built[key]["payload"]
                for n, (_box, _field, text) in enumerate(_slots(i["kind"], payload)):
                    if (key, n, piece) in done or _without(text, piece) is None:
                        continue
                    done.add((key, n, piece))
                    tries += 1
                    trial = copy.deepcopy(payload)
                    box, field, old = _slots(i["kind"], trial)[n]
                    box[field] = _without(old, piece)
                    try:
                        _validate(i["kind"], trial)
                    except Exception:  # noqa: BLE001 - a fix that breaks the item is skipped
                        continue
                    new_built = {**built, key: {**built[key], "payload": trial}}
                    after = runs(plan, new_built, library=library, base=base)
                    if _same_meaning(base_runs, after) >= 2:
                        built, base_runs = new_built, after
                        said.setdefault(key, []).append(piece)
                        found = True
                        break
                    if tries >= MAX_TRIES:
                        break
                if found or tries >= MAX_TRIES:
                    break
            if found or tries >= MAX_TRIES:
                break
        if not found:
            break
    return built, said


def _prompt_order(plan: dict[str, Any], built: dict[str, Any]) -> list[str]:
    """Built item keys by where the prompt first shows what they write (a
    combine's parts where the combine is read), the template's own words
    last: a repeat keeps its first place in the prompt."""
    tpl = P._template(plan, built)
    text = tpl[1] if tpl else ""
    where: dict[str, int] = {}
    for m in re.finditer(r"\$([A-Za-z_]\w*)", text):
        where.setdefault(m.group(1), m.start())
    for c in plan["items"]:
        if c["kind"] == "combine" and c["key"] in built and c["var"] in where:
            for v in P._combine_inputs(plan, built, c["var"]):
                where.setdefault(v, where[c["var"]])
    end = len(text) + 1
    keys = [k for k in P.run_order(plan, built) if k in built]
    if tpl:
        keys.append(tpl[0]["key"])

    def place(key: str) -> int:
        i = P._item(plan, key)
        if i["kind"] == "template":
            return end + 1
        sets = P.item_io(i, built[key]["payload"])[1]
        return min((where[v] for v in sets if v in where), default=end)

    return sorted(keys, key=place)


# ── sibling picks ───────────────────────────────────────────────────────


def strip_siblings(plan: dict[str, Any],
                   built: dict[str, Any]) -> tuple[dict[str, Any], dict[str, list[str]]]:
    """The build takes the pieces another wildcard picks out of a wildcard's
    options, but only against the wildcards built before it: run it again
    for every wildcard now that all of them are built."""
    said: dict[str, list[str]] = {}
    for i in plan["items"]:
        if not P.is_wild(i) or i["kind"] != "wildcard" or i["key"] not in built \
                or i.get("existing"):
            continue
        trial = copy.deepcopy(built[i["key"]]["payload"])
        out = P._strip_sibling_picks(plan, built, i, trial)
        if not out:
            continue
        try:
            WildcardHandler.validate_payload(trial)
        except Exception:  # noqa: BLE001 - leave the item as it was
            continue
        built = {**built, i["key"]: {**built[i["key"]], "payload": trial}}
        said[i["key"]] = out
    return built, said


def tidy(plan: dict[str, Any], built: dict[str, Any], *,
         library: list[dict[str, Any]] | None = None,
         base: dict[str, Any] | None = None) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    """Both fixes, before a check. Returns the new ``built`` and, for each
    item changed, ``{payload, preview, warnings}`` (``warnings``: the lines
    to add to the item's own)."""
    built, siblings = strip_siblings(plan, built)
    built, repeats = strip_repeats(plan, built, library=library, base=base)
    changed: dict[str, dict[str, Any]] = {}
    for key in dict.fromkeys([*siblings, *repeats]):
        lines = list(siblings.get(key) or [])
        if repeats.get(key):
            quoted = ", ".join(f'"{p}"' for p in repeats[key][:6])
            lines.append(f"Took out {quoted}: the prompt already says it, so it showed twice")
        changed[key] = {"payload": built[key]["payload"],
                        "preview": preview(plan, built, key), "warnings": lines}
    return built, changed


def preview(plan: dict[str, Any], built: dict[str, Any], key: str) -> list[str]:
    """The item's preview lines for its current payload."""
    from engine.ai import derivation as ai_derivation
    from engine.ai import wildcard as ai_wildcard

    i = P._item(plan, key)
    payload = built[key]["payload"]
    if i["kind"] == "wildcard":
        idx = P.ref_index(plan, built)
        return [ai_wildcard.option_line(o, idx) for o in payload.get("options") or []]
    if i["kind"] == "derivation":
        return [ai_derivation.describe_rule(r) for r in payload.get("rules") or []]
    if i["kind"] == "fixed_values":
        return [f"${v['name']} = {v['value']}"
                + (f"  (negative: {v['negative']})" if v.get("negative") else "")
                for v in payload.get("values") or []]
    if i["kind"] == "combine":
        return [f"${i['var']} = {payload.get('template') or ''}"]
    text = str(payload.get("template_string") or "")
    neg = str(payload.get("negative_template") or "")
    return [text] + ([f"Negative: {neg}"] if neg else [])


# ── rule breaks ─────────────────────────────────────────────────────────


def _ruled_out(src: dict[str, Any], tgt: dict[str, Any],
               payload: dict[str, Any]) -> dict[str, list[str]]:
    """For each source option's text, the target options the constraint
    excludes for it (the plain ones, lower case)."""
    out: dict[str, list[str]] = {}
    targets = [o for o in tgt.get("options") or [] if isinstance(o, dict)
               and not o.get("is_null") and isinstance(o.get("value"), str)
               and not _LIVE.search(o["value"]) and len(o["value"].strip()) >= 3]
    for s in src.get("options") or []:
        if not isinstance(s, dict) or not isinstance(s.get("value"), str):
            continue
        pick = {"value": s["value"], "tags": list(s.get("sub_categories") or [])}
        gone = [_norm(o["value"]) for o in targets
                if combine_constraint_factor(
                    [pick], {"value": o["value"], "tags": o.get("sub_categories") or []},
                    payload.get("matrix"), payload.get("exceptions")) is EXCLUDE]
        if gone and len(gone) < len(targets):
            out[_norm(s["value"])] = gone
    return out


def _says(text: str, phrase: str) -> bool:
    return re.search(r"(?<![\w-])" + re.escape(phrase) + r"(?![\w-])", text) is not None


def rule_breaks(plan: dict[str, Any], built: dict[str, Any],
                done: list[dict[str, Any]]) -> dict[str, str]:
    """A prompt that shows what one of the pack's constraints rules out for
    that run (a desert scene that says "heavy snowfall" because the scenery
    options mention it): ``{key of the item that printed it: problem}``.
    The constraint keeps its own target right; this catches the words the
    other items write. Leans quiet: only whole phrases of an excluded
    option count, in at least `BREAK_RUNS` runs."""
    by_var = {i["var"]: i for i in plan["items"] if P.is_wild(i) and i["key"] in built}
    # A combine only holds what the others wrote: blame them first.
    writers = sorted(((i, P.item_io(i, built[i["key"]]["payload"])[1]) for i in plan["items"]
                      if i["key"] in built and i["kind"] not in ("constraint", "template")),
                     key=lambda w: w[0]["kind"] == "combine")
    tpl = P._template(plan, built)
    hits: dict[tuple[str, str], list[tuple[str, str]]] = {}
    for c in plan["items"]:
        if c["kind"] != "constraint" or c["key"] not in built:
            continue
        s, t = by_var.get(c["source"]), by_var.get(c["target"])
        if s is None or t is None:
            continue
        table = _ruled_out(built[s["key"]]["payload"], built[t["key"]]["payload"],
                           built[c["key"]]["payload"])
        if not table:
            continue
        for r in done:
            ctx = r["ctx"]
            gone = table.get(_norm(str(ctx.get(s["var"]) or "")))
            prompt = _norm(r["prompt"])
            if not gone or not prompt:
                continue
            own = _norm(str(ctx.get(t["var"]) or ""))
            for phrase in gone:
                if _says(own, phrase) or not _says(prompt, phrase):
                    continue
                who = next((i for i, sets in writers if i is not t and any(
                    _says(_norm(str(ctx.get(v) or "")), phrase) for v in sets)), None)
                if who is None and tpl is not None \
                        and _says(_norm(str(tpl[1]).replace("$", " ")), phrase):
                    who = tpl[0]
                if who is None:
                    continue
                hits.setdefault((who["key"], c["key"]), []).append(
                    (str(ctx.get(s["var"]) or ""), phrase))
    items = {i["key"]: i for i in plan["items"]}
    out: dict[str, str] = {}
    for (key, ckey), got in hits.items():
        if len(got) < BREAK_RUNS or key in out:
            continue
        c = items[ckey]
        s, t = by_var[c["source"]], by_var[c["target"]]
        when, phrase = got[0]
        out[key] = (f"with ${s['var']} = \"{when}\" it puts \"{phrase}\" in the prompt, "
                    f"which {c['name']} rules out for that {s['name']} ({len(got)} of "
                    f"{len(done)} runs); leave {t['name']}'s subject to ${t['var']}")
    return out


# ── lookup tables ───────────────────────────────────────────────────────


def merge_lookup(payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """A rule whose branches all test one variable for one value each
    ("$weather equals rain → $light = dim"), where several branches write
    the same thing: those become one branch testing any of their values.
    Branches never overlap (each tests a different value), so the rule
    does exactly what it did."""
    said: list[str] = []
    rules = []
    for rule in payload.get("rules") or []:
        branches = rule.get("branches") or [] if isinstance(rule, dict) else []
        tests = [_lone_equals(b) for b in branches]
        if len(branches) < 3 or any(x is None for x in tests) \
                or len({x[0] for x in tests if x}) != 1:
            rules.append(rule)
            continue
        groups: dict[str, list[dict[str, Any]]] = {}
        for b in branches:
            what = json.dumps({k: v for k, v in b.items() if k != "condition"}, sort_keys=True)
            groups.setdefault(what, []).append(b)
        if len(groups) == len(branches):
            rules.append(rule)
            continue
        merged = []
        for group in groups.values():
            if len(group) == 1:
                merged.append(group[0])
                continue
            conds = [copy.deepcopy(_lone_equals_cond(b)) for b in group]
            merged.append({**group[0], "condition": {"match": "any", "conditions": conds}})
        rules.append({**rule, "branches": merged})
        said.append(f"Joined {len(branches)} branches into {len(merged)}: branches that "
                    "wrote the same thing now test any of their values")
    if not said:
        return payload, []
    out = {**payload, "rules": rules}
    DerivationHandler.validate_payload(out)
    return out, said


def _lone_equals_cond(branch: dict[str, Any]) -> dict[str, Any] | None:
    cond = branch.get("condition") if isinstance(branch, dict) else None
    while isinstance(cond, dict) and "conditions" in cond and len(cond["conditions"] or []) == 1:
        cond = cond["conditions"][0]
    if isinstance(cond, dict) and "conditions" not in cond and cond.get("op") == "equals":
        return cond
    return None


def _lone_equals(branch: dict[str, Any]) -> tuple[str, str] | None:
    cond = _lone_equals_cond(branch)
    return (str(cond.get("var") or ""), str(cond.get("value") or "")) if cond else None


# ── fallback template ───────────────────────────────────────────────────

_STANDING = {"tags": "lowres, bad anatomy, bad hands, worst quality, watermark",
             "": "blurry, low quality, deformed, watermark, text"}


def fallback_template(plan: dict[str, Any], built: dict[str, Any]) -> dict[str, str]:
    """A template answer (``{template, negative}``) written without the
    model: the variables the plan's template description names, in that
    order, else every pick the pack sets in run order (what a combine
    already joins left out), with a standing negative per the settings."""
    tpl = next((i for i in plan["items"] if i["kind"] == "template"), None)
    known = {i["var"] for i in plan["items"] if i["var"] and i["kind"] != "constraint"} \
        | {i["var"] for i in plan.get("inputs") or []}
    named = [v for v in dict.fromkeys(re.findall(r"\$([A-Za-z_]\w*)", str(
        (tpl or {}).get("about") or ""))) if v in known]
    if len(named) < 2:
        items = {i["key"]: i for i in plan["items"]}
        joined = {v for c in plan["items"] if c["kind"] == "combine" and c["key"] in built
                  for v in P._combine_inputs(plan, built, c["var"])}
        named = [i["var"] for i in plan.get("inputs") or []]
        for key in P.run_order(plan, built):
            i = items.get(key)
            if i is None or not i["var"] or i["kind"] in ("constraint", "template") \
                    or P._vocab(i) or "internal" in (i.get("use") or "") \
                    or i["var"] in joined or i["var"] in named:
                continue
            named.append(i["var"])
    mode = P.parse_settings(plan.get("settings"))["negatives"]
    standing = _STANDING["tags" if plan.get("style") == "tags" else ""]
    negative = "$negatives" if mode == "none" else f"{standing}, $negatives"
    return {"template": ", ".join(f"${v}" for v in named), "negative": negative}


def fallback_item(plan: dict[str, Any], key: str, built: dict[str, Any], why: str, *,
                  library: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """`compile_item`'s result for a template written by `fallback_template`,
    with a warning saying so. Raises ValueError when even that can't be
    used (nothing in the pack sets a variable yet)."""
    answer = fallback_template(plan, built)
    if not answer["template"]:
        raise ValueError(f"the model's answers failed ({why}) and nothing is built to read")
    old = built.get(key)
    out = P.compile_item(plan, key, built, answer, taken={b["id"] for b in built.values()},
                         item_id=old["id"] if old else "", library=library)
    out["warnings"] = [f"Wrote a plain template that reads every pick: the model's answers "
                       f"failed ({why[:120]}). Rebuild it, or edit it after install",
                       *out["warnings"]]
    out["repair"] = ""
    return out
