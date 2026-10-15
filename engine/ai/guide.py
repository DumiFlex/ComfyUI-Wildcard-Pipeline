"""How to build well: the authoring guide the chat and the pack planner share.

The module prompts say what each field means; this says which feature fits
which job and how to make the prompts that come out coherent. Kept in one
place so the chat and the pack builder give the same advice, and checked by
`tests/engine/ai/test_ai_guide.py` against the tools and settings it names.
"""
from __future__ import annotations

import json

SYNTAX = """\
Text grammar (the compilers check it and say what to fix):
- $name reads a variable; $name.0 the first of a multi-pick; $name.AXIS the \
rolled tag of an accepts group; $name.neg its negative words. $$ is a literal $.
- {a|b|c} picks one each run; {2$$a|b|c} picks 2 joined by ", "; \
{1-3$$ and $$a|b|c} picks 1 to 3 joined by " and "; {2~$$a|b|c} may pick \
the same one twice.
- @{Wildcard name} draws from another wildcard; @{Name:warm and not wet} only \
from its options with those tags (!wet means not wet); @{Name!null} never its \
empty option.
Where each works: wildcard options and negatives: picks and @{…}, no $. \
Derivation actions: everything. Combines: $ and picks, no @{…}. Fixed values: \
picks only. The Assembler template: $ only (it has no seed, so a pick or \
@{…} would stay as written). Conditions: plain text or one $var.\
"""

WHICH = """\
Which feature for which job:
- A list to draw from → wildcard (one concept per wildcard: hair, outfit, \
place). A shared vocabulary drawn in several places, often narrowed by tag → \
a wildcard with no variable that others point at with @{Name:tag}.
- @{…} is a fresh pick nothing can read, test or pin: use it only for parts \
nothing else needs. Recipes: an Outfit option "@{Tops:formal} with \
@{Bottoms:formal}" (pin the recipe, the parts still vary); filler: \
"{2-3$$@{Props:indoor}}". If a rule, the template or a pin needs the value, \
it is its own wildcard read as $var ("@{Colors} jacket and @{Colors} jeans" \
gives two colours; one colour is $color twice).
- Text that's always the same (a style preset, quality tags) → fixed values.
- Joining picks into one phrase → combine ("$hair $eyes" → $look).
- Text that depends on picks ("if $season is winter add a scarf"), or a \
pick from a wildcard only in some cases → derivation (an action can be \
@{Hats:winter}).
- One pick changing another's odds ("elves rarely carry guns") → constraint \
(exclude for "never", reduce/boost for odds, "only" for "goes with" / "just \
these"). Exclude drops an option if ANY of its tags is excluded, so an option \
tagged both winter and summer is gone in both: for "goes with" use only.
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
- Two characters → the same wildcards twice with different variables \
($a_hair, $b_hair), each pair's constraint just before its own target with \
reach "first", and a combine per character ($a_look) so each one's words stay \
together.
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
- Match the model's style: Danbooru tags for Pony/Illustrious/NoobAI/SDXL \
anime, sentences for Flux, Z-Image, Qwen, Chroma and other natural-language \
models. Options are short phrases that fit both; quality, score and rating \
words go in a per-model preset (fixed values, or a wildcard matched on \
$model_variant), never in options. Pony V6 wants its score chain and rating_*, \
Illustrious/NoobAI masterpiece-style quality tags and no score_ tags; Flux and \
Z-Image ignore negatives (leave the negative template empty).
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
                "constraint keys on them (winter: only warm, so the all-season "
                "fallback tagged both stays in), and a fallback keeps Outfit "
                "from ever coming out empty. Then check with run_test.",
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
                    {"source": "#winter", "target": "#warm", "effect": "only"},
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
        return "\n".join([SYNTAX, "", WHICH, NODES_SHORT, CHAT])
    return "\n".join([SYNTAX, "", WHICH, NODES, COHERENCE, CHAT])
