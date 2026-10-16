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


def _without_last(text: str, piece: str) -> str | None:
    """``text`` with only its LAST comma piece equal to ``piece`` taken out
    (a second read of the same variable), or None as in ``_without``."""
    parts = text.split(",")
    at = [n for n, p in enumerate(parts) if _norm(p) == piece]
    if not at:
        return None
    kept = parts[:at[-1]] + parts[at[-1] + 1:]
    if not any(_norm(p) for p in kept):
        return None
    lead = re.match(r"\s*,\s*", text)
    joined = ", ".join(p.strip() for p in kept if p.strip())
    return (", " + joined) if lead else joined


def _reads_saying(text: str, piece: str, ctx: dict[str, Any]) -> list[str]:
    """The comma pieces of a template or combine that read a variable
    (``$hair``, ``$colour hair``) and print ``piece`` in this run, last
    first: the reads a repeat may come from."""
    from engine.template import resolve_variables

    out = []
    for raw in reversed(text.split(",")):
        if "$" not in raw:
            continue
        try:
            shown = resolve_variables(raw, ctx)
        except Exception:  # noqa: BLE001 - a read that can't render is not a candidate
            continue
        if piece in _chunks(shown) and _norm(raw) not in out:
            out.append(_norm(raw))
    return out


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
        seen_in: dict[str, dict[str, Any]] = {}
        for r in base_runs:
            counts: dict[str, int] = {}
            for c in _chunks(r["prompt"]):
                counts[c] = counts.get(c, 0) + 1
            for c, n in counts.items():
                if n > 1 and len(c) >= 3 and not _LIVE.search(c):
                    twice[c] = twice.get(c, 0) + 1
                    seen_in.setdefault(c, r["ctx"])
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
                cuts: list[tuple[int, str, str]] = []
                for n, (_box, _field, text) in enumerate(_slots(i["kind"], payload)):
                    if _without(text, piece) is not None:
                        cuts.append((n, piece, piece))
                    if i["kind"] in ("template", "combine"):
                        # The same variable read twice (or a combine that
                        # already holds it): drop the later read.
                        cuts += [(n, raw, piece) for raw in _reads_saying(
                            text, piece, seen_in[piece])]
                for n, cut, said_piece in cuts:
                    if (key, n, cut) in done:
                        continue
                    done.add((key, n, cut))
                    tries += 1
                    trial = copy.deepcopy(payload)
                    box, field, old = _slots(i["kind"], trial)[n]
                    box[field] = (_without(old, cut) if cut == said_piece
                                  else _without_last(old, cut))
                    if box[field] is None:
                        continue
                    try:
                        _validate(i["kind"], trial)
                    except Exception:  # noqa: BLE001 - a fix that breaks the item is skipped
                        continue
                    new_built = {**built, key: {**built[key], "payload": trial}}
                    after = runs(plan, new_built, library=library, base=base)
                    if _same_meaning(base_runs, after) >= 2:
                        built, base_runs = new_built, after
                        said.setdefault(key, []).append(cut)
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


#: Words of an attribute wildcard's name that say which kind of word it
#: picks, not what it describes ("Hair Colour" describes hair).
_KIND_WORDS = {"color", "colour", "colors", "colours", "shade", "shades", "tone", "tones",
               "tint", "tints"}
#: Name words that are neither the kind nor the subject.
_FILLER = {"the", "of", "and", "pick", "picks", "main"}
#: Longest attribute value taken out of another wildcard's words.
_ATTR_WORDS = 3


def _attribute(item: dict[str, Any], payload: dict[str, Any]) -> tuple[set[str], list[str]]:
    """``(subject words, values)`` for a wildcard that picks one short
    attribute of a subject (Hair Colour: subject "hair", values "silver",
    "black"…), else empty."""
    words = set(re.findall(r"[a-z]+", f"{item.get('name') or ''} "
                           f"{(item.get('var') or '').replace('_', ' ')}".lower()))
    kinds = words & _KIND_WORDS
    subject = {w for w in words - _KIND_WORDS - _FILLER if len(w) >= 3}
    values = [_norm(o["value"]) for o in payload.get("options") or []
              if isinstance(o, dict) and not o.get("is_null") and isinstance(o.get("value"), str)
              and not _LIVE.search(o["value"]) and "," not in o["value"]
              and 0 < len(o["value"].split()) <= _ATTR_WORDS]
    if not kinds or not subject or len(values) < 2:
        return set(), []
    # "lemon blonde hair" also matches as "lemon blonde" inside "sleek lemon
    # blonde bob".
    bare = [" ".join(w for w in v.split() if w not in subject) for v in values]
    values += [b for b in bare if b and b not in values]
    return subject, sorted(set(values), key=len, reverse=True)


