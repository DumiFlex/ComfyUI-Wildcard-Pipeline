"""Pack builder text fixers: what `compile_item` tidies in a built item's
texts, combines, options and constraint rules."""
from __future__ import annotations

import re
from typing import Any

from engine.ai import library_vars, text_items
from engine.ai.pack._common import _NEVER, _chunks, _once, _reads, is_wild
from engine.ai.pack.build_notes import tag_commas
from engine.ai.pack.plan import _PICKS
from engine.ai.pack.plan_rules import _ONLY_WITH
from engine.ai.pack.review import RUNTIME_VARS, known_vars

# The planner's own conditions written into the prompt text: "If $outer
# is present: with $outer." prints as a sentence in every image.
_PROSE = re.compile(r"(?:^|(?<=[.,;]))\s*\(?\s*(?:if|when|only if)\s+[^.,;:()]{1,40}?"
                    r"\s+(?:is|are)\s+(?:present|set|given|there|not empty|non-empty|"
                    r"available|used|picked|rolled)\s*\)?\s*[:,]\s*", re.I)
# "Footwear: $shoes", "Layering note: …": a label printed as prompt text.
# Weights ("(word:1.2)") have no space after the colon.
_LABEL = re.compile(r"(?:^|(?<=[.,;]))\s*[A-Za-z][A-Za-z ]{1,24}:\s+")
_TWICE = re.compile(r"\b([A-Za-z]{3,})\s+\1\b", re.I)
_PROSE_TAIL = re.compile(r"\s*\(\s*(?:if\s+(?:any|present|set|given|available)|optional)"
                         r"\s*\)", re.I)
# A phrase that ends on its article ("wielding a,"): the word after it is gone.
_DANGLING = re.compile(r"\b(?:a|an|the)\s*(?=,|\.|;|$)", re.I)


def _fold_case_reads(text: str, plan: dict[str, Any],
                     built: dict[str, Any]) -> tuple[str, list[str]]:
    """Reads of a split that was merged ($outfit_autumn after the outfits
    became one $outfit tagged by season) read the merged pick, once; and a
    word the pick's options already end on ("$hair_color hair" for options
    like "white hair") is dropped."""
    known = known_vars(plan)
    wild = {i["var"]: i for i in plan["items"] if is_wild(i)}
    said: list[str] = []
    for v in text_items.reads(text):
        if v in known:
            continue
        parts = v.split("_")
        for n in range(1, len(parts)):
            for role, case in (("_".join(parts[:n]), "_".join(parts[n:])),
                               ("_".join(parts[n:]), "_".join(parts[:n]))):
                w = wild.get(role)
                if w is not None and case in {str(t).lower() for t in w.get("tags") or []}:
                    text = _once(re.sub(r"\$" + re.escape(v) + r"\b", "$" + role, text), role)
                    said.append(f"Read ${role} for ${v}: the cases were merged into one pick")
                    break
            else:
                continue
            break
    for v in text_items.reads(text):
        w = wild.get(v)
        b = built.get(w["key"]) if w else None
        if not b:
            continue
        opts = [str(o.get("value") or "").strip().lower() for o in b["payload"].get(
            "options") or [] if isinstance(o, dict)]
        m = re.search(r"\$" + re.escape(v) + r"\b(?![.\w])\s+([A-Za-z]+)\b", text)
        if not m or not opts:
            continue
        word = m.group(1).lower()
        if sum(o.endswith(word) for o in opts) * 2 > len(opts):
            text = text[:m.start(1)].rstrip() + text[m.end(1):]
            said.append(f"Dropped \"{word}\" after ${v}: its options already end on it "
                        f"(\"… {word} {word}\")")
    return text, said


