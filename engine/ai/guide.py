"""How to build well: the authoring guide the chat and the pack planner share.

The module prompts say what each field means; this says which feature fits
which job and how to make the prompts that come out coherent. Kept in one
place so the chat and the pack builder give the same advice, and checked by
`tests/engine/ai/test_ai_guide.py` against the tools and settings it names.
"""
from __future__ import annotations

import json
import re

SYNTAX = """\
Text grammar (the compilers check it and say what to fix):
- $name reads a variable; $name.0 the first of a multi-pick; $name.AXIS the \
rolled tag of an accepts group; $name.neg its negative words. $$ is a literal $.
- {a|b|c} picks one each run; {2$$, $$a|b|c} picks 2 joined by ", "; \
{1-3$$ and $$a|b|c} picks 1 to 3; {2~$$, $$a|b|c} may pick the same \
one twice.
- @{Wildcard name} draws from another wildcard; @{Name:warm and not wet} only \
from its options with those tags; @{Name!null} never its empty option.
Where each works: wildcard options and negatives: picks and @{…}, no $. \
Derivation actions: everything. Combines: $ and picks, no @{…}. Fixed values: \
picks only (small variations; a real choice is a wildcard). The Assembler \
template: $ only (it has no seed: {a|b} prints as typed, @{…} prints nothing). \
Conditions: plain text or one $var.\
"""

STRUCTURE = """\
How a pack fits together, in running order:
1. Decisions: one wildcard per choice the image makes (setting, character, \
outfit, pose, camera), each with a variable. Anything a constraint, \
derivation, "match" or the template reads is one of these.
2. Details nothing reads go inside a decision's options as @{refs} filtered \
by tag. A "recipe" Outfit has options like "@{Tops:formal} with \
@{Bottoms:formal}" and "@{Dresses:casual}": the outfit stays one pick rules \
key on, and its parts still vary. The same goes for shared vocabularies \
(@{Colors:warm} in many places) and filler ({2$$, $$@{Props:indoor}}). A ref \
is a fresh pick each time and sets no variable: $outfit is the same text \
wherever it is read, two @{Colors} are two colours, and no rule can react \
to a ref's pick (rules can still narrow what a ref draws).
3. Agreement: a constraint from the anchor (or any earlier pick) to each \
wildcard that must fit it, by tags on both sides; a fallback option on the \
target so it is never empty.
4. Consequences: a derivation writes what follows from picks (a title for \
a class, ", scarf" appended in winter). It sets its own variables, never one \
a wildcard sets.
5. Drivers: a pick rules need but the image shouldn't name ($season, \
$rating, $mood) is a wildcard used "internal"; a combine or derivation turns \
it into words when it should show.
6. Assembly: fixed values for always-on words (quality header, style), \
combines to join a few variables into a phrase, one template that orders \
everything the way the image model reads it, with a standing negative.
Never: two items setting one variable; {a|b} in a fixed value or combine \
for a real choice (a wildcard has weights, tags, rules and a fallback); a \
wildcard per case of another pick ($winter_top); rule words in a template \
("if $x is set").
"""

#: Short pack shapes for the planner. Compiled-free text; kept to the
#: patterns STRUCTURE describes.
BLUEPRINTS = """\
Pack shapes that work (adapt, don't copy):
- Character: Setting (anchor) → Outfit tagged by setting, with a fallback, \
and a constraint Setting → Outfit; Hair; Eyes; Pose; Expression; fixed \
values Quality; template "$quality, 1girl, solo, $hair, $eyes, $outfit, \
$pose, $expression, $setting".
- Outfit and shoes that match: Outfit with an accepts group SHOES (each \
outfit tagged with the shoes it suits: loafers, sneakers), Shoes tagged \
with the same words, a constraint Outfit → Shoes "only" on those tags.
- Recipe: Outfit options "@{Tops:formal} with @{Bottoms:formal}" / \
"@{Dresses:casual}", where Tops, Bottoms and Dresses are vocabularies (var "").
- Seasonal: Season used "internal" → constraints to Outfit, Weather and \
Light; a combine "$outfit for $season" only when the season should show.
- Story over a WP Context Loop: Character and Outfit used "hold"; a \
derivation on $iteration sets $beat (or $pose) per frame.
- Per model: a derivation on $model_variant writes $quality and its \
negative; the template starts with $quality.
- Safe and adult from one pack: Rating used "internal" (safe, nsfw) → \
constraints that shut explicit options out of safe runs.
"""

