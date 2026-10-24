"""What the request asks the graph for, checked clause by clause.

`request_gaps` (graph.py) catches request words the graph says nowhere.
This catches words the graph has but doesn't act on (9B smoke run,
2026-10-24): "winter never gets pastel colours" with a Season and a
Palette slot and no rule between them; "a hat about 30% of the time"
with a Hat that always rolls; "the same hero in every image" with a Hero
that rerolls; "Outfits and shoes" with the outfit internal, so the
prompt never shows it.

``apply_request_needs`` lands what the code can settle itself while the
graph compiles (a share of runs with its number, a hold, a subject shown):
the 9B asked to fix those in a plan round rewrote the plan instead and
broke more than it fixed (smoke run on #116). What is left,
``request_needs(graph, request)`` returns as ``[{type, refs, text}]`` for
`review_plan`, which files a missing rule as a "fix" finding (the planner
is asked once in run_pack, or on Fix all in the manager). Deterministic
and quiet when unsure: a clause has to name the slots it is about. A rule
keyed on a drawn list (``list_reads``) is a tip.
"""
from __future__ import annotations

import re
from typing import Any

from engine.ai.pack.graph import NARROWING, _content_words, _stems

#: Words that make a clause a rule between picks.
_RULE_CUE = re.compile(
    r"\b(never|only|nothing but|without|except|unless|match(?:es|ing)?|"
    r"go(?:es)? with|narrows?|no \w+ (?:in|with|for|on|when))\b", re.I)
#: "about 30% of the time", "30 percent", "sometimes", "now and then".
_SOMETIMES = re.compile(
    r"\b(\d{1,2})\s*(?:%|percent)|\b(sometimes|occasionally|now and then|once in a while)\b",
    re.I)
#: "the same hero in every image", "keep the outfit", "stays the same".
_SAME = re.compile(r"\b(?:the same|keeps?|stays? the same|unchanged|consistent)\b", re.I)
_CLAUSE = re.compile(r"[.;:\n]|,\s*(?=(?:but|and|never|only|while|with|each)\b)", re.I)


def _clauses(request: str) -> list[str]:
    return [c.strip() for c in _CLAUSE.split(request) if c and c.strip()]


def _slot_words(graph: dict[str, Any]) -> dict[str, set[str]]:
    """Slot name → the stems that name it: its name and variable, its axis
    values, and the words of the relations that target it."""
    out: dict[str, set[str]] = {}
    for s in graph["slots"]:
        words = re.findall(r"[a-z]+", f"{s['name']} {s['var']}".lower().replace("_", " "))
        for a in s["axes"]:
            words += [v.lower() for v in a["values"]]
        out[s["name"]] = set().union(*(_stems(w) for w in words)) if words else set()
    for r in graph["relations"]:
        to = (r.get("to") or {}).get("slot")
        if to in out:
            for w in r.get("words") or []:
                for part in re.findall(r"[a-z]+", str(w).lower()):
                    out[to] |= _stems(part)
    return out


def _named(clause: str, words: dict[str, set[str]], *, own_only: bool = False,
           graph: dict[str, Any] | None = None) -> list[str]:
    """The slots a clause names. ``own_only``: by name or variable only."""
    if own_only and graph is not None:
        words = {s["name"]: set().union(*(_stems(w) for w in re.findall(
            r"[a-z]+", f"{s['name']} {s['var']}".lower().replace("_", " "))))
            for s in graph["slots"]}
    found: list[str] = []
    for w in _content_words(clause):
        stems = _stems(w)
        for name, have in words.items():
            if stems & have and name not in found:
                found.append(name)
    return found


def _draws(graph: dict[str, Any]) -> dict[str, set[str]]:
    """Slot → the slots it shares a draw with (the list and its drawers)."""
    out: dict[str, set[str]] = {}
    for r in graph["relations"]:
        if r["kind"] == "draw":
            a, b = r["from"]["slot"], r["to"]["slot"]
            out.setdefault(a, set()).add(b)
            out.setdefault(b, set()).add(a)
    return out