def _lead_with_anchor(text: str, plan: dict[str, Any],
                      built: dict[str, Any]) -> tuple[str, list[str]]:
    """The pick the other picks follow (the season every outfit is kept
    to) shows in the prompt: when nothing the template reads holds it, the
    template starts with it."""
    shown = set(text_items.reads(text))
    for v in list(shown):
        if any(c["kind"] == "combine" and c["var"] == v for c in plan["items"]):
            shown |= set(_combine_inputs(plan, built, v))
    sources = [plan.get("anchor") or "", *(c["source"] for c in plan["items"]
                                          if c["kind"] == "constraint")]
    wild = {i["var"]: i for i in plan["items"] if is_wild(i) and i["key"] in built
            and "internal" not in (i.get("use") or "")}
    led = next((v for v in dict.fromkeys(sources) if v in wild and v not in shown), "")
    if not led or not text.strip():
        return text, []
    return f"${led}, {text}", [f"Started with ${led} ({wild[led]['name']}): the other picks "
                               "follow it, but the prompt never showed it"]


def _plan_prose(text: str) -> tuple[str, list[str]]:
    """``text`` without the planner's conditions ("If $x is present:",
    "(if any)"), labels ("Footwear: $shoes", "Layering note:") and a
    doubled word ("wearing wearing"); the empty-variable tidy already
    drops a phrase whose variable is empty."""
    bare = _PROSE_TAIL.sub("", _PROSE.sub(" ", text))
    bare = _LABEL.sub(" ", bare)
    bare = _TWICE.sub(r"\1", bare)
    if bare == text:
        return text, []
    bare = re.sub(r"\s{2,}", " ", bare).strip()
    return bare, ["Took out the plan's own condition or label (\"If … is present:\", "
                  "\"Footwear:\"): it printed as text in every prompt"]


def _dangling(text: str, plan: dict[str, Any], item: dict[str, Any],
              built: dict[str, Any]) -> tuple[str, list[str]]:
    """A phrase ending on "a" / "the" lost its word. When exactly one pick
    the item's plan names isn't read, that's the word: it's read there."""
    if not _DANGLING.search(text):
        return text, []
    reads = set(text_items.reads(text))
    wild = {i["var"] for i in plan["items"] if is_wild(i) and i["key"] in built}
    missing = [v for v in _reads(item.get("about") or "")
               if v != item["var"] and v not in reads and v in wild]
    if len(missing) == 1 and len(_DANGLING.findall(text)) == 1:
        fixed = _DANGLING.sub(f"${missing[0]}", text, count=1)
        return fixed, [f"Read ${missing[0]} where a phrase ended on its article: it "
                       "printed \"… a,\" with nothing after it"]
    return text, ["A phrase ends on its article (\"… a,\"), so the word after it is "
                  "missing; read the variable that names it there"]


_ARTICLE_PICK = re.compile(r"\{\s*(?:[a-z]|an|the)?\s*(?:\|\s*(?:[a-z]|an|the)?\s*)+\}",
                           re.I)