WHICH = """\
Which feature for which job:
- A list to draw from → wildcard (one concept per wildcard: hair, outfit, \
place). A shared vocabulary drawn in several places, often narrowed by tag → \
a wildcard with no variable that others point at with @{Name:tag}.
- Text that's always the same (a style preset, quality tags) → fixed values.
- Joining picks into one phrase → combine ("$hair $eyes" → $look).
- Text that depends on picks ("if $season is winter add a scarf"), or a \
pick from a wildcard only in some cases → derivation (an action can be \
@{Hats:winter}).
- One pick changing another's odds ("elves rarely carry guns") → constraint \
(exclude, reduce, boost; "only" when a source allows just a few targets).
- Two picks that must agree ("shoes that match the outfit") → an accepts \
axis on both wildcards (options list what they go with) and a constraint \
keyed on it.
- "Sometimes nothing" → null_weight. "Never empty when rules narrow it" → \
a fallback option on the target. "2-3 of these" → use "pick 2-3", read \
with $var (joined) or $var.0. A choice that should stay for a whole batch → \
use "hold". A value rules need but the prompt shouldn't show → use "internal".
- A value from outside (subject typed by the user, an LLM's text, a LoRA \
trigger) → a WP Context Injector row sets it; read it like any variable. \
Per-checkpoint differences → rules on $model_family / $model_variant (WP \
Model Info). A sequence over a WP Context Loop → rules on $iteration. To key \
a constraint on such a variable, bundle a wildcard whose options are its \
values with "match $var" and make that wildcard the constraint's source.
- Grouping a big pack → sub-bundles (one level) inside one bundle, e.g. \
Outfit and Scene sub-bundles in a Character bundle. A constraint goes in \
the same sub-bundle as its target wildcard, just before it; its source runs \
earlier (the same sub-bundle or one before).
"""

COHERENCE = """\
Making prompts coherent:
- Keep a wildcard to its one concept. A pose wildcard holds poses: no hair, \
outfit, camera framing or body shape unless the user asks. Read the request's \
flavour inside that concept (poses for "presenting" can include looking \
back, hand on hip, bent over); the other concepts get their own wildcards.
- Use the simplest feature that does the job: a constraint with an exception \
or two before a derivation, tags and one matrix row before a rule per \
option, an option's weight before a duplicate. A derivation is for text \
that depends on picks, never a lookup table of value → value.
- Reuse what the library has (search first) before creating; build only \
what the user asked for, and say what else could help instead of adding it.
- Size lists to the job: 8-30 options for a wildcard unless asked.
- Pick the anchor first (setting, season, character class), then constrain \
or derive the rest from it, so details agree with it.
- Tag options by what rules need to test (season, formality, material), not \
by everything they are. Reuse the library's tags and variables.
- Prefer reduce over exclude when variety matters; give every constrained \
target a fallback so it never comes out empty.
- Weights for realism: common things weight 2-3, rare ones 0.5.
- Match the model's style: Danbooru tags for Pony/Illustrious/SDXL anime, \
short sentences for Flux and other natural-language models.
- Every template gets a standing negative (lowres, watermark, bad anatomy, \
… for the model's style) with $negatives where the used variables' \
negatives go; when a pack or answer has none, say so once and offer it.
- Negatives follow usage: put a negative on the option that invites it \
("strawberry blonde" → "fruit"), standing negatives (lowres, watermark) in \
the template's negative with $negatives where the used ones go.
- Order a stack: producers (fixed values, wildcards), each constraint after \
its source and before its target, derivations after what they read, \
combines last; the template reads only what's set.
"""