def _linked(graph: dict[str, Any], groups: list[set[str]]) -> bool:
    """Whether a rule runs between two of ``groups`` (a named slot with the
    slots it shares a draw with): a narrowing relation, or an append to
    one's variable from another. A rule inside one group doesn't count: a
    Colour List → Shirt rule says nothing about "winter never pastel"
    (9B smoke, 2026-10-24)."""
    var_of = {s["var"]: s["name"] for s in graph["slots"]}
    for r in graph["relations"]:
        src = r["from"]["slot"]
        if r["kind"] in NARROWING:
            dst = r["to"]["slot"]
        elif r["kind"] == "append":
            dst = var_of.get(r.get("var") or "")
        else:
            continue
        if src == dst or dst is None:
            continue
        if any(src in a and dst in b for a in groups for b in groups if a is not b) \
                and not any(src in g and dst in g for g in groups):
            return True
    return False


def _across(graph: dict[str, Any], a: set[str], b: set[str]) -> bool:
    """Whether a rule runs from one side of a cue to the other: "winter
    never gets pastel colours" needs a rule between what "winter" names
    and what "pastel colours" names, not a Season → Shirt Type one."""
    var_of = {s["var"]: s["name"] for s in graph["slots"]}
    for r in graph["relations"]:
        src = r["from"]["slot"]
        dst = r["to"]["slot"] if r["kind"] in NARROWING else \
            var_of.get(r.get("var") or "") if r["kind"] == "append" else None
        if dst is None or src == dst or {src, dst} <= (a & b):
            continue
        if (src in a and dst in b) or (src in b and dst in a):
            return True
    return False


def _narrowed(graph: dict[str, Any], slot: str) -> bool:
    return any(r["kind"] in NARROWING and r["to"]["slot"] == slot for r in graph["relations"])


def request_needs(graph: dict[str, Any], request: str) -> list[dict[str, Any]]:
    if not request.strip() or not graph.get("slots"):
        return []
    words = _slot_words(graph)
    by_name = {s["name"]: s for s in graph["slots"]}
    draws = _draws(graph)
    out: list[dict[str, Any]] = []

    def need(type: str, refs: list[str], text: str) -> None:
        if not any(n["type"] == type and n["refs"] == refs for n in out):
            out.append({"type": type, "refs": refs, "text": text})

    for clause in _clauses(request):
        named = _named(clause, words)
        cue = _RULE_CUE.search(clause)
        if cue:
            groups = [{n} | draws.get(n, set()) for n in named]
            before = _named(clause[:cue.start()], words)
            after = _named(clause[cue.end():], words)
            sides = [set(x).union(*(draws.get(n, set()) for n in x)) for x in (before, after)]
            linked = _across(graph, *sides) if before and after else _linked(graph, groups)
            if len(named) >= 2 and not linked:
                need("rule_unlinked", sorted(named),
                     f"The request says \"{clause}\", and no rule runs between "
                     f"{', '.join(named)}; add the relation (exclude, only, agree or "
                     "accepts) that makes it true")
            elif len(named) == 1 and re.search(r"\bnarrow", clause, re.I) \
                    and not _narrowed(graph, named[0]):
                need("rule_unlinked", named,
                     f"The request says \"{clause}\", and no rule narrows {named[0]}; add "
                     "the relations that do")
        m = _SOMETIMES.search(clause)
        if m:
            for n in named:
                s = by_name[n]
                if s["sometimes_none"] or s.get("weights") or s.get("self_axis"):
                    continue
                pct = int(m.group(1)) if m.group(1) else 0
                hint = (f" (it shows {pct}% of the time, so sometimes_none {100 - pct})"
                        if pct else "")
                need("sometimes_none", [n],
                     f"The request says \"{clause}\", but {n} is picked every run; set its "
                     f"sometimes_none{hint}")
        if _SAME.search(clause) and (graph.get("run") or {}).get("mode") != "single":
            # Single images clear every hold; the story question asks first.
            for n in _named(clause, words, own_only=True, graph=graph):
                s = by_name[n]
                if not s["hold"] and s["show"] == "prompt":
                    need("hold", [n], f"The request says \"{clause}\", but {n} rolls again "
                         "every image; set hold true on it")
    # What the pack is about ("Outfits and shoes: …") is what the image shows.
    lead = request.split(":", 1)[0] if ":" in request[:80] else ""
    for n in _named(lead, words, own_only=True, graph=graph) if lead else []:
        s = by_name[n]
        if s["show"] == "internal" and not s.get("self_axis") and n not in {
                r["from"]["slot"] for r in graph["relations"] if r["kind"] == "draw"}:
            need("hidden_subject", [n],
                 f"The request is about {n}, but {n} is internal, so the prompt never shows "
                 "it; show it in the prompt and put it in the template order")
    return out