#: Colour words, for a colour said in another wildcard's options that the
#: colour wildcard spells differently ("sleek platinum blonde hair" next to
#: Hair Colour's "lemon blonde hair"): round 31's hair pack.
_COLOUR_WORDS = (
    "black|white|grey|gray|silver|blonde|blond|brunette|brown|auburn|red|ginger|copper|"
    "pink|purple|violet|lavender|blue|teal|turquoise|green|mint|orange|yellow|gold|golden|"
    "platinum|ash|honey|strawberry|chestnut|caramel|chocolate|raven|jet|crimson|scarlet|"
    "burgundy|magenta|rose|peach|cream|ivory|beige|tan|bronze|amber|azure|cyan|navy|"
    "emerald|sapphire|ruby|plum|cherry|lemon|sandy|dirty|light|dark|pale|pastel|bright|"
    "deep|icy|ice|snow|multicolored|multicoloured|two-tone|ombre|rainbow|streaked")
_COLOUR_RUN = re.compile(rf"(?<![\w-])(?:(?:{_COLOUR_WORDS})(?:[\s-]+|$)){{1,4}}", re.I)
#: Words of a colour run that only shade another ("light", "dark"): a run of
#: just these is not a colour.
_SHADES = {"light", "dark", "pale", "pastel", "bright", "deep", "dirty"}


def _colour_run(piece: str) -> re.Match[str] | None:
    for m in _COLOUR_RUN.finditer(piece):
        if set(m.group(0).lower().replace("-", " ").split()) - _SHADES:
            return m
    return None


def _names_subject(piece: str, subject: set[str]) -> bool:
    return any(re.search(rf"\b{re.escape(w)}", piece) for w in subject)


def strip_attributes(plan: dict[str, Any], built: dict[str, Any], *,
                     library: list[dict[str, Any]] | None = None,
                     base: dict[str, Any] | None = None,
                     ) -> tuple[dict[str, Any], dict[str, list[str]]]:
    """A colour said twice: a Hair Colour wildcard picks "silver" while a
    hairstyle option says "long black hair", so the prompt shows two hair
    colours. Takes the attribute's values out of other wildcards' pieces that
    name the same subject ("long black hair" → "long hair"), but only when
    the attribute's own pick shows in every test run, so no prompt is left
    without one."""
    said: dict[str, list[str]] = {}
    attrs = [(i, *_attribute(i, built[i["key"]]["payload"])) for i in plan["items"]
             if i["kind"] == "wildcard" and i["key"] in built and i.get("var")]
    attrs = [a for a in attrs if a[2]]
    if not attrs:
        return built, said
    tested: list[dict[str, Any]] | None = None
    for attr, subject, values in attrs:
        colour = bool(re.search(r"colou?r", f"{attr.get('name')} {attr.get('var')}", re.I))
        trial = dict(built)
        took: dict[str, list[str]] = {}
        for i in plan["items"]:
            if i["kind"] != "wildcard" or i is attr or i["key"] not in built or i.get("existing") \
                    or not P.is_wild(i) or i.get("var") == attr["var"]:
                continue
            payload = copy.deepcopy(built[i["key"]]["payload"])
            changed = False
            for o in payload.get("options") or []:
                v = o.get("value") if isinstance(o, dict) else None
                if not isinstance(v, str) or o.get("is_null") or _LIVE.search(v):
                    continue
                pieces = []
                for piece in v.split(","):
                    low = _norm(piece)
                    if _names_subject(low, subject) and low not in values:
                        found = None
                        for x in values:
                            words = r"\s+".join(re.escape(w) for w in x.split())
                            found = re.search(rf"(?<![\w-]){words}(?![\w-])", piece, re.I)
                            if found:
                                break
                        run = _colour_run(piece) if colour else None
                        if run is not None and (found is None or (
                                run.start() <= found.start() and run.end() >= found.end())):
                            found = run  # the whole colour: "platinum blonde", not "blonde"
                        if found is not None:
                            rest = " ".join((piece[:found.start()] + " "
                                             + piece[found.end():]).split())
                            if rest and _names_subject(_norm(rest), subject):
                                took.setdefault(i["key"], []).append(found.group(0).strip())
                                # A bare "hair" left over says nothing.
                                bare = set(_norm(rest).split()) <= subject
                                piece, changed = ("" if bare else rest), True
                    pieces.append(piece.strip())
                if changed and any(pieces):
                    o["value"] = ", ".join(p for p in pieces if p)
            if changed:
                try:
                    WildcardHandler.validate_payload(payload)
                except Exception:  # noqa: BLE001 - leave the item as it was
                    took.pop(i["key"], None)
                    continue
                trial[i["key"]] = {**built[i["key"]], "payload": payload}
        if not took:
            continue
        if tested is None:
            tested = runs(plan, built, library=library, base=base)
        # The attribute must show on its own in every run.
        if not tested or any(not _norm(str(r["ctx"].get(attr["var"]) or ""))
                             or not _says(_norm(r["prompt"]), _norm(str(r["ctx"][attr["var"]])))
                             for r in tested):
            continue
        built = trial
        tested = None
        for key, gone in took.items():
            quoted = ", ".join(f'"{g}"' for g in list(dict.fromkeys(gone))[:5])
            said.setdefault(key, []).append(
                f"Took {quoted} out: {attr['name']} already picks the {' '.join(sorted(subject))}"
                f"'s {'colour' if 'colo' in attr['name'].lower() else 'kind'}, so it showed twice")
    return built, said


