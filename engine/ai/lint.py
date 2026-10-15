"""Coherence checks on the chat's proposals: plain rules, no model.

Small models mix concepts into one wildcard (a pose list that also sets the
camera and body shape), build a twenty-branch derivation where one constraint
would do, or exclude options from a target that has nothing to fall back on.
Each check here looks at one proposed item and returns short warnings. The
card shows them and the model reads them in the proposal note, so it can
replace the card. Checks lean quiet: they only speak when the pattern is
plain, because a wrong warning teaches the model to ignore all of them.

See `/pr-drafts/ai-feature-audit.md` (coherence).
"""
from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

#: Words that show an option sets a concept. Kept small and unambiguous:
#: "view", "from behind" and "looking back" are poses as much as camera.
CONCEPTS: dict[str, tuple[str, ...]] = {
    "camera": ("close-up", "closeup", "close up", "wide shot", "full body", "upper body",
               "cowboy shot", "from above", "from below", "dutch angle", "low angle",
               "high angle", "bird's eye", "birds eye", "fisheye", "depth of field", "bokeh",
               "portrait shot", "medium shot", "long shot"),
    "hair": ("hair", "ponytail", "twintails", "twin tails", "braid", "braids", "bangs",
             "bob cut", "pixie cut"),
    "body": ("breasts", "thighs", "hips", "petite", "curvy", "muscular", "abs", "slim body",
             "chubby", "body type", "hourglass figure", "flat chest", "tall woman",
             "short woman", "tall man", "short man"),
    "lighting": ("lighting", "sunlight", "backlight", "backlit", "rim light", "golden hour",
                 "neon light", "soft light", "hard light", "studio light"),
    "clothing": ("dress", "shirt", "jacket", "skirt", "pants", "jeans", "bikini", "uniform",
                 "coat", "hoodie", "boots", "high heels", "swimsuit", "lingerie", "sweater"),
    "place": ("background", "forest", "beach", "city street", "bedroom", "office",
              "classroom", "kitchen", "park bench", "rooftop", "alley"),
    "expression": ("smile", "smiling", "frown", "frowning", "blush", "blushing", "crying",
                   "laughing", "expression", "grin", "pout"),
}

#: Name words that say which concept a wildcard is about. Names like
#: "Scene", "Character" or "Prompt" mix on purpose and get no check.
NAME_WORDS: dict[str, tuple[str, ...]] = {
    "pose": ("pose", "poses", "posing", "stance", "action", "gesture"),
    "camera": ("camera", "shot", "angle", "framing", "composition", "lens"),
    "hair": ("hair", "hairstyle", "haircut"),
    "body": ("body", "figure", "proportion", "proportions", "build", "physique"),
    "lighting": ("light", "lighting"),
    "clothing": ("outfit", "outfits", "clothes", "clothing", "attire", "wear", "dress",
                 "top", "bottom", "shoes", "footwear"),
    "place": ("place", "location", "setting", "background", "backdrop", "environment"),
    "expression": ("expression", "emotion", "face", "facial"),
}

#: What a concept may name without it being a second concept.
ALLOWED: dict[str, set[str]] = {
    "pose": {"expression"},
    "place": {"lighting"},
    "clothing": set(),
}

#: Same-variable lookup branches before a derivation looks like a table.
LOOKUP_BRANCHES = 5
#: Branches in one derivation before asking whether a simpler feature fits.
MANY_BRANCHES = 20
#: Highest weight ratio between two live options before it reads as a mistake.
WEIGHT_RATIO = 40.0
MAX_WARNINGS = 4


def _words(text: str) -> str:
    return " " + re.sub(r"[^a-z0-9' -]+", " ", text.lower()).replace("_", " ") + " "


def _has(text: str, word: str) -> bool:
    return f" {word} " in text


def concept_of(name: str, var: str = "") -> str:
    """The one concept a wildcard's name or variable says it holds, else ""."""
    words = _words(f"{name} {var.replace('_', ' ')}")
    found = {c for c, ws in NAME_WORDS.items() if any(_has(words, w) for w in ws)}
    return found.pop() if len(found) == 1 else ""


def bleeding(name: str, var: str, options: list[dict[str, Any]]) -> dict[str, list[str]]:
    """Other concept -> the option texts of a one-concept wildcard that set it."""
    concept = concept_of(name, var)
    if not concept:
        return {}
    texts = [str(o.get("value") or "") for o in options
             if isinstance(o, dict) and not o.get("is_null")]
    out: dict[str, list[str]] = {}
    for other, words in CONCEPTS.items():
        if other == concept or other in ALLOWED.get(concept, set()):
            continue
        hits = [t for t in texts if any(_has(_words(t), w) for w in words)]
        if len(hits) >= 2 or (hits and len(texts) <= 4):
            out[other] = hits
    return out