NODES = """\
The nodes on the user's ComfyUI canvas (what packs and answers can count on):
- WP Context runs a stack (modules and bundles) and sets $variables; \
Contexts chain, later ones read and override earlier ones. WP Prompt \
Assembler renders a template from them (prompt and negative outputs; the \
negative template's $negatives takes the negatives of the variables it used).
- WP Context Injector: each row turns something from outside into a \
$variable the user names: a socket value (a LoRA trigger string, an LLM's \
text, a number) or a template over other variables. A pack expects such \
values as inputs; the user may already set others on the canvas.
- WP Context Loop: runs everything after it N times (frames), a fresh roll \
each. Sets $iteration (1 to N, as text) and $iteration_total; the user can \
rename them (e.g. $page, $page_total). Both are internal: rules read them, \
but a template shows them only if the user turns that off, so put the frame \
number in a prompt through a derivation or combine. A sequence or story \
from one pack: derivations on $iteration (equals "1", or matches \
"^[1-3]$" for a range; there is no greater-than) set a beat or scene per \
frame, and "hold" keeps the character and outfit the same in every frame. \
Sweep mode instead runs every combination of the options the user ticks in \
chosen wildcards (a contact sheet), holding the other picks; it works best \
on short single-concept wildcards. WP Seed List gives each frame its seed.
- WP Model Info: $model_family (sdxl, sd15, sd3, flux, chroma, qwen_image, \
hidream, lumina2, …), $model_variant (pony, illustrious, noobai, animagine, \
or "" when the file name matches none) and $model_name (the checkpoint's \
file name); internal, known only at run time. Key per-model wording or \
quality tags on them ("match $model_variant", or a derivation).
- LoRAs: <lora:name:0.8> in a prompt is plain text to the Assembler; a \
prompt-LoRA loader node on the canvas loads it. Put the LoRA's trigger \
words next to it. A character LoRA can replace a random character: a \
derivation "when $character_lora is set, replace $character with it".
- Also: WP Prompt Cleaner (tidies spacing, duplicates, empty groups), WP \
Image Filter (pauses the run to pick images; Send to Loop keeps the picked \
frames), WP Var to Int / Float / Bool (a variable into a number or switch \
for another node, e.g. $cfg or $steps), WP Debug (shows every variable).
"""

NODES_SHORT = """\
Nodes: WP Context Injector rows set $variables from outside (LoRA triggers, \
LLM text). WP Context Loop runs N frames and sets $iteration / \
$iteration_total (internal, renamable): derivations on $iteration make a \
sequence, "hold" keeps a pick for the run; sweep mode runs every combination \
of ticked options. WP Model Info sets $model_family, $model_variant (pony, \
illustrious, noobai, animagine or "") and $model_name. <lora:name:0.8> is \
prompt text a LoRA loader node reads.
"""

CHAT = """create_bundle puts a stack in that order for you. Check with run_test before \
saying something works: look for options never picked, empty variables, \
warnings and braces left in sample prompts.
"""


#: One worked chat answer: anchor first, rules keyed on tags both sides
#: carry, a fallback on the constrained target, then a check. Compiled by
#: tests/engine/ai/test_ai_guide.py so it can't drift from the tools.
EXAMPLE_CHAT_REQUEST = "outfits that suit the season"
EXAMPLE_CHAT_STEPS: list[dict] = [
    {
        "plan": "Season is the anchor. Outfit options get warm/light tags, a "
                "constraint keys on them, and a fallback keeps Outfit from "
                "ever coming out empty. Then check with run_test.",
        "message": "I'll add a Season wildcard and an Outfit wildcard that follows it.",
        "calls": [
            {"tool": "create_wildcard", "args": {
                "name": "Season", "var": "season", "options": [
                    {"text": "winter", "tags": ["winter"]},
                    {"text": "summer", "tags": ["summer"]}], "axes": []}},
            {"tool": "create_wildcard", "args": {
                "name": "Outfit", "var": "outfit", "options": [
                    {"text": "wool coat and scarf", "tags": ["warm"]},
                    {"text": "puffer jacket", "tags": ["warm"]},
                    {"text": "linen shirt", "tags": ["light"]},
                    {"text": "sundress", "tags": ["light"]},
                    {"text": "jeans and a hoodie", "tags": ["warm", "light"],
                     "fallback": True}], "axes": []}},
            {"tool": "create_constraint", "args": {
                "name": "Season → Outfit", "source_id": "Season", "target_id": "Outfit",
                "rules": [
                    {"source": "#winter", "target": "#light", "effect": "exclude"},
                    {"source": "#summer", "target": "#warm", "effect": "reduce",
                     "factor": 0.2}]}},
        ],
    },
    {
        "plan": "Check the new stack with the proposed changes.",
        "message": "",
        "calls": [{"tool": "run_test", "args": {
            "stack": ["Season", "Outfit", "Season → Outfit"], "proposed": True}}],
    },
]


