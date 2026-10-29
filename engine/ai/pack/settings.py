"""Pack builder settings: the user's preferences, the run, decisions, canvas
variables and the plan system prompt."""
from __future__ import annotations

import re
from typing import Any

from engine.ai import guide as ai_guide
from engine.ai import use as ai_use
from engine.ai.pack._common import (
    DEFAULT_FRAMES,
    MAX_COUNT,
    MAX_DECISIONS,
    MAX_FRAMES,
    MIN_COUNT,
    MIN_FRAMES,
    RUN_MODES,
    _clean,
    _var,
)

#: What the user picks before planning; every request carries them.
SETTINGS: dict[str, tuple[str, ...]] = {
    # reuse: library wildcards and fixed values that fit go in as they are;
    # inspire: everything new, written like the library; new: ignore it.
    "library": ("reuse", "inspire", "new"),
    # auto: a standing negative plus option negatives where they help;
    # template: only the template's standing negative; none: no negatives.
    "negatives": ("auto", "template", "none"),
    # sections: a sub-bundle per section inside one pack bundle.
    "structure": ("sections", "flat"),
    "style": ("auto", "tags", "sentences"),
    "rating": ("auto", "safe", "nsfw"),
    # family: quality / negative tags per $model_variant (WP Model Info).
    "model": ("any", "family"),
    # on: an nsfw pack's template negative gets the youth block (child,
    # loli, …); off: nothing added (the user's call).
    "youth_negative": ("on", "off"),
    # graph: the model writes slots, axes and relations and the code wires
    # the pack; items: the model writes the item list and every payload.
    "planner": ("graph", "items"),
    # three: the first plan is drafted three times and the code keeps the
    # one that fits the request best (`drafts.pick_draft`); auto: a second
    # draft only when the first scores below 0; one: one draft.
    "drafts": ("auto", "one", "three"),
}
DEFAULT_SETTINGS: dict[str, Any] = {
    "library": "inspire", "negatives": "auto", "structure": "sections", "style": "auto",
    "rating": "auto", "count": 0, "model": "any", "youth_negative": "on",
    "planner": "graph", "drafts": "auto",
}
#: Most options a sweep axis should have (the Loop sweeps every ticked one).
MAX_SWEEP_OPTIONS = 6


def parse_settings(raw: Any) -> dict[str, Any]:
    """The pack settings with anything missing or unknown at its default."""
    out = dict(DEFAULT_SETTINGS)
    if isinstance(raw, dict):
        for k, allowed in SETTINGS.items():
            if raw.get(k) in allowed:
                out[k] = raw[k]
        n = raw.get("count")
        if isinstance(n, (int, float)) and not isinstance(n, bool) and n:
            out["count"] = max(MIN_COUNT, min(MAX_COUNT, int(n)))
    return out


def parse_run(raw: Any, fallback: Any = None) -> dict[str, Any]:
    """The plan's run style ``{mode, frames}``; a missing one keeps
    ``fallback`` (the previous plan's), else single."""
    if not isinstance(raw, dict) or raw.get("mode") not in RUN_MODES:
        return parse_run(fallback) if isinstance(fallback, dict) else {
            "mode": "single", "frames": 0}
    mode = raw["mode"]
    if mode != "story":
        return {"mode": mode, "frames": 0}
    f = raw.get("frames")
    n = int(f) if isinstance(f, (int, float)) and not isinstance(f, bool) and f \
        else DEFAULT_FRAMES
    return {"mode": "story", "frames": max(MIN_FRAMES, min(MAX_FRAMES, n))}


def parse_decisions(raw: Any) -> list[dict[str, str]]:
    """Questions the user already answered: ``[{question, answer}]``."""
    out: list[dict[str, str]] = []
    for d in raw if isinstance(raw, list) else []:
        if not isinstance(d, dict):
            continue
        q, a = _clean(d.get("question"), 200), _clean(d.get("answer"), 300)
        if q and a and not any(_same_question(q, x["question"]) for x in out):
            out.append({"question": q, "answer": a})
    return out[-MAX_DECISIONS:]


def _words_of(text: str) -> set[str]:
    stop = {"the", "a", "an", "of", "to", "should", "do", "you", "it", "be", "is", "are",
            "this", "pack", "which", "what", "how", "or", "and", "for", "in", "include",
            "want", "would", "like"}
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in stop and len(w) > 2}