def _combine_notes(plan: dict[str, Any], item: dict[str, Any], payload: dict[str, Any],
                   built: dict[str, Any] | None = None) -> list[str]:
    """A combine that makes its own pick ("{parka|trench coat}") instead of
    reading the variable its plan joins, and one that also reads what the
    template prints itself ($quality_tags), so the prompt shows it twice."""
    text = str(payload.get("template") or "")
    reads = set(text_items.reads(text))
    said = []
    planned = [v for v in _reads(item.get("about") or "") if v != item["var"]]
    skipped = [v for v in planned if v not in reads]
    if skipped and _PICKS.search(text):
        said.append(f"It picks inline ({{a|b}}) instead of reading ${', $'.join(skipped)}; "
                    "read the variable so the constraints on it apply")
    elif len(reads) >= 2 and re.search(r"\{[^{}]*\|[^{}]*\}", text):
        said.append("It picks inline ({a|b}) in a line that joins picks; leave the choice "
                    "to a wildcard, which the constraints can reach")
    low = text.lower()
    for w in (i for i in plan["items"] if is_wild(i) and i["key"] in (built or {})):
        opts = [str(o.get("value") or "") for o in built[w["key"]]["payload"].get(
            "options") or [] if isinstance(o, dict)]
        written = [c for c in (sorted(_chunks(o))[:1] for o in opts) if c and len(c[0]) >= 5
                   and re.search(r"(?<!\w)" + re.escape(c[0]) + r"(?!\w)", low)]
        if len(written) >= 2:
            said.append(f"It writes out {w['name']}'s options itself ("
                        + ", ".join(f'"{c[0]}"' for c in written[:3]) + "), so every prompt "
                        f"lists them all; read ${w['var']} instead")
    tpl = next((i for i in plan["items"] if i["kind"] == "template"), None)
    shown = set(_reads(tpl.get("about") or "")) if tpl is not None else set()
    for c in plan["items"]:
        if c["kind"] != "combine" or c is item or c["key"] not in (built or {}) \
                or c["var"] not in shown \
                or item["var"] in _combine_inputs(plan, built or {}, c["var"]):
            continue
        dup = sorted(reads & set(_combine_inputs(plan, built or {}, c["var"])))
        if dup:
            said.append(f"It also reads ${', $'.join(dup)}, which ${c['var']} ({c['name']}) "
                        "already joins, so the prompt shows it twice; leave it out")
    if tpl is not None:
        both = sorted(v for v in reads & set(_reads(tpl.get("about") or ""))
                      if v not in planned)
        if both:
            said.append(f"It also reads ${', $'.join(both)}, which the template prints "
                        "itself, so the prompt shows it twice; leave it out")
    return said


_GETS_ONLY = re.compile(r"#([\w-]+)\s+gets\s+only\s+#([\w-]+)", re.I)


def _entry_core(v: str) -> str:
    """A comma-list entry that reads ``$v``, with at most two plain words
    of its own around it ("$weather conditions")."""
    return (r"\s*(?:[A-Za-z]+\s+){0,2}\$" + re.escape(v)
            + r"\b(?![.\w])(?:\s+[A-Za-z]+){0,2}\s*")


def _entry(v: str) -> str:
    return r"(?:^|,)" + _entry_core(v) + r"(?=,|$)"


def _plan_onlys(item: dict[str, Any], src: dict[str, Any], tgt: dict[str, Any],
                matrix: dict[str, dict[str, Any]]) -> list[str]:
    """The plan's "#winter gets only #winter" clauses as only cells, in
    place, whatever the model wrote for that row: a "never" written next to
    them (no sandals in winter) used to come back as a few excludes with
    the only rows gone. Other cells in such a row that let a target
    through (boost, reduce, allow) go; excludes stay."""
    st = {str(t).lower(): t for t in src.get("tags") or []}
    tt = {str(t).lower(): t for t in tgt.get("tags") or []}
    carried = {t for o in tgt.get("options") or [] for t in o.get("tags") or []}
    said = []
    for a, b in _GETS_ONLY.findall(str(item.get("about") or "")):
        sa, tb = st.get(a.lower()), tt.get(b.lower())
        if sa is None or tb is None or tb not in carried:
            continue
        row = matrix.setdefault(sa, {})
        if (row.get(tb) or {}).get("mode") != "only":
            said.append(f"#{sa} → #{tb}")
        row[tb] = {"mode": "only", "factor": 1}
        for k in [k for k, c in row.items() if k != tb and isinstance(c, dict)
                  and c.get("mode") not in ("only", "exclude")]:
            del row[k]
    return said


