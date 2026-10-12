"""How to build well: the authoring guide the chat and the pack planner share.

The module prompts say what each field means; this says which feature fits
which job and how to make the prompts that come out coherent. Kept in one
place so the chat and the pack builder give the same advice, and checked by
`tests/engine/ai/test_ai_guide.py` against the tools and settings it names.
"""
from __future__ import annotations

SYNTAX = """\
Text grammar (the compilers check it and say what to fix):
- $name reads a variable; $name.0 the first of a multi-pick; $name.AXIS the \
rolled tag of an accepts group; $name.neg its negative words. $$ is a literal $.
- {a|b|c} picks one each run; {2$$, $$a|b|c} picks 2 joined by ", "; \
{1-3$$ and $$a|b|c} picks 1 to 3.
- @{Wildcard name} draws from another wildcard; @{Name:warm and not wet} only \
from its options with those tags; @{Name!null} never its empty option.
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
- A value from outside (subject typed by the user, an LLM's text) → it's set \
by a WP Context Injector row; read it like any variable. Per-checkpoint \
differences → rules on $model_family / $model_variant (WP Model Info node). \
WP Context Loop sets $iteration and $iteration_total.
"""

COHERENCE = """\
Making prompts coherent:
- Pick the anchor first (setting, season, character class), then constrain \
or derive the rest from it, so details agree with it.
- Tag options by what rules need to test (season, formality, material), not \
by everything they are. Reuse the library's tags and variables.
- Prefer reduce over exclude when variety matters; give every constrained \
target a fallback so it never comes out empty.
- Weights for realism: common things weight 2-3, rare ones 0.5.
- Match the model's style: Danbooru tags for Pony/Illustrious/SDXL anime, \
short sentences for Flux and other natural-language models.
- Negatives follow usage: put a negative on the option that invites it \
("strawberry blonde" → "fruit"), standing negatives (lowres, watermark) in \
the template's negative with $negatives where the used ones go.
- Order a stack: producers (fixed values, wildcards), each constraint after \
its source and before its target, derivations after what they read, \
combines last; the template reads only what's set.
"""

CHAT = """create_bundle puts a stack in that order for you. Check with run_test before \
saying something works: look for options never picked, empty variables, \
warnings and braces left in sample prompts.
"""


def text() -> str:
    """The chat's copy: everything, plus how to check with its tools."""
    return "\n".join([SYNTAX, "", WHICH, COHERENCE, CHAT])