def list_reads(graph: dict[str, Any]) -> list[dict[str, Any]]:
    """Derive / append rules keyed on a list that other slots draw from. The
    list's own pick is not what a drawer drew (9B smoke run, 2026-10-24: a
    $palette_modifier from Palette said "vivid" on a shirt that drew an
    earthy colour), so the rule describes a colour the prompt doesn't show."""
    lists: dict[str, list[str]] = {}
    for r in graph["relations"]:
        if r["kind"] == "draw":
            lists.setdefault(r["from"]["slot"], []).append(r["to"]["slot"])
    out: list[dict[str, Any]] = []
    for r in graph["relations"]:
        src = r["from"]["slot"]
        if r["kind"] in ("derive", "append") and src in lists \
                and not any(o["refs"] == [src] for o in out):
            drawers = ", ".join(dict.fromkeys(lists[src]))
            out.append({"type": "list_read", "refs": [src], "text": (
                f"A {r['kind']} rule keys on {src}, but {src} is a list {drawers} draws "
                f"from, and its own pick isn't the one {drawers} drew; key the rule on "
                f"{drawers} (give it the axis) or drop it")})
    return out


#: "sneakers only with casual", "heels go only with formal", "sneakers with
#: casual", "boots go with both casual and formal", "boots with either".
_WITH = re.compile(
    r"\b([a-z]+)\s+(?:go(?:es)?\s+|are\s+|is\s+)?(only\s+)?(?:go(?:es)?\s+)?"
    r"(?:with|for)\s+(?:a\s+|an\s+|the\s+)?([a-z]+)", re.I)
_ANY = {"either", "both", "any", "all", "every", "each"}


def _value_slot(graph: dict[str, Any], word: str,
                near: str = "") -> tuple[dict[str, Any], str, str] | None:
    """The one slot axis value a word names: (slot, axis, value). With
    ``near``, a value two slots carry ("casual" on Formality and Outfit)
    goes to the one a rule runs between it and ``near``."""
    stems = _stems(word.lower())
    hits = [(s, a["name"], v) for s in graph["slots"] for a in s["axes"] for v in a["values"]
            if stems & _stems(v.lower())]
    if near and len({h[0]["name"] for h in hits}) > 1:
        linked = {x for r in graph["relations"] if r["kind"] in NARROWING
                  and near in (r["from"]["slot"], r["to"]["slot"])
                  for x in (r["from"]["slot"], r["to"]["slot"])} - {near}
        hits = [h for h in hits if h[0]["name"] in linked] or hits
    return hits[0] if len({(h[0]["name"], h[2]) for h in hits}) == 1 else None