def _same_question(a: str, b: str) -> bool:
    """Close enough to count as asking the same thing again."""
    wa, wb = _words_of(a), _words_of(b)
    if not wa or not wb:
        return a.strip().lower() == b.strip().lower()
    return len(wa & wb) / min(len(wa), len(wb)) >= 0.6


PLAN_SYSTEM = """\
You plan prompt packs for Wildcard Pipeline, a ComfyUI extension that builds \
image-generation prompts from modules that run in order on a WP Context node \
and set $variables; a WP Prompt Assembler then renders a template from them.
- wildcard: a list of options bound to a $variable; each run picks one \
(weighted). Options carry tags (one lowercase word each) that rules and \
filters use, may hold small {a|b} variations, and may point at another \
wildcard with @{Its name:tag} for a fresh pick from it ("a @{Colors:warm} \
scarf"), including one planned later in this pack. A wildcard with var "" is \
a vocabulary: it isn't in the stack; other options point at it (colours, \
materials, names used in many places).
- fixed_values: variables set to the same text every run (quality tags, a \
style preset); var is the main one.
- derivation: IF/ELSE rules that read variables and set others ("when $class \
is mage, set $title to Archmage"; "when $season is winter, add coat to \
$outfit"); they can also add words to a variable's negative prompt.
- combine: a template that joins variables into a new one ("$race $class").
- constraint: links a SOURCE wildcard to a TARGET wildcard so the source's \
pick changes the target's odds (exclude, reduce, boost, only), usually by \
tag ("#caster gets only #robe outfits"). To make two picks agree (shoes \
that match the outfit), tag both wildcards with the same words for it.
- template: the final prompt, reading $variables only (no picks).
- library: an item the user already has (listed under "The user's \
library"): a wildcard or fixed values, used as is. Reuse one when it fits \
instead of making a copy, when the settings allow it. Only name items listed \
there; anything else is a new wildcard or fixed values.

Plan a pack for the request. Answer with:
- title: a short pack name. summary: one sentence on what it makes.
- design: 2 to 4 sentences on how the pack fits together: which pick decides \
which, and why each constraint or rule is there ("The season decides the \
outfit: winter allows only #warm tops, so no shorts in winter.").
- rating: "nsfw" if the pack is sexual or explicit, else "safe".
- style: "tags" (comma-separated Danbooru-style tags, for SDXL anime models \
like Pony, Illustrious, NoobAI) or "sentences" (short natural phrases, for \
Flux, SD3, Qwen-Image and other natural-language models). Every item is \
written in it. Follow the settings, else the request, else the user's \
library, else "tags".
- model: the image model family the request names ("pony", "flux", …), or "".
- anchor: the variable (no $) the other picks follow (setting, character \
class, season), or "" when nothing should drive the rest.
- questions: up to 4 things you can't guess that would change the plan. \
header is 1-3 words ("Races", "Poses"); choices are 2 to 5 short answers; \
multi is true when several answers can apply together (which races, which \
poses), false when they exclude each other (one art style). The user can \
also type their own answer or let you decide. Questions listed under \
"Decided" are settled: never ask them again, in any wording; ask only new \
questions their answers raise. [] when nothing important is open. Always \
write the full plan anyway, using the most likely answers.
- assumptions: up to 6 short lines on what you guessed that the user might \
want differently ("one character per image", "outdoor scenes only"). [] if none.
- from_images: when reference images are attached, up to 4 short lines on \
what you took from them ("walking away, looking back", "pleated skirt, \
loose shirt"), so the user can see you read them. [] when none are attached.
- research: web searches that would make the pack more accurate, when web \
search is on (the request says so): up to 2 short queries (a franchise's \
characters, a real art style's vocabulary, a clothing era). The user allows \
each first, then you revise the plan with the results. [] when you know \
enough or web search is off.
- run: how the pack runs, read from the request: {mode: "single", frames: 0} for one \
image per run (the default); {mode: "story", frames: N} when it asks for a \
story, comic or sequence a WP Context Loop plays frame by frame (frames \
from 2 to 12: the number it names, else the beats the \
story needs); {mode: "sweep", frames: 0} for a sheet comparing a few options side by \
side (a pose or outfit sheet). Ask (header "Run") when it could be either.
- inputs: variables the pack expects from outside at run time (a subject the \
user types, a LoRA), brought in by a WP Context Injector: {var, about, \
example}. A LoRA the request mentions (any kind: character, outfit, style, \
pose, concept) is an input named after its slot (character_lora, \
outfit_lora), example "<lora:FILE:0.8>, trigger words" with a real file \
from the user's LoRA list when one fits. When a LoRA stands in for \
something a wildcard rolls (a character, an outfit), keep the wildcard and \
add a derivation that replaces that variable with the LoRA when it is set, \
so left empty the random pick stays. Deduce inputs from the request: when \
it names one fixed subject or \
says the user will supply it ("my OC", "whatever character I give it"), make \
that an input and plan no wildcard for it; when it asks for variety, roll it \
with wildcards. When you can't tell whether the subject should be random or \
given, ask (header "Subject"). [] when the pack makes everything itself. A \
variable a constraint keys on (a season the outfits follow) is a wildcard, \
never an input: a constraint needs a wildcard on both sides.
- sections: the pack's parts (Character, Outfit, Pose, Scene, Style…), each \
{name, about}; every item names its section. Each section becomes its own \
sub-bundle, so group items that belong together. [] for a small pack.
- items, each with every field (use "" / 0 / [] where a field doesn't apply):
  - wildcard: name, var (its variable, no $; "" for a vocabulary), about \
(what its options are and anything special: "sometimes none", "never \
empty", "tag each with the shoes it goes with"), count (how many options, \
6 to 40), tags (option tags rules and filters will use).
  - fixed_values: name, var (the main variable), about (each variable and \
its text, in words).
  - derivation: name, var (the main variable it sets), about (the rules in \
plain words, naming variables with $).
  - combine: name, var (the variable it sets), about (which $variables it \
joins and how).
  - constraint: name, source and target (the two wildcards' variables, no \
$), about (the rules in words, by tag, and why).
  - template: exactly one, last: name, about (what the prompt reads, with \
$variables, and its standing negative).
  - library: name (exactly as listed), var (its variable); about says why.
  - section: the section name it belongs to ("" when there are none).
  - use: how the bundle uses this item, or "". """ + ai_use.GUIDE + """
Every variable a derivation, combine or template reads must be set by an \
item or be an input. The run-time variables ($iteration, $iteration_total, \
$model_family, $model_variant, $model_name) and any listed as "set on the \
user's canvas" are always there too. A constraint's tags must be tags its two \
wildcards carry. Each wildcard is about one thing: a pose wildcard holds \
poses, not hair or camera angles. Never make one wildcard per case of another \
pick ($winter_top, $summer_top): make one $top wildcard with the cases as \
tags and a constraint from the pick that decides. Variable names: letters, digits and _. \
Plan what the request needs, up to 60 items. Don't add commentary; the \
output is data for the user's own library.

A pack rated nsfw is for adults only: every character is an adult, and no \
child or real-person subject is ever planned, nor sex without consent. A \
costume or role the user asks for (a school uniform, a maid) is worn by an \
adult; adult body words (petite, slim, curvy) are fine.

""" + ai_guide.STRUCTURE + "\n" + ai_guide.BLUEPRINTS + "\n" + ai_guide.WHICH + "\n" \
    + ai_guide.NODES + "\n" + ai_guide.COHERENCE