#: Share of test runs a colour may be missing from before the check says so.
MISSING_SHARE = 0.25


def missing_attributes(plan: dict[str, Any], built: dict[str, Any],
                       done: list[dict[str, Any]]) -> dict[str, str]:
    """A colour wildcard whose pick is missing from many prompts (an empty
    option, or a pick nothing prints): ``{key: problem}``."""
    out: dict[str, str] = {}
    if not done or not any(r["prompt"] for r in done):
        return out
    for i in plan["items"]:
        if i["kind"] != "wildcard" or i["key"] not in built or not i.get("var"):
            continue
        subject, _values = _attribute(i, built[i["key"]]["payload"])
        if not subject:
            continue
        gone = sum(1 for r in done
                   if not _norm(str(r["ctx"].get(i["var"]) or ""))
                   or not _says(_norm(r["prompt"]), _norm(str(r["ctx"][i["var"]]))))
        if gone >= max(2, MISSING_SHARE * len(done)):
            nulls = any(o.get("is_null") and _weight(o) > 0
                        for o in built[i["key"]]["payload"].get("options") or [])
            out[i["key"]] = (f"{gone} of {len(done)} prompts show no {i['name'].lower()}"
                             + ("; drop the empty option so every prompt gets one" if nulls
                                else "; make sure the template prints it every time"))
    return out


def tidy(plan: dict[str, Any], built: dict[str, Any], *,
         library: list[dict[str, Any]] | None = None,
         base: dict[str, Any] | None = None) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    """Both fixes, before a check. Returns the new ``built`` and, for each
    item changed, ``{payload, preview, warnings}`` (``warnings``: the lines
    to add to the item's own)."""
    built, siblings = strip_siblings(plan, built)
    built, repeats = strip_repeats(plan, built, library=library, base=base)
    built, attrs = strip_attributes(plan, built, library=library, base=base)
    built, empties = fill_dead_ends(plan, built)
    changed: dict[str, dict[str, Any]] = {}
    for key in dict.fromkeys([*siblings, *repeats, *attrs, *empties]):
        lines = [*(siblings.get(key) or []), *(attrs.get(key) or []), *(empties.get(key) or [])]
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
    if i["kind"] == "constraint":
        from engine.ai import constraint as ai_constraint
        return ai_constraint.describe_existing(payload)
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


def _weight(o: dict[str, Any]) -> float:
    try:
        return float(o.get("weight", 1) if o.get("weight") is not None else 1)
    except (TypeError, ValueError):
        return 1.0