def _only_with(graph: dict[str, Any], request: str) -> list[str]:
    """Pairings the request spells out ("sneakers with casual, heels with
    formal, boots with either") as "only" rows from the partner's value to
    the things it takes. A pairing said with "only" also drops a rule that
    pairs the thing with another partner value (formal → sneakers, casual →
    heels: rules written the wrong way round, 9B smoke 2026-10-24, the check
    passed them all). Pairings without "only" are added only when no rule
    runs between the two slots yet (the planner left the request's rule out:
    accepts missing on the shoes pack)."""
    pairs: list[tuple[tuple[dict[str, Any], str, str], tuple[dict[str, Any], str, str], bool]] = []
    anys: list[tuple[dict[str, Any], str, str]] = []
    for m in _WITH.finditer(request):
        thing = _value_slot(graph, m.group(1))
        if thing is None:
            continue
        if m.group(3).lower() in _ANY:
            anys.append(thing)
            continue
        partner = _value_slot(graph, m.group(3), near=thing[0]["name"])
        if partner is not None and thing[0] is not partner[0]:
            pairs.append((thing, partner, bool(m.group(2))))
    lines: list[str] = []
    groups: dict[tuple[str, str, str], list[tuple[Any, Any, bool]]] = {}
    for t, p, only in pairs:
        groups.setdefault((t[0]["name"], p[0]["name"], p[1]), []).append((t, p, only))
    for (tname, pname, pa), rows in groups.items():
        pair = {tname, pname}

        def sides(r: dict[str, Any], pair: set[str] = pair) -> dict[str, dict[str, Any]] | None:
            to = r.get("to") or {}
            if r["kind"] not in NARROWING or {r["from"]["slot"], to.get("slot")} != pair:
                return None
            return {r["from"]["slot"]: r["from"], to["slot"]: to}

        pvals = next(a["values"] for a in rows[0][1][0]["axes"] if a["name"] == pa)
        said = [((t[0]["name"], t[2]), p[2]) for t, p, _ in rows] + [
            ((t[0]["name"], t[2]), v) for t in anys if t[0]["name"] == tname for v in pvals]
        # An exclude the request contradicts ("boots go with both" against
        # casual → never boots, 9B smoke 2026-10-24) goes either way.
        keep = []
        for r in graph["relations"]:
            sd = sides(r)
            if sd and r["kind"] in ("exclude", "reduce") and sd[pname].get("axis") == pa \
                    and ((tname, sd[tname].get("value")), sd[pname].get("value")) in said:
                lines.append(f"Dropped {sd[pname]['value']} never {sd[tname]['value']}: the "
                             f"request pairs {sd[tname]['value']} with "
                             f"{sd[pname]['value']}")
                continue
            keep.append(r)
        graph["relations"] = keep
        ruled = any(sides(r) for r in graph["relations"])
        if ruled and not any(only for *_, only in rows):
            continue
        # The wrong way round: "X only with Y" against a rule X ← Z.
        for (_ts, _ta, tv), (_ps, _pa, pv), only in rows:
            if not only:
                continue
            keep = []
            for r in graph["relations"]:
                sd = sides(r)
                if sd and r["kind"] in ("only", "boost") and sd[tname].get("value") == tv \
                        and sd[pname].get("axis") == pa \
                        and sd[pname].get("value") not in ("", pv):
                    lines.append(f"Dropped {sd[pname]['value']} → {tv}: the request says "
                                 f"{tv} only with {pv}")
                    continue
                keep.append(r)
            graph["relations"] = keep
        wanted = [(t, p) for t, p, _ in rows]
        wanted += [(t, (rows[0][1][0], pa, v)) for t in anys if t[0]["name"] == tname
                   for v in pvals]
        for (ts, ta, tv), (ps, _pa, pv) in dict.fromkeys(
                ((t[0]["name"], t[1], t[2]), (p[0]["name"], p[1], p[2])) for t, p in wanted):
            if any((sd := sides(r)) and sd[ts].get("value") == tv and sd[ps].get("value") == pv
                   for r in graph["relations"]):
                continue
            graph["relations"].append({
                "kind": "only", "from": {"slot": ps, "axis": pa, "value": pv},
                "to": {"slot": ts, "axis": ta, "value": tv}, "words": []})
            lines.append(f"Added {ps} {pv} → only {ts} {tv}, as the request says")
    return lines


def apply_request_needs(graph: dict[str, Any], request: str) -> list[str]:
    """Settle what ``request_needs`` finds that has one answer: "a hat 30%
    of the time" sets Hat's sometimes_none to 70, "the same hero" holds
    Hero, and the subject of "Outfits and shoes: …" goes in the prompt.
    Edits ``graph`` in place; returns the lines saying so."""
    lines = _only_with(graph, request)
    by_name = {s["name"]: s for s in graph["slots"]}
    for n in request_needs(graph, request):
        s = by_name.get(n["refs"][0]) if len(n["refs"]) == 1 else None
        if s is None:
            continue
        if n["type"] == "sometimes_none":
            m = re.search(r"sometimes_none (\d+)", n["text"])
            if m:
                s["sometimes_none"] = int(m.group(1))
                lines.append(f"{s['name']} comes out empty in {m.group(1)}% of runs, as the "
                             "request asks")
        elif n["type"] == "hold":
            s["hold"] = True
            lines.append(f"{s['name']} is held, as the request asks")
        elif n["type"] == "hidden_subject":
            s["show"] = "prompt"
            if s["var"] not in graph["template"]["order"]:
                graph["template"]["order"].append(s["var"])
            lines.append(f"{s['name']} is shown in the prompt: the request is about it")
    return lines
