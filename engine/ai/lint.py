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


def scope_bleed(name: str, var: str, options: list[dict[str, Any]]) -> list[str]:
    """Options of a one-concept wildcard that also set another concept."""
    concept = concept_of(name, var)
    if not concept:
        return []
    texts = [str(o.get("value") or "") for o in options
             if isinstance(o, dict) and not o.get("is_null")]
    if not texts:
        return []
    out = []
    for other, words in CONCEPTS.items():
        if other == concept or other in ALLOWED.get(concept, set()):
            continue
        hits = [t for t in texts if any(_has(_words(t), w) for w in words)]
        if len(hits) >= 2 or (hits and len(texts) <= 4):
            sample = ", ".join(f'"{h[:40]}"' for h in hits[:3])
            out.append(
                f"{len(hits)} of {name}'s options also set {other} ({sample}). Keep one "
                f"concept per wildcard: leave {other} to its own wildcard unless the user "
                "asked for it here")
    return out


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
        out += constraint_fallback(payload, get)
    return out[:MAX_WARNINGS]