def _plan_only_withs(item: dict[str, Any], src: dict[str, Any], tgt: dict[str, Any],
                     matrix: dict[str, dict[str, Any]]) -> list[str]:
    """The plan's "#snow only with #cold" clauses as excludes, in place:
    every source tag but #cold excludes #snow."""
    st = {str(t).lower(): t for t in src.get("tags") or []}
    tt = {str(t).lower(): t for t in tgt.get("tags") or []}
    carried = {t for o in tgt.get("options") or [] for t in o.get("tags") or []}
    said = []
    for a, b in _ONLY_WITH.findall(str(item.get("about") or "")):
        tb = tt.get(a.lower())
        keeps = [st[b.lower()]] if b.lower() in st else _case_kin(b.lower(), st)
        if tb is None or not keeps or tb not in carried:
            continue
        hit = False
        for keep in keeps:
            kept = matrix.get(keep) or {}
            if any(isinstance(c, dict) and c.get("mode") == "only" for c in kept.values()) \
                    and (kept.get(tb) or {}).get("mode") != "only":
                # "#cold gets only #cold" would shut snow out of the cold
                # places too: there it's one of the kept ones.
                kept[tb] = {"mode": "only", "factor": 1}
                hit = True
        for sa in st.values():
            if sa in keeps:
                continue
            row = matrix.setdefault(sa, {})
            if (row.get(tb) or {}).get("mode") != "exclude":
                row[tb] = {"mode": "exclude", "factor": 0}
                hit = True
        if hit:
            said.append(f"#{tb} only with #{', #'.join(keeps)}")
    return said


#: The source tags that count as a case the request names ("cold" places
#: are the arctic, tundra and alpine ones on a biome list without #cold).
_CASE_KIN = {"cold": r"cold|cool|arctic|polar|tundra|alpine|frozen|icy|snowy|winter|"
                     r"boreal|subarctic|glacial|taiga",
             "hot": r"hot|warm|tropical|desert|arid|summer|volcanic",
             "wet": r"wet|rainy|humid|tropical|monsoon|rainforest|swamp|marsh",
             "dry": r"dry|arid|desert|savann?ah?|steppe"}


def _case_kin(case: str, tags: dict[str, str]) -> list[str]:
    pat = _CASE_KIN.get(case) or _CASE_KIN.get(case.rstrip("s"))
    if not pat:
        return []
    word = re.compile(r"(?:^|[_-])(?:" + pat + r")(?:$|[_-])")
    return [t for k, t in tags.items() if word.search(k)]


# An option that stands for "nothing" ("no color variation", "none").
_PLACEHOLDER = re.compile(r"^\s*(?:none|n/?a|no\s+(?:\w+\s+){0,2}"
                          r"(?:variation|change|modifier|extra|accent)s?)\s*$", re.I)