def _stuck(plan: dict[str, Any], built: dict[str, Any]):
    """``(constraint, source item, target item, stuck source values)`` for
    each constraint that leaves its target no option for some source pick."""
    by_var = {i["var"]: i for i in plan["items"] if P.is_wild(i) and i["key"] in built}
    seen: set[str] = set()
    for c in plan["items"]:
        if c["kind"] != "constraint" or c["key"] not in built:
            continue
        s, t = by_var.get(c["source"]), by_var.get(c["target"])
        if s is None or t is None or t["key"] in seen:
            continue
        rule = built[c["key"]]["payload"]
        options = [o for o in built[t["key"]]["payload"].get("options") or []
                   if isinstance(o, dict) and _weight(o) > 0]
        if len(options) < 2:
            continue
        stuck: list[str] = []
        for o in built[s["key"]]["payload"].get("options") or []:
            if not isinstance(o, dict) or o.get("is_null") or not isinstance(o.get("value"), str):
                continue
            pick = {"value": o["value"], "tags": list(o.get("sub_categories") or [])}
            if all(combine_constraint_factor(
                    [pick], {"value": x.get("value") or "", "tags": x.get("sub_categories") or []},
                    rule.get("matrix"), rule.get("exceptions")) is EXCLUDE for x in options):
                stuck.append(o["value"])
        if stuck:
            seen.add(t["key"])
            yield c, s, t, stuck


def _named(values: list[str]) -> str:
    return ", ".join(f'"{v}"' for v in values[:3]) + (" …" if len(values) > 3 else "")


def dead_ends(plan: dict[str, Any], built: dict[str, Any]) -> dict[str, str]:
    """A constraint that rules out every option of its target for some
    source pick (every weather option is snow and the rule bans snow in a
    desert): the fallback then fires anyway and the prompt breaks the rule.
    ``{target key: problem}``, so the target is rebuilt with options the
    rule allows."""
    return {t["key"]: (f"{c['name']} rules out every option when ${s['var']} is "
                       f"{_named(stuck)}, so the prompt breaks the rule anyway; give "
                       f"{t['name']} options the rule allows for "
                       f"{'those' if len(stuck) > 1 else 'that'} {s['name']} (different tags)")
            for c, s, t, stuck in _stuck(plan, built)}


def fill_dead_ends(plan: dict[str, Any],
                   built: dict[str, Any]) -> tuple[dict[str, Any], dict[str, list[str]]]:
    """The fix for a dead end that needs no model: the target gets an empty
    option that only those source picks can land on (a jungle gets no snow
    instead of a blizzard), and every other pick keeps exactly its old
    chances. ``(built, {key: warning lines})``; the input is left as is."""
    said: dict[str, list[str]] = {}
    for c, s, t, stuck in list(_stuck(plan, built)):
        if not said:
            built = copy.deepcopy(built)
        target = built[t["key"]]["payload"]
        rule = built[c["key"]]["payload"]
        options = target.setdefault("options", [])
        if not any(o.get("is_null") for o in options if isinstance(o, dict)):
            taken = {str(o.get("id")) for o in options if isinstance(o, dict)}
            options.append({"id": P.new_id(taken), "value": "", "is_null": True,
                            "weight": 1, "sub_categories": []})
        exceptions = [e for e in rule.get("exceptions") or []
                      if not (isinstance(e, dict)
                              and e.get("target_value", e.get("target")) == "")]
        only = {str(e.get("source_value", e.get("source"))) for e in exceptions
                if isinstance(e, dict) and e.get("mode") == "only"}
        for o in built[s["key"]]["payload"].get("options") or []:
            if not isinstance(o, dict) or o.get("is_null") or not isinstance(o.get("value"), str):
                continue
            v = o["value"]
            if v in stuck:
                mode = "only" if v in only else "allow"
            elif v in only:
                continue  # an `only` row already shuts the empty option out
            else:
                mode = "exclude"
            exc: dict[str, Any] = {"source": v, "target": "", "mode": mode,
                                   "factor": 0 if mode == "exclude" else 1.0}
            if o.get("id"):
                exc["source_id"] = o["id"]
            exceptions.append(exc)
        rule["exceptions"] = exceptions
        line = (f"{c['name']} left nothing for {_named(stuck)}: added an empty option that "
                f"only {'those' if len(stuck) > 1 else 'that'} {s['name']} can get")
        said.setdefault(t["key"], []).append(line)
        said.setdefault(c["key"], []).append(line)
    return built, said


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