def scope_bleed(name: str, var: str, options: list[dict[str, Any]]) -> list[str]:
    """Options of a one-concept wildcard that also set another concept."""
    return [_bleed_text(name, other, hits)
            for other, hits in bleeding(name, var, options).items()]


def _bleed_text(name: str, other: str, hits: list[str]) -> str:
    sample = ", ".join(f'"{h[:40]}"' for h in hits[:3])
    return (f"{len(hits)} of {name}'s options also set {other} ({sample}). Keep one "
            f"concept per wildcard: leave {other} to its own wildcard unless the user "
            "asked for it here")


def weights(name: str, options: list[dict[str, Any]]) -> list[str]:
    live = [o for o in options if isinstance(o, dict) and not o.get("is_null")]
    ws = [float(o.get("weight", 1)) for o in live
          if isinstance(o.get("weight", 1), (int, float)) and o.get("weight", 1) > 0]
    if len(ws) < 2 or max(ws) / min(ws) < WEIGHT_RATIO:
        return []
    return [f"{name}'s weights run from {min(ws):g} to {max(ws):g}: the light options will "
            "almost never come up. Common 2-3, rare 0.5 is usually enough"]


def duplicates(name: str, options: list[dict[str, Any]]) -> list[str]:
    seen: dict[str, int] = {}
    for o in options:
        if isinstance(o, dict) and not o.get("is_null"):
            key = " ".join(str(o.get("value") or "").lower().split())
            if key:
                seen[key] = seen.get(key, 0) + 1
    twice = [k for k, n in seen.items() if n > 1]
    if not twice:
        return []
    return [f"{name} lists the same option more than once: "
            + ", ".join(f'"{t[:40]}"' for t in twice[:4])
            + ". Raise its weight instead"]


def _single(cond: Any) -> dict[str, Any] | None:
    if isinstance(cond, dict) and "conditions" not in cond:
        return cond
    if isinstance(cond, dict) and len(cond.get("conditions") or []) == 1:
        return _single(cond["conditions"][0])
    return None


def derivation_shape(name: str, payload: dict[str, Any]) -> list[str]:
    out = []
    total = 0
    for rule in payload.get("rules") or []:
        branches = rule.get("branches") or [] if isinstance(rule, dict) else []
        total += len(branches)
        pairs: dict[tuple[str, str], int] = {}
        for br in branches:
            cond = _single(br.get("condition")) if isinstance(br, dict) else None
            action = br.get("action") if isinstance(br, dict) else None
            if (cond and cond.get("op") == "equals" and isinstance(action, dict)
                    and not br.get("extra_actions")
                    and action.get("mode", "replace") == "replace"):
                key = (str(cond.get("var") or ""), str(action.get("target_var") or ""))
                pairs[key] = pairs.get(key, 0) + 1
        for (src, dst), n in pairs.items():
            if n >= LOOKUP_BRANCHES:
                out.append(
                    f"{name} maps ${src} to ${dst} value by value ({n} branches). A wildcard "
                    f"for ${dst} with a constraint from ${src}'s wildcard (or tags both share "
                    "and one matrix row) does this with less to maintain")
    if total > MANY_BRANCHES and not out:
        out.append(f"{name} has {total} branches. Check whether tags with one constraint, "
                   "or a combine, does the job more simply")
    return out


def constraint_fallback(payload: dict[str, Any],
                        get: Callable[[str], dict[str, Any] | None]) -> list[str]:
    modes = [e.get("mode") for e in payload.get("exceptions") or [] if isinstance(e, dict)]
    for row in (payload.get("matrix") or {}).values():
        if isinstance(row, dict):
            modes += [c.get("mode") for c in row.values() if isinstance(c, dict)]
    if not {"exclude", "only"} & set(modes):
        return []
    target = get(str(payload.get("target_wildcard_id") or ""))
    if not target or target.get("type") != "wildcard":
        return []
    opts = (target.get("payload") or {}).get("options") or []
    if any(isinstance(o, dict) and o.get("fallback") for o in opts):
        return []
    return [f"This rules options out of {target.get('name')}, which has no fallback option: "
            "when every option is ruled out it comes out empty. Flag one safe option as the "
            "fallback (edit_options)"]


