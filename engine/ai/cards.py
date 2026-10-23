"""Feature cards: a few lines on one feature, sent with the message that
needs them (research note "Request-aware prompts", plan Phase 1).

A small model reads its long guide once, at the start of the chat, and by
the tenth step it has lost the detail that matters for this ask (where
@{…} works, that "goes with" is an only constraint). A short card that
arrives with the message, at the end of the prompt, is followed far better
(little-coder: the same Qwen3.5-9B went from 19% to 46% on Aider's
benchmark with per-turn cards of 80-150 tokens instead of one preamble).

Cards are picked from the message's words and the items it picks with @,
at most `MAX_CARDS` per message and `MAX_CHARS` in all, each sent once
while the model can still see it (`sent`). A change tool's card also comes
with its first card or its first error (`for_tool`). Both go in the
message or a call's result, which is appended to the log, so the prompt
start never changes. Small and medium models only (`_ai_turn`).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

MAX_CARDS = 3
#: About 450 tokens: little-coder capped its cards at ~500 a turn.
MAX_CHARS = 1800


@dataclass(frozen=True)
class Card:
    key: str
    title: str
    text: str
    #: What a message says when it needs this card.
    words: re.Pattern[str] | None = None
    #: Item kinds that bring it when the user @-picks one.
    kinds: tuple[str, ...] = ()
    #: Manager pages (route keys) where it wins a tie.
    routes: tuple[str, ...] = ()
    #: Change tools whose first card or first error brings it.
    tools: tuple[str, ...] = ()
    #: Tools the step shortlist gets when the card comes (it names them).
    offers: tuple[str, ...] = ()


def _w(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.I)


CARDS: tuple[Card, ...] = (
    Card("refs", "Refs",
         "@{Name} inside an option draws a fresh pick from another wildcard each run "
         "(\"@{Colors} jacket\"). It works in wildcard options, negatives and derivation "
         "actions, not in combines, fixed values or the template. A ref sets no variable and "
         "nothing can test it: if a rule or the template needs the value, make it its own "
         "wildcard and read $var. [[id#Name]] only names an item in chat; it is not a ref. A "
         "wildcard used only through refs has var \"\".",
         _w(r"\bref(?:erence)?s?\b|\bnest\w*|\b(?:draws?|drawing|picks?|pulls?|takes?)\b"
            r"[^.?!]{0,40}\bfrom\b|@\{|\bvocabular\w*|\bshared list|"
            r"\buses? (?:my|the|our) \w+ (?:list|wildcard)\b"),
         kinds=("wildcard",),
         offers=("create_wildcard", "add_options", "edit_options")),
    Card("tag_filter", "Tag filters",
         "@{Name:warm} draws only the options tagged warm; @{Name:warm and not wet}, "
         "@{Name:warm or cool}; !wet means not wet; @{Name!null} never the empty option. On a "
         "stack item the same filter is the use setting \"filter warm and not wet\". Tag the "
         "source wildcard's options (\"tags\": [\"warm\"]) so the filter has something to "
         "match. \"Options using only warm colours from Palette\" means options like "
         "\"a @{Palette:warm} sky\", never the colours copied in.",
         _w(r"\bonly (?:the )?\w+ (?:ones|options|colou?rs|items)\b|\btagged\b|\bby tags?\b|"
            r"\bwith the tag\b|\bfilter\w*|\bonly uses?\b|@\{\w+:"),
         offers=("add_options", "edit_options")),
    Card("picks", "Inline picks",
         "{a|b|c} picks one each run; {2$$a|b|c} picks 2 joined by \", \"; "
         "{1-3$$ and $$a|b|c} picks 1 to 3 joined by \" and \"; {2~$$a|b|c} may repeat one. "
         "For 2-3 picks from a whole wildcard, use the use setting \"pick 2-3\" and read $var "
         "(joined) or $var.0. Inline picks work in options, fixed values, combines and "
         "derivation actions, not in the template. A real choice that rules or weights need "
         "is a wildcard, not {a|b}.",
         _w(r"\{[^{}]*\|[^{}]*\}|\bpicks? (?:\d|two|three|several|a few|some)\b|"
            r"\b\d ?- ?\d (?:of|options|picks)\b|\bvariations?\b|\bseveral of\b|"
            r"\bmore than one\b")),
    Card("accessors", "Reading variables",
         "$name reads a variable; $name.0 is the first pick of a multi-pick; $name.AXIS the "
         "rolled tag of an accepts group named AXIS; $name.neg its negative words; $$ is a "
         "literal $. $ works in combines, derivation actions and conditions, and the "
         "template, never inside wildcard options (use @{…} there).",
         _w(r"\$\w+\.\w+|\bfirst (?:one|pick) of\b|\beach pick\b|\baxis value\b")),
    Card("constraint", "Constraints",
         "A constraint links a SOURCE wildcard (earlier in the stack) to a TARGET wildcard and "
         "changes the target's odds when the source picks: exclude (never), reduce or boost "
         "(with a factor: rarer, more often), only (the target may use just what the row "
         "names: \"goes with\", \"only gets\"). Rules name options by text, or tags with #: "
         "{\"source\": \"#winter\", \"target\": \"#sandals\", \"effect\": \"exclude\"}. Exclude "
         "drops an option if ANY of its tags is excluded, so for \"goes with\" use only. Give "
         "the target a fallback option so it never comes out empty. Reach: all (default), "
         "first, next N.",
         _w(r"\bnever\b|\brarely\b|\bconstraints?\b|\bgoes with\b|\bgo with\b|\bonly gets?\b|"
            r"\bonly get\b|\bsuits?\b|\bsuited\b|\bexclud\w*|\brule[sd]? out\b|"
            r"\bmore likely\b|\bless likely\b|\bonly (?:allow|with)\b"),
         kinds=("constraint",), routes=("constraints",), tools=("create_constraint",),
         offers=("create_constraint", "edit_constraint")),
    Card("agree", "Two picks that agree",
         "For two picks that must agree (shoes that suit the outfit): give the source an "
         "accepts axis (\"axes\": [{\"name\": \"shoes\", \"kind\": \"accepts\", \"tags\": "
         "[\"sneakers\", \"loafers\"]}]) and tag each source option with what it goes with; "
         "tag the target's options with the same words; then a constraint source → target "
         "with effect only on those tags. A classify axis only groups tags; accepts says what "
         "an option goes with.",
         _w(r"\bmatch(?:es|ing)? (?:the|its|their)\b|\bagree\w*|\bthat suits?\b|"
            r"\bgo(?:es)? together\b|\bconsistent\b|\baccepts?\b"),
         offers=("create_constraint", "edit_options")),
    Card("fallback", "Fallback and empty",
         "\"fallback\": true on one option (create_wildcard or add_options; edit_options "
         "{\"fallback\": n}) makes it the pick when rules leave nothing; otherwise it rolls "
         "like any option. \"null_weight\": w adds an empty option, so the wildcard sometimes "
         "gives nothing (edit_options null_weight 0 removes it). @{Name!null} or the use "
         "setting \"no empty\" skips the empty option.",
         _w(r"\bfallback\b|\bnever (?:be )?empty\b|\bempty\b|\bsometimes (?:no|nothing|none)\b|"
            r"\bnothing (?:left|else)\b|\brules? out everything\b|\boptional\b"),
         offers=("add_options", "edit_options")),
    Card("derivation", "Derivation rules",
         "A derivation rule is IF/ELIF branches plus else_actions. A branch: {\"match\": "
         "\"all\" (AND) or \"any\" (OR), \"conditions\": [{\"var\": \"class\", \"op\": "
         "\"equals\", \"value\": \"warrior\"}, …], \"actions\": [{\"target_var\": \"cloak\", "
         "\"mode\": \"replace\", \"value\": \"fur cloak\"}]}; a condition can be a nested group "
         "for \"a AND (b OR c)\". Ops: equals, not_equals, contains, not_contains, matches "
         "(regex), exists, is_empty, is_set and their opposites. var has no $. It sets its own "
         "variables, never one a wildcard sets; \"else nothing\" is no else_actions.",
         _w(r"\bif\b|\bwhen (?:the |a |an |\$)?\w+ (?:is|are|has|contains)\b|\botherwise\b|"
            r"\belse\b|\bderivations?\b|\bdepends? on\b|\bsets? \$\w+|(?-i:\b(?:AND|OR)\b)"),
         kinds=("derivation",), routes=("derivations",),
         tools=("create_derivation", "add_rules", "replace_rules"),
         offers=("create_derivation", "add_rules", "edit_rules")),
    Card("negatives", "Negatives",
         "A negative rides on what invites it: an option's \"negative\" (create_wildcard, "
         "add_options, or edit_options {\"negatives\": [{\"n\", \"negative\"}]} by the numbers "
         "read shows), a fixed value's or a combine's negative. The template's negative holds "
         "standing words (lowres, watermark) plus $negatives, where the negatives of the "
         "variables the prompt used go. A derivation action with mode negative adds to a "
         "variable's negatives; negative_replace swaps them.",
         _w(r"\bnegatives?\b|\bunwanted\b|\boverexpos\w*|\bso (?:the image|it) (?:isn't|is not|"
            r"doesn't)\b"),
         offers=("add_options", "edit_options", "edit_values", "edit_combine",
                 "create_derivation")),
    Card("rename_var", "Renaming a variable",
         "To rename a variable: variables {\"var\": \"old\"} lists what sets and reads it. "
         "Change the setter (a wildcard: edit_options {\"var\": \"new\"}; fixed values: "
         "edit_values; a combine: edit_combine \"var\") and propose a change to every reader "
         "($old in combines, templates and derivations). update_info renames the item, not "
         "its variable.",
         _w(r"\brename\w*\b[^.?!]{0,30}\bvariable|\bvariable\b[^.?!]{0,30}\brename|"
            r"\brename \$\w+|\bchange (?:the |its )?variable\b"),
         offers=("variables", "edit_options", "edit_values", "edit_combine", "edit_template",
                 "edit_rules")),
    Card("weights", "Weights",
         "Weights are relative: 1 normal, 2-3 common, 0.3-0.5 rare, 0 never. edit_options "
         "{\"weights\": [{\"n\": 2, \"weight\": 3}]} by the numbers read shows. To change odds "
         "only after another pick, use a constraint (reduce or boost) instead.",
         _w(r"\brarer\b|\bmore often\b|\bless often\b|\bmore common\b|\bless common\b|"
            r"\bweights?\b|\bodds\b|\bchances?\b|\bprobabilit\w*"),
         offers=("edit_options", "create_constraint")),
    Card("use", "Per-use settings",
         "Settings that live on one use of an item (a bundle child): {\"item\": \"Outfit\", "
         "\"use\": \"pick 2-3; hold\"}. \"pick 2-3\" (a list; $var joins them), \"hold\" (the "
         "same pick for a whole Loop run), \"internal\" (rules read it, the prompt doesn't "
         "show it), \"filter warm\", \"no empty\", \"match $var\", \"as $other\", \"pin 2\", "
         "\"weight 3=2.5\". They are not part of the module.",
         _w(r"\bhold\b|\bsame (?:\w+ )?(?:for|across|in) (?:every|all|each|the whole)\b|"
            r"\binternal\b|\bhidden\b|\bhide\b|\b(?:don't|do not|never) show\b|\bpin(?:ned)?\b|"
            r"\block(?:ed)?\b"),
         offers=("create_bundle", "edit_bundle")),
    Card("model_info", "Per-model text",
         "WP Model Info sets $model_family (sdxl, flux, …), $model_variant (pony, "
         "illustrious, noobai, animagine or \"\") and $model_name at run time. Per-model text: "
         "a derivation on $model_variant or $model_family writes $quality and its negative. "
         "To use the model as a constraint source, bundle a wildcard whose options are those "
         "values with the use setting \"match $model_variant\" and make it the source.",
         _w(r"\bper[- ]model\b|\bcheckpoints?\b|\bmodel info\b|\bmodel_(?:family|variant)\b|"
            r"\beach model\b|\bwhich model\b"),
         offers=("create_derivation",)),
    Card("loop", "Context Loop",
         "WP Context Loop runs everything after it N times. $iteration is the CURRENT frame "
         "as text (\"1\" first); $iteration_total is the frame COUNT, the same every frame "
         "(never test it to pick a frame). A sequence: derivations on $iteration (equals "
         "\"1\", or matches \"^[2-4]$\"; there is no greater-than) set a beat per frame; "
         "\"hold\" keeps the character the same in every frame.",
         _w(r"\bloop\b|\bframes?\b|\bsequence\b|\bstory\b|\biteration\w*|\b(?:first|each|"
            r"every|later) (?:image|picture|shot)\b"),
         offers=("create_derivation", "create_bundle")),
    Card("injector", "Values from outside",
         "A value from outside the library (a subject the user types, an LLM's text, a LoRA "
         "trigger) comes from a WP Context Injector row on the canvas, which sets a $variable; "
         "read it like any other. Don't make a wildcard for it. To key a constraint on it, "
         "use a wildcard of its values with \"match $var\" as the source.",
         _w(r"\binjector\b|\bfrom outside\b|\blora trigger\b|\bllm\b|\b(?:the user|i) "
            r"types?\b|\btyped\b|\bnode input\b")),
    Card("bundles", "Bundles",
         "create_bundle saves a stack in running order (\"order\": \"auto\" puts producers "
         "first, each constraint before its target, rules, combines last). Sub-bundles go one "
         "level deep. A constraint goes in the same sub-bundle as its target, just before it; "
         "its source runs earlier. Per-use settings go on the items: {\"item\", \"use\"}.",
         _w(r"\bbundles?\b|\bsub-?bundles?\b|\bstack\b|\bgroup (?:them|these|it)\b"),
         kinds=("bundle",), routes=("bundles",), tools=("create_bundle",),
         offers=("create_bundle", "edit_bundle")),
    Card("template", "Template",
         "The template is the final prompt the WP Prompt Assembler writes: $variables only, "
         "no {a|b} picks and no @{…} (it has no seed). Order it the way the image model reads "
         "a prompt. Always give a negative: standing words (lowres, watermark, …) plus "
         "$negatives where the used variables' negatives go.",
         _w(r"\btemplates?\b|\bfinal prompt\b|\bassembler\b|\bprompt order\b"),
         kinds=("template",), routes=("templates",), tools=("create_template",),
         offers=("create_template", "edit_template")),
    Card("fixed_combine", "Fixed values and combines",
         "Fixed values: variables with the same text every run (quality tags, a style line); "
         "{a|b} only for small variations, no $. A combine joins variables into one: template "
         "\"$hair $eyes\" sets $look; it may use {a|b} but not @{…}. Neither is a list to pick "
         "from: that is a wildcard.",
         _w(r"\bfixed[ -]?values?\b|\bquality tags?\b|\bstyle line\b|\bpresets?\b|"
            r"\bcombines?\b|\bjoin\w*\b|\balways the same\b"),
         kinds=("fixed_values", "combine"), routes=("fixed-values", "combines"),
         tools=("create_fixed_values", "create_combine"),
         offers=("create_fixed_values", "edit_values", "create_combine", "edit_combine")),
)

BY_KEY = {c.key: c for c in CARDS}
_PICKED = re.compile(r"\[\[([0-9a-f]{8})(?:#[^\]]*)?\]\]")


def picked_ids(text: str) -> list[str]:
    """Item ids the user picked with @ in a message ([[id#Name]] chips)."""
    return list(dict.fromkeys(_PICKED.findall(text or "")))


def _route_key(route: Any) -> str:
    key = str(route or "").strip("/").split("/")[0]
    for suffix in ("-new", "-edit"):
        if key.endswith(suffix):
            key = key[: -len(suffix)]
    return key


def pick(text: str, *, kinds: set[str] | frozenset[str] = frozenset(), route: Any = None,
         shown: set[str] | frozenset[str] = frozenset()) -> list[Card]:
    """The cards one message needs, best first: words, then @-picked item
    kinds, then the page breaks ties. Cards in `shown` (keys) are left out."""
    if not text:
        return []
    page = _route_key(route)
    # Chips name items; their names must not trigger cards ("[[id#Never Rain]]").
    plain = _PICKED.sub(" ", text)
    scored = []
    for i, c in enumerate(CARDS):
        if c.key in shown:
            continue
        score = 3 * bool(c.words and c.words.search(plain)) + 2 * bool(set(c.kinds) & kinds)
        if not score:
            continue
        scored.append((score + (page in c.routes), -i, c))
    out: list[Card] = []
    used = 0
    for _s, _i, c in sorted(scored, key=lambda x: (x[0], x[1]), reverse=True):
        if len(out) >= MAX_CARDS or used + len(c.text) > MAX_CHARS:
            continue
        out.append(c)
        used += len(c.text)
    return out


def note(cards: list[Card]) -> str:
    """The cards as one tail block, or ""."""
    if not cards:
        return ""
    return "(Notes for this ask:\n" + "\n".join(f"- {c.title}: {c.text}" for c in cards) + ")"


def for_tool(tool: str, shown: set[str] | frozenset[str] = frozenset()) -> Card | None:
    """The card that belongs to a change tool, unless already sent."""
    for c in CARDS:
        if tool in c.tools and c.key not in shown:
            return c
    return None


def offers(cards: list[Card]) -> list[str]:
    """The tools these cards name, for the step shortlist: a card that says
    "edit_options {"var": …}" is no help if the step can't call it (chat
    smoke run 2026-10-23: the rename card came, edit_options wasn't offered,
    and the 9B renamed a category instead)."""
    return list(dict.fromkeys(t for c in cards for t in c.offers))


def sent(meta: dict[str, Any], log_len: int) -> set[str]:
    """Keys of the cards the model can still read: sent in an entry the log
    still has (a retry cuts its turn off), not summarised away by
    compaction, and, for one sent in a call's result, not masked."""
    dropped = int(meta.get("dropped_before") or 0)
    masked = int(meta.get("masked_before") or 0)
    out = set()
    for key, at in (meta.get("cards") or {}).items():
        if not (isinstance(at, list) and len(at) == 2 and isinstance(at[0], int)):
            continue
        idx, in_result = at
        if dropped <= idx < log_len and not (in_result and idx < masked):
            out.add(key)
    return out


def mark(meta: dict[str, Any], cards: list[Card], at: int, *, in_result: bool = False) -> None:
    """Remember that `cards` went out in log entry `at`."""
    if cards:
        meta["cards"] = {**(meta.get("cards") or {}),
                         **{c.key: [at, in_result] for c in cards}}