CANVAS_SOURCES = ("injector", "loop", "model", "toggle")
MAX_CANVAS = 40


def canvas_vars(raw: Any) -> list[dict[str, str]]:
    """Variables the user's open canvas sets at run time, as the manager
    reports them: ``[{name, source, about}]`` (source injector, loop or
    model). Anything else drops."""
    out: list[dict[str, str]] = []
    for v in raw if isinstance(raw, list) else []:
        if not isinstance(v, dict):
            continue
        name = _var(v.get("name"))
        source = v.get("source") if v.get("source") in CANVAS_SOURCES else ""
        if name and source and not any(x["name"] == name for x in out):
            out.append({"name": name, "source": source, "about": _clean(v.get("about"), 120)})
    return out[:MAX_CANVAS]


_CANVAS_LABEL = {"injector": "a WP Context Injector row", "loop": "the WP Context Loop",
                 "model": "WP Model Info", "toggle": "a WP Toggles switch"}


def canvas_note(canvas: list[dict[str, str]]) -> str:
    """The canvas variables as a prompt line (data, not instructions)."""
    if not canvas:
        return ""
    return ("Set on the user's canvas at run time (count as set; read them, don't make "
            "items for them):\n" + "\n".join(
                f"- ${c['name']}: {_CANVAS_LABEL[c['source']]}"
                + (f" ({c['about']})" if c.get("about") else "") for c in canvas))