def exclude_shared_tags(payload: dict[str, Any],
                        get: Callable[[str], dict[str, Any] | None]) -> list[str]:
    """An exclude cell drops an option if ANY of its tags is excluded. When
    the dropped option also carries a tag the same source row favours (the
    source tag itself, or one it boosts or allows with only), that is almost
    always "goes with" written as exclude: say so, and name the fix."""
    target = get(str(payload.get("target_wildcard_id") or ""))
    if not target or target.get("type") != "wildcard":
        return []
    opts = [o for o in (target.get("payload") or {}).get("options") or [] if isinstance(o, dict)]
    out: list[str] = []
    for src, row in (payload.get("matrix") or {}).items():
        if not isinstance(row, dict):
            continue
        favoured = {src} | {t for t, c in row.items()
                            if isinstance(c, dict) and c.get("mode") in ("boost", "only")}
        excluded = {t for t, c in row.items() if isinstance(c, dict) and c.get("mode") == "exclude"}
        for o in opts:
            tags = set(o.get("sub_categories") or [])
            hit, kept = tags & excluded, tags & favoured
            if hit and kept:
                out.append(
                    f'With #{src}, "{o.get("value")}" is excluded by its #{sorted(hit)[0]} tag '
                    f"although it also has #{sorted(kept)[0]}: exclude drops an option if any "
                    f"of its tags is excluded. For \"#{src} goes with #{sorted(kept)[0]}\" use "
                    f"only #{sorted(kept)[0]} instead of excluding the rest")
                if len(out) >= 2:
                    return out
    return out


def check(op: dict[str, Any], item: dict[str, Any],
          get: Callable[[str], dict[str, Any] | None],
          base: dict[str, Any] | None = None) -> list[str]:
    """Warnings for one proposed item (``item`` is the whole item after the
    change: an update's patch laid over ``base``, the row before it). An edit
    is only checked for what it adds, so old choices aren't nagged about."""
    kind = item.get("type")
    payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
    name = str(item.get("name") or "This item")
    out: list[str] = []
    if kind == "wildcard":
        opts = payload.get("options") or []
        old = ((base or {}).get("payload") or {}).get("options") or []
        if old == opts:
            return []
        known = {o.get("id") for o in old if isinstance(o, dict)}
        added = [o for o in opts if isinstance(o, dict) and o.get("id") not in known]
        out += scope_bleed(name, str(payload.get("var_binding") or ""), added)
        out += duplicates(name, opts) + weights(name, opts)
    elif kind == "derivation":
        out += derivation_shape(name, payload)
    elif kind == "constraint":
        out += constraint_fallback(payload, get) + exclude_shared_tags(payload, get)
    return out[:MAX_WARNINGS]


# --- Fixes ------------------------------------------------------------------
#
# A warning the card can fix by itself carries a fix ``{warning, key, label,
# only?}``. The user's Fix sends the key; the server records it per card
# (`meta["fixes"]`), makes it with `apply_fix` on the card's body and hands
# the new body back, so there is no TS copy of these rules. Reopening the
# chat and reading the card back later replay the same keys (`fixed_body`).

#: Lowest weight a fix leaves, as a share of the heaviest option's.
FIX_WEIGHT_SHARE = 0.1


def _strip_concept(text: str, other: str) -> str:
    """``text`` without its comma parts that set ``other``."""
    words = CONCEPTS.get(other, ())
    parts = [p.strip() for p in text.split(",")]
    keep = [p for p in parts if p and not any(_has(_words(p), w) for w in words)]
    return ", ".join(keep)