def _example_chat() -> str:
    lines = [f'Example. User: "{EXAMPLE_CHAT_REQUEST}"']
    for step in EXAMPLE_CHAT_STEPS:
        calls = [{"tool": c["tool"], "args": json.dumps(c["args"], ensure_ascii=False)}
                 for c in step["calls"]]
        lines.append("You: " + json.dumps({**step, "calls": calls}, ensure_ascii=False))
    lines.append("(then a last answer with \"calls\": [] saying what the test showed)")
    return "\n".join(lines) + "\n"


def _example_chat_native() -> str:
    # Told as steps, not as a transcript: small models copied a "You call:
    # read {...}" transcript into their answer as text instead of calling.
    lines = [f'Example of a good order of tool calls for "{EXAMPLE_CHAT_REQUEST}" '
             "(each one a real tool call, never written out as text):"]
    for i, step in enumerate(EXAMPLE_CHAT_STEPS, 1):
        calls = " and ".join(f"{c['tool']} with {json.dumps(c['args'], ensure_ascii=False)}"
                             for c in step["calls"])
        lines.append(f"{i}. {step['plan']} Call {calls}.")
    lines.append(f"{len(EXAMPLE_CHAT_STEPS) + 1}. Answer in plain text, with no call, "
                 "saying what the test showed.")
    return "\n".join(lines) + "\n"


EXAMPLES_CHAT = "\n" + _example_chat()
EXAMPLES_CHAT_NATIVE = "\n" + _example_chat_native()


def text(*, slim: bool = False) -> str:
    """The chat's copy: everything, plus how to check with its tools. `slim`
    keeps the grammar and the feature choice and drops the rest."""
    if slim:
        return "\n".join([SYNTAX, "", STRUCTURE, WHICH, NODES_SHORT, CHAT])
    return "\n".join([SYNTAX, "", STRUCTURE, WHICH, NODES, COHERENCE, CHAT])


# ── prompt formats per image model ───────────────────────────────────────

#: How each model family reads a prompt: style, order, header, negative.
#: From /pr-drafts/prompt-writing-research.md §3-4 and the coverage addendum
#: §6.1; one line each so a small model gets only the one it needs.
FORMATS: dict[str, str] = {
    "pony": "Pony (SDXL): Danbooru tags, comma-separated. Start with score_9, score_8_up, "
            "score_7_up, then a source tag (source_anime, source_cartoon), then "
            "rating_safe, rating_questionable or rating_explicit. Then count (1girl, solo), "
            "character, look, outfit, pose, expression, place, light, camera, style. "
            "Negative: score_6, score_5, score_4, worst quality, low quality, watermark.",
    "illustrious": "Illustrious (SDXL): Danbooru tags. Start with masterpiece, best quality, "
                   "very aesthetic, absurdres; then count (1girl, solo), character (series), "
                   "artist, look, outfit, pose, expression, place, light, camera. Rating "
                   "words: general, sensitive, nsfw, explicit. Negative: worst quality, low "
                   "quality, lowres, bad anatomy, bad hands, extra digits, jpeg artifacts, "
                   "signature, watermark, username.",
    "noobai": "NoobAI (SDXL, from Illustrious): Danbooru tags. Start with masterpiece, best "
              "quality, newest, absurdres, highres, then safe (or explicit); then count, "
              "character (series), artist, look, outfit, pose, expression, place, light. "
              "Negative: worst quality, old, early, low quality, lowres, signature, username, "
              "logo, bad hands, mutated hands (and nsfw in a safe pack).",
    "animagine": "Animagine XL 4: Danbooru tags. Count, character, series, rating (safe, "
                 "sensitive, nsfw, explicit), then everything else, and the quality tags "
                 "LAST: masterpiece, high score, great score, absurdres. Negative: lowres, "
                 "bad anatomy, bad hands, text, error, worst quality, low quality, low score, "
                 "bad score, average score, signature, watermark, username, blurry.",
    "anima": "Anima (anime, Cosmos-based): tags and sentences mixed, at least two "
             "sentences; name the character first, then describe them. Start with "
             "masterpiece, best quality, score_7, then the rating (safe, sensitive, nsfw, "
             "explicit). Negative: worst quality, low quality, score_1, score_2, score_3, "
             "artist name (the Turbo model at CFG 1 ignores it).",
    "sdxl": "SDXL (base and photo fine-tunes): short phrases or a sentence: subject and "
            "action first, then look, outfit, place, light, camera, style. Negative: "
            "lowres, blurry, watermark, text, deformed.",
    "sd15": "SD 1.5: keywords in order of importance (subject, look, outfit, pose, place, "
            "light, camera, style, then best quality, highly detailed), under 75 tokens. "
            "Negative: lowres, bad anatomy, bad hands, extra digits, worst quality, low "
            "quality, jpeg artifacts, signature, watermark, text.",
    "flux": "Flux (1 and 2): natural sentences, subject first: who, what they are doing, "
            "then style, then place, light and camera. No quality tags, no weights; text to "
            "show goes in quotes. Flux ignores the negative prompt, so write exclusions as "
            "positive words (\"a plain background\") and don't rely on negatives.",
    "sd3": "SD 3.5: natural sentences: medium or style, subject and look, action, place, "
           "light, camera; text in quotes. A short negative only when a defect needs it "
           "(Large Turbo ignores it).",
    "chroma": "Chroma: natural sentences like Flux, with an optional short tag tail. "
              "Negatives work: low quality, blurry, deformed.",
    "qwen_image": "Qwen-Image: natural sentences, under 200 words: style, subject, look, "
                  "outfit, action, where things are, place, colours and light, camera; text "
                  "to render in quotes with where it goes; end with Ultra HD, 4K, cinematic "
                  "composition. Negative usually empty.",
    "hidream": "HiDream: natural sentences, most important first, under about 100 words. "
               "Only the Full model uses a negative.",
    "lumina2": "Lumina 2 and Z-Image: long, detailed natural prose. Z-Image Turbo ignores "
               "the negative, so write exclusions as positive words.",
    "wan": "Wan 2.x (video): 80-100 words: style, subject and look, one simple motion, "
           "place, shot size and angle, then the camera movement.",
}