def _list_options(options: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Options that are a list of the others ("staff, wand, sword, axe")."""
    heads = [(o, sorted(_chunks(str(o.get("value") or "")))[:1]) for o in options]
    out = []
    for o, _ in heads:
        parts = [re.sub(r"\s+", " ", x).strip().lower()
                 for x in str(o.get("value") or "").split(",")]
        others = {h[0] for p, h in heads if p is not o and h}
        named = {p for p in parts if p in others or any(
            re.search(r"(?<!\w)" + re.escape(p) + r"(?!\w)", h) for h in others if len(p) >= 3)}
        if len(parts) >= 4 and len(named) >= 3:
            out.append(o)
    return out


_SNAKE = re.compile(r"(\$[A-Za-z_]\w*|@\{[^}]*\}|<[^>]*>)|(?<=[A-Za-z])_(?=[A-Za-z])")


def _snake_text(rows: list[Any]) -> list[str]:
    """Values written as tag ids ("polar_bear") print the underscores:
    they become words, in place ($reads and @{refs} stay as they are)."""
    said = []
    for r in rows:
        v = r.get("value") if isinstance(r, dict) else None
        if isinstance(v, str) and "_" in v:
            text = _SNAKE.sub(lambda m: m.group(1) or " ", v)
            if text != v:
                r["value"] = text
                said.append(v)
    if not said:
        return []
    return [f"Wrote \"{said[0][:40]}\"{' and others' if len(said) > 1 else ''} with spaces: "
            "underscores printed as text"]


#: What a kept pick looks like in other words ("blizzard" is snow).
_KIN_WORDS = {"snow": r"snow\w*|blizzard\w*|hail\w*|sleet\w*|frost\w*|icy|whiteout",
              "rain": r"rain(?!bow)\w*|drizzl\w*|downpour\w*|monsoon\w*",
              "fog": r"fog\w*|mist\w*|haze|hazy",
              "storm": r"storm\w*|thunder\w*|lightning"}


def _kin_options(plan: dict[str, Any], item: dict[str, Any],
                 payload: dict[str, Any]) -> list[str]:
    """A "#snow only with #cold" rule only stops options tagged #snow: the
    rule's target tags the ones that say snow in other words ("blizzard
    winds"), and another wildcard leaves them out (its picks aren't kept to
    the cold places)."""
    said: list[str] = []
    opts = [o for o in payload.get("options") or [] if isinstance(o, dict)
            and isinstance(o.get("value"), str)]
    for c in (c for c in plan["items"] if c["kind"] == "constraint"):
        if item["var"] == c["source"]:
            continue
        for a, b in _ONLY_WITH.findall(c.get("about") or ""):
            a = a.lower()
            kin = re.compile(r"\b(?:" + str(_KIN_WORDS.get(a.rstrip("s"), re.escape(a) + r"\w*"))
                             + r")\b", re.I)
            hits = [o for o in opts if kin.search(o["value"])
                    and a not in (o.get("sub_categories") or [])]
            if not hits:
                continue
            first = f"\"{hits[0]['value'][:40]}\"" + (" and others" if len(hits) > 1 else "")
            if item["var"] == c["target"]:
                for o in hits:
                    o["sub_categories"] = [*(o.get("sub_categories") or []), a]
                if a not in payload.get("sub_categories", []):
                    payload["sub_categories"] = [*payload.get("sub_categories", []), a]
                said.append(f"Tagged {first} "
                            f"#{a}: it says {a} in other words, and {c['name']} keeps #{a} "
                            f"to #{b.lower()}")
            elif len(hits) * 2 < len(opts):
                payload["options"] = [o for o in payload["options"] if o not in hits]
                opts = [o for o in opts if o not in hits]
                said.append(f"Left out {first}: "
                            f"the request keeps {a} to #{b.lower()}, and only "
                            f"${c['target']} follows that rule")
    return said


_PHRASE_GAP = re.compile(r"\s*(?:\$[A-Za-z_]\w*\s+)+\$[A-Za-z_]\w*\s*")


def _bare_join(text: str, plan: dict[str, Any],
               built: dict[str, Any]) -> tuple[str, list[str]]:
    """A combine of picks side by side ("$top $bottom $shoes") runs whole
    phrases together ("henley shirt cargo shorts loafers"): commas go in
    when every pick it joins is a phrase of two words or more."""
    if not _PHRASE_GAP.fullmatch(text):
        return text, []
    wild = {i["var"]: i for i in plan["items"] if is_wild(i)}
    for v in text_items.reads(text):
        w = wild.get(v)
        b = built.get(w["key"]) if w else None
        if b is None:
            return text, []
        opts = [str(o.get("value") or "") for o in b["payload"].get("options") or []
                if isinstance(o, dict)]
        if not opts or sum(len(o.split()) for o in opts) < 2 * len(opts):
            return text, []
    return tag_commas(text), ["Put commas between the picks it joins: whole phrases ran "
                              "together"]


def _wrap_pipes(rows: list[Any]) -> list[str]:
    """Values written as bare alternatives ("morning light|golden hour")
    print the "|" as text: they become one pick, ``{a|b}``, in place."""
    said = []
    for r in rows:
        v = r.get("value") if isinstance(r, dict) else None
        if isinstance(v, str) and "|" in v and not re.search(r"[{}]", v):
            r["value"] = "{" + "|".join(p.strip() for p in v.split("|")) + "}"
            said.append(v)
    if not said:
        return []
    return [f"Made \"{said[0][:40]}\"{' and others' if len(said) > 1 else ''} a pick of "
            "one: a bare \"|\" printed as text"]


def _combine_inputs(plan: dict[str, Any], built: dict[str, Any], var: str,
                    seen: set[str] | None = None) -> list[str]:
    """What a combine joins, through the combines it joins ($character
    joining $look, which joins $race and $skin)."""
    seen = seen if seen is not None else {var}
    combos = {c["var"]: c for c in plan["items"] if c["kind"] == "combine"
              and c["key"] in built}
    out: list[str] = []
    joins = built[combos[var]["key"]]["payload"].get("input_vars") or [] \
        if var in combos else []
    for v in joins:
        if v in seen:
            continue
        seen.add(v)
        out.append(v)
        if v in combos:
            out += _combine_inputs(plan, built, v, seen)
    return out


def _drop_double_reads(plan: dict[str, Any], built: dict[str, Any],
                       payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """A template that reads a combine and what the combine joins prints it
    twice ("$race, $class, $race_class"): the separate reads go."""
    text = payload["template_string"]
    said: list[str] = []
    shown = set(text_items.reads(text))
    for c in plan["items"]:
        if c["kind"] != "combine" or c["key"] not in built or c["var"] not in shown:
            continue
        joined = [v for v in _combine_inputs(plan, built, c["var"])
                  if v in shown and v != c["var"]]
        # Only a read that is a list entry of its own goes: in a sentence
        # ("wearing a $top and $bottom") dropping it leaves the words behind.
        # A list entry may carry a word or two of its own ("$weather conditions").
        joined = [v for v in joined if re.search(_entry(v), text)]
        for v in joined:
            text = ",".join(p for p in text.split(",")
                            if not re.fullmatch(_entry_core(v), p)).strip(" ,")
        if joined:
            shown -= set(joined)
            said.append(f"Dropped ${', $'.join(joined)}: ${c['var']} ({c['name']}) already "
                        "holds them")
    # Two combines where one holds all of the other ("$hero" with race,
    # look and class next to "$look"): the smaller one prints twice.
    combos = [c for c in plan["items"] if c["kind"] == "combine" and c["key"] in built
              and c["var"] in shown and re.search(_entry(c["var"]), text)]
    for c in combos:
        inner = set(_combine_inputs(plan, built, c["var"]))
        if not inner or c["var"] not in shown:
            continue
        big = next((o for o in combos if o is not c and o["var"] in shown
                    and inner <= set(_combine_inputs(plan, built, o["var"]))), None)
        if big is None:
            continue
        text = ",".join(p for p in text.split(",")
                        if not re.fullmatch(_entry_core(c["var"]), p)).strip(" ,")
        shown.discard(c["var"])
        said.append(f"Dropped ${c['var']}: ${big['var']} ({big['name']}) already holds "
                    "everything it joins")
    # The same variable read twice as list entries prints it twice.
    parts, seen, twice = text.split(","), set(), []
    kept = []
    for p in parts:
        m = re.fullmatch(r"\s*\$([a-zA-Z_]\w*)\s*", p)
        if m and m.group(1) in seen:
            twice.append(m.group(1))
            continue
        if m:
            seen.add(m.group(1))
        kept.append(p)
    if twice:
        text = ",".join(kept).strip(" ,")
        said.append(f"Read ${', $'.join(dict.fromkeys(twice))} once: the template printed "
                    "it twice")
    if not said:
        return payload, []
    return {**payload, "template_string": text}, said


def _append_onto_nothing(plan: dict[str, Any], key: str, built: dict[str, Any],
                         payload: dict[str, Any]) -> list[str]:
    """An append (or prepend) to a variable nothing else sets adds to an
    empty value, so the prompt shows its leading ", ". When one rule is all
    that writes it (only one of its branches runs), those writes become
    plain sets, in place."""
    others = set(RUNTIME_VARS) | {i["var"] for i in plan.get("inputs") or []} \
        | {c["name"] for c in plan.get("canvas") or []}
    for i in plan["items"]:
        if i["key"] == key or i.get("kind") in ("constraint", "template"):
            continue
        if i["var"]:
            others.add(i["var"])
        if i["kind"] == "derivation" and i["key"] in built:
            others |= set(library_vars.derivation_targets(built[i["key"]]["payload"]))
    writers: dict[str, list[tuple[int, dict[str, Any]]]] = {}
    for n, rule in enumerate(payload["rules"]):
        for clause in [*(rule.get("branches") or []), rule.get("else")]:
            if not isinstance(clause, dict):
                continue
            for a in [clause.get("action"), *(clause.get("extra_actions") or [])]:
                if isinstance(a, dict) and isinstance(a.get("target_var"), str):
                    writers.setdefault(a["target_var"], []).append((n, a))
    said: list[str] = []
    for var, acts in writers.items():
        if var in others or len({n for n, _ in acts}) != 1:
            continue
        flat = [a for _, a in acts]
        if not any(a.get("mode") in ("append", "prepend") for a in flat) or any(
                a.get("mode") not in ("append", "prepend", "replace") for a in flat):
            continue
        for a in flat:
            if a.get("mode") in ("append", "prepend"):
                a["mode"] = "replace"
                a["value"] = str(a.get("value") or "").strip().strip(",").strip()
        said.append(f"Sets ${var} instead of adding to it: nothing sets it before")
    return said


def _second_rolls(plan: dict[str, Any], payload: dict[str, Any],
                  built: dict[str, Any] | None = None) -> list[str]:
    """A rule that writes a wildcard's own variable with an ``@{…}`` pick
    (summer → ``@{Outerwear:parka}``) rolls that wildcard a second time and
    throws the first pick away; one that appends picks of its kind to it
    (``$footwear`` += "open-toed sandals") puts two in the prompt. Both
    writes are taken out, in place (a branch left with nothing goes, then
    a rule with nothing): the wildcard picks, a constraint narrows it."""
    wild = {i["var"]: i for i in plan["items"] if is_wild(i)}
    heads: dict[str, set[str]] = {}
    for v, i in wild.items():
        opts = (built or {}).get(i["key"], {}).get("payload", {}).get("options") or []
        heads[v] = {c.split()[-1] for o in opts if isinstance(o, dict)
                    for c in _chunks(str(o.get("value") or "")) if len(c.split()[-1]) >= 4}
    said: list[str] = []

    def bad(a: Any) -> bool:
        var = a.get("target_var") if isinstance(a, dict) else None
        if var not in wild:
            return False
        value = str(a.get("value") or "")
        name = wild[var]["name"]
        if "@{" in value:
            note = (f"Left out a write of ${var} with a new pick (@{{…}}): it rolled {name} "
                    "a second time; the wildcard picks it, a constraint narrows it")
        elif a.get("mode") in ("append", "prepend") and {
                c.split()[-1] for c in _chunks(value)} & heads.get(str(var), set()):
            note = (f"Left out adding more {name} to ${var}: it put two in the prompt; the "
                    "wildcard picks one, a constraint narrows it")
        else:
            return False
        if note not in said:
            said.append(note)
        return True

    rules = []
    for rule in payload["rules"]:
        branches = []
        for clause in [*(rule.get("branches") or []), rule.get("else")]:
            if not isinstance(clause, dict):
                branches.append(clause)
                continue
            acts = [x for x in [clause.get("action"), *(clause.get("extra_actions") or [])]
                    if isinstance(x, dict) and not bad(x)]
            if not acts:
                branches.append(None)
                continue
            new = {**clause, "action": acts[0]}
            if len(acts) > 1:
                new["extra_actions"] = acts[1:]
            else:
                new.pop("extra_actions", None)
            branches.append(new)
        n = len(rule.get("branches") or [])
        kept = [x for x in branches[:n] if x is not None]
        other = branches[n] if len(branches) > n else None
        if kept:
            rules.append({**rule, "branches": kept,
                          **({"else": other} if other is not None else {})})
            if other is None:
                rules[-1].pop("else", None)
    if said:
        if not rules:
            raise ValueError("every rule wrote a wildcard's own pick; " + said[0])
        payload["rules"] = rules
    return said


_ONLY = re.compile(r"\bonly\b", re.I)
_SOFT = re.compile(r"\b(rarely|rarer|less|fewer|seldom|unlikely|sometimes|reduces?|mostly|"
                   r"usually|often)\b", re.I)


def _strict_rules(item: dict[str, Any], payload: dict[str, Any],
                  source: dict[str, Any] | None = None) -> list[str]:
    """The plan says "never" (or "only") and the model wrote rules that just
    make the target rarer. "Never": reduce rules become excludes (in place;
    boosts stay), and a near-zero reduce does even when other words soften
    the plan. "Only" with excludes for some source tags: the source tags
    with no rule for that target tag get an exclude too (snow only in cold
    biomes excludes snow from every biome that isn't boosted for it). An
    "only" with neither is sent back."""
    text = f"{item.get('name') or ''}. {item.get('about') or ''}"
    matrix = payload["matrix"]
    cells = [c for row in matrix.values() for c in row.values() if isinstance(c, dict)]
    rules = cells + list(payload["exceptions"])
    if not rules:
        return []
    said: list[str] = []
    soft = bool(_SOFT.search(item.get("about") or ""))
    if _ONLY.search(text) and not soft:
        if not any(r.get("mode") in ("only", "exclude") for r in rules):
            return ["The plan says \"only\", but no rule is an only or exclude rule, so every "
                    "other pair still goes through"]
        filled = _fill_only(matrix, source) + _fill_only_exceptions(payload, source)
        if filled:
            said.append("Excluded " + ", ".join(filled[:6]) + (" and more" if len(filled) > 6
                                                               else "")
                        + ": the plan says only, so every other source shuts it out")
        return said
    if not _NEVER.search(text):
        return []
    reduce = [r for r in rules if r.get("mode") == "reduce"
              and (not soft or float(r.get("factor") or 0) <= 0.2)]
    for r in reduce:
        r["mode"], r["factor"] = "exclude", 0
    if reduce:
        said.append("Made its reduce rules exclude: the plan says the pairs never go together")
    return said


#: Exceptions an "only" fill may add.
MAX_FILLED = 150


def _fill_only_exceptions(payload: dict[str, Any],
                          source: dict[str, Any] | None) -> list[str]:
    """`_fill_only` for option pairs: a target option some source options
    exclude and others allow is excluded from the source options with no
    rule for it."""
    excs = payload["exceptions"]
    opts = [o for o in (source or {}).get("options") or [] if isinstance(o, dict)]
    by_target: dict[str, dict[str, Any]] = {}
    for e in excs:
        by_target.setdefault(e.get("target"), {})[e.get("source")] = e
    out: list[str] = []
    for t, rows in by_target.items():
        modes = {e.get("mode") for e in rows.values()}
        if "exclude" not in modes or not modes & {"boost", "only", "allow"}:
            continue
        sample = next(iter(rows.values()))
        for o in opts:
            if o["value"] in rows or len(out) >= MAX_FILLED:
                continue
            exc = {"source": o["value"], "target": t, "mode": "exclude", "factor": 0}
            if o.get("id"):
                exc["source_id"] = o["id"]
            if sample.get("target_id"):
                exc["target_id"] = sample["target_id"]
            excs.append(exc)
            out.append(f"{t} for {o['value']}")
    return out


def _fill_only(matrix: dict[str, dict[str, Any]],
               source: dict[str, Any] | None) -> list[str]:
    """For each target tag some source tags exclude and others allow (boost
    or only), exclude it from the source tags with no rule for it."""
    tags = [t for t in (source or {}).get("tags") or [] if isinstance(t, str)]
    targets = {t for row in matrix.values() for t in row}
    out: list[str] = []
    for t in sorted(targets):
        modes = {s: row[t].get("mode") for s, row in matrix.items()
                 if isinstance(row.get(t), dict)}
        if "exclude" not in modes.values() or not any(
                m in ("boost", "only", "allow") for m in modes.values()):
            continue
        for s in tags:
            if s not in modes:
                matrix.setdefault(s, {})[t] = {"mode": "exclude", "factor": 0}
                out.append(f"#{t} for #{s}")
    return out
