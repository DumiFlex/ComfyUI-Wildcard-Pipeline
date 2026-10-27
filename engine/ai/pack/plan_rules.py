"""Pack builder plan fix-ups: the rules `compile_plan` applies to the model's raw
items (split and merged pickers, case rules, fits, "never" and "only in"
requests, unasked drivers) before it checks the plan."""
from __future__ import annotations

import re
from typing import Any

from engine.ai.pack._common import (
    _STOP,
    _TAG_REF,
    MAX_ABOUT,
    MAX_COUNT,
    _cut,
    _once,
    _tag,
    _var,
)


def _split_groups(wild: list[dict[str, Any]],
                  others: list[dict[str, Any]]) -> list[tuple[str, dict[str, dict[str, Any]]]]:
    """``[(role, {case: item})]`` for wildcards that split one subject per
    case ($winter_tops, $summer_tops): a role whose cases also split another
    role (a grid: tops and shoes per season), or three or more cases that
    another item names (the season wildcard's tags or words)."""
    by_role: dict[str, dict[str, dict[str, Any]]] = {}
    for w in wild:
        parts = _var(w.get("var")).lower().split("_")
        if len(parts) >= 2 and parts[0] and parts[-1]:
            # $winter_tops (case first) and $animal_desert (case last).
            by_role.setdefault("_".join(parts[1:]), {})[parts[0]] = w
            by_role.setdefault("_".join(parts[:-1]) + "_", {})[parts[-1]] = w
    words = " ".join(f"{o.get('name') or ''} {o.get('about') or ''} "
                     + " ".join(str(t) for t in o.get("tags") or [])
                     for o in others).lower()
    other_tags = [str(t).lower() for o in others for t in o.get("tags") or []]
    out = []
    for role, cases in by_role.items():
        if len(cases) < 2:
            continue
        grid = any(r != role and r.endswith("_") == role.endswith("_")
                   and len(set(cases) & set(c)) >= 2 for r, c in by_role.items())
        named = sum(1 for c in cases if re.search(r"\b" + re.escape(c) + r"\b", words)
                    or _case_tag(c, other_tags))
        # Another item must name the cases ("upper_body" / "lower_body" next
        # to each other is two subjects, not a split by case).
        if grid and named >= 2 or len(cases) >= 3 and named >= 3:
            out.append((role.rstrip("_"), cases))
    # One wildcard can only be in one group: the bigger split wins.
    out.sort(key=lambda g: -len(g[1]))
    seen: set[int] = set()
    kept = []
    for role, cases in out:
        if not any(id(w) in seen for w in cases.values()):
            seen.update(id(w) for w in cases.values())
            kept.append((role, cases))
    return kept


_MODIFIERS = {"base", "main", "primary", "secondary", "variation", "variant", "alt",
              "extra", "accent", "second", "alternate", "other", "additional", "bias",
              "weight", "weights", "odds", "choice", "pick"}
#: Words that all name one attribute: a colour wildcard next to a tone or
#: highlights one prints two colours.
_SAME_ATTRIBUTE = (frozenset({"color", "colour", "tone", "tones", "shade", "hue", "tint",
                              "highlights", "highlight", "streaks", "dye"}),
                   frozenset({"length", "lengths", "long"}))


def _twin_picks(wild: list[dict[str, Any]]) -> list[tuple[dict[str, Any], dict[str, Any], str]]:
    """Two wildcards for one thing ($hair_color_base, $hair_color_variation;
    $hair_color, $hair_color_alt): ``[(first, second, "hair color")]``."""
    out = []
    for n, a in enumerate(wild):
        pa = a["var"].split("_")
        for b in wild[n + 1:]:
            pb = b["var"].split("_")
            k = 0
            while k < min(len(pa), len(pb)) and pa[k] == pb[k]:
                k += 1
            ra, rb = pa[k:], pb[k:]
            kin = next((f for f in _SAME_ATTRIBUTE if pa[k - 1] in f), frozenset()) if k else ()
            if k >= 2 and all(len(r) <= 1 and (not r or r[0] in _MODIFIERS or r[0] in kin)
                              for r in (ra, rb)):
                out.append((a, b, " ".join(pa[:k])))
            elif k == 1 and ra and rb and any(
                    ra[0] in fam and rb[0] in fam
                    and all(w in _MODIFIERS for w in ra[1:] + rb[1:]) for fam in _SAME_ATTRIBUTE):
                out.append((a, b, f"{pa[0]} {ra[0]}"))
    return out