_FAMILY = [
    (re.compile(r"pony|pdxl", re.I), "pony"),
    (re.compile(r"noob", re.I), "noobai"),
    (re.compile(r"illustrious|\bill?xl\b|\bwai\b", re.I), "illustrious"),
    (re.compile(r"animagine", re.I), "animagine"),
    (re.compile(r"\banima\b|cosmos", re.I), "anima"),
    (re.compile(r"flux|krea", re.I), "flux"),
    (re.compile(r"\bsd ?3(?:\.5)?\b|stable diffusion 3", re.I), "sd3"),
    (re.compile(r"chroma", re.I), "chroma"),
    (re.compile(r"qwen", re.I), "qwen_image"),
    (re.compile(r"hidream", re.I), "hidream"),
    (re.compile(r"lumina|z[-_ ]?image", re.I), "lumina2"),
    (re.compile(r"\bwan(?:[ -]?2(?:\.\d)?)?\b", re.I), "wan"),
    (re.compile(r"\bsd ?1\.?5\b|\bsd15\b", re.I), "sd15"),
    (re.compile(r"sdxl|\bxl\b|juggernaut|realvis", re.I), "sdxl"),
]


def family(model: str) -> str:
    """The FORMATS key a model name means ("PonyXL v6" → "pony"), or ""."""
    for rx, key in _FAMILY:
        if rx.search(model or ""):
            return key
    return ""


def format_line(model: str) -> str:
    """How the named image model reads a prompt, or "" for an unknown one."""
    return FORMATS.get(family(model), "")


#: For a pack rated nsfw only: the safeguards first (enforced by
#: engine/ai/adult.py as well), then how such packs are built.
NSFW = """\
Adult pack (rated nsfw). Every character is an adult, and written so: an \
adult age or "mature female" / "mature male" style words on each character. \
Never a child, teen, school-age words (school uniform, schoolgirl), a \
character whose canon age is under 18 (even "aged up"), or a real person's \
name or likeness. Options with youth words are left out, and the template's \
negative always gets a youth block (child, loli, …). Structure: a Rating \
wildcard used "internal" (safe, nsfw) gates explicit options by constraint, \
so the pack makes safe images too; a clothing-state wildcard (dressed, \
partly undressed, topless, nude) with constraints to Outfit ("only" rules: \
nude allows no outfit, with an empty fallback); poses and acts tagged by \
how many people they need, with a constraint from the count. Tag packs use \
Danbooru's own tags for body, clothing state and acts; Pony adds \
rating_explicit (or rating_questionable) to its header, Illustrious and \
NoobAI an nsfw or explicit rating word, and NoobAI drops nsfw from its \
negative.
"""