def apply_fix(body: dict[str, Any], key: str,
              only: set[str] | None = None) -> dict[str, Any] | None:
    """``body`` (a card's op body) with fix ``key`` made, or None when it
    changes nothing. ``only`` limits a scope fix to those option ids (an
    edit fixes only the options it adds)."""
    import copy
    payload = body.get("payload") if isinstance(body.get("payload"), dict) else None
    opts = payload.get("options") if payload else None
    if not isinstance(opts, list):
        return None
    out = copy.deepcopy(body)
    new: list[dict[str, Any]] = []
    if key.startswith("scope:"):
        other = key.split(":", 1)[1]
        for o in out["payload"]["options"]:
            if not isinstance(o, dict) or o.get("is_null") or (
                    only is not None and o.get("id") not in only):
                new.append(o)
                continue
            text = _strip_concept(str(o.get("value") or ""), other)
            if text:
                new.append({**o, "value": text})
            # An option that only set the other concept goes.
    elif key == "dupes":
        seen: dict[str, dict[str, Any]] = {}
        for o in out["payload"]["options"]:
            k = " ".join(str(o.get("value") or "").lower().split()) \
                if isinstance(o, dict) and not o.get("is_null") else ""
            if k and k in seen:
                first = seen[k]
                w = o.get("weight", 1)
                if isinstance(w, (int, float)) and isinstance(first.get("weight", 1), (int, float)):
                    first["weight"] = round(float(first.get("weight", 1)) + float(w), 3)
                continue
            if k:
                seen[k] = o
            new.append(o)
    elif key == "weights":
        ws = [float(o.get("weight", 1)) for o in out["payload"]["options"]
              if isinstance(o, dict) and not o.get("is_null")
              and isinstance(o.get("weight", 1), (int, float)) and o.get("weight", 1) > 0]
        floor = round(max(ws) * FIX_WEIGHT_SHARE, 3) if ws else 0
        for o in out["payload"]["options"]:
            w = o.get("weight", 1) if isinstance(o, dict) else None
            if isinstance(w, (int, float)) and 0 < w < floor:
                o = {**o, "weight": floor}
            new.append(o)
    else:
        return None
    out["payload"]["options"] = new
    return None if out == body else out


_FIX_LABELS = {"dupes": "Merge the repeats", "weights": "Even out the weights"}


def fixes(op: dict[str, Any], item: dict[str, Any],
          base: dict[str, Any] | None, warnings: list[str]) -> list[dict[str, Any]]:
    """For each warning ``check`` gave that the card can fix by itself:
    ``{warning, key, label, only?}`` (``only``: the option ids a scope fix
    may touch). Warnings left out here are fixed by asking the model."""
    if item.get("type") != "wildcard":
        return []
    body = op.get("body") if isinstance(op.get("body"), dict) else {}
    payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
    name = str(item.get("name") or "This item")
    var = str(payload.get("var_binding") or "")
    old = ((base or {}).get("payload") or {}).get("options") or []
    known = {o.get("id") for o in old if isinstance(o, dict)}
    opts = [o for o in payload.get("options") or [] if isinstance(o, dict)]
    added = {o.get("id") for o in opts if o.get("id") not in known}
    wanted: list[tuple[str, str, str]] = []
    for other, hits in bleeding(name, var, [o for o in opts if o.get("id") in added]).items():
        wanted.append((_bleed_text(name, other, hits), f"scope:{other}", f"Remove {other} words"))
    for w in warnings:
        if "more than once" in w:
            wanted.append((w, "dupes", _FIX_LABELS["dupes"]))
        elif "weights run from" in w:
            wanted.append((w, "weights", _FIX_LABELS["weights"]))
    out = []
    for text, key, label in wanted:
        if text not in warnings:
            continue
        only = added if key.startswith("scope:") else None
        if apply_fix(body, key, only) is not None:
            fix: dict[str, Any] = {"warning": text, "key": key, "label": label}
            if only is not None:
                fix["only"] = sorted(str(i) for i in only if i is not None)
            out.append(fix)
    return out


def fixed_body(proposal: dict[str, Any], keys: list[str]) -> dict[str, Any] | None:
    """The card's op body with the fixes ``keys`` made in order (each key
    one of its own ``fixes``), or None when none changes anything."""
    op = proposal.get("op") if isinstance(proposal.get("op"), dict) else {}
    body = op.get("body") if isinstance(op.get("body"), dict) else None
    if body is None:
        return None
    known = {f.get("key"): f for f in proposal.get("fixes") or [] if isinstance(f, dict)}
    out = body
    for key in keys:
        fix = known.get(key)
        if fix is None:
            continue
        only = set(fix["only"]) if isinstance(fix.get("only"), list) else None
        out = apply_fix(out, key, only) or out
    return None if out is body else out


def with_fixes(proposal: dict[str, Any], keys: list[str]) -> dict[str, Any]:
    """A copy of the card as it is after the fixes ``keys``: the new body,
    and those warnings and fixes gone."""
    body = fixed_body(proposal, keys)
    done = [f for f in proposal.get("fixes") or [] if isinstance(f, dict) and f.get("key") in keys]
    if body is None and not done:
        return proposal
    gone = {f.get("warning") for f in done}
    out = {**proposal, "warnings": [w for w in proposal.get("warnings") or [] if w not in gone],
           "fixes": [f for f in proposal.get("fixes") or [] if f not in done]}
    if body is not None:
        out["op"] = {**proposal["op"], "body": body}
    return out