def _case_namers(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Items that may name the cases a split is by: anything but the split
    wildcards themselves (their own names say "Winter Tops")."""
    return [x for x in items if x.get("kind") != "wildcard"
            or len(_var(x.get("var")).split("_")) < 2]


def _merge_splits(raw_items: list[dict[str, Any]],
                  warnings: list[str]) -> list[dict[str, Any]]:
    """One subject split into a wildcard per case becomes one wildcard
    tagged by case, the reads of the parts read it, and a constraint from
    the wildcard that names the cases (the season) keeps each case's
    options to it. Without that the prompt lists every case's picks."""
    wild = [x for x in raw_items if x.get("kind") == "wildcard" and _var(x.get("var"))]
    groups = _split_groups(wild, _case_namers(raw_items))
    if not groups:
        return raw_items
    taken = {_var(x.get("var")) for x in raw_items}
    items = list(raw_items)
    for role, cases in groups:
        members = list(cases.values())
        old_vars = [_var(m.get("var")) for m in members]
        holder = next((x for x in items if _var(x.get("var")) == role
                       and x not in members), None)
        if holder is not None:
            # A "Select Animal" item that picks among the parts by case is
            # what the merged wildcard does itself: it goes.
            text = f"{holder.get('about') or ''} {holder.get('use') or ''}"
            if holder.get("kind") in ("derivation", "combine") and (
                    sum(1 for v in old_vars if f"${v}" in text) >= 2
                    or _dynamic_ref(role).search(text)):
                items.remove(holder)
                warnings.append(f"Left out {holder.get('name') or role}: the merged "
                                f"{role.replace('_', ' ')} wildcard picks by case itself")
            else:
                continue
        names = set(cases)
        source = next((x for x in wild if x not in members and x not in sum(
            (list(c.values()) for _, c in groups), []) and (
            len(names & {str(t).lower() for t in x.get("tags") or []}) >= 2
            or sum(1 for c in names if re.search(r"\b" + re.escape(c) + r"\b",
                                                 f"{x.get('name')} {x.get('about')}".lower()))
            >= 2)), None)
        if source is None:
            # "elven_traits", "dwarven_traits" next to a race tagged elf, dwarf.
            for x in wild:
                if x in members or x in sum((list(c.values()) for _, c in groups), []):
                    continue
                tags = [str(t).lower() for t in x.get("tags") or []]
                hit = {c: t for c in names if (t := _case_tag(c, tags))}
                if len(hit) >= 2:
                    source = x
                    cases = {hit.get(c, c): m for c, m in cases.items()}
                    names = set(cases)
                    break
        if source is None:
            continue  # nothing to key the cases on: the review flags it instead
        merged = {
            "kind": "wildcard", "name": role.replace("_", " ").title(), "var": role,
            "about": f"{role.replace('_', ' ')} for each "
                     f"{str(source.get('name') or _var(source.get('var'))).lower()} case "
                     f"({', '.join(cases)}); tag every option with the case it fits. "
                     + " ".join(
                         str(m.get("about") or "")[:120] for m in members),
            "count": min(MAX_COUNT, sum(int(m.get("count") or 0) for m in members) or 0),
            "tags": list(cases), "section": members[0].get("section") or "", "use": ""}
        at = items.index(members[0])
        items = [x for x in items if x not in members]
        items.insert(at, merged)
        taken.add(role)
        pat = re.compile(r"\$(?:" + "|".join(map(re.escape, old_vars)) + r")\b")
        # "boost tundra_animal" (the part's name without $) is its case's tag.
        bare = {_var(m.get("var")): c for c, m in cases.items()}
        bare_pat = re.compile(r"(?<![$\w])(?:" + "|".join(map(re.escape, bare)) + r")\b")
        for x in items:
            for field in ("about", "use"):
                if isinstance(x.get(field), str):
                    x[field] = _once(_dynamic_ref(role).sub(
                        f"${role}", pat.sub(f"${role}", x[field])), role)
                    if x.get("kind") == "constraint":
                        x[field] = bare_pat.sub(lambda m, b=bare: "#" + b[m.group(0)], x[field])
            if x.get("kind") == "constraint":
                for side in ("source", "target"):
                    if _var(x.get(side)) in old_vars:
                        x[side] = role
        src = _var(source.get("var"))
        source["tags"] = list(dict.fromkeys([*(source.get("tags") or []), *cases]))
        # The per-case rules now all link the same two wildcards: one rule.
        same = [x for x in items if x.get("kind") == "constraint"
                and _var(x.get("source")) == src and _var(x.get("target")) == role]
        if len(same) > 1:
            same[0]["about"] = _cut("; ".join(dict.fromkeys(
                str(x.get("about") or "").strip() for x in same if x.get("about"))), MAX_ABOUT)
            items = [x for x in items if x not in same[1:]]
        if same:
            # A rule the plan had between them ("no shorts in winter") also
            # keeps each case's options to it.
            had = str(same[0].get("about") or "")
            more = [f"#{c} gets only #{c}" for c in cases
                    if f"#{c} gets only #{c}" not in had.lower()]
            if more:
                same[0]["about"] = _cut(had.rstrip("; ") + "; " + "; ".join(more)
                                        if had else "; ".join(more), MAX_ABOUT)
        else:
            items.insert(items.index(merged), {
                "kind": "constraint", "name": f"{source.get('name') or src} → "
                f"{merged['name']}", "source": src, "target": role,
                "about": "; ".join(f"#{c} gets only #{c}" for c in cases),
                "section": merged["section"], "use": ""})
        warnings.append(
            "Merged " + ", ".join(str(m.get("name") or m.get("var")) for m in members)
            + f" into one {merged['name']} wildcard tagged by case, kept to the "
            f"{source.get('name') or src} pick by a constraint")
    return items


def _case_tag(case: str, tags: list[str]) -> str | None:
    """The tag a case word means: itself, or its stem ("elven" → elf,
    "dwarven" → dwarf, "orcish" → orc)."""
    if case in tags:
        return case
    for t in tags:
        n = 0
        while n < min(len(t), len(case)) and t[n] == case[n]:
            n += 1
        if len(t) >= 3 and n >= max(2, len(t) - 1) and len(case) - n <= 4:
            return t
    return None


def _dynamic_ref(role: str) -> re.Pattern[str]:
    """A read that builds the name from another pick ("$animal_{$biome}",
    "$animal_<biome>", or the "$animal_" left of it): no such variable."""
    return re.compile(r"\$" + re.escape(role) + r"_(?:\{[^}]*\}|<[^>]*>|\[[^\]]*\]|"
                      r"\$\w+)?(?!\w)")


def _names(x: dict[str, Any], words: list[str]) -> list[str]:
    """The ``words`` an item names in its tags, name or about."""
    text = " ".join([str(x.get("name") or ""), str(x.get("about") or ""),
                     *(str(t) for t in x.get("tags") or [])]).lower().replace("_", " ")
    return [w for w in words
            if re.search(r"\b" + re.escape(w.replace("_", " ")) + r"s?\b", text)]


def _case_rules(raw_items: list[dict[str, Any]],
                warnings: list[str]) -> list[dict[str, Any]]:
    """Options tagged by the cases another pick names (tops tagged winter /
    summer next to a season wildcard) follow that pick: a "#winter gets
    only #winter" rule is added, or added to the rule already between
    them. Tags nothing enforces leave a wool sweater in summer. One pick
    keeps each wildcard (the one already ruling it, else the first), so
    three picks tagged by biome don't all get rules into the weather.

    The wildcard must say it follows that pick ("tagged by season", "for
    each biome"): two colour lists (eyes and hair) share their tags
    without one deciding the other."""
    wild = [x for x in raw_items if x.get("kind") == "wildcard" and _var(x.get("var"))]
    items = list(raw_items)

    def rule_of(sv: str, tv: str) -> dict[str, Any] | None:
        return next((x for x in items if x.get("kind") == "constraint"
                     and _var(x.get("source")) == sv and _var(x.get("target")) == tv), None)

    for w in wild:
        tv = _var(w.get("var"))
        tags = [str(t).lower() for t in w.get("tags") or [] if str(t).strip()]
        if len(tags) < 2:
            continue
        found = []
        # The pick that decides comes first in the plan (season, then tops).
        for src in wild[:wild.index(w)]:
            if not _follows(w, src):
                continue
            cases = _names(src, tags)
            own = {str(t).lower() for t in src.get("tags") or []}
            # The source must be about the cases: two of its own tags, or
            # three of them in its name or description.
            if len(set(cases) & own) < 2 and len(cases) < 3:
                continue
            sv = _var(src.get("var"))
            if rule_of(tv, sv) is not None:
                found = []
                break
            found.append((src, cases, rule_of(sv, tv)))
        if not found:
            continue
        src, cases, rule = next((f for f in found if f[2] is not None), found[0])
        sv = _var(src.get("var"))
        about = str((rule or {}).get("about") or "")
        missing = [c for c in cases if not re.search(
            "#" + re.escape(c) + r"\b[^;]*#" + re.escape(c) + r"\b", about.lower())]
        if not missing:
            continue
        said = "; ".join(f"#{c} gets only #{c}" for c in missing)
        if rule is None:
            items.insert(items.index(w), {
                "kind": "constraint", "name": f"{src.get('name') or sv} → "
                f"{w.get('name') or tv}", "source": sv, "target": tv, "about": said,
                "section": w.get("section") or "", "use": "", "_auto": True})
            warnings.append(f"Added a rule keeping {w.get('name') or tv} to the "
                            f"{src.get('name') or sv} pick: its options are tagged "
                            + ", ".join(f"#{c}" for c in missing))
        else:
            rule["about"] = _cut(about.rstrip("; ") + "; " + said if about else said,
                                 MAX_ABOUT)
            warnings.append(f"{rule.get('name') or 'A rule'} now also keeps "
                            f"{w.get('name') or tv} to its #"
                            + ", #".join(missing) + " options")
    return items


def _strip_case_suffixes(raw_items: list[dict[str, Any]], warnings: list[str]) -> None:
    """Tags spelled with their role (#summer_top, #winter_shoe) next to a
    pick tagged #summer, #winter are those cases: renamed in place (the
    wildcard's tags and every rule's #tags), so rules keyed on the season
    find them."""
    wild = [x for x in raw_items if x.get("kind") == "wildcard" and _var(x.get("var"))]
    for n, w in enumerate(wild):
        for src in wild[:n]:
            cases = {str(t).lower() for t in src.get("tags") or []}
            if len(cases) < 2:
                continue
            renamed = {}
            for t in w.get("tags") or []:
                low = str(t).lower()
                m = re.fullmatch(r"([a-z0-9]+)[_-][a-z0-9_]+|[a-z0-9_]+[_-]([a-z0-9]+)", low)
                c = m and (m.group(1) if m.group(1) in cases else
                           m.group(2) if m.group(2) in cases else None)
                if c:
                    renamed[low] = c
            if len(set(renamed.values())) < 2:
                continue
            w["tags"] = list(dict.fromkeys(renamed.get(str(t).lower(), t)
                                           for t in w.get("tags") or []))
            w["_follows"] = _var(src.get("var"))
            pat = re.compile(r"#(" + "|".join(map(re.escape, renamed)) + r")\b", re.I)
            for x in raw_items:
                for field in ("about", "use"):
                    if isinstance(x.get(field), str):
                        x[field] = pat.sub(lambda m, r=renamed: "#" + r[m.group(1).lower()],
                                           x[field])
            warnings.append(f"Tagged {w.get('name') or _var(w.get('var'))} by "
                            f"{src.get('name') or _var(src.get('var'))} (#"
                            + ", #".join(dict.fromkeys(renamed.values())) + ") instead of "
                            "#" + ", #".join(list(renamed)[:3]))
            break


def _follows(w: dict[str, Any], src: dict[str, Any]) -> bool:
    """Whether ``w``'s description names ``src`` ("tagged by season")."""
    if w.get("_follows") == _var(src.get("var")):
        return True
    about = f"{w.get('name') or ''} {w.get('about') or ''}".lower().replace("_", " ")
    names = {_var(src.get("var")).replace("_", " "),
             *(n for n in [str(src.get("name") or "").lower()] if n)}
    names |= {n[:-1] for n in names if n.endswith("s")} | {
        " ".join(n.split()[:-1]) for n in names if len(n.split()) > 1
        and n.split()[-1] in ("options", "list", "pick", "picks", "type", "types")}
    return any(n and re.search(r"\b" + re.escape(n) + r"(?:e?s|al)?\b", about) for n in names)


_FITS = re.compile(
    r"(?:\b([a-z]+)\s+and\s+(?:an?\s+|the\s+)?)?\b([a-z]+)\s+(?:that\s+|which\s+|to\s+)?(?:fits?|fitting|match(?:es|ing)?|"
    r"suits?|suited\s+to|suiting|goes\s+with|go\s+with|right\s+for|"
    r"appropriate\s+(?:to|for)|depends?\s+on|follows?)\s+(?:the\s+|their\s+|his\s+|"
    r"her\s+|its\s+|each\s+|a\s+)?([a-z]+)", re.I)


_GROUPISH = re.compile(r"_(?:class|classes|type|types|category|categories|group|groups|"
                       r"family|families|kind)$")
_DECIDES = re.compile(
    r"\b([a-z]{3,})\s+(?:decides|determines|controls|limits|sets|picks|chooses)\s+"
    r"(?:which\s+|what\s+|the\s+|its\s+|their\s+)?([a-z]{3,})", re.I)


def _fit_rules(raw_items: list[dict[str, Any]], request: str,
               warnings: list[str]) -> list[dict[str, Any]]:
    """"A weapon that fits the class": a constraint from the class pick to
    the weapon pick when the plan has both and nothing links them."""
    wild = [x for x in raw_items if x.get("kind") == "wildcard" and _var(x.get("var"))]

    def find(word: str) -> dict[str, Any] | None:
        forms = {word.lower(), word.lower()[:-1] if word.lower().endswith("s") else "",
                 word.lower()[:-2] if word.lower().endswith("es") else ""} - {""}
        if len(word) < 3:
            return None
        hits = [x for x in wild if forms & {
            f for p in _var(x.get("var")).split("_")
            for f in (p, p[:-1] if p.endswith("s") else p)}]
        if len(hits) > 1:
            # "weapon" next to $weapon and $weapon_material: the plain one.
            hits = [x for x in hits if _var(x.get("var")).rstrip("s") in forms] or hits
        if len(hits) > 1:
            # "animal" next to $animal_class and $animal_species: the pick
            # itself, not its group.
            hits = [x for x in hits if not _GROUPISH.search(_var(x.get("var")))] or hits
        if not hits:
            # "habitats" for a $biome wildcard whose name or about says habitat.
            hits = [x for x in wild if forms & {
                w.rstrip("s") if len(w) > 3 else w for w in re.findall(
                    r"[a-z]+", f"{x.get('name') or ''} {x.get('about') or ''}".lower())}]
        return hits[0] if len(hits) == 1 else None

    items = list(raw_items)
    pairs = []
    for m in _FITS.finditer(request):
        # "an outfit and a weapon that fit the class": both follow it.
        pairs += [(w, m.group(3)) for w in (m.group(1), m.group(2)) if w]
    decides = []
    for m in _DECIDES.finditer(request):
        # "the animal decides which habitats are possible".
        pairs.append((m.group(2), m.group(1)))
        decides.append((m.group(2), m.group(1)))
    for tw, sw in decides:
        tgt, src = find(tw), find(sw)
        if tgt is None or src is None or tgt is src:
            continue
        sv, tv = _var(src.get("var")), _var(tgt.get("var"))
        # The pick decides by the target's own cases: a species tagged
        # only by class can't say which habitats fit it.
        t_tags = [t for t in tgt.get("tags") or [] if t]
        if t_tags and not set(map(str, src.get("tags") or [])) & set(map(str, t_tags)):
            src["tags"] = [*(src.get("tags") or []), *t_tags][:16]
            warnings.append(f"Tagged {src.get('name') or sv} by {tgt.get('name') or tv}'s "
                            f"cases: the request says it decides {tgt.get('name') or tv}")
        for x in [x for x in items if x.get("kind") == "constraint"
                  and _var(x.get("target")) == tv and _var(x.get("source")) != sv
                  and _GROUPISH.search(_var(x.get("source")))
                  and _var(x.get("source")).split("_")[0] == sv.split("_")[0]]:
            items.remove(x)
            warnings.append(f"Left out {x.get('name') or 'a rule'}: {src.get('name') or sv} "
                            f"decides {tgt.get('name') or tv}, not its group")
    for tw, sw in pairs:
        tgt, src = find(tw), find(sw)
        if tgt is None or src is None or tgt is src:
            continue
        sv, tv = _var(src.get("var")), _var(tgt.get("var"))
        for x in [x for x in items if x.get("_auto") and _var(x.get("target")) == tv
                  and _var(x.get("source")) != sv]:
            # Kept to the race by its tags AND to the class the request
            # names: no option fits both, so the fallback runs every time.
            items.remove(x)
            warnings.append(f"Left out {x.get('name') or 'a rule'}: the request keeps "
                            f"{tgt.get('name') or tv} to {src.get('name') or sv}, and two "
                            "keep rules leave nothing that fits both")
        have = next((x for x in items if x.get("kind") == "constraint"
                     and {_var(x.get("source")), _var(x.get("target"))} == {sv, tv}), None)
        if have is not None and _var(have.get("source")) == tv:
            # Planned the other way round (the habitat picking the animal):
            # the request says which one leads.
            have["source"], have["target"] = sv, tv
            have["about"] = (f"each {src.get('name') or sv} gets only the "
                             f"{tgt.get('name') or tv} options that fit it; exclude the rest")
            have.pop("_auto", None)
            if src.get("tags") and not tgt.get("tags"):
                tgt["tags"] = list(src["tags"])
            warnings.append(f"Turned {have.get('name') or 'a rule'} around: the request says "
                            f"{src.get('name') or sv} decides {tgt.get('name') or tv}")
            continue
        if have is not None:
            # "Fits" means the rest don't: a rule that only boosts the
            # fitting ones still hands a mage plate armour now and then.
            about = str(have.get("about") or "")
            if _var(have.get("source")) == sv and not re.search(
                    r"\b(only|exclude\w*|never|not)\b", about, re.I):
                have["about"] = _cut(about.rstrip(". ") + ". Each "
                                     f"{src.get('name') or sv} gets only the "
                                     f"{tgt.get('name') or tv} options that fit it; exclude "
                                     "the rest", MAX_ABOUT)
                warnings.append(f"{have.get('name') or 'A rule'} now keeps only the fitting "
                                f"{tgt.get('name') or tv}: the request says one fits the other")
            continue
        items.insert(items.index(tgt), {
            "kind": "constraint", "name": f"{src.get('name') or sv} → {tgt.get('name') or tv}",
            "source": sv, "target": tv,
            "about": f"each {src.get('name') or sv} gets only the {tgt.get('name') or tv} "
                     "options that fit it; exclude the ones that don't",
            "section": tgt.get("section") or "", "use": ""})
        if src.get("tags") and not tgt.get("tags"):
            tgt["tags"] = list(src["tags"])
        warnings.append(f"Added a rule from {src.get('name') or sv} to "
                        f"{tgt.get('name') or tv}: the request says one fits the other")
    asked = _stems(request)
    for tw, sw in decides:
        tgt, src = find(tw), find(sw)
        if tgt is None or src is None or tgt is src or not tgt.get("tags"):
            continue
        # The extras the planner added (an action, a backdrop) follow the
        # habitat too: an orca "resting under a tree" breaks the scene.
        tv, own = _var(tgt.get("var")), _stems(f"{_var(src.get('var'))} {_var(tgt.get('var'))}")
        ruled = {_var(x.get(s)) for x in items if x.get("kind") == "constraint"
                 for s in ("source", "target")}
        extras = [x for x in wild if x is not src and x is not tgt
                  and _var(x.get("var")) not in ruled
                  and not _GROUPISH.search(_var(x.get("var")))
                  and not (_stems(_var(x.get("var"))) - own) & asked]
        for x in extras[:2]:
            xv = _var(x.get("var"))
            items.insert(items.index(x), {
                "kind": "constraint",
                "name": f"{tgt.get('name') or tv} → {x.get('name') or xv}",
                "source": tv, "target": xv,
                "about": f"each {tgt.get('name') or tv} gets only the {x.get('name') or xv} "
                         "options that fit it; exclude the ones that don't",
                "section": x.get("section") or "", "use": ""})
            if not set(map(str, x.get("tags") or [])) & set(map(str, tgt["tags"])):
                x["tags"] = [*(x.get("tags") or []), *tgt["tags"]][:16]
            warnings.append(f"Added a rule from {tgt.get('name') or tv} to "
                            f"{x.get('name') or xv}: it has to fit the scene the request "
                            "builds")
    return items


def _stems(text: str) -> set[str]:
    out = set()
    for w in re.findall(r"[a-z]{3,}", text.lower().replace("_", " ")):
        w = w[:-3] + "f" if w.endswith("ves") else w[:-2] if w.endswith("es") \
            and len(w) > 4 else w[:-1] if w.endswith("s") and len(w) > 3 else w
        if w not in _STOP:
            out.add(w)
    return out


# A negation with the few words before it ("elves never use guns").
_NEGATED = re.compile(r"(?:\b[\w']+\s+){0,3}\b(?:no|never|not|without|can'?t|cannot|"
                      r"don'?t|doesn'?t|won'?t|shouldn'?t|nothing)\b[^.;:!?\n]{0,60}", re.I)
_SOFTEN = re.compile(r"\b(?:reduces?|reduced|reducing|lowers?|lowered|lessens?)\s+(?:the\s+)?"
                     r"(?:odds|chances?|likelihood|weight|frequency)\s+(?:of|for)\b|"
                     r"\b(?:make|makes)\s+(\w+(?:\s+\w+)?)\s+(?:rarer|less likely)\b|"
                     r"\b(?:rarely|less often|seldom|unlikely)\b", re.I)


def _never_from_request(raw_items: list[dict[str, Any]], request: str,
                        warnings: list[str]) -> None:
    """The request says "no sandals in winter" and the planner wrote the
    rule as "reduce odds of sandals": the rule says never again, so its
    pairs are excluded instead of made rarer."""
    said = [_stems(m.group(0)) for m in _NEGATED.finditer(request)]
    if not said:
        return
    for x in raw_items:
        if x.get("kind") != "constraint":
            continue
        about = str(x.get("about") or "")
        if not _SOFTEN.search(about) and not re.search(r"\breduce", about, re.I):
            # Already says never (the built rules are checked for it), or it
            # is no softened rule at all: a "goes with" rule got "Never:
            # exclude it" glued on (9B bench P3-P5, 2026-10-26).
            continue
        words = _stems(f"{x.get('name') or ''} {about}")
        if not any(len(words & s) >= 2 for s in said):
            continue
        x["about"] = (_SOFTEN.sub(lambda m: f"never allow {m.group(1)}" if m.group(1)
                                  else "never allow", about).rstrip(". ")
                      + ". Never: exclude it, as the request says")[:MAX_ABOUT]
        warnings.append(f"{x.get('name') or 'A rule'} excludes instead of reducing: the "
                        "request says never")


# "hairstyles and hair colours": a colour the request asks for by name.
_ASKED_COLOUR = re.compile(r"\b([a-z]{3,})\s+colou?rs?\b", re.I)
_COLOURISH = re.compile(r"colou?r|tone|shade|hue|tint", re.I)
#: Words before "colour" that aren't a subject ("different colours").
_NOT_SUBJECT = {"different", "many", "various", "the", "and", "with", "all", "some", "two",
                "matching", "random", "bright", "dark", "pastel", "warm", "cool", "more",
                "other", "its", "their", "his", "her", "of", "for", "skin"}


def _asked_colours(raw_items: list[dict[str, Any]], request: str,
                   warnings: list[str]) -> list[dict[str, Any]]:
    """The request asks for hair colours and the plan has hairstyles but no
    colour: a 9B planned "Hair Styles, Hair Length" and every prompt came
    out with no colour. Adds the colour wildcard, read where the template
    reads that subject."""
    asked = []
    for m in _ASKED_COLOUR.finditer(request):
        subject = m.group(1).lower()
        if subject not in _NOT_SUBJECT and subject not in asked:
            asked.append(subject)
    if not asked:
        return raw_items
    items = list(raw_items)
    taken = {_var(x.get("var")) for x in items}
    for subject in asked:
        def covers(x: dict[str, Any], subject: str = subject) -> bool:
            # By name or variable only: a Hair Styles item whose about says
            # "with colours" left round 31's hair prompts with no colour.
            words = f"{x.get('name') or ''} {x.get('var') or ''}"
            return bool(_COLOURISH.search(words)) and subject[:4] in words.lower()
        if any(covers(x) for x in items if x.get("kind") in ("wildcard", "library",
                                                             "fixed_values", "combine")):
            continue
        near = next((x for x in items if x.get("kind") == "wildcard"
                     and subject[:4] in f"{x.get('name') or ''} {x.get('var') or ''}".lower()),
                    None)
        if near is None:
            continue  # the subject itself isn't in the plan: not ours to guess
        var = f"{subject}_color"
        if var in taken:
            continue
        taken.add(var)
        item = {"kind": "wildcard", "name": f"{subject.title()} Colour", "var": var,
                "section": near.get("section") or "", "count": 12, "tags": [],
                "about": f"one {subject} colour per prompt, a colour word only "
                         f"(\"silver\", \"jet black\"), never a style or length",
                "source": "", "target": "", "use": ""}
        items.insert(items.index(near), item)
        near_var = _var(near.get("var"))
        for t in (x for x in items if x.get("kind") == "template"):
            about = str(t.get("about") or "")
            if f"${var}" in about:
                continue
            if near_var and f"${near_var}" in about:
                t["about"] = about.replace(f"${near_var}", f"${var}, ${near_var}", 1)
            else:
                t["about"] = (about.rstrip(", ") + f", ${var}").strip(", ")
        warnings.append(f"Added {item['name']}: the request asks for {subject} colours and "
                        "no item picked one")
    return items


# "snow only in cold biomes": a pick (snow) that only goes with one case
# (cold) of another (biome).
_ONLY_IN = re.compile(r"\b([a-z]{3,})\s+(?:is\s+|are\s+)?only\s+(?:in|on|for|with|during|at|"
                      r"when)\s+(?:the\s+|a\s+|an\s+)?([a-z]{3,})(?:\s+([a-z]{3,}))?", re.I)
#: What else counts as the pick a "X only in Y" keeps (hail is snow there).
_KIN = {"snow": "snow, hail, sleet, frost or a blizzard", "rain": "rain, drizzle or a storm",
        "fog": "fog, mist or haze", "storm": "a storm, thunder or lightning"}
_ONLY_WITH = re.compile(r"#([\w-]+)\s+only\s+with\s+#([\w-]+)", re.I)


def _forms(word: str) -> set[str]:
    w = word.lower()
    return {w, *(f for f in (w[:-1] if w.endswith("s") else "",
                             w[:-2] if w.endswith("es") else "",
                             w[:-3] + "y" if w.endswith("ies") else "") if len(f) >= 3)}


def _only_in_rules(raw_items: list[dict[str, Any]], request: str,
                   warnings: list[str]) -> list[dict[str, Any]]:
    """"Snow only in cold biomes": the weather's #snow goes only with the
    biome's #cold. The plan gets a "#snow only with #cold" clause on a
    biome → weather rule (made when there's none), which the build turns
    into excludes for every other biome tag, whatever the model wrote."""
    wild = [x for x in raw_items if x.get("kind") == "wildcard" and _var(x.get("var"))]
    items = list(raw_items)

    def tags(x: dict[str, Any]) -> list[str]:
        return [t for t in (_tag(t) for t in x.get("tags") or []) if t]

    for m in _ONLY_IN.finditer(request):
        what, case, group = m.group(1), m.group(2), m.group(3) or ""
        wf, cf, gf = _forms(what), _forms(case), _forms(group) if group else set()
        src = [x for x in wild if cf & set(tags(x))]
        if len(src) != 1:
            src = [x for x in wild if gf & set(_var(x.get("var")).split("_"))]
        if len(src) != 1:
            continue
        s = src[0]
        tgt = [x for x in wild if x is not s and wf & set(tags(x))]
        if len(tgt) != 1:
            tgt = [x for x in wild if x is not s and wf & set(re.findall(
                r"[a-z]+", f"{x.get('name') or ''} {x.get('about') or ''}".lower()))]
        if len(tgt) != 1:
            continue
        t = tgt[0]
        sv, tv = _var(s.get("var")), _var(t.get("var"))
        if any(x.get("kind") == "constraint" and _var(x.get("source")) == tv
               and _var(x.get("target")) == sv for x in items):
            continue  # a rule the other way: this one would make a loop
        ctag = next((x for x in tags(s) if x in cf), case.lower())
        wtag = next((x for x in tags(t) if x in wf), what.lower())
        for x, tag in ((s, ctag), (t, wtag)):
            if tag not in tags(x):
                x["tags"] = [*(x.get("tags") or []), tag]
        kin = _KIN.get(wtag.rstrip("s"), wtag)
        ask = (f"Tag every option with {kin} #{wtag}, and keep at least two of them "
               f"for the #{ctag} cases")
        if ask not in str(t.get("about") or ""):
            t["about"] = _cut(str(t.get("about") or "").rstrip(". ") + ". " + ask, MAX_ABOUT)
        clause = (f"#{wtag} only with #{ctag}: every other {s.get('name') or sv} "
                  f"excludes #{wtag}")
        have = next((x for x in items if x.get("kind") == "constraint"
                     and _var(x.get("source")) == sv and _var(x.get("target")) == tv), None)
        if have is not None:
            about = str(have.get("about") or "")
            if not _ONLY_WITH.search(about):
                have["about"] = _cut(clause + "; " + about, MAX_ABOUT)
                warnings.append(f"{have.get('name') or 'A rule'} now keeps #{wtag} to "
                                f"#{ctag}: the request says {what} only in {case}")
            continue
        items.insert(items.index(t), {
            "kind": "constraint", "name": f"{s.get('name') or sv} → {t.get('name') or tv}",
            "source": sv, "target": tv, "about": clause,
            "section": t.get("section") or "", "use": ""})
        warnings.append(f"Added a rule keeping #{wtag} to #{ctag}: the request says {what} "
                        f"only in {case}")
    return items


# Where a rule's clause turns from its source tags to its target tags.
_REL = re.compile(r"→|->|=>|:|\b(?:gets?|only|excludes?|boosts?|reduces?|favou?rs?|never|"
                  r"allows?|keeps?|means?|takes?|uses?)\b", re.I)


def _stray_rule_tags(raw_items: list[dict[str, Any]], warnings: list[str]) -> None:
    """A rule keyed on tags neither side lists ("#rogue → #dagger" on a
    class tagged #melee) matches nothing: the tags join the side the
    clause puts them on, so the options get them when they are built."""
    wild = {_var(x.get("var")): x for x in raw_items
            if x.get("kind") == "wildcard" and _var(x.get("var"))}

    def have(x: dict[str, Any]) -> set[str]:
        return {t for t in (_tag(t) for t in x.get("tags") or []) if t}

    for c in (x for x in raw_items if x.get("kind") == "constraint"):
        src, tgt = wild.get(str(c.get("source") or "")), wild.get(str(c.get("target") or ""))
        if src is None or tgt is None or src is tgt:
            continue
        added: dict[int, list[str]] = {id(src): [], id(tgt): []}
        for clause in re.split(r"[;.]", str(c.get("about") or "")):
            rel = _REL.search(clause)
            if rel is None:
                continue
            parts = (clause[:rel.start()].lower(), clause[rel.end():].lower())
            if not all(_TAG_REF.search(p) for p in parts):
                continue  # "excludes #gun for #elf": no telling which side is which
            for side, part in zip((src, tgt), parts, strict=True):
                for t in _TAG_REF.findall(part):
                    t = _tag(t)
                    if not t or t in have(src) | have(tgt) or len(have(side)) >= 16:
                        continue
                    side["tags"] = [*(side.get("tags") or []), t]
                    added[id(side)].append(t)
        for side in (src, tgt):
            if added[id(side)]:
                warnings.append(f"Tagged {side.get('name') or _var(side.get('var'))} with #"
                                + ", #".join(added[id(side)]) + f": {c.get('name') or 'a rule'}"
                                " keys on them")


# A pick and the group it belongs to: $animal_species next to $animal_class.
_MEMBER = re.compile(r"^(?:species|breed|breeds|specific|name|names|subtype|subtypes|"
                     r"variant|variants|model|models|item|items)$")


def _drop_loose_groups(raw_items: list[dict[str, Any]],
                       warnings: list[str]) -> list[dict[str, Any]]:
    """A group wildcard ($animal_class) that rolls on its own next to the
    pick it groups ($animal_species) prints "insect, dolphin": with no rule
    between them, the group goes and the pick says it all."""
    wild = [x for x in raw_items if x.get("kind") == "wildcard" and _var(x.get("var"))]
    ruled = {_var(x.get(s)) for x in raw_items if x.get("kind") == "constraint"
             for s in ("source", "target")}
    gone: set[str] = set()
    for g in wild:
        gv = _var(g.get("var"))
        m = _GROUPISH.search(gv)
        if not m or gv in ruled:
            continue
        head = gv[:m.start()]
        member = next((x for x in wild if x is not g and (
            _var(x.get("var")) == head or (
                _var(x.get("var")).startswith(head + "_")
                and _MEMBER.match(_var(x.get("var"))[len(head) + 1:])))), None)
        if member is None:
            continue
        gone.add(gv)
        warnings.append(f"Left out {g.get('name') or gv}: it rolled apart from "
                        f"{member.get('name') or _var(member.get('var'))}, so the two could "
                        "disagree, and the pick already says which one it is")
    if not gone:
        return raw_items
    out = []
    for x in raw_items:
        if x.get("kind") == "wildcard" and _var(x.get("var")) in gone:
            continue
        for v in gone:
            if isinstance(x.get("about"), str):
                x["about"] = re.sub(r",?\s*\$" + re.escape(v) + r"\b", "", x["about"])
        out.append(x)
    return out


_WEATHERISH = re.compile(r"^(?:\w+_)?(?:weather|precipitation)(?:_\w+)?$")
_LIGHTISH = re.compile(r"^(?:\w+_)?(?:light|lighting|sunlight)(?:_\w+)?$")


def _light_follows_weather(raw_items: list[dict[str, Any]],
                           warnings: list[str]) -> list[dict[str, Any]]:
    """Weather and lighting rolled apart print "steady rain, bright
    overhead sunlight": the lighting follows the weather when nothing else
    keeps it."""
    wild = [x for x in raw_items if x.get("kind") == "wildcard" and _var(x.get("var"))]
    weather = next((x for x in wild if _WEATHERISH.match(_var(x.get("var")))
                    and x.get("tags")), None)
    light = next((x for x in wild if _LIGHTISH.match(_var(x.get("var")))), None)
    if weather is None or light is None:
        return raw_items
    wv, lv = _var(weather.get("var")), _var(light.get("var"))
    if any(x.get("kind") == "constraint" and (_var(x.get("target")) == lv or {
            _var(x.get("source")), _var(x.get("target"))} == {wv, lv}) for x in raw_items):
        return raw_items
    items = list(raw_items)
    items.insert(items.index(light), {
        "kind": "constraint", "name": f"{weather.get('name') or wv} → {light.get('name') or lv}",
        "source": wv, "target": lv,
        "about": f"each {weather.get('name') or wv} gets only the {light.get('name') or lv} "
                 "options that fit it (no bright sun in rain or snow); exclude the ones that "
                 "don't",
        "section": light.get("section") or "", "use": ""})
    if not set(map(str, light.get("tags") or [])) & set(map(str, weather["tags"])):
        light["tags"] = [*(light.get("tags") or []), *weather["tags"]][:16]
    warnings.append(f"Added a rule from {weather.get('name') or wv} to "
                    f"{light.get('name') or lv}: lighting rolled apart from the weather can "
                    "contradict it")
    return items


def _drop_unasked_drivers(raw_items: list[dict[str, Any]], request: str,
                          warnings: list[str]) -> list[dict[str, Any]]:
    """A library item the request never names that the plan makes a rule
    SOURCE (the library's Character Class steering an outfit pack) pulls
    the pack off what was asked: it goes, with its rules."""
    asked = _stems(request)
    sources = {_var(x.get("source")) for x in raw_items if x.get("kind") == "constraint"}
    gone = {_var(x.get("var")) for x in raw_items if x.get("kind") == "library"
            and _var(x.get("var")) in sources
            and not _stems(f"{_var(x.get('var'))} {x.get('name') or ''}") & asked}
    if not gone:
        return raw_items
    out = []
    for x in raw_items:
        if x.get("kind") == "library" and _var(x.get("var")) in gone:
            warnings.append(f"Left out {x.get('name') or _var(x.get('var'))}: the request "
                            "doesn't ask for it, and its rules would steer the pack")
            continue
        if x.get("kind") == "constraint" and {_var(x.get("source")),
                                              _var(x.get("target"))} & gone:
            continue
        for v in gone:
            if isinstance(x.get("about"), str):
                x["about"] = re.sub(r",?\s*\$" + re.escape(v) + r"\b", "", x["about"])
        out.append(x)
    return out


# A subject the planner adds on its own ("noir detective" in a weather pack).
_SUBJECT_VAR = re.compile(r"^(?:main_)?(?:subject|character|person|figure|protagonist|model)"
                          r"s?(?:_type)?$")
_SUBJECT_ASK = re.compile(r"\b(?:subjects?|characters?|people|persons?|portraits?|figures?|"
                          r"m[ae]n|wom[ae]n|heroe?s?|someone|protagonists?|"
                          r"models?|who|survivors?|inventors?|crew|outfits?|hair\w*|"
                          r"faces?|selfies?|poses?|\d*girls?|\d*boys?|solo|couples?|pin-?ups?|"
                          r"lingerie|nude|nsfw|lewd|erotic|sexy|ecchi|hentai|waifus?|oc|"
                          r"cosplay\w*|anime|bod(?:y|ies))\b", re.I)


def _drop_unasked_subject(raw: dict[str, Any], raw_items: list[dict[str, Any]],
                          request: str, warnings: list[str]) -> list[dict[str, Any]]:
    """A subject wildcard the request never asks for puts a stranger in
    every prompt: it goes, with the rules on it and its reads in the plan."""
    if _SUBJECT_ASK.search(request):
        return raw_items
    asked = _stems(request)
    gone = [x for x in raw_items if x.get("kind") == "wildcard"
            and _SUBJECT_VAR.match(_var(x.get("var")))
            and not _stems(f"{_var(x.get('var'))} {x.get('name') or ''}") & asked]
    if not gone:
        return raw_items
    out = []
    for v in {_var(x.get("var")) for x in gone}:
        warnings.append(f"Left out ${v}: the request asks for no subject")
        if _var(raw.get("anchor")) == v:
            raw["anchor"] = ""
    vars_ = {_var(x.get("var")) for x in gone}
    for x in raw_items:
        if x in gone or (x.get("kind") == "constraint" and {
                _var(x.get("source")), _var(x.get("target"))} & vars_):
            continue
        for v in vars_:
            if isinstance(x.get("about"), str):
                x["about"] = re.sub(r",?\s*\$" + re.escape(v) + r"\b", "", x["about"])
        out.append(x)
    return out
