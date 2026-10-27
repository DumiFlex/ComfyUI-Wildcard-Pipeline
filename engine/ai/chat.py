"""Chat with the library: questions answered by reading it, changes proposed.

Each model step answers with the same small JSON shape on every provider:

    {"message": str, "calls": [{"tool": str, "args": str}]}

`args` is a JSON object written as a string, because strict structured
output can't hold a free-form object. Read tools (`search`, `read`,
`variables`) run here and their results go back to the model for another
step. Change tools are compiled with the same checkers the editor panels use
(`wildcard.compile_options`, `derivation.compile_rules`,
`constraint.compile_rules`) and validated by the engine handlers; each one
that passes becomes a *proposal* the manager shows as a card, and nothing is
written until the user presses Apply. A change that fails goes back to the
model as an error so it can fix it.

`Library` is pure: it takes the rows the route read and holds no connection.
"""
from __future__ import annotations

import copy
import json
import re
import secrets
from typing import Any

from engine.ai import constraint as ai_constraint
from engine.ai import derivation as ai_derivation
from engine.ai import describe as ai_describe
from engine.ai import docs as ai_docs
from engine.ai import guide as ai_guide
from engine.ai import index as ai_index
from engine.ai import library_vars
from engine.ai import lint as ai_lint
from engine.ai import patterns as ai_patterns
from engine.ai import ratings as ai_ratings
from engine.ai import react as ai_react
from engine.ai import refs as ai_refs
from engine.ai import safety as ai_safety
from engine.ai import search_index as ai_search
from engine.ai import tools as ai_tools
from engine.ai import use as ai_use
from engine.ai import vocab as ai_vocab
from engine.ai import wildcard as ai_wildcard
from engine.ai import wildcard_edit as ai_wildcard_edit
from engine.ai.chat_manage import ManageTools, bulk_key, default_style
from engine.ai.chat_tools import MoreTools, _num, _reach, _reach_text
from engine.ai.pack import recommend as pack_recommend
from engine.modules.constraint_handler import ConstraintHandler
from engine.modules.derivation_handler import DerivationHandler
from engine.modules.wildcard_handler import WildcardHandler

READ_TOOLS = ai_tools.READ
CHANGE_TOOLS = ai_tools.CHANGE
#: Tools that pause the turn: they run in the browser or need the user's OK.
PAUSE_TOOLS = ai_tools.CLIENT + ai_tools.WEB + ai_tools.ASK
#: Tools that change one existing item (its id is `args.id`).
ITEM_TOOLS = ("add_options", "edit_options", "edit_values", "edit_combine", "add_rules",
              "edit_rules", "edit_constraint", "edit_template", "edit_bundle", "update_info")
#: Manager pages `open` can go to: route name → what it is for.
APP_PAGES: dict[str, str] = {
    "dashboard": "overview of the library",
    "all": "every module and bundle in one list",
    "wildcards": "wildcard list", "fixed-values": "fixed values list",
    "combines": "combine list", "derivations": "derivation list",
    "constraints": "constraint list", "bundles": "bundle list",
    "templates": "prompt templates", "categories": "categories", "tags": "tags and collections",
    "import-export": "import and export, wildcard pack import, backups",
    "test": "Test Runner: run modules on many seeds",
    "pack-builder": "Pack builder: plan and build a whole pack",
    "settings": "Settings (add a section: general, appearance, editing, autocomplete, "
                "canvas, test-runner, ai, library, advanced)",
    "whats-new": "release notes", "community": "community packs",
}
MAX_PAGE_NOTE = 1500
MAX_PACK_DESCRIPTION = 2000
#: Changes run_test can try (the rest change names, tags or open pages).
CHECKABLE_TOOLS = (
    "create_wildcard", "add_options", "edit_options", "create_fixed_values", "edit_values",
    "create_combine", "edit_combine", "create_derivation", "add_rules", "edit_rules",
    "create_constraint", "edit_constraint", "create_bundle", "edit_bundle",
)
#: Sent once when an answer proposed module changes without trying them.
CHECK_NUDGE = (
    "Before you finish: you proposed changes but haven't tried them. Call run_test "
    "with \"proposed\": true on a stack that uses them (with a template if one fits), "
    "then tell the user what it showed and fix anything it flags."
)
#: Sent once when an answer asks leave to do what it could just propose,
#: or answers the user's "yes" by asking again. Small models do this in a
#: loop: proposals are already the asking.
GO_NUDGE = (
    "Don't ask the user whether to go ahead: every change tool only makes a "
    "proposal card they Apply or Dismiss, so proposing IS asking. Make the "
    "calls now (plan_pack for a whole new pack, the create tools for a few "
    "items). Only if you truly can't continue without the user's choice, ask "
    "that one question again with \"calls\": []."
)
#: The result of a highlight on parts it already pointed at this turn.
POINTED_AGAIN = (
    "highlight: already pointed at that; it is still showing on the page. "
    "Don't point again: answer the user now in words (say where it is)."
)
READ_AGAIN = (
    "read_page: you already read that part in this answer and its result is "
    "above; reading it again shows the same. Answer the user now."
)
#: Sent once when a step comes back empty (no text, no calls).
EMPTY_NUDGE = (
    "Your last answer was empty. Answer the user's message now: call a tool, or "
    "reply in plain text."
)
#: Sent instead of `EMPTY_NUDGE` when the step limit was reached, or a call
#: on the user's page failed: one more step, words only.
EMPTY_WORDS_NUDGE = (
    "Your last answer was empty. No more tool calls: answer the user's message "
    "now in plain text from what you have."
)
PAGE_FAILED_NUDGE = (
    "Your last answer was empty after a call on the user's page failed. No more "
    "tool calls: answer the user's message now in plain text from what you know, "
    "and say plainly if you couldn't show it on the page."
)
#: The result of a change call identical to one already proposed in this answer.
PROPOSED_AGAIN = (
    "{tool}: you already proposed exactly this as card {pid}; it stands, with "
    "its warnings. Don't send it again. If a warning is right, send a changed "
    "call; otherwise go on to the next item the user asked for."
)
#: Sent once when an answer stops where it introduces its content.
UNFINISHED_NUDGE = (
    "Your answer stopped right where it introduced its content (it ends with a "
    "colon and nothing follows). Write the whole answer again, this time with "
    "that content."
)
#: What a model asks leave to do when it should just propose it.
_CHANGE_VERB = (r"(?:go ahead|proceed|start|continue|create|build|make|add|apply|propose|"
                r"set (?:it|them|this|that) up|change|fix|update|edit|remove|delete|rename|"
                r"retag|tag|write|draft|implement|put)")
_ASKS_LEAVE = re.compile(
    r"\b(?:should|shall|may|can) i " + _CHANGE_VERB + r"\b|"
    r"\b(?:do you )?want me to " + _CHANGE_VERB + r"\b|"
    r"\bwould you like me to " + _CHANGE_VERB + r"\b|"
    r"\bready (?:for me )?to (?:proceed|start|build)\b|\bshall we (?:proceed|start|begin)\b",
    re.IGNORECASE,
)
_GO_AHEAD = re.compile(
    r"^(?:yes|yeah|yep|yup|sure|ok|okay|go|go ahead|go for it|do it|proceed|please|"
    r"sounds good|let'?s go|build it|create it|make it|start|continue|y)\b[\s\w,.!']{0,30}$",
    re.IGNORECASE,
)


def asks_leave(message: str) -> bool:
    """The answer asks permission instead of proposing ("Should I proceed?")."""
    return bool(_ASKS_LEAVE.search(message or ""))


def unfinished(said: str) -> bool:
    """The answer ends by introducing something that never came
    ("Here's a quick summary of the key concepts:")."""
    return said.rstrip().endswith(":")


#: Sent when an answer was cut off (the output limit, a dropped stream, or
#: it stops mid-sentence): the next step writes the rest.
CONTINUE_NUDGE = (
    "Your last answer was cut off mid-way. Continue it from exactly where it "
    "stopped: don't repeat what you already wrote, don't start over. If it "
    "was in fact complete, reply with only: (complete)"
)
#: The reply to CONTINUE_NUDGE that means nothing was missing.
COMPLETE_MARK = "(complete)"
_ENDS = ".!?…)]}\"'`*>_~|"
_BLOCK_LINE = re.compile(r"^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|\||>)")


def looks_cut(text: str) -> bool:
    """The answer stops mid-sentence: an unclosed bracket, bold or code span
    or code block on its last line, or a paragraph that ends without its
    full stop. List items, headings and table rows may end bare."""
    t = (text or "").rstrip()
    if not t:
        return False
    if t.count("```") % 2:
        return True
    last = t.rsplit("\n", 1)[-1]
    if (last.count("(") > last.count(")") or last.count("[") > last.count("]")
            or last.count("**") % 2 or last.replace("```", "").count("`") % 2):
        return True
    if _BLOCK_LINE.match(last) or t.endswith(":"):
        return False
    return t[-1] not in _ENDS and len(last) > 25


def join_continuation(head: str, tail: str) -> str:
    """The cut answer and the step that continued it. A model that started
    over instead of continuing gives the new text alone."""
    tail = tail.strip()
    if not tail or tail.rstrip(".").lower() == COMPLETE_MARK:
        return head
    probe = head.strip()[:60]
    if probe and tail.startswith(probe):
        return tail
    if head.endswith((" ", "\n")) or tail[0] in ".,;:!?)]}*`":
        return head + tail
    return head + " " + tail


def read_budget(size: str) -> int:
    """Read calls one answer may make before it is told to answer: a local
    model re-reads a growing prompt on every step, so many reads run out
    the clock (a 27B read 8 items in two steps and timed out writing)."""
    return {"small": 6, "medium": 8}.get(size, 12)


def is_go_ahead(text: str) -> bool:
    """The user's message is a short yes ("yes", "ok do it", "go ahead")."""
    t = re.sub(r"\s+", " ", text or "").strip()
    return 0 < len(t) <= 40 and bool(_GO_AHEAD.match(t))


#: An answer longer than this that ends by offering more ("Want me to
#: propose changes?") answered something; it isn't stalling.
STALL_CHARS = 300


def stalls(said: str, user_text: str, last_answer: str) -> bool:
    """A step that ended with no calls but should have acted: the whole
    answer is a request for leave, it repeats its last answer, or it met the
    user's yes with more talk."""
    if (asks_leave(said) and len(said.strip()) <= STALL_CHARS) \
            or (is_go_ahead(user_text) and asks_leave(last_answer)):
        return True
    norm = lambda t: re.sub(r"\W+", " ", t or "").strip().lower()  # noqa: E731
    return bool(last_answer) and norm(said) == norm(last_answer)


#: "I'll use add_rules to add a new rule." with no call after it.
_PROMISES = re.compile(r"\b(?:I(?:'ll| will| am going to|'m going to)|let me)\s+(?:now\s+)?"
                       r"(?:use|call|try|run)\s+(?:the\s+)?`?([a-z_]+)`?", re.I)


def promised_call(said: str) -> str:
    """The change tool an answer with no calls says it will call, or "".
    Re-test on 367a6a5 (9B): "I'll use add_rules…" ended the turn."""
    for m in _PROMISES.finditer(said or ""):
        if m.group(1).lower() in CHANGE_TOOLS:
            return m.group(1).lower()
    return ""


def promise_nudge(tool: str) -> str:
    return (f"You said you'd call {tool}, but you made no call, so nothing was proposed. "
            f"Call {tool} now with its arguments (not as text in your message).")


#: An answer with no call that says a change or a test happened (9B chat
#: eval, 2026-10-21: "I've created …", "the Test Runner is now open with 20
#: runs", categories listed as text for an organize ask).
_CLAIMED = re.compile(
    r"\b(?:I(?:'ve| have)?|I've now)\s+(?:just\s+)?(?:created|made|added|built|set up|saved|"
    r"updated|applied|proposed|organi[sz]ed|moved|renamed|ran|run|tested|opened)\b"
    r"|\bthe\s+test\s+runner\s+is\s+(?:now\s+)?open\b|\bopened\s+the\s+test\s+runner\b"
    r"|\b(?:the\s+)?test\s+(?:ran|shows|showed|passed)\b", re.I)


def claims_change(said: str) -> bool:
    """Whether an answer talks as if it made a change, ran a test or opened
    the Test Runner. With no call behind it, the turn is asked once more
    for the call (`CLAIM_NUDGE`) before the answer stands."""
    return bool(_CLAIMED.search(said or ""))


#: An answer that proposed part of the ask and puts the rest off to a later
#: turn (9B chat eval, 2026-10-21, "Class wildcard + $title derivation":
#: "Apply it, then I'll propose the derivation for $title").
_DEFERS = re.compile(
    r"\b(?:then|next|after\s+(?:that|you\s+apply\b[^.?!]*?|applying\b[^.?!]*?)|once\s+(?:it|that|"
    r"this|you)[^.?!]*?),?\s+I(?:'ll| will| can| could)\s+(?:then\s+)?(?:propose|create|make|"
    r"add|build|set\s+up|write|draft)\b", re.I)


def defers_rest(said: str) -> bool:
    """Whether an answer puts part of the ask off to a later turn ("Apply
    it, then I'll propose the derivation"). Cards from one answer can be
    applied together, so the rest is asked for now (`DEFER_NUDGE`)."""
    return bool(_DEFERS.search(said or ""))


DEFER_NUDGE = (
    "Your answer puts part of the request off to a later turn. The user asked for all of it "
    "now, and cards from one answer are applied together (a rule may read a variable a card "
    "of this answer creates), so nothing needs applying first. Propose the rest now, with "
    "its calls, then answer.")


#: Keys and $variables an answer names as facts about the app or library.
_KEYS = re.compile(
    r"\b(?:Ctrl|Cmd|Alt|Option|Shift|Meta)(?:\s*\+\s*(?:Ctrl|Cmd|Alt|Option|Shift|Meta|Enter|"
    r"Return|Esc|Escape|Tab|Space|Backspace|Delete|Up|Down|Left|Right|Home|End|F\d{1,2}|"
    r"[A-Za-z0-9]\b))+", re.I)
_VARS = re.compile(r"(?<![\w$])\$([A-Za-z_][A-Za-z0-9_]*)")


def _plus(text: str) -> str:
    """"Ctrl + S" and "Ctrl+S" read the same."""
    return re.sub(r"\s*\+\s*", "+", text)


def _docs_text() -> str:
    """All the built-in docs as one lower-case text, keys written "ctrl+s"."""
    global _DOCS_TEXT
    if _DOCS_TEXT is None:
        _DOCS_TEXT = _plus("\n".join(str(sec.get("text") or "") + " " + str(sec.get("title") or "")
                               for page in ai_docs.pages() for sec in page.get("sections") or []
                               if isinstance(sec, dict)).lower())
    return _DOCS_TEXT


_DOCS_TEXT: str | None = None


def unknown_names(said: str, known: str, variables: Any = ()) -> list[str]:
    """Keys (Ctrl+S) and $variables an answer names that neither the docs,
    the library's variables nor the chat so far (`known`: the user's words
    and every result) mention. Sonnet probe 2026-10-21: a how-to answer
    gave Ctrl+S and $final_prompt, neither of which exists."""
    if not said:
        return []
    known = _plus(known.lower())
    docs = _docs_text()
    out: list[str] = []
    for m in _KEYS.finditer(said):
        key = re.compile(r"(?<![a-z0-9+])" + re.escape(_plus(m.group(0).lower()))
                         + r"(?![a-z0-9+])")
        if not key.search(docs) and not key.search(known) and m.group(0) not in out:
            out.append(m.group(0))
    have = {str(v).lower() for v in variables}
    for m in _VARS.finditer(said):
        name = m.group(1)
        low = name.lower()
        if low in have or f"${low}" in docs or f"${low}" in known or f"${name}" in out:
            continue
        if re.search(r"(?<![\w$])" + re.escape(low) + r"(?!\w)", known):
            # The user's bare word: "Rename its variable to hair_color."
            # (9B smoke s-rename-var, empty library, 2026-10-24).
            continue
        out.append(f"${name}")
    return out[:6]


def facts_nudge(names: list[str]) -> str:
    return (
        "Your answer names " + ", ".join(names) + ", which the docs, the library and this "
        "chat never mention. Don't guess keys, variables or how the app behaves: check the "
        "docs (docs tool) or the library first, or leave them out. If one is only an example, "
        "say so plainly.\n" + REWRITE_KEEP)


#: How a nudged answer is written again: the user sees only the new one
#: (Sonnet 2026-10-21: a warning answer came back as a bare apology, its
#: Warning box gone).
REWRITE_KEEP = (
    "If you answer in words, write your WHOLE answer again with only the wrong part "
    "changed: keep everything else, its formatting (lists, tables, Tip: / Warning: lines) "
    "included. The user sees only this new answer. No apology, and don't mention the "
    "correction.")


CLAIM_NUDGE = (
    "Your answer says something was made, changed, tested or opened, but you made no call, so "
    "nothing happened and the user would be misled. Make the call now (the change tool, "
    "run_test, or show_test), or answer plainly that it is not done yet. Never describe a "
    "change as done without its call.\n" + REWRITE_KEEP)
#: Under an organize ask, in the message tail (`_ai_turn`): Haiku and the
#: 9B (2026-10-21) searched the library a type and a tag at a time until the
#: steps ran out, and never called a change tool.
ORGANIZE_HINT = (
    "This is an organize ask. Don't search type by type or tag by tag: one search with "
    "{\"query\": \"\", \"category\": \"none\"} lists every item with no category (up to "
    "100), and {\"category\": name} lists a category's items. Then propose the moves in "
    "this answer: edit_categories for categories that don't exist yet and one update_many "
    "per group (the user applies the cards), or organize with the ids to have the panel "
    "suggest categories, tags and ratings. Reuse the user's own categories where they fit.")
ORGANIZE_NUDGE = (
    "The user asked you to organize their library, but you made no call, so nothing changed: "
    "a list of categories in your message does nothing. Call edit_categories (or the "
    "organize action) with the moves now, or ask one question if you can't decide.")


#: A message asking for a NEW item ("make a weather wildcard", "create me
#: a new outfit list"), as opposed to a change of one that exists.
_CREATION_ASK = re.compile(
    r"\b(?:make|create|build|write|generate|set\s+up|add)\s+(?:me\s+)?(?:a|an|another|new|"
    r"some|\d+)\b|\bnew\s+(?:\w+\s+){0,2}(?:wildcards?|combines?|templates?|derivations?|"
    r"constraints?|fixed\s+values?|bundles?|lists?|items?|modules?)\b", re.I)


def creation_ask(text: str) -> bool:
    """Whether the user's message asks for a new item rather than a change
    of one that exists: then an item the answer only read is still not
    theirs to change (chat eval round 3: "make a weather wildcard" rewrote
    their Weather)."""
    return bool(_CREATION_ASK.search(text or ""))


TOOLS = READ_TOOLS + CHANGE_TOOLS

MAX_STEPS = 6
MAX_CALLS_PER_STEP = 8
MAX_PROPOSALS = 12
MAX_MESSAGE = 12000
#: User messages one chat holds; older turns are shortened or left out first.
MAX_TURNS = 100
MAX_TURN_CHARS = 6000
MAX_OVERVIEW_ITEMS = 150
MAX_SEARCH = 25
#: A search by category with no query is a listing (an organize ask reads
#: every item with no category in one call), so it goes further.
MAX_SEARCH_LISTING = 100
_FIELD_NAMES = {"name": "name", "var": "variable", "tags": "tags", "desc": "description",
                "content": "options/content"}
MAX_READ_OPTIONS = 150
_REF = re.compile(r"\[\[([^\[\]\n]{1,80})\]\]")
#: Words a model puts after an item's name ("Character Design bundle").
_KIND_WORDS = {"", "bundle", "wildcard", "combine", "derivation", "constraint", "template",
               "fixed values", "module", "item"}
#: Words after "my" that say what kind of item, not which one.
_OWN_SKIP = frozenset({"wildcard", "wildcards", "template", "templates", "derivation",
                       "derivations", "constraint", "constraints", "bundle", "bundles",
                       "combine", "combines", "fixed", "values", "value", "rule", "rules",
                       "item", "items", "list", "library", "module", "modules", "one", "and",
                       "to", "with", "so", "for", "in", "of", "it", "a", "is"})
_IDENT = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,63}$")
_HEX_ID = re.compile(r"\b[0-9a-f]{8}\b")
_CHIP_ID = re.compile(r"\[\[([0-9a-f]{8})#")
#: "A → B": a model writing a constraint as a wildcard.
_ARROW = re.compile(r"\S\s*(?:→|->|⟶|=>)\s*\S")

STEP_SCHEMA: dict[str, Any] = ai_tools.step_schema(list(TOOLS))

SYSTEM_INTRO = """\
You are the assistant inside Wildcard Pipeline's library manager. Wildcard \
Pipeline is a ComfyUI extension that builds image-generation prompts from \
modules that run in order and set $variables:
- wildcard: a list of options, one picked per run, bound to a $variable (or \
none: a vocabulary other options draw from with @{Name}). Options carry a \
weight, tags, a negative; tags can be grouped into axes; one option can be \
empty (null) and one a fallback.
- fixed_values: variables set to the same text every run.
- combine: a template that joins variables into a new one.
- derivation: sets or changes variables from others. It holds several \
RULES that each run; a rule is IF … ELIF … ELSE branches (the first branch \
whose test holds runs its actions, else the ELSE); a test is one condition \
or several joined by AND or OR, and groups nest ("a AND (b OR c)"); each \
branch can run several actions in order.
- constraint: links a SOURCE wildcard to a TARGET wildcard so the source's \
pick changes the odds of the target's options (exclude, reduce, boost, only).
- bundle: a saved stack of modules in order; each child has per-use settings.
- template: the WP Prompt Assembler's prompt and negative, reading variables.

You help the user understand, build and tidy their library, and you answer \
questions about Wildcard Pipeline itself. You can read the library and the \
built-in docs, run stacks on the engine, and propose changes. You never \
change anything yourself: every change tool makes a proposal card the user \
reviews and applies, and until then the item does not exist in the library. \
So say "I've proposed …, apply the cards", never "I created"; don't search \
for what you just proposed (the tool result gives its id, and you can point \
at it by that id right away). Before creating an item for a variable, \
search for one that already sets it and offer to reuse it. Examples in the \
docs are not in the user's library: call them examples. Plans are fine, but act: if the user asks \
for something, propose it. Never ask "should I proceed?" or "want me to?": a \
proposal already waits for the user's Apply, so asking first only makes \
them say yes twice. When the user says yes, make the calls. Deleting \
needs the delete_items tool; when it isn't in your tools, tell the user \
deleting is off in Settings › AI assistant › Permissions (you can't turn it \
on). Answer the user's actual question with what you found: no greeting, no \
list of what you can do.

"""
#: The Markdown the chat renders, told to the model the same way in both
#: answer modes. Every element here has a drawing in the drawer
#: (`AiMessage.vue`); one it is not told about, it never writes.
FORMATTING = """\
Write short answers as plain sentences. Use formatting only where it helps:
- a list (- or 1.) for several separate items, or steps that explain how \
something works;
- a task list (- [ ] to do, - [x] done) for steps the user has to do (a to-do or a \
checklist), not a plain list;
- a | table | to compare items;
- `code` for $variables, option text and prompt syntax; keys like `Ctrl+Enter` \
in backticks show as keyboard keys;
- a ``` block for JSON or a prompt longer than a line (```prompt for prompt text);
- ### headings only in answers longer than about 15 lines;
- one line starting "Tip:", "Note:" or "Warning:" for the next step or a risk, at \
most one per answer; a longer one as a quote: > [!TIP], > [!NOTE] or > [!WARNING] \
on the first line, the text on the next. A risk (something that breaks, is lost or \
can't be undone) is a Warning, never a Tip, and never plain text;
- a [link](https://…) only for a web address you were given (it shows as text). \
Asked for a link, write it in your answer (a docs page as Docs › page › section); \
never open or highlight something to link it.
No emoji. Name keys, $variables and what the app does only as the docs, the page \
or the library show them; never guess one. End with the answer, not an offer.
"""
#: How a JSON-mode model answers.
FORMAT_JSON = """While you still have calls to make, leave "message" empty. \
Answer with JSON: {"plan": one or two sentences for yourself: what the \
user wants, which features fit (see "Which feature for which job") and what \
you'll call next, "message": what you say to the user now, "calls": tools \
to run}. Each call is {"tool": name, "args": ARGS}. Read tools run at once \
and you get their results in the next message; then continue. When you are \
done, answer with "calls": [] and a message for the user. Keep messages short and plain. \
Write every library item you mention as [[id#Name]] (its id from read or \
search, then its name): the user sees a chip with the name that opens it. \
Never write an id anywhere else, and never ask the user for one: ids mean \
nothing to them.
""" + FORMATTING + """\
Wherever a tool takes an id you can also give \
the item's exact name. Use page tools (open, highlight) only when the user asks about the app \
or where something is, never for a greeting.
For "where is X": read_page and highlight it on the page the user is on; open another \
page only when it isn't there. Point once, then answer in words.
"""
#: How a model with native tool calling answers.
FORMAT_NATIVE = """\
Use the tools: read tools run at once and their results come back to you; \
then continue. Change tools each make a proposal card. Before your first \
call, decide what the user wants, which features fit (see "Which feature \
for which job") and what you'll call. Call tools through tool calls only: \
never write a call, its arguments or its results into your message, and \
never answer from an item you haven't read. Several calls can go in one \
step (for example several options in one add_options call, or reads of \
several items). When you are done, answer the user in plain text without \
calling a tool. Keep messages short and plain. \
Write every library item you mention as [[id#Name]] (its id from read or \
search, then its name): the user sees a chip with the name that opens it. \
Never write an id anywhere else, and never ask the user for one: ids mean \
nothing to them.
""" + FORMATTING + """\
Wherever a tool takes an id you can also give \
the item's exact name. Use page tools (open, highlight) only when the user asks about \
the app or where something is, never for a greeting.
For "where is X": read_page and highlight it on the page the user is on; open another \
page only when it isn't there. Point once, then answer in words.
"""


def tools_section(names: list[str] | None = None) -> str:
    """The JSON-mode list of tools, generated from the registry."""
    chosen = ai_tools.tools(names if names is not None
                            else ai_tools.toolset(None, scoped=False))
    return kinds_section(chosen) + "\n"


#: Under the lean prompt's one-line tool list.
INDEX_NOTE = ("Each tool's arguments and an example come with the step that first offers "
              "it, under \"Tools for this step\".")


def index_section(names: list[str] | None = None) -> str:
    """The lean prompt's tool list: one line per tool (`lean_prompt`)."""
    chosen = ai_tools.tools(names if names is not None
                            else ai_tools.toolset(None, scoped=False))
    return kinds_section(chosen, index=True) + INDEX_NOTE + "\n"


def kinds_section(chosen: list[Any], *, index: bool = False) -> str:
    """Tools grouped by what they do, for the JSON-mode prompt and
    `more_tools`; `index`: one line each, no arguments or example."""
    lines_of = ai_tools.index_lines if index else ai_tools.prompt_lines
    out = ""
    for kind, head in (("read", "Read tools"),
                       ("change", "Change tools (each becomes a proposal)"),
                       ("client", "Page tools (run in the user's browser; you get the result)"),
                       ("web", "Web tools (the user allows each query first)"),
                       ("ask", "Questions (shown in the chat; you get the user's answers)")):
        lines = lines_of(chosen, kind)
        if lines:
            out += ("\n" if out else "") + head + ":\n" + lines + "\n"
    return out


#: How "args" is written: a string for hosted servers, the object itself
#: where the server's grammar checks it (`typed`).
ARGS_TEXT = "a JSON object written as a string"
ARGS_TYPED = "the arguments as a JSON object"


def _format_json(typed: bool = False) -> str:
    return FORMAT_JSON.replace("ARGS", ARGS_TYPED if typed else ARGS_TEXT)


SYSTEM_HEAD = SYSTEM_INTRO + _format_json() + "\n" + tools_section()
SYSTEM_TAIL = """
Per-use settings ("use" on bundle items and run_test items): """ + ai_use.GUIDE + """

Read an item before changing it. Don't add commentary about content; the \
output is data for the user's own library.

Ask (with the ask tool) only when the answer changes what you'll make and \
you can't read it from the library or the page: a style, which of two \
existing items to reuse, whether to add negatives. For a small request, act \
and state your assumption in one line instead. Ask once, up to 4 questions, \
then build with the answers. Never ask permission, and never ask again what \
the user already answered.

""" + ai_safety.UNTRUSTED_RULE + """

Questions about Wildcard Pipeline (how something works, what a warning \
means, where a setting is, what a page says): search and read the docs \
first and answer from them, naming the page, like "(docs: Constraint › \
Target reach)", and open the page or point at the part when it helps. When asked to \
explain something more simply, say the same thing in plain everyday words \
with one small example; don't change what it means. If the docs don't cover \
it, say so instead of guessing.

When the user has an item open in its editor, read shows the editor's \
version, unsaved changes included, and your changes to that item go into the \
editor; the user saves them there. On the Test Runner page the note under \
the user's message shows the last run; use run_test to try changes.
"""
#: SYSTEM_TAIL for the leanest chats: the rules kept, the explanations cut
#: (examples teach a small model more than prose does).
SYSTEM_TAIL_SHORT = """
Read an item before changing it. The output is data for the user's own \
library: no commentary about content. For a small request, act and state \
your assumption in one line; ask (ask tool, once, up to 4 questions) only \
when the answer changes what you'll make. Never ask permission.

""" + ai_safety.UNTRUSTED_RULE + """

Questions about Wildcard Pipeline: search and read the docs first and answer \
from them, naming the page; if they don't cover it, say so. Changes to an \
item open in its editor go into the editor; the user saves them there.
"""
SYSTEM_PROMPT = SYSTEM_HEAD + ai_guide.text() + SYSTEM_TAIL


#: FORMAT_NATIVE's way to finish, and its split-step form (the act ask
#: must call something, so being done is the `answer` tool).
_NATIVE_DONE = "When you are done, answer the user in plain text without calling a tool."
_NATIVE_DONE_SPLIT = ("When you are done, call answer instead of a tool; you then write your "
                      "reply to the user in plain text.")
assert _NATIVE_DONE in FORMAT_NATIVE


def system_prompt(*, slim: bool = False, examples: bool = True, native: bool = False,
                  tools: list[str] | None = None, typed: bool = False,
                  prose: bool = True, split: bool = False, index: bool = False) -> str:
    """The chat's instructions. `slim` (small models) keeps the tools and
    the core guide but leaves out the coherence notes and the docs and page
    tables (docs_search still finds pages), about a third shorter.
    `native`: the tools travel as native declarations, so the prompt says
    how to use them instead of listing them. `tools`: the names this chat
    offers (default: all). `typed`: JSON-mode args are objects the server
    checks against each tool's schema (`ai_tools.step_schema`). `prose`
    False (the leanest level): the short closing rules (SYSTEM_TAIL_SHORT).
    `split` (native): steps are asked in two parts, so the model finishes
    by calling `answer` (`_ai_chat.split_step`). `index` (JSON mode, the
    `lean_prompt` setting): one line per tool; each tool's docs go in the
    tail of the step that first offers it (`_ai_turn._tool_docs`)."""
    pages = "\n".join(f"- {k}: {v}" for k, v in APP_PAGES.items())
    if native:
        fmt = FORMAT_NATIVE.replace(_NATIVE_DONE, _NATIVE_DONE_SPLIT) if split \
            else FORMAT_NATIVE
        head = SYSTEM_INTRO + fmt + "\n"
        shown = ai_guide.EXAMPLES_CHAT_NATIVE if examples else ""
    else:
        head = SYSTEM_INTRO + _format_json(typed) + "\n" + (
            index_section(tools) if index else tools_section(tools))
        shown = (ai_guide.EXAMPLES_CHAT_TYPED if typed else ai_guide.EXAMPLES_CHAT) \
            if examples else ""
    tail = SYSTEM_TAIL if prose else SYSTEM_TAIL_SHORT
    if slim:
        return (head + ai_guide.text(slim=True) + shown + tail
                + "\nDocs: find pages with docs_search; asked what you can do, read "
                "docs assistant-tools. Manager pages: "
                + ", ".join(APP_PAGES))
    return (f"{head}{ai_guide.text()}{shown}{tail}\n"
            f"Docs pages (id: title; asked what you can do, read assistant-tools):\n"
            f"{ai_docs.contents()}\n\n"
            f"Manager pages:\n{pages}")


def _short(text: Any, n: int) -> str:
    s = re.sub(r"\s+", " ", text).strip() if isinstance(text, str) else ""
    return s if len(s) <= n else s[: n - 1] + "…"


def parse_args(raw: Any) -> dict[str, Any]:
    """A call's args: a JSON object, sometimes fenced or already an object."""
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str) or not raw.strip():
        return {}
    text = raw.strip()
    m = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if m:
        text = m.group(1)
    try:
        value = json.loads(text)
    except ValueError as e:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise ValueError("args must be a JSON object") from e
        try:
            value = json.loads(text[start:end + 1])
        except ValueError:
            raise ValueError("args must be a JSON object") from e
    if not isinstance(value, dict):
        raise ValueError("args must be a JSON object")
    return value


def parse_step(raw: Any) -> tuple[str, list[dict[str, Any]]]:
    if not isinstance(raw, dict):
        raise ValueError("the model's answer wasn't an object")
    message = _got if isinstance(_got := raw.get("message"), str) else ""
    calls: list[dict[str, Any]] = []
    for c in _got if isinstance(_got := raw.get("calls"), list) else []:
        if isinstance(c, dict) and c.get("tool") in TOOLS:
            calls.append({"tool": c["tool"], "args": c.get("args", "")})
    return message.strip()[:MAX_MESSAGE], calls[:MAX_CALLS_PER_STEP]


#: The tool that changes each kind of item, and the more_tools group it's in.
KIND_TOOLS = {"wildcard": ("edit_options", "wildcards"),
              "derivation": ("edit_rules", "derivations"),
              "constraint": ("edit_constraint", "constraints"),
              "fixed_values": ("edit_values", "fixed-values"),
              "combine": ("edit_combine", "combines"),
              "template": ("edit_template", "templates"),
              "bundle": ("edit_bundle", "bundles")}
#: A wildcard name that says it is another kind ("Portrait Template").
_OTHER_KIND = re.compile(r"\b(templates?|bundles?|fixed[ -]values?|combines?)\b", re.I)


#: A message that asks to point at an item it picks ("nested reference of
#: @color", "draw the colours from @color").
_REF_ASK = re.compile(r"\b(?:nest\w*|referenc\w*|refs?|draws?(?:ing)? from|picks? from|"
                      r"pulls? from)\b|@\{", re.I)
_PICKED = re.compile(r"\[\[([0-9a-f]{8})(?:#[^\]]*)?\]\]")


def ref_asks(text: str) -> set[str]:
    """Ids the user picked in a message that asks for a reference."""
    if not isinstance(text, str) or not _REF_ASK.search(text):
        return set()
    return set(_PICKED.findall(text))


def use_instead(kind: str, create: bool = False) -> str:
    """The pointer a wrong-kind refusal ends with, so the model calls the
    right tool instead of retrying this one (all-tools eval)."""
    tool, group = KIND_TOOLS.get(kind, ("", ""))
    if not tool:
        return ""
    if create:
        tool = "create_" + kind
    return (f": use {tool} (if you don't have it, call more_tools with "
            f'{{"group": "{group}"}} first)')

class Library(MoreTools, ManageTools):
    """The rows one chat request may look at, plus the change compilers."""

    def __init__(self, modules: list[dict[str, Any]], bundles: list[dict[str, Any]],
                 categories: list[dict[str, Any]],
                 templates: list[dict[str, Any]] | None = None) -> None:
        self.modules = {m["id"]: m for m in modules if isinstance(m.get("id"), str)}
        self.bundles = {b["id"]: b for b in bundles if isinstance(b.get("id"), str)}
        self.templates = {t["id"]: t for t in templates or [] if isinstance(t.get("id"), str)}
        self.categories = {c["id"]: c["name"] for c in categories}
        self.category_rows = {c["id"]: dict(c) for c in categories}
        #: Settings › AI assistant › "Let the assistant delete items".
        self.allow_delete = False
        #: Library items the user named in this chat, had open, or that an
        #: earlier card changed: the only ones the edit tools may change.
        #: None (tests, other callers) leaves every item open.
        self.named: set[str] | None = None
        #: Wildcards the user picked by id in a message asking to point at
        #: them ("a nested reference of [[id#color]]"): a new wildcard that
        #: never does is told so (`_unused_ref_ask`).
        self.ref_asks: set[str] = set()
        #: Words of the user's message that could be variable names: a
        #: clash with one of them is what the user asked for.
        self.asked_words: set[str] = set()
        #: The user's message this turn: a rating lowered to safe or an
        #: adult tag taken off needs its say-so (`ratings.keep_nsfw`).
        self.user_text = ""
        #: The user's message read into a request frame when it isn't in
        #: English (`engine/ai/lang.py`), else None.
        self.request_frame: dict[str, Any] | None = None
        self.cat_by_lower = {c["name"].lower(): c["id"] for c in categories}
        self.names = {i: m.get("name") or "" for i, m in self.modules.items()}
        self.tags = ai_describe.library_tags([*modules, *bundles, *(templates or [])])
        self._catalog: dict[str, dict[str, Any]] | None = None
        # Item id -> (proposal id, the row as that proposal leaves it). A later
        # change to the same item builds on the earlier proposal, so applying
        # both in order keeps both; the card says to apply the earlier first.
        self._pending: dict[str, tuple[str, dict[str, Any]]] = {}
        #: Id of each module proposed in this answer -> its proposal id.
        self._created: dict[str, str] = {}
        #: Items this answer's read tools looked at, in order: a name several
        #: items share links to the one the model read (`link_items`).
        self.touched: list[str] = []
        #: Whether an item this answer read in full may be changed: the user
        #: asked for a change, not a new item (`creation_ask`). The 9B found
        #: and showed the user's Weather, then refused to add negatives to it
        #: because "you haven't named it" (2026-10-21).
        self.edit_read = False
        #: The last run_test as card data (`chat_tools._test_card`), taken by the route.
        self.last_card: dict[str, Any] | None = None
        #: The emoji `react` put on the user's message this turn, else "".
        self.reaction = ""
        #: Put on the message as it was sent (`react.opening`); the model's
        #: own `react` replaces it.
        self.opening_reaction = ""
        #: Create cards from earlier answers the user hasn't applied, by pid:
        #: edits to them come back as a card that replaces them.
        self._earlier_ops: dict[str, dict[str, Any]] = {}
        #: Cards replaced by a repeat of them (`_take_place`): old pid -> new.
        self.replaced: dict[str, str] = {}
        #: Categories an unapplied card creates: lower-case name -> (pid,
        #: name), so the same create isn't proposed again (`edit_categories`).
        self.proposed_categories: dict[str, tuple[str, str]] = {}
        #: Each item change an update_many card of this answer makes
        #: (`chat_manage.bulk_key`) -> its pid.
        self.bulk_cards: dict[tuple[str, str], str] = {}
        #: This answer's cards by pid (`_fold`).
        self._answer_cards: dict[str, dict[str, Any]] = {}
        self._next_pid = 0
        #: Proposals from earlier answers in this chat: pid -> {title, status}.
        self.earlier_proposals: dict[str, dict[str, Any]] = {}
        #: Id of the item open in an editor whose unsaved state replaced the
        #: saved row (`use_editor`); changes to it go into that editor.
        self.editor_id: str | None = None
        self.editor_dirty = False
        #: The editor's item is new: never saved, only its id is reserved.
        self.editor_new = False
        #: The library index (`engine.ai.index`), synced by the route; None
        #: means search scores every row in Python.
        self.index: ai_index.Index | None = None
        #: Meaning search: the embedding model, and the vector of the query
        #: the next `search` runs (the route embeds it; tools are sync).
        self.embed_model = ""
        self.qvec: list[float] | None = None
        #: The user's tags, LoRAs and embeddings (`engine.ai.vocab`): the
        #: route's lookup and the sources switched on with data behind them.
        self.vocab: ai_vocab.Lookup | None = None
        self.vocab_kinds: set[str] = set()

    def use_editor(self, editor: Any) -> None:
        """Read the open editor's version of its item instead of the saved
        row: the fields it sends (name, description, tags, category_id,
        content_rating, payload; a template's text, a bundle's children)
        replace the saved ones."""
        if not isinstance(editor, dict) or not isinstance(editor.get("id"), str):
            return
        item_id = editor["id"]
        saved = (self.modules.get(item_id) or self.bundles.get(item_id)
                 or self.templates.get(item_id))
        if saved is None and editor.get("new") is True:
            saved = self._add_unsaved(item_id, editor.get("type"))
        if saved is None:
            return
        row = dict(saved)
        for key, kind in (("name", str), ("description", str), ("tags", list),
                          ("content_rating", str)):
            if isinstance(editor.get(key), kind):
                row[key] = editor[key]
        if "category_id" in editor and (editor["category_id"] is None
                                        or isinstance(editor["category_id"], str)):
            row["category_id"] = editor["category_id"]
        if isinstance(editor.get("payload"), dict) and item_id in self.modules:
            payload = copy.deepcopy(editor["payload"])
            if isinstance(saved.get("payload"), dict) and "history" in saved["payload"]:
                payload.setdefault("history", saved["payload"]["history"])
            row["payload"] = payload
        if item_id in self.templates:
            for key in ("template_string", "negative_template"):
                if isinstance(editor.get(key), str):
                    row[key] = editor[key]
        if isinstance(editor.get("children"), list) and item_id in self.bundles:
            row["children"] = copy.deepcopy(editor["children"])
        if item_id in self.modules:
            self.modules[item_id] = row
            self.names[item_id] = row.get("name") or ""
            self._catalog = None
        elif item_id in self.templates:
            self.templates[item_id] = row
        else:
            self.bundles[item_id] = row
        self.editor_id = item_id
        self.editor_dirty = bool(editor.get("dirty"))

    def _add_unsaved(self, item_id: str, kind: Any) -> dict[str, Any] | None:
        """A new item open in its editor, never saved: a blank row at the id
        the editor reserved (Save creates it there), filled by the editor's
        fields. Changes to it go into the editor; nothing is created here."""
        if not re.fullmatch(r"[0-9a-f]{8}", item_id) or self.get(item_id) is not None:
            return None
        row: dict[str, Any] = {"id": item_id, "name": "", "description": "", "tags": [],
                               "category_id": None, "content_rating": "safe"}
        if kind == "bundle":
            self.bundles[item_id] = row = {**row, "children": []}
        elif kind in ("wildcard", "fixed_values", "combine", "derivation", "constraint"):
            self.modules[item_id] = row = {**row, "type": kind, "payload": {}}
        elif kind == "template":
            self.templates[item_id] = row = {**row, "template_string": "",
                                             "negative_template": ""}
        else:
            return None
        self.editor_new = True
        return row

    @property
    def catalog(self) -> dict[str, dict[str, Any]]:
        if self._catalog is None:
            self._catalog = library_vars.build_catalog(list(self.modules.values()))
        return self._catalog

    # ── what the model is told up front ──────────────────────────────────

    def overview(self, limit: int | None = None) -> str:
        counts: dict[str, int] = {}
        for m in self.modules.values():
            counts[str(m.get("type"))] = counts.get(str(m.get("type")), 0) + 1
        if self.bundles:
            counts["bundle"] = len(self.bundles)
        if self.templates:
            counts["template"] = len(self.templates)
        lines = ["The library now:"]
        lines.append("Counts: " + (", ".join(f"{n} {t}" for t, n in sorted(counts.items()))
                                   or "empty"))
        cats = list(self.categories.values())
        lines.append(f"Categories: {', '.join(cats) if cats else 'none'}")
        lines.append(f"Tags: {', '.join(self.tags[:60]) if self.tags else 'none'}")
        rows = [*self.modules.values(), *self.bundles.values(), *self.templates.values()]
        rows.sort(key=lambda r: str(r.get("updated_at") or ""), reverse=True)
        unset = self.unset_reads()
        if unset:
            # Worked out here so the model needn't read every item for it.
            lines.append("Read but set by nothing in the library (a node on the canvas may "
                         "set them): " + "; ".join(
                             f"${v} (by {', '.join(names[:3])})" for v, names in unset))
        lines.append(f"Items (id · type · name), newest first, {len(rows)} in all:")
        habits = ai_patterns.note(ai_patterns.summarize(
            list(self.modules.values()), list(self.bundles.values()),
            list(self.templates.values())), reuse=False)
        if habits:
            lines.append(habits)
        limit = limit or MAX_OVERVIEW_ITEMS
        for r in rows[:limit]:
            lines.append(f"- {self._line(r)}")
        if len(rows) > limit:
            lines.append(f"- … {len(rows) - limit} more (use search)")
        return "\n".join(lines)

    def _kind(self, row: dict[str, Any]) -> str:
        if row.get("id") in self.templates and "template_string" in row:
            return "template"
        return "bundle" if row.get("id") in self.bundles and "children" in row else str(
            row.get("type") or "module")

    def _line(self, r: dict[str, Any]) -> str:
        bits = [str(r["id"]), self._kind(r), str(r.get("name") or "(unnamed)")]
        if r.get("type") == "wildcard" and isinstance(r.get("payload"), dict):
            var = r["payload"].get("var_binding")
            bits.append(f"${var}" if var else "vocabulary")
        elif r.get("type") == "combine" and isinstance(r.get("payload"), dict):
            if r["payload"].get("output_var"):
                bits.append(f"${r['payload']['output_var']}")
        return " · ".join(bits)

    def named_in(self, text: str) -> set[str]:
        """Ids of library items the user's message names: an id, a chip,
        or a name not right after "a", "an", "new" or "another" ("change my
        Weather" names it, "make a weather wildcard" does not)."""
        out: set[str] = set(_HEX_ID.findall(text or "")) & {
            *self.modules, *self.bundles, *self.templates}
        low = (text or "").lower()
        for pool in (self.modules, self.bundles, self.templates):
            for r in pool.values():
                name = str(r.get("name") or "").strip().lower()
                if len(name) < 3 or r.get("_proposed"):
                    continue
                for m in re.finditer(r"(?<![\w])" + re.escape(name) + r"(?![\w])", low):
                    before = re.findall(r"[a-z]+", low[:m.start()])[-1:]
                    if before not in (["a"], ["an"], ["new"], ["another"]):
                        out.add(r["id"])
                        break
        # "my hero template" for "Hero shot": the words after my/the/this,
        # kind words left out, all in one item's name.
        for m in re.finditer(r"\b(?:my|the|this|that|these|those)\s+((?:[\w'-]+\s*){1,3})", low):
            words = [w for w in re.findall(r"[a-z0-9]+", m.group(1))
                     if w not in _OWN_SKIP]
            if not words:
                continue
            for pool in (self.modules, self.bundles, self.templates):
                for r in pool.values():
                    have = set(re.findall(r"[a-z0-9]+", str(r.get("name") or "").lower()))
                    if not r.get("_proposed") and all(
                            w in have or w.rstrip("s") in have for w in words):
                        out.add(r["id"])
        return out

    def shown_in(self, message: str) -> set[str]:
        """Ids of library items an answer showed as chips (``[[id#Name]]``)."""
        return set(_CHIP_ID.findall(message or "")) & {
            *self.modules, *self.bundles, *self.templates}

    def _check_named(self, tool: str, item_id: Any) -> None:
        """Refuse an edit of a library item the user never pointed at (chat
        eval round 3: "make a weather wildcard" rewrote their Weather)."""
        if self.named is None or not isinstance(item_id, str):
            return
        row = self.get(item_id)
        if row is None or row.get("_proposed") or item_id in self.named \
                or item_id == self.editor_id:
            return
        # Three wildcards named Weather (Haiku, 2026-10-21): the answer
        # showed one, the next turn read and edited another by id. The one
        # the user was shown is the one they mean.
        low = str(row.get("name") or "").strip().lower()
        twin = next((n for n in self.named if (r2 := self.get(n)) is not None
                     and str(r2.get("name") or "").strip().lower() == low), None)
        if twin is not None:
            shown = self.get(twin)
            assert shown is not None
            raise ValueError(
                f"{self._chip(row)} is another item named {row.get('name')}: the user was "
                f"shown {self._chip(shown)} in this chat, so that is the one they mean. "
                "Change that one, or ask which of them they want")
        if self.edit_read and item_id in self.touched:
            return
        raise ValueError(
            f"{self._chip(row)} is the user's own item and they haven't named it in this chat: "
            "don't change it. Make a new item for what they asked (a new name, or another "
            "variable), or ask them whether they mean this one")

    def page_note(self, page: Any) -> str:
        """What the user is looking at, added under their message."""
        if not isinstance(page, dict):
            return ""
        lines: list[str] = []
        item = self.get(page.get("id")) if isinstance(page.get("id"), str) else None
        doc = ai_docs.page(page.get("doc")) if page.get("doc") else None
        if item is None and self.editor_new and self.editor_id:
            new = self.get(self.editor_id) or {}
            name = new.get("name") or "(unnamed)"
            lines.append(f"The user has a new {self._kind(new)} \"{name}\" "
                         f"({self.editor_id}) open in its editor, not saved yet: read it by that "
                         "id; changes to it go into the editor, and it is created there (at that "
                         "id) only when the user saves.")
        elif item is not None:
            line = f"The user has {self._kind(item)} \"{item.get('name')}\" ({item['id']}) open"
            if item["id"] == self.editor_id:
                line += (" in its editor, with unsaved changes" if self.editor_dirty
                         else " in its editor")
            lines.append(line + ".")
        elif doc is not None:
            lines.append(f"The user is reading the docs page \"{doc['title']}\" ({doc['id']}); "
                         "docs_read it before answering about \"this page\".")
        elif isinstance(page.get("route"), str):
            lines.append(f"The user is on the {_short(page['route'], 40)} page.")
        note = page.get("note")
        if isinstance(note, str) and note.strip():
            text = note.strip()
            if len(text) > MAX_PAGE_NOTE:
                text = text[:MAX_PAGE_NOTE] + " …"
            lines.append(f"On screen: {text}")
        return "(" + " ".join(lines) + ")" if lines else ""

    def get(self, item_id: Any) -> dict[str, Any] | None:
        if not isinstance(item_id, str):
            return None
        return (self.modules.get(item_id) or self.bundles.get(item_id)
                or self.templates.get(item_id))

    def kind_of(self, item_id: Any) -> str:
        """An item's kind (wildcard, bundle, template, …), or "" if unknown."""
        row = self.get(item_id)
        return self._kind(row) if row is not None else ""

    def not_found(self, raw: Any, what: str = "item") -> str:
        """Why `raw` names nothing, for the model. An item from an earlier
        proposal the user hasn't applied has no id yet: say so, or the model
        guesses ids and then claims things about an item that isn't there."""
        key = _short(raw, 60)
        low = key.lower().lstrip("$")
        if low in TOOLS:
            return (f"{key!r} is a tool, not an item: call {key} itself with its arguments")
        if key and not re.search(r"\w", key):
            # All-tools eval: read({"id": "}}] } ]} ,"}), the JSON closing
            # brackets written as the value.
            return (f"the {what} id came out as JSON brackets ({key!r}): write the item's "
                    "8-character id or its name as the value")
        if low:
            for pid, p in self.earlier_proposals.items():
                if low in str(p.get("title") or "").lower() and p.get("status") not in (
                        "applied", "replaced"):
                    return (f"no {what} {key!r}: it is only proposed ({pid}, "
                            f"{'not applied' if not p.get('status') else p['status']}), so it "
                            "isn't in the library yet. Tell the user it needs applying first "
                            f"(or open it unsaved with open {{\"proposal\": \"{pid}\"}}); "
                            "don't guess its id")
            cat = next((c for c in self.category_rows.values()
                        if str(c.get("name") or "").lower() == low or c.get("id") == low), None)
            if cat is not None:
                # Re-test on d6ac847: read({"id": "Subject"}) for a category.
                inside = [r for r in [*self.modules.values(), *self.bundles.values(),
                                      *self.templates.values()]
                          if r.get("category_id") == cat["id"] and not r.get("_proposed")]
                shown = ", ".join(self._chip(r) for r in inside[:12])
                more = f" and {len(inside) - 12} more" if len(inside) > 12 else ""
                return (f"{cat['name']} is a category, not an item. It holds {len(inside)} "
                        f"item{'s' if len(inside) != 1 else ''}" + (f": {shown}{more}" if inside
                                                                     else "") + ". Read one of "
                        "them by its id, or propose changes with update_many / edit_categories")
            pool = [*self.modules.values(), *self.bundles.values(), *self.templates.values()]
            same = [r for r in pool if str(r.get("name") or "").lower() == low]
            if len(same) > 1:
                # Two items share the name: say which, so the next call
                # takes an id instead of searching and guessing again.
                return (f"{len(same)} items are named {key!r}: " + ", ".join(
                    f"{r['id']} ({self._kind(r).replace('_', ' ')})" for r in same[:6])
                    + "; call again with the id of the one you mean")
        return f"no {what} {key!r}; search for it, or check the id"

    def _resolve(self, args: dict[str, Any], *keys: str) -> dict[str, Any]:
        """``args`` with each of ``keys`` (an id or a unique name) turned
        into the item's id, so tools take either."""
        out = dict(args)
        for k in keys:
            if isinstance(out.get(k), str) and self.get(out[k]) is None:
                out[k] = self._bare_id(out[k])
            if isinstance(out.get(k), str) and self.get(out[k]) is None:
                row = self._find(out[k])
                if row is not None:
                    out[k] = row["id"]
        return out

    def _bare_id(self, raw: str) -> str:
        """An id the way the model copies it from a chip or a card:
        ``[[id#Name]]``, ``@{id}``, ``id#Name`` or the card's own ``p4``."""
        text = raw.strip()
        m = re.fullmatch(r"\[\[(.*)\]\]|@\{(.*)\}", text)
        if m:
            text = (m.group(1) or m.group(2) or "").strip()
        head = text.split("#", 1)[0].strip()
        if _HEX_ID.fullmatch(head):
            return head
        m = re.fullmatch(r"[^→>]*?[\s(]([0-9a-f]{8})\s*\)?", text)
        if m and self.get(m.group(1)) is not None:
            # "Weather (997f6b50)", as answers write items, or "Lighting d97da2bb".
            return m.group(1)
        # "Character Hair · $hair", the way cards are titled (all-tools eval).
        named = re.sub(r"\s*·\s*\$[A-Za-z_]\w*\s*$", "", text)
        if named != text and named:
            return named
        if re.fullmatch(r"p\d+", head):
            made = [i for i, pid in self._created.items() if pid == head]
            if len(made) == 1:
                return made[0]
            op = (self.earlier_proposals.get(head) or {}).get("op") or {}
            iid = op.get("id") or (op.get("body") or {}).get("id")
            if isinstance(iid, str) and self.get(iid) is not None:
                return iid
        return raw

    # ── read tools ───────────────────────────────────────────────────────

    def link_items(self, message: str) -> str:
        """The answer with the items it names made into chips, and no bare
        ids left for the user (models copy ids from read results, and
        unmarked names stay plain text). Code blocks are left alone.

        - ``[[Name]] (id)``, ``**Name** (id)``, ``Name kind (id)`` become
          ``[[id#Name]]`` (the id decides when two items share a name);
        - a known id anywhere else (``id``, ``(id, id)``) becomes a chip;
        - ``**Name**`` naming an item becomes a chip, and so does ``[[Name]]``
          when several items have that name: the one with the variable
          written next to it, else the one this answer read, else the open
          one (`_pick_named`);
        - ``**A** → **B**`` becomes the constraint from A to B.
        """
        if not message:
            return message
        out: list[str] = []
        fenced = False
        for line in message.split("\n"):
            if line.lstrip().startswith("```"):
                fenced = not fenced
                out.append(line)
                continue
            out.append(line if fenced else self._link_line(line))
        return "\n".join(out)

    def _known(self, raw: str) -> dict[str, Any] | None:
        """A real item (or one an open card proposes) by id; ``id#Name``
        counts by its id."""
        return self.get(raw.split("#", 1)[0].strip())

    def _chip(self, row: dict[str, Any]) -> str:
        """How an item is written in an answer: ``[[id#Name]]``."""
        name = re.sub(r"[\[\]\n#]", " ", str(row.get("name") or "")).strip()
        return f"[[{row['id']}#{name}]]" if name else f"[[{row['id']}]]"

    def _pick_named(self, name: str, var: str = "") -> dict[str, Any] | None:
        """The item called ``name`` (case-insensitive). Several share it (a
        pack imported twice): the one writing ``var``, else the one this
        answer read last, else the open one; None while still unsure."""
        low = name.strip().lower()
        if not low:
            return None
        pool = [r for r in (*self.modules.values(), *self.bundles.values(),
                            *self.templates.values())
                if str(r.get("name") or "").strip().lower() == low and not r.get("_proposed")]
        if len(pool) <= 1:
            return pool[0] if pool else None
        if var:
            v = var.lstrip("$").lower()
            by_var = [r for r in pool if isinstance(r.get("payload"), dict) and v in (
                str(r["payload"].get("var_binding") or "").lower(),
                str(r["payload"].get("output_var") or "").lower())]
            if len(by_var) == 1:
                return by_var[0]
            pool = by_var or pool
        for iid in reversed(self.touched):
            for r in pool:
                if r["id"] == iid:
                    return r
        for r in pool:
            if r["id"] == self.editor_id:
                return r
        return None

    def _constraint_between(self, a: str, b: str) -> dict[str, Any] | None:
        """The constraint from the wildcard named ``a`` to the one named ``b``
        (or named "a to b"); the one this answer read when there are more."""
        la, lb = a.strip().lower(), b.strip().lower()
        hits = []
        for r in self.modules.values():
            if r.get("type") != "constraint" or r.get("_proposed"):
                continue
            p = _got if isinstance(_got := r.get("payload"), dict) else {}
            src = str((self.modules.get(str(p.get("source_wildcard_id"))) or {}).get("name") or "")
            tgt = str((self.modules.get(str(p.get("target_wildcard_id"))) or {}).get("name") or "")
            name = str(r.get("name") or "").lower()
            if (src.lower() == la and tgt.lower() == lb) or name in (
                    f"{la} to {lb}", f"{la} → {lb}", f"{la} -> {lb}"):
                hits.append(r)
        if len(hits) == 1:
            return hits[0]
        for iid in reversed(self.touched):
            for r in hits:
                if r["id"] == iid:
                    return r
        return None

    def _link_line(self, line: str) -> str:
        def named(m: re.Match[str]) -> str:
            before, iid = m.group(1), m.group(2)
            row = self._known(iid)
            if row is None:
                return m.group(0)
            name = str(row.get("name") or "")
            ref = re.match(r"^(.*?)\[\[[^\[\]\n]+\]\]\s*$", before)
            if ref:
                return f"{ref.group(1)}{self._chip(row)}"
            # "**Name**", "Name", "**Name kind**" right before the id.
            tail = re.match(r"^(.*?)(\*\*|__)?([^*_\n]*?)(\*\*|__)?\s*$", before)
            if tail and name:
                lead, words = tail.group(1), tail.group(3)
                low, nlow = words.lower(), name.lower()
                at = low.rfind(nlow)
                if at >= 0 and (at == 0 or not low[at - 1].isalnum()):
                    rest = words[at + len(name):].strip()
                    if rest.lower() in _KIND_WORDS:
                        bit = words[:at]
                        return f"{lead}{bit}{self._chip(row)}" + (f" {rest}" if rest else "")
            return f"{before.rstrip()} {self._chip(row)}" if before.strip() else self._chip(row)

        # An id in brackets after its name (or after anything).
        line = re.sub(r"(^|.*?)\s*\(\s*`?([0-9a-f]{8})`?\s*\)", named, line)

        # Any other known id, bare or in code, outside chips.
        def bare(m: re.Match[str]) -> str:
            row = self._known(m.group(2))
            return self._chip(row) if row is not None else m.group(0)
        line = re.sub(r"(?<!\[\[)(`?)\b([0-9a-f]{8})\b\1(?![#\]])", bare, line)

        # A chip naming several items: the right one, by id.
        def chip(m: re.Match[str]) -> str:
            raw = m.group(1)
            row = self._known(raw)
            if row is not None:
                return self._chip(row)
            # A wrong id with a right name, or a bare name.
            name = raw.split("#", 1)[1] if "#" in raw else raw
            row = self._pick_named(name)
            return self._chip(row) if row is not None else m.group(0)
        line = re.sub(r"\[\[([^\[\]\n]{1,80})\]\]", chip, line)

        # "**A** → **B**": the constraint between them.
        def pair(m: re.Match[str]) -> str:
            row = self._constraint_between(m.group(2), m.group(4))
            return self._chip(row) if row is not None else m.group(0)
        line = re.sub(r"(\*\*|__)([^*_\n]{1,60}?)\1\s*(?:→|->|⟶)\s*(\*\*|__)([^*_\n]{1,60}?)\3",
                      pair, line)

        # A bold name (the variable after it decides between namesakes).
        def bold(m: re.Match[str]) -> str:
            row = self._pick_named(m.group(2), m.group(3) or "")
            return self._chip(row) if row is not None else m.group(0)
        return re.sub(r"(\*\*|__)([^*_\n]{2,80}?)\1(?=(?:\s*\(`?(\$[\w.]+)`?\))?)",
                      bold, line)

    def message_refs(self, message: str) -> dict[str, dict[str, str]]:
        """The [[Name]] / [[id]] mentions in an answer that name a real item
        (not one only proposed), so the manager can show them as chips."""
        refs: dict[str, dict[str, str]] = {}
        for raw in _REF.findall(message or "")[:60]:
            raw = raw.strip()
            if raw in refs:
                continue
            # By id; a name only when it is certain (never by variable:
            # several items write the same one).
            name = raw.split("#", 1)[1].strip() if "#" in raw else raw
            row = self._known(raw) or self._pick_named(name)
            if row is None:
                same = self._name_count(name)
                if same > 1:
                    refs[raw] = {"id": "", "type": "", "name": name, "shared": str(same)}
                continue
            ref = {"id": row["id"], "type": self._kind(row), "name": str(row.get("name") or name)}
            if row.get("_proposed"):
                # Not created yet: the chip says so instead of opening it.
                ref["pending"] = str(row["_proposed"])
            refs[raw] = ref
        return refs

    def _name_count(self, name: str) -> int:
        low = name.strip().lower()
        return sum(1 for r in (*self.modules.values(), *self.bundles.values(),
                               *self.templates.values())
                   if str(r.get("name") or "").strip().lower() == low and not r.get("_proposed"))

    def search(self, args: dict[str, Any]) -> str:
        query = _short(args.get("query"), 100).lower()
        type_ = _short(args.get("type"), 30).lower()
        tag = _short(args.get("tag"), 40).lower().lstrip("#")
        category = _short(args.get("category"), 60).strip().lower()
        rating = _short(args.get("rating"), 10).strip().lower()
        if rating and rating not in ("safe", "nsfw"):
            raise ValueError("rating is safe or nsfw")
        if category and category != "none" and category not in self.cat_by_lower:
            cats = ", ".join(sorted(self.categories.values())) or "none yet"
            raise ValueError(f"no category {category!r}; the categories are: {cats}. "
                             "Use \"none\" for items with no category")
        own, widened = ai_search.expand(query)
        if self.index is not None and own:
            return self._search_index(query, type_, tag, category, rating)
        phrase = query.strip()
        ranked: list[tuple[float, int, dict[str, Any], list[str], list[str]]] = []
        rows = [*self.modules.values(), *self.bundles.values(), *self.templates.values()]
        for n, r in enumerate(rows):
            if not self._fits(r, type_, tag, category, rating):
                continue
            where: list[str] = []
            snips: list[str] = []
            points = 0.0
            if own:
                entry = ai_search.Entry(r)
                points, where = ai_search.score(entry, own, widened, phrase)
                if points <= 0:
                    continue
                if "content" in where:
                    snips = ai_search.snippets(entry, own, widened, phrase)
            ranked.append((points, -n, r, where, snips))
        if not ranked:
            return "no matches"
        ranked.sort(key=lambda x: (x[0], x[1]), reverse=True)
        # A listing by category (an organize ask) is meant to be whole: one
        # call, not a search per type and per tag until the steps run out
        # (Haiku and the 9B, 2026-10-21).
        cap = MAX_SEARCH_LISTING if (category or rating) and not own else MAX_SEARCH
        hits = [self._hit_line(r, [_FIELD_NAMES[w] for w in where], snips)
                for _points, _n, r, where, snips in ranked[:cap]]
        total = len(ranked)
        more = f"\n- … {total - len(hits)} more (narrow the query or give a type)" \
            if total > len(hits) else ""
        head = f"{total} match{'es' if total != 1 else ''}"
        if widened:
            head += " (best first; broad words widened to related ones)"
        return head + ":\n" + "\n".join(hits) + more

    def _fits(self, r: dict[str, Any], type_: str, tag: str, category: str = "",
              rating: str = "") -> bool:
        kind = self._kind(r)
        if type_ and type_ not in (kind, kind.replace("_", " ")):
            return False
        # Templates carry no rating, so a rating filter leaves them out.
        if rating and (kind == "template" or (r.get("content_rating") or "safe") != rating):
            return False
        tags = [t for t in r.get("tags") or [] if isinstance(t, str)]
        if tag and tag not in (t.lower() for t in tags):
            return False
        if category == "none":
            return not r.get("category_id")
        if category:
            return r.get("category_id") == self.cat_by_lower.get(category)
        return True

    def _hit_line(self, r: dict[str, Any], where: list[str], snips: list[str],
                  used: int = 0) -> str:
        cat = self.categories.get(r.get("category_id") or "", "")
        tags = [t for t in r.get("tags") or [] if isinstance(t, str)]
        extra = []
        if r.get("_proposed"):
            extra.append(f"PROPOSED in card {r['_proposed']}, not applied: not in the "
                         "library yet")
        if cat:
            extra.append(f"category {cat}")
        if r.get("content_rating") == "nsfw":
            extra.append("rated nsfw")
        if tags:
            extra.append("tags " + ", ".join(tags))
        if r.get("description"):
            extra.append(_short(r["description"], 80))
        if used:
            extra.append(f"used by {used} item{'s' if used != 1 else ''}")
        if where:
            extra.append("matched in " + ", ".join(where))
        line = f"- {self._line(r)}" + (f" ({'; '.join(extra)})" if extra else "")
        if snips:
            line += "\n    e.g. " + " | ".join(_short(t, 90) for t in snips)
        return line

    def _search_index(self, query: str, type_: str, tag: str, category: str = "",
                      rating: str = "") -> str:
        """`search` over the library index (saved items), plus any item this
        chat proposed or the open editor changed, scored the old way."""
        assert self.index is not None
        fetch = MAX_SEARCH * (4 if tag or type_ or category or rating else 1) + 1
        qvec, self.qvec = self.qvec, None
        hits = [h for h in self.index.search(query, limit=fetch, qvec=qvec,
                                             model=self.embed_model)
                if (r := self.get(h.id)) is not None and not r.get("_proposed")
                and h.id != self.editor_id and self._fits(r, type_, tag, category, rating)]
        own, widened = ai_search.expand(query)
        fresh: list[tuple[float, dict[str, Any], list[str], list[str]]] = []
        for r in [*self.modules.values(), *self.bundles.values(), *self.templates.values()]:
            if not (r.get("_proposed") or r.get("id") == self.editor_id):
                continue
            if not self._fits(r, type_, tag, category, rating):
                continue
            entry = ai_search.Entry(r)
            points, where = ai_search.score(entry, own, widened, query.strip())
            if points > 0:
                snips = ai_search.snippets(entry, own, widened, query.strip()) \
                    if "content" in where else []
                fresh.append((points, r, [_FIELD_NAMES[w] for w in where], snips))
        fresh.sort(key=lambda x: -x[0])
        if not hits and not fresh:
            return "no matches"
        lines = [self._hit_line(r, where, snips) + " (changed in this chat)"
                 for _p, r, where, snips in fresh[:5]]
        for h in hits[:MAX_SEARCH - len(lines)]:
            row = self.get(h.id)
            assert row is not None
            where = ["name/variable/tags/description"] if h.strong else []
            if h.snippets:
                where.append("options/content")
            if not where and h.cosine is not None:
                where.append(f"meaning ({h.cosine:.2f})")
            lines.append(self._hit_line(row, where, h.snippets,
                                        used=len(h.facts.get("used_by") or [])))
        more = len(hits) + len(fresh) > len(lines)
        head = f"{len(lines)}{'+' if more else ''} match{'es' if len(lines) != 1 else ''}"
        head += " (best first" + ("; broad words widened to related ones" if widened else "") + ")"
        tail = "\n- … more (narrow the query or give a type)" if more else ""
        return head + ":\n" + "\n".join(lines) + tail

    def read(self, args: dict[str, Any]) -> str:
        r = self.get(args.get("id"))
        if r is None:
            raise ValueError(self.not_found(args.get("id")))
        kind = self._kind(r)
        lines = [f"{kind} \"{r.get('name')}\" ({r['id']})"]
        if r.get("_proposed"):
            lines.append(f"PROPOSED in card {r['_proposed']}, not applied: it isn't in the "
                         "library until the user applies that card. You can still point at "
                         "it by this id and propose changes to it.")
        if r.get("description"):
            lines.append(f"Description: {_short(r['description'], 600)}")
        cat = self.categories.get(r.get("category_id") or "", "")
        lines.append(f"Category: {cat or '(none)'}")
        lines.append(f"Tags: {', '.join(r.get('tags') or []) or '(none)'}")
        if kind != "template":
            lines.append(f"Rating: {r.get('content_rating') or 'safe'}")
        lines.extend(self.read_body(kind, r))
        if kind == "wildcard" and isinstance(r.get("payload"), dict):
            unknown = ai_vocab.unknown_tags(self.vocab, self.vocab_kinds, [
                str(o.get("text") or "") for o in r["payload"].get("options") or []
                if isinstance(o, dict)])
            if unknown:
                # Checked here so the model needn't look each one up.
                lines.append(f"Not in the user's tag list ({len(unknown)}): "
                             + ", ".join(unknown[:ai_vocab.MAX_CHECK]))
        facts = self.index.facts(r["id"]) if self.index is not None else None
        if facts and facts.get("used_by"):
            lines.append("Used by: " + ", ".join(facts["used_by"]))
        if facts and facts.get("in_bundles"):
            lines.append("In bundles: " + ", ".join(facts["in_bundles"]))
        return "\n".join(lines)

    def variables(self, args: dict[str, Any]) -> str:
        var = _short(args.get("var"), 60).lstrip("$").split(".")[0]
        if var:
            # One variable: who sets it and who reads it ("what breaks if…").
            writers = [r for r in self.modules.values() if var in self._writes(r)]
            readers = self.readers(var)
            if not writers and not readers:
                return f"nothing sets or reads ${var}"
            entry = library_vars.describe({var: self.catalog[var]}) if var in self.catalog \
                else ""
            lines = [entry] if entry else []
            lines.append("Set by: " + (", ".join(self._chip(r) for r in writers[:12])
                                       or "nothing in the library (an Injector or the "
                                       "Model Info / Loop node may set it)"))
            lines.append("Read by: " + (", ".join(self._chip(r) for r in readers[:20])
                                        or "nothing"))
            return "\n".join(lines)
        out = library_vars.describe(self.catalog) or "the library sets no variables yet"
        unset = self.unset_reads(limit=30)
        if unset:
            out += "\nRead but set by nothing in the library: " + "; ".join(
                f"${v} (by {', '.join(names[:3])})" for v, names in unset)
        return out

    @staticmethod
    def _writes(r: dict[str, Any]) -> set[str]:
        p = _got if isinstance(_got := r.get("payload"), dict) else {}
        out = {p.get("var_binding"), p.get("output_var")}
        out |= {v.get("name") for v in p.get("values") or [] if isinstance(v, dict)}
        if r.get("type") == "derivation":
            out |= set(library_vars.derivation_targets(p))
        return {v for v in out if isinstance(v, str) and v}

    _READ = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)")

    def unset_reads(self, limit: int = 12) -> list[tuple[str, list[str]]]:
        """Variables the library's items read that none of them sets (the
        run-time ones left out), each with the names of what reads it."""
        writes: set[str] = set()
        for r in self.modules.values():
            if not r.get("_proposed"):
                writes |= self._writes(r)
        out: dict[str, list[str]] = {}
        for r in [*self.modules.values(), *self.templates.values()]:
            if r.get("_proposed"):
                continue
            text = json.dumps({k: r.get(k) for k in ("payload", "template_string",
                                                      "negative_template")},
                              ensure_ascii=False)
            reads = set(self._READ.findall(text))
            if r.get("type") == "derivation":
                reads |= {v.split(".")[0] for v in re.findall(r'"var": "([^"]+)"', text)}
            for v in sorted(reads - writes - library_vars.RUNTIME_VARS):
                out.setdefault(v, []).append(str(r.get("name") or r["id"]))
        return sorted(out.items())[:limit]

    def readers(self, var: str) -> list[dict[str, Any]]:
        """Items that read ``$var``: conditions, $var in any text, templates."""
        pat = re.compile(r"\$" + re.escape(var) + r"(?![A-Za-z0-9_])")
        out = []
        for r in [*self.modules.values(), *self.templates.values()]:
            if r.get("_proposed"):
                continue
            text = json.dumps({k: r.get(k) for k in ("payload", "template_string",
                                                      "negative_template")},
                              ensure_ascii=False)
            if pat.search(text) or (r.get("type") == "derivation" and re.search(
                    r'"var": "' + re.escape(var) + r'(\.[^"]*)?"', text)):
                out.append(r)
        return out

    def docs_search(self, args: dict[str, Any]) -> str:
        return ai_docs.search(_short(args.get("query"), 200))

    def react(self, args: dict[str, Any]) -> str:
        emoji = ai_react.clean(args.get("emoji"))
        if not emoji:
            return "react: pick one of " + " ".join(ai_react.REACTIONS)
        self.reaction = emoji
        return (f"Reacted {emoji} to the user's message. If that was all it needed, answer "
                "with an empty message.")

    def docs_read(self, args: dict[str, Any]) -> str:
        return ai_docs.read(args.get("page"), args.get("section"))

    def explain(self, args: dict[str, Any]) -> str:
        return ai_docs.explain(_short(args.get("topic"), 200))

    def lookup(self, args: dict[str, Any]) -> str:
        kind = str(args.get("kind") or "").strip().lower()
        kind = {"tag": "tags", "lora": "loras", "embedding": "embeddings"}.get(kind, kind)
        if kind not in ai_vocab.KINDS:
            raise ValueError("kind is tags, loras or embeddings")
        if self.vocab is None or kind not in self.vocab_kinds:
            return ai_vocab.OFF[kind]
        return ai_vocab.answer(self.vocab, kind, _short(args.get("query"), 400))

    # ── change tools → proposals ─────────────────────────────────────────

    def _category(self, raw: Any) -> tuple[str | None, str]:
        """(existing id or None, new name or "")."""
        name = _short(raw, 40).strip(" .")
        if not name:
            return None, ""
        cid = self.cat_by_lower.get(name.lower())
        return (cid, "") if cid else (None, name)

    def _meta(self, args: dict[str, Any]) -> dict[str, Any]:
        tags: list[str] = []
        lower = {t.lower(): t for t in self.tags}
        for t in _got if isinstance(_got := args.get("tags"), list) else []:
            tag = _short(t, ai_describe.MAX_TAG_LEN).lstrip("#")
            if tag:
                tag = lower.get(tag.lower(), tag.lower())
                if tag not in tags:
                    tags.append(tag)
        cid, new_cat = self._category(args.get("category"))
        out: dict[str, Any] = {
            "description": _short(args.get("description"), ai_describe.MAX_DESCRIPTION),
            "tags": tags[:8], "category_id": cid,
        }
        return {"body": out, "new_category": new_cat}

    def _name(self, args: dict[str, Any], fallback: str) -> str:
        return _short(args.get("name"), 120) or fallback

    def _spec(self, args: dict[str, Any]) -> dict[str, Any]:
        return {"options": _got if isinstance(_got := args.get("options"), list) else [],
                "axes": _got if isinstance(_got := args.get("axes"), list) else [],
                "null_weight": args.get("null_weight", 0)}

    def create_wildcard(self, args: dict[str, Any]) -> dict[str, Any]:
        name = self._name(args, "")
        if not name:
            raise ValueError("give the wildcard a name")
        var = _short(args.get("var"), 64).lstrip("$")
        if var and not _IDENT.match(var):
            raise ValueError("var must be a variable name: letters, digits and _ "
                             "(or \"\" for a vocabulary)")
        defaulted = ""
        if args.get("var") is None:
            # No "var" at all is a forgotten one ("" is a vocabulary): chat
            # eval round 2 asked for "a weather wildcard" three times and got
            # a refusal, then an unasked rename of a library item.
            var = defaulted = self._default_var(name)
        if not var and any(str(r.get("name") or "").lower() == name.lower()
                           for r in self.modules.values()
                           if r.get("type") == "wildcard" and not r.get("_proposed")):
            raise ValueError(f"a wildcard named {name} exists and this one sets no variable; "
                             f"give it a variable (\"var\") or a name no item has (a "
                             f"vocabulary is found by name with @{{{name}}})")
        other = _OTHER_KIND.search(name)
        if other:
            word = other.group(1).lower().rstrip("s").replace(" ", "_").replace("-", "_")
            kind = {"fixed_value": "fixed_values"}.get(word, word)
            raise ValueError(f"{name!r} names a {kind.replace('_', ' ')}, not a wildcard"
                             + use_instead(kind, create=True))
        texts = [str(o.get("text") or "") for o in args.get("options") or []
                 if isinstance(o, dict)]
        if _ARROW.search(name) or sum(1 for t in texts if _ARROW.search(t)) > len(texts) // 2:
            raise ValueError("a wildcard's options are plain choices; to make one wildcard's "
                             "pick change another's odds, use create_constraint (call "
                             "more_tools if you don't have it)")
        out = ai_wildcard.compile_spec(self._spec(args), var=var or None, refs=self.refs)
        payload = out["payload"]
        meta = self._meta(args)
        twin = self._proposed_writer(var, name)
        if twin is not None:
            # The 9B proposed "Model Style Tags" four times in one answer,
            # each read the "already set by" warning and made another card.
            raise ValueError(
                f"${var} is already set by {self._chip(twin)}, which "
                + ("you proposed in this answer" if not twin.get("_earlier")
                   else "an earlier card of this chat proposes")
                + f": reuse it (change it with edit_options {{\"id\": \"{twin['id']}\"}}) "
                "or pick another variable name")
        warnings = [w for w in [self.var_clash(var, skip_name=name),
                                self._unused_ref_ask(payload)] if w]
        if defaulted:
            warnings.insert(0, f"Sets ${defaulted}, named after it (no \"var\" was given; "
                               "\"var\": \"\" makes a vocabulary with no variable)")
        return {
            "title": f"Create wildcard {name}",
            "summary": (f"${var}" if var else "vocabulary (no variable)")
            + f" with {len(payload['options'])} options",
            "preview": out["preview"] + [f"Group {g}: {', '.join(t)}"
                                         for g, t in (payload.get("tag_groups") or {}).items()],
            "warnings": warnings + out["warnings"],
            "op": {"op": "create", "kind": "module", "new_category": meta["new_category"],
                   "body": {"type": "wildcard", "name": name, **meta["body"], "payload": payload}},
        }

    def _unused_ref_ask(self, payload: dict[str, Any]) -> str:
        """The warning for a wildcard that leaves out a reference the user
        asked for, so the model fixes it in the same answer: a 9B asked for
        "a nested reference of [[id#color]]" wrote plain options and said
        they drew from color (2026-10-22)."""
        texts = " ".join(str(o.get("value") or "") for o in payload.get("options") or []
                         if isinstance(o, dict))
        for wid in sorted(self.ref_asks):
            row = self.modules.get(wid)
            if row is None or row.get("type") != "wildcard" or f"@{{{wid}" in texts:
                continue
            name = str(row.get("name") or wid)
            return (f"You were asked to point at {self._chip(row)}, but no option draws from "
                    f"it: write @{{{name}}} inside the option text (e.g. \"oversized "
                    f"@{{{name}}} tee\") and propose it again")
        return ""

    def _default_var(self, name: str) -> str:
        """The variable a wildcard made without "var" sets: the one library
        wildcards of that name set (a new Weather writes $weather like the
        others), else the name as a variable."""
        low = name.strip().lower()
        same = [str((r.get("payload") or {}).get("var_binding") or "")
                for r in self.modules.values()
                if r.get("type") == "wildcard" and str(r.get("name") or "").lower() == low]
        same = [v for v in same if v]
        if same:
            return max(set(same), key=same.count)
        slug = re.sub(r"[^a-z0-9]+", "_", low).strip("_")[:48]
        return slug if _IDENT.match(slug) else ""

    @staticmethod
    def _writes_var(r: dict[str, Any], var: str) -> bool:
        p = _got if isinstance(_got := r.get("payload"), dict) else {}
        return (p.get("var_binding") == var or p.get("output_var") == var
                or any(isinstance(v, dict) and v.get("name") == var
                       for v in p.get("values") or []))

    def _proposed_writer(self, var: str, name: str) -> dict[str, Any] | None:
        """A card not yet applied (this answer's or an earlier one's) that
        sets ``$var`` under another name: a second writer is a mistake, so
        the call is refused with the id to reuse. One with the same name is
        the same card again: `_twin` replaces it instead."""
        if not var:
            return None
        low = name.strip().lower()
        for r in reversed(list(self.modules.values())):
            if r.get("_proposed") and self._writes_var(r, var) \
                    and str(r.get("name") or "").strip().lower() != low:
                return r
        return None

    def _twin(self, op: dict[str, Any]) -> dict[str, Any] | None:
        """The card not yet applied that this new item repeats: same kind
        and name (and variable for a wildcard, source and target for a
        constraint). Its card is replaced at the same id (`run`); a
        wildcard's variable may change."""
        body = _got if isinstance(_got := op.get("body"), dict) else {}
        if op.get("op") != "create" or op.get("kind") not in ("module", "bundle"):
            return None
        rows = self.modules if op["kind"] == "module" else self.bundles
        p = _got if isinstance(_got := body.get("payload"), dict) else {}

        def key(r: dict[str, Any], q: dict[str, Any]) -> tuple[Any, ...]:
            if r.get("type") == "constraint":
                return ("constraint", q.get("source_wildcard_id"), q.get("target_wildcard_id"))
            # A wildcard proposed again under its name with another variable
            # is a revision too (round 1: "Weather Conditions" for $weather,
            # then again for $atmosphere after the clash warning).
            return (r.get("type"), str(r.get("name") or "").strip().lower())

        want = key(body, p)
        for r in reversed(list(rows.values())):
            q = _got if isinstance(_got := r.get("payload"), dict) else {}
            if r.get("_proposed") and key(r, q) == want:
                return r
        return None

    def var_clash(self, var: str, skip_name: str = "") -> str:
        """A warning when items already set ``$var``, naming them, with what
        to do instead (two writers: the later one wins at run time). A card
        named ``skip_name`` is the one being replaced, not another writer."""
        if not var or var not in self.catalog:
            return ""
        skip = skip_name.strip().lower()
        writers = [r for r in self.modules.values() if self._writes_var(r, var)
                   and not (r.get("_proposed") and skip
                            and str(r.get("name") or "").strip().lower() == skip)]
        if not writers and any(self._writes_var(r, var) for r in self.modules.values()):
            return ""
        if not writers:
            return f"${var} is already set elsewhere in the library"
        chips = ", ".join(self._chip(r) + (" (proposed)" if r.get("_proposed") else "")
                          for r in writers[:3])
        more = f" and {len(writers) - 3} more" if len(writers) > 3 else ""
        if var.lower() in self.asked_words:
            # "Rename its variable to hair_color" with $hair_color taken:
            # "pick another name" made the 9B propose $hair_style instead
            # (smoke s-rename-var, 2026-10-24).
            return (f"${var} is also set by {chips}{more}. The user asked for ${var}, so "
                    "keep it, and tell them both set it (when both run, the later one wins)")
        return (f"${var} is already set by {chips}{more}: reuse that, or pick another "
                "variable name (when both run, the later one wins)")

    def _current(self, item_id: Any) -> tuple[dict[str, Any] | None, str | None]:
        """The item as earlier proposals in this answer leave it, and the
        last such proposal's id."""
        if isinstance(item_id, str) and item_id in self._pending:
            pid, row = self._pending[item_id]
            return row, pid
        return self.get(item_id), None

    def _module(self, args: dict[str, Any], type_: str) -> dict[str, Any]:
        raw = args.get("id")
        r = self.modules.get(raw) if isinstance(raw, str) else None
        if (r is None or r.get("type") != type_) and isinstance(raw, str):
            # A name several items share ("Outfit": a combine, a derivation
            # and two wildcards): only the ones of the kind asked for count,
            # and a card from this answer wins.
            low = raw.strip().lower()
            same = [m for m in self.modules.values() if m.get("type") == type_
                    and str(m.get("name") or "").strip().lower() == low]
            same = [m for m in same if m["id"] in self._created] or same
            r = same[0] if len(same) == 1 else None
        if r is not None:
            r = self._current(r["id"])[0]
        if r is None or r.get("type") != type_:
            other = self.get(self._bare_id(raw)) if isinstance(raw, str) else None
            if other is not None:
                # Round 2: a constraint from the derivation it had just made.
                kind = self._kind(other)
                raise ValueError(
                    f"{self._chip(other)} is a {kind.replace('_', ' ')}, not a "
                    f"{type_.replace('_', ' ')}; this needs a {type_.replace('_', ' ')}"
                    + use_instead(kind))
            raise ValueError(self.not_found(raw, type_.replace("_", " ")))
        return r

    def add_options(self, args: dict[str, Any]) -> dict[str, Any]:
        r = self._module(args, "wildcard")
        old = _got if isinstance(_got := r.get("payload"), dict) else {}
        spec = self._spec(args)
        spec["null_weight"] = 0
        out = ai_wildcard.compile_spec(spec, var=old.get("var_binding") or None, refs=self.refs,
                                       self_id=r["id"], existing_payload=copy.deepcopy(old))
        payload = out["payload"]
        n = out["new_count"]
        return {
            "title": f"Add {n} option{'s' if n != 1 else ''} to {r.get('name')}",
            "summary": f"{len(old.get('options') or [])} → {len(payload['options'])} options",
            "preview": out["preview"],
            "warnings": out["warnings"],
            "op": {"op": "update", "kind": "module", "type": "wildcard", "id": r["id"],
                   "name": r.get("name"), "body": {"payload": payload},
                   "before": {"payload": old}},
        }

    def _option_refs(self) -> set[str]:
        """Option ids other modules point at (constraint exceptions)."""
        refs: set[str] = set()
        for m in self.modules.values():
            if m.get("type") != "constraint" or not isinstance(m.get("payload"), dict):
                continue
            for e in m["payload"].get("exceptions") or []:
                if isinstance(e, dict):
                    refs.update(v for v in (e.get("source_id"), e.get("target_id"))
                                if isinstance(v, str))
        return refs

    def edit_options(self, args: dict[str, Any]) -> dict[str, Any]:
        r = self._module(args, "wildcard")
        old = _got if isinstance(_got := r.get("payload"), dict) else {}
        opts = [o for o in old.get("options") or [] if isinstance(o, dict)]
        shown = [
            {"id": str(n), "value": "" if o.get("is_null") else str(o.get("value") or ""),
             "weight": o.get("weight", 1), "sub_categories": list(o.get("sub_categories") or []),
             "negative": o.get("negative") or "", **({"is_null": True} if o.get("is_null") else {})}
            for n, o in enumerate(opts, start=1)
        ]
        registry = [t for t in old.get("sub_categories") or [] if isinstance(t, str)]
        nulls = {str(n) for n, o in enumerate(opts, start=1) if o.get("is_null")}

        def _numbered(key: str, field: str) -> list[dict[str, Any]]:
            rows = _got if isinstance(_got := args.get(key), list) else []
            return [{"id": str(x.get("n")), field: x.get(field)}
                    for x in rows if isinstance(x, dict)]

        retag = _numbered("retag", "tags")
        for x in _numbered("add_tags", "tags"):
            # Bench W17: "add an intensity tag" went through retag with the
            # new tag alone, which dropped the tags a constraint keys on.
            # add_tags keeps the option's tags (and a retag of it).
            extra = [t for t in x["tags"] if isinstance(t, str)] \
                if isinstance(x["tags"], list) else []
            same = next((r for r in retag if r["id"] == x["id"]), None)
            if same is not None:
                same["tags"] = list(same["tags"] or []) + extra
                continue
            k = int(x["id"]) - 1 if str(x["id"]).isdigit() else -1
            has = shown[k]["sub_categories"] if 0 <= k < len(shown) else []
            retag.append({"id": x["id"], "tags": has + extra})
        asks = {
            "remove": {"remove": [{"id": str(n), "reason": ""}
                                  for n in (args.get("remove") or [])
                                  if isinstance(n, (int, str)) and not isinstance(n, bool)]},
            "rewrite": {"options": _numbered("rewrite", "text")},
            "retag": {"options": retag},
            "reweight": {"options": _numbered("weights", "weight")},
        }
        for raw in asks.values():
            rows = next(iter(raw.values()))
            ids = sorted(int(x["id"]) for x in rows if str(x["id"]).isdigit())
            if not nulls and ids and ids == list(range(len(opts))):
                # 9B smoke s-tag-filter: a rewrite of all four options as
                # n 0-3, refused at the last step. Every option, counted
                # from 0, can only mean 1-4.
                for x in rows:
                    x["id"] = str(int(x["id"]) + 1)
        if any(x["id"] == "0" for raw in asks.values() for x in next(iter(raw.values()))):
            # Browser test: "make the blank option rarer" sent n 0, and the
            # card changed another option while leaving the blank alone.
            empty = next((n for n in sorted(nulls, key=int)), "")
            raise ValueError("options are numbered from 1, as read shows them"
                             + (f"; the empty option is number {empty}" if empty else
                                "; this wildcard has no empty option (null_weight adds one)"))
        changes: dict[str, list[dict[str, Any]]] = {}
        skipped: list[dict[str, str]] = []
        new_tags: list[str] = []
        for action, raw in asks.items():
            if not next(iter(raw.values())):
                continue
            out = ai_wildcard_edit.compile_edit(action, raw, options=shown,
                                                registry=registry + new_tags,
                                                refs=self.refs, self_id=r["id"],
                                                labels=list(r.get("tags") or []))
            got = out["changes"]
            if action in ("rewrite", "retag"):
                skipped += [{"text": "the empty option", "reason": "it has no text"}
                            for c in got if c["id"] in nulls]
                got = [c for c in got if c["id"] not in nulls]
            changes[action] = got
            skipped += out["skipped"]
            new_tags += [t for t in out["new_tags"] if t not in new_tags]
        refs = self._option_refs()
        kept: list[str] = []
        payload = copy.deepcopy(old)
        rows = [o for o in payload.get("options") or [] if isinstance(o, dict)]
        gone: set[int] = set()
        for c in changes.get("remove", []):
            i = int(c["id"]) - 1
            if isinstance(rows[i].get("id"), str) and rows[i]["id"] in refs:
                kept.append(c["before"]["value"] or "the empty option")
                continue
            gone.add(i)
        preview: list[str] = []
        for c in changes.get("remove", []):
            if int(c["id"]) - 1 in gone:
                preview.append(f"− {c['before']['value'] or '∅'}")
        for c in changes.get("rewrite", []):
            rows[int(c["id"]) - 1]["value"] = c["after"]["value"]
            preview.append(f"{c['before']['value']} → {c['after']['value']}")
        for c in changes.get("retag", []):
            rows[int(c["id"]) - 1]["sub_categories"] = c["after"]["tags"]
            before = " ".join(f"#{t}" for t in c["before"]["tags"]) or "no tags"
            after = " ".join(f"#{t}" for t in c["after"]["tags"]) or "no tags"
            preview.append(f"{shown[int(c['id']) - 1]['value'] or '∅'}: {before} → {after}")
        for c in changes.get("reweight", []):
            rows[int(c["id"]) - 1]["weight"] = c["after"]["weight"]
            preview.append(f"{shown[int(c['id']) - 1]['value'] or '∅'}: "
                           f"×{c['before']['weight']} → ×{c['after']['weight']}")
        preview += self._option_extras(args, rows, nulls, gone, skipped, r["id"])
        if isinstance(args.get("axes"), list) and args["axes"]:
            payload["options"] = rows
            grouped = ai_wildcard.group_tags(payload, args["axes"])
            payload.update(grouped["payload"])
            preview += grouped["preview"]
            skipped += [{"text": "groups", "reason": w} for w in grouped["warnings"]]
        if isinstance(args.get("groups"), list) and args["groups"]:
            edited = ai_wildcard.edit_groups(payload, args["groups"])
            payload.update(edited["payload"])
            preview += edited["preview"]
            skipped += [{"text": "groups", "reason": w} for w in edited["warnings"]]
        tag_warnings: list[str] = []
        if args.get("rename_tags") or args.get("drop_tags"):
            payload["options"] = rows
            named = ai_wildcard.rename_option_tags(payload, args.get("rename_tags"),
                                                   args.get("drop_tags"))
            rows = named["payload"].pop("options")
            payload.update(named["payload"])
            registry = list(payload["sub_categories"])
            preview += named["preview"]
            skipped += [{"text": "tags", "reason": w} for w in named["warnings"]]
            # Saved constraints keyed by these tags keep the old names (an
            # unapplied constraint card gets its own warning, `_broken_links`).
            for m in self.modules.values():
                cp = _got if isinstance(_got := m.get("payload"), dict) else {}
                if (m.get("type") == "constraint" and not m.get("_proposed")
                        and r["id"] in (cp.get("source_wildcard_id"),
                                        cp.get("target_wildcard_id"))):
                    tag_warnings.append(f"{self._chip(m)} may name the old tags; check "
                                        "its rules")
        order = [i for i in range(len(rows)) if i not in gone]
        for x in args.get("move") or []:
            # Original numbers, like edit_rules: where read showed them.
            n = _num(x.get("n"), len(rows)) if isinstance(x, dict) else None
            to = _num(x.get("to"), len(rows)) if isinstance(x, dict) else None
            if n is None or to is None or n - 1 not in order:
                skipped.append({"text": f"move {x.get('n') if isinstance(x, dict) else x}",
                                "reason": "no such option, or no place to move it to"})
                continue
            order.remove(n - 1)
            order.insert(min(to - 1, len(order)), n - 1)
            preview.append(f"Moved {self._show(rows[n - 1].get('value')) or '∅'} to "
                           f"{min(to, len(order))}")
        var_warnings: list[str] = []
        if args.get("var"):
            var = _short(args.get("var"), 60).lstrip("$")
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", var):
                raise ValueError(f"${var} isn't a variable name (letters, digits, _)")
            was = str(old.get("var_binding") or "")
            if var != was:
                payload["var_binding"] = var
                preview.append(f"Sets ${var}" + (f" instead of ${was}" if was else ""))
                clash = self.var_clash(var)
                if clash:
                    var_warnings.append(clash)
                readers = [x for x in self.readers(was) if x.get("id") != r["id"]] if was else []
                if readers:
                    var_warnings.append(
                        f"Still read as ${was} by " + ", ".join(
                            self._chip(x) for x in readers[:6])
                        + ": change them too (or they get nothing)")
        if not preview and not isinstance(args.get("null_weight"), (int, float)):
            raise ValueError("that changes nothing" + _skipped(skipped)
                             + (f" ({len(kept)} options are used by constraints)" if kept else ""))
        payload["options"] = [rows[i] for i in order]
        null_w = args.get("null_weight")
        if isinstance(null_w, (int, float)) and not isinstance(null_w, bool):
            preview += self._null_weight(payload, null_w, refs)
        if not preview:
            raise ValueError("that changes nothing" + _skipped(skipped))
        if new_tags:
            payload["sub_categories"] = list(dict.fromkeys([*registry, *new_tags]))
        WildcardHandler.validate_payload(payload)
        warnings = [f"Kept {_short(v, 60)}: a constraint points at it" for v in kept[:8]]
        if not (args.get("rename_tags") or args.get("drop_tags")):
            tag_warnings += self._lost_tag_rules(str(r["id"]), opts, payload["options"])
        warnings += tag_warnings[:4] + var_warnings
        n = len(preview)
        return {
            "title": f"Change {n} option{'s' if n != 1 else ''} in {r.get('name')}",
            "summary": f"{len(old.get('options') or [])} → {len(payload['options'])} options",
            "preview": preview,
            "warnings": warnings + _skip_notes(skipped),
            "op": {"op": "update", "kind": "module", "type": "wildcard", "id": r["id"],
                   "name": r.get("name"), "body": {"payload": payload},
                   "before": {"payload": old}},
        }

    def _lost_tag_rules(self, wid: str, before: list[dict[str, Any]],
                        after: list[Any]) -> list[str]:
        """Saved constraints on wildcard `wid` with rules for a tag that no
        option carries after this change (bench W17: a retag took #dark and
        #bright off Mood, and Mood → weather quietly stopped working)."""
        def carried(rows: list[Any]) -> set[str]:
            return {t for o in rows if isinstance(o, dict)
                    for t in o.get("sub_categories") or [] if isinstance(t, str)}
        lost = carried(before) - carried(after)
        if not lost:
            return []
        out: list[str] = []
        for m in self.modules.values():
            cp = _got if isinstance(_got := m.get("payload"), dict) else {}
            if m.get("type") != "constraint" or m.get("_proposed"):
                continue
            side = ("source" if cp.get("source_wildcard_id") == wid else
                    "target" if cp.get("target_wildcard_id") == wid else "")
            if not side:
                continue
            matrix = _got if isinstance(_got := cp.get("matrix"), dict) else {}
            used = (set(matrix) if side == "source" else
                    {t for cells in matrix.values() if isinstance(cells, dict) for t in cells})
            gone = sorted(used & lost)
            if gone:
                out.append(f"{self._chip(m)} has rules for "
                           + ", ".join(f"#{t}" for t in gone[:5])
                           + ", which no option carries after this, so those rules "
                           "will do nothing")
        return out

    def _option_extras(self, args: dict[str, Any], rows: list[dict[str, Any]],
                       nulls: set[str], gone: set[int], skipped: list[dict[str, str]],
                       self_id: str) -> list[str]:
        """Negatives and the fallback flag, by option number."""
        preview: list[str] = []
        for x in args.get("negatives") or []:
            if not isinstance(x, dict):
                continue
            n = _num(x.get("n"), len(rows))
            if n is None or str(n) in nulls or n - 1 in gone:
                skipped.append({"text": f"negative for {x.get('n')}", "reason": "no such option"})
                continue
            try:
                neg = ai_refs.compile_text(_short(x.get("negative"), 2000), surface="negative",
                                           refs=self.refs, self_id=self_id)
            except ValueError as e:
                skipped.append({"text": f"negative for {n}", "reason": str(e)})
                continue
            row = rows[n - 1]
            if neg == (row.get("negative") or ""):
                continue
            if neg:
                row["negative"] = neg
            else:
                row.pop("negative", None)
            preview.append(f"{self._show(row.get('value'))}: negative "
                           + (self._show(neg) if neg else "removed"))
        if "fallback" in args:
            n = args.get("fallback")
            n = 0 if n in (None, False, 0, "0", "") else _num(n, len(rows))
            if n is None or (n and (str(n) in nulls or n - 1 in gone)):
                skipped.append({"text": "fallback", "reason": "pick a non-empty option number"})
            else:
                had = next((i for i, o in enumerate(rows) if o.get("fallback")), None)
                if had != (n - 1 if n else None):
                    for o in rows:
                        o.pop("fallback", None)
                    if n:
                        rows[n - 1]["fallback"] = True
                        preview.append(f"Fallback: {self._show(rows[n - 1].get('value'))}")
                    else:
                        preview.append("No fallback")
        return preview

    @staticmethod
    def _null_weight(payload: dict[str, Any], weight: float, refs: set[str]) -> list[str]:
        opts = payload["options"]
        i = next((k for k, o in enumerate(opts) if o.get("is_null")), None)
        if weight <= 0:
            if i is None:
                return []
            if isinstance(opts[i].get("id"), str) and opts[i]["id"] in refs:
                return []
            opts.pop(i)
            return ["− ∅ (nothing)"]
        w = ai_wildcard.clean_weight(weight)
        if i is None:
            taken = {o.get("id") for o in opts}
            opts.append({"id": ai_wildcard.new_option_id(taken), "value": "", "is_null": True,
                         "weight": w, "sub_categories": []})
            return [f"+ ∅ (nothing) ×{w}"]
        if opts[i].get("weight", 1) == w:
            return []
        before = opts[i].get("weight", 1)
        opts[i]["weight"] = w
        return [f"∅ (nothing): ×{before} → ×{w}"]

    def _rules(self, args: dict[str, Any], taken: set[str]) -> dict[str, Any]:
        compiled = ai_derivation.compile_rules(
            {"rules": _got if isinstance(_got := args.get("rules"), list) else []},
            catalog=self.catalog, taken_ids=taken, refs=self.refs,
        )
        if not compiled["rules"]:
            raise ValueError("no usable rules" + _skipped(compiled["skipped"]) + ". "
                             + self._rule_example())
        return compiled

    def _rule_example(self) -> str:
        """One rule that works, written from a variable of this library and
        one of its values, for a failed create_derivation / add_rules."""
        var, value = "class", "mage"
        for name, entry in self.catalog.items():
            if entry.get("values") and any(s.get("kind") == "wildcard"
                                           for s in entry.get("sources") or []):
                var, value = name, str(entry["values"][0])[:40]
                break
        rule = {"summary": "…", "branches": [{"conditions": [
            {"var": var, "op": "equals", "value": value}], "actions": [
            {"target_var": "new_var", "mode": "replace", "value": "some text"}]}],
            "else_actions": [{"target_var": "new_var", "mode": "replace",
                              "value": "other text"}]}
        return ("A rule that works: " + json.dumps(rule, ensure_ascii=False)
                + '. "var" and "target_var" are bare variable names (no $); a condition '
                "compares with text, and a variable a Context Loop or Model Info sets "
                "($iteration, $model_family) is fine to read")

    def create_derivation(self, args: dict[str, Any]) -> dict[str, Any]:
        name = self._name(args, "")
        if not name:
            raise ValueError("give the derivation a name")
        compiled = self._rules(args, set())
        payload = {"rules": [r["rule"] for r in compiled["rules"]]}
        DerivationHandler.validate_payload(payload)
        meta = self._meta(args)
        return {
            "title": f"Create derivation {name}",
            "summary": f"{len(payload['rules'])} rule{'s' if len(payload['rules']) != 1 else ''}",
            "preview": [self._show(ai_derivation.describe_rule(r)) for r in payload["rules"]],
            "warnings": [w for r in compiled["rules"] for w in r["warnings"]]
            + _skip_notes(compiled["skipped"]),
            "op": {"op": "create", "kind": "module", "new_category": meta["new_category"],
                   "body": {"type": "derivation", "name": name, **meta["body"],
                            "payload": payload}},
        }

    def add_rules(self, args: dict[str, Any]) -> dict[str, Any]:
        r = self._module(args, "derivation")
        old = _got if isinstance(_got := r.get("payload"), dict) else {}
        old_rules = [x for x in old.get("rules") or [] if isinstance(x, dict)]
        compiled = self._rules(args, {x["id"] for x in old_rules if isinstance(x.get("id"), str)})
        payload = copy.deepcopy(old)
        payload["rules"] = [*old_rules, *(x["rule"] for x in compiled["rules"])]
        DerivationHandler.validate_payload(payload)
        return {
            "title": f"Add {len(compiled['rules'])} rules to {r.get('name')}",
            "summary": f"{len(old_rules)} → {len(payload['rules'])} rules",
            "preview": [self._show(ai_derivation.describe_rule(x["rule"]))
                        for x in compiled["rules"]],
            "warnings": [w for x in compiled["rules"] for w in x["warnings"]]
            + _skip_notes(compiled["skipped"]),
            "op": {"op": "update", "kind": "module", "type": "derivation", "id": r["id"],
                   "name": r.get("name"), "body": {"payload": payload},
                   "before": {"payload": old}},
        }

    def create_constraint(self, args: dict[str, Any]) -> dict[str, Any]:
        src = self._module({"id": args.get("source_id")}, "wildcard")
        tgt = self._module({"id": args.get("target_id")}, "wildcard")
        if src["id"] == tgt["id"]:
            raise ValueError("source and target must be different wildcards")
        source = ai_constraint.side_view(src, "S")
        target = ai_constraint.side_view(tgt, "T")
        compiled = ai_constraint.compile_rules(
            {"rules": _got if isinstance(_got := args.get("rules"), list) else []},
            source=source, target=target,
        )
        if not compiled["cells"] and not compiled["exceptions"]:
            raise ValueError("no usable rules" + _skipped(compiled["skipped"]) + ". "
                             + ai_constraint.example_rule(source, target))
        matrix: dict[str, dict[str, Any]] = {}
        for c in compiled["cells"]:
            matrix.setdefault(c["source_tag"], {})[c["target_tag"]] = c["cell"]
        payload = {
            "source_wildcard_id": src["id"], "target_wildcard_id": tgt["id"],
            "matrix": matrix, "exceptions": [e["exception"] for e in compiled["exceptions"]],
        }
        reach = _reach(args.get("reach"))
        if reach and reach["mode"] != "all":
            payload["target_select"] = reach
        ConstraintHandler.validate_payload(payload)
        name = self._name(args, f"{src.get('name')} → {tgt.get('name')}")
        meta = self._meta(args)
        preview = [
            f"#{c['source_tag']} → #{c['target_tag']}: {c['cell']['mode']}"
            + (f" ×{c['cell']['factor']}" if c["cell"]["mode"] in ("boost", "reduce") else "")
            for c in compiled["cells"]
        ] + [
            f"{e['exception']['source']} → {e['exception']['target']}: {e['exception']['mode']}"
            + (f" ×{e['exception']['factor']}"
               if e["exception"]["mode"] in ("boost", "reduce") else "")
            for e in compiled["exceptions"]
        ]
        if reach and reach["mode"] != "all":
            preview.append(f"Reaches {_reach_text(reach)}")
        return {
            "title": f"Create constraint {name}",
            "summary": f"{len(compiled['cells'])} tag rules, "
                       f"{len(compiled['exceptions'])} option exceptions",
            "preview": preview,
            "warnings": _skip_notes(compiled["skipped"]),
            "op": {"op": "create", "kind": "module", "new_category": meta["new_category"],
                   "body": {"type": "constraint", "name": name, **meta["body"],
                            "payload": payload}},
        }

    def update_info(self, args: dict[str, Any]) -> dict[str, Any]:
        r = self._current(args.get("id"))[0]
        if r is None:
            raise ValueError(self.not_found(args.get("id")))
        kind = ("bundle" if r["id"] in self.bundles else
                "template" if r["id"] in self.templates else "module")
        body: dict[str, Any] = {}
        before: dict[str, Any] = {}
        preview: list[str] = []
        new_cat = ""
        if isinstance(args.get("description"), str) and args["description"].strip():
            desc = _short(args["description"], ai_describe.MAX_DESCRIPTION)
            if desc != (r.get("description") or ""):
                body["description"], before["description"] = desc, r.get("description") or ""
                preview.append(f"Description: {desc}")
        tags = [t for t in r.get("tags") or [] if isinstance(t, str)]
        have = {t.lower() for t in tags}
        adds = [
            a for a in (_short(t, ai_describe.MAX_TAG_LEN).lstrip("#")
                        for t in args.get("tags_add") or [] if isinstance(t, str))
            if a and a.lower() not in have
        ]
        rms = {
            t.lower() for t in (args.get("tags_remove") or []) if isinstance(t, str)
        } & have
        rating = args.get("rating") if kind != "template" else None
        was = r.get("content_rating") or "safe"
        rating, kept_rms, held = ai_ratings.keep_nsfw(
            was, tags, rating if rating in ("safe", "nsfw") else None, sorted(rms),
            self.user_text)
        rms = set(kept_rms)
        if kind != "template" and rating is None and was == "safe" and (
                ai_ratings.nsfw_tagged(adds)):
            # Tagged #nsfw now: rated so too.
            rating = "nsfw"
        if adds or rms:
            lower = {t.lower(): t for t in self.tags}
            added = list(dict.fromkeys(lower.get(a.lower(), a.lower()) for a in adds))
            body["tags"] = [t for t in tags if t.lower() not in rms] + added
            before["tags"] = tags
            preview.append("Tags: " + " ".join(
                [f"+#{a}" for a in added] + [f"−#{t}" for t in tags if t.lower() in rms]))
        if isinstance(args.get("name"), str) and args["name"].strip():
            name = _short(args["name"], 120).strip()
            if name != (r.get("name") or ""):
                body["name"], before["name"] = name, r.get("name") or ""
                preview.append(f"Name: {r.get('name')} → {name}")
        if isinstance(args.get("category"), str):
            if args["category"].strip().lower() in ("", "none"):
                if r.get("category_id"):
                    body["category_id"], before["category_id"] = None, r.get("category_id")
                    preview.append("Category: none")
            else:
                cid, new_cat = self._category(args["category"])
                # A new category is a change even for an item in none.
                if new_cat or (cid and cid != r.get("category_id")):
                    body["category_id"], before["category_id"] = cid, r.get("category_id")
                    preview.append(f"Category: {args['category'].strip()}"
                                   + (" (new)" if new_cat else ""))
        if rating in ("safe", "nsfw") and rating != was:
            body["content_rating"] = rating
            before["content_rating"] = was
            preview.append(f"Rating: {rating}")
        if not body:
            raise ValueError("that changes nothing" + (f" ({held[0]})" if held else ""))
        return {
            "title": f"Update {r.get('name')}",
            "summary": f"{kind} info",
            "preview": preview,
            "warnings": held,
            # Auto-apply may apply it: a rating change or a rename stays a
            # normal card, because it changes what people see.
            **({} if "content_rating" in body or "name" in body else {"risk": "low"}),
            "op": {"op": "update", "kind": kind, "type": self._kind(r), "id": r["id"],
                   "name": r.get("name"), "body": body, "before": before,
                   "new_category": new_cat},
        }

    def plan_pack(self, args: dict[str, Any]) -> dict[str, Any]:
        text = args.get("description")
        text = text.strip() if isinstance(text, str) else ""
        if len(text) < 10:
            raise ValueError("describe the pack: what it makes, its parts and its rules")
        text = text[:MAX_PACK_DESCRIPTION]
        settings = pack_recommend.clean_suggested(args.get("settings"))
        preview = [_short(text, 300)]
        if settings:
            preview.append("Suggested settings: " + pack_recommend.settings_line(settings))
        return {
            "title": "Plan this pack in the Pack builder", "summary": "pack",
            "preview": preview, "warnings": [],
            "op": {"op": "open", "kind": "pack", "type": "pack", "id": "pack-builder",
                   "description": text, **({"settings": settings} if settings else {})},
        }

    def _adopt(self, proposal: dict[str, Any]) -> None:
        """Make a proposed new item visible to the rest of this answer, so
        later calls can name it, point at it and run it. Each gets the id
        it will be created with, so a card that points at it (a nested
        @{id}, a bundle child, a sub-bundle) waits for it and still points
        at it once both are applied."""
        op, pid = proposal["op"], proposal["pid"]
        body = op["body"]
        taken = {*self.modules, *self.bundles, *self.templates}
        new_id = secrets.token_hex(4)
        while new_id in taken:
            new_id = secrets.token_hex(4)
        if op["kind"] == "module":
            body["id"] = new_id
            self.modules[new_id] = {**copy.deepcopy(body), "id": new_id, "_proposed": pid}
            self.names[new_id] = str(body.get("name") or "")
            self._catalog = None
            self._created[new_id] = pid
            self._pending[new_id] = (pid, self.modules[new_id])
        elif op["kind"] in ("bundle", "template"):
            body["id"] = new_id
            rows = self.bundles if op["kind"] == "bundle" else self.templates
            rows[new_id] = {**copy.deepcopy(body), "id": new_id, "_proposed": pid}
            self._created[new_id] = pid

    def _take_place(self, proposal: dict[str, Any], twin: dict[str, Any]) -> None:
        """Make a create that repeats an unapplied card (`_twin`) replace
        that card at the same id, so the user gets one card, the newest."""
        op, pid = proposal["op"], proposal["pid"]
        old_pid = str(twin["_proposed"])
        iid = twin["id"]
        body = op["body"]
        body["id"] = iid
        rows = self.modules if op["kind"] == "module" else self.bundles
        row = {**copy.deepcopy(body), "id": iid, "_proposed": pid}
        if twin.get("_earlier"):
            row["_earlier"] = twin["_earlier"]
            self.earlier_proposals.setdefault(old_pid, {})["status"] = "replaced"
        rows[iid] = row
        self.names[iid] = str(body.get("name") or "")
        self._catalog = None
        self._created[iid] = pid
        if op["kind"] == "module":
            self._pending[iid] = (pid, row)
        proposal["replaces"] = old_pid
        self.replaced[old_pid] = pid

    def adopt_earlier(self, proposal: dict[str, Any]) -> None:
        """Make a new module an earlier answer proposed (and the user hasn't
        applied) readable and editable here, at the id its card creates it
        with. An edit to it comes back as a card that replaces the old one
        (`run`), so "now add negatives" works before anything is applied."""
        op = proposal.get("op") or {}
        body = _got if isinstance(_got := op.get("body"), dict) else None
        pid = proposal.get("pid")
        if op.get("op") == "categories" and isinstance(pid, str):
            self._note_categories(op, pid)
            return
        if (op.get("op") != "create" or op.get("kind") != "module" or body is None
                or not isinstance(body.get("id"), str) or not isinstance(pid, str)
                or body["id"] in self.modules):
            return
        iid = body["id"]
        self.modules[iid] = {**copy.deepcopy(body), "_proposed": pid, "_earlier": pid}
        self.names[iid] = str(body.get("name") or "")
        self._earlier_ops[pid] = proposal
        # A card that points at it (a nested @{id}, a bundle child) waits
        # for it: its id is reserved, but it exists only once applied.
        self._created[iid] = pid
        self._catalog = None

    def _note_categories(self, op: dict[str, Any], pid: str) -> None:
        for name in op.get("create") or []:
            if isinstance(name, str) and name.strip():
                self.proposed_categories.setdefault(name.strip().lower(), (pid, name.strip()))

    def _pointed_at(self, name: str, item_id: str) -> bool:
        """Whether any item (or a card of this chat) points at the wildcard
        with ``@{…}`` by name or id."""
        keys = [k for k in (item_id, name) if k]
        if not keys:
            return False
        texts = [json.dumps(m.get("payload") or {}, ensure_ascii=False)
                 for m in self.modules.values()]
        texts += [json.dumps((p.get("op") or {}).get("body") or {}, ensure_ascii=False)
                  for p in self.earlier_proposals.values()]
        return any("@{" + k in t for t in texts for k in keys)

    def _broken_links(self, op: dict[str, Any]) -> list[str]:
        """A change to a wildcard that cards not yet applied rely on (a new
        constraint's rules name its options and tags): which rules it
        breaks, so nothing resets silently."""
        body = _got if isinstance(_got := op.get("body"), dict) else {}
        wid = op.get("id") if op.get("op") == "update" else body.get("id")
        payload = _got if isinstance(_got := body.get("payload"), dict) else None
        if not isinstance(wid, str) or payload is None or "options" not in payload:
            return []
        ids = {o.get("id") for o in payload.get("options") or [] if isinstance(o, dict)}
        tags = set(payload.get("sub_categories") or [])
        out: list[str] = []
        for r in self.modules.values():
            if r.get("type") != "constraint" or not r.get("_proposed"):
                continue
            cp = _got if isinstance(_got := r.get("payload"), dict) else {}
            side = ("source" if cp.get("source_wildcard_id") == wid else
                    "target" if cp.get("target_wildcard_id") == wid else "")
            if not side:
                continue
            lost = [str(e.get(side)) for e in cp.get("exceptions") or []
                    if isinstance(e, dict) and e.get(f"{side}_id") not in ids]
            matrix = _got if isinstance(_got := cp.get("matrix"), dict) else {}
            used = (set(matrix) if side == "source" else
                    {t for cells in matrix.values() if isinstance(cells, dict) for t in cells})
            lost += [f"#{t}" for t in sorted(used - tags)]
            if lost:
                out.append(f"Card {r['_proposed']} ({r.get('name')}) has rules for "
                           f"{', '.join(lost[:5])}, which this removes; those rules "
                           "will do nothing")
        return out

    def _replace_earlier(self, proposal: dict[str, Any]) -> None:
        """Turn an edit of an earlier answer's unapplied new module into a
        create card that replaces that one, at the same id."""
        op = proposal["op"]
        row = self.modules.get(op.get("id")) if op.get("op") == "update" else None
        if row is None or not row.get("_earlier"):
            return
        old_pid = row["_earlier"]
        old = self._earlier_ops.get(old_pid) or {}
        body = {k: v for k, v in row.items() if not k.startswith("_")}
        body.update(copy.deepcopy(op.get("body") or {}))
        proposal["op"] = {"op": "create", "kind": "module",
                          "new_category": (old.get("op") or {}).get("new_category", ""),
                          "body": body}
        proposal["replaces"] = old_pid
        proposal["title"] = str(old.get("title") or proposal.get("title") or "")
        pid = proposal["pid"]
        self.modules[body["id"]] = {**copy.deepcopy(body), "_proposed": pid}
        self._created[body["id"]] = pid
        self._pending[body["id"]] = (pid, self.modules[body["id"]])
        self.earlier_proposals.setdefault(old_pid, {})["status"] = "replaced"

    def _rate_new(self, proposal: dict[str, Any], args: dict[str, Any]) -> None:
        """A new module or bundle gets the rating the model gave, raised to
        NSFW when its tags or text say so (bench Z11: tagged #nsfw, rated
        Safe)."""
        body = proposal["op"]["body"]
        text = json.dumps({k: body.get(k) for k in ("name", "description", "payload")},
                          ensure_ascii=False)
        rating, why = ai_ratings.rate_new(args.get("rating"), body.get("tags") or [], text)
        body["content_rating"] = rating
        if rating == "nsfw":
            proposal["preview"] = [*(proposal.get("preview") or []), "Rating: nsfw"]
        if why:
            proposal["warnings"] = [*(proposal.get("warnings") or []), why]

    def run(self, tool: str, args: dict[str, Any]) -> str | dict[str, Any]:
        """A read tool's text, or a change tool's proposal (with `pid`, and
        `after` when it builds on an earlier proposal). Raises ValueError."""
        fn = getattr(self, tool, None)
        if tool not in TOOLS or fn is None:
            raise ValueError(f"unknown tool {tool}")
        args = self._resolve(args, "id", "source_id", "target_id")
        if tool in READ_TOOLS:
            if isinstance(args.get("id"), str):
                self.touched.append(args["id"])
            return fn(args)
        item_id = args.get("id") if tool in ITEM_TOOLS else None
        self._check_named(tool, item_id)
        after = self._current(item_id)[1]
        try:
            proposal = fn(args)
        except ValueError as e:
            if after and str(e).startswith("that changes nothing"):
                # Round 2: the same edit sent twice; the 9B read "changes
                # nothing" as a wrong id and remade the whole wildcard.
                raise ValueError(f"{e}: card {after} already makes this change (it is on "
                                 "screen); answer now, or ask for a different change") from None
            raise
        self._next_pid += 1
        pid = f"p{self._next_pid}"
        proposal = {"pid": pid, "tool": tool, **proposal, "after": after}
        op = proposal["op"]
        if op["op"] == "create" and op.get("kind") in ("module", "bundle"):
            self._rate_new(proposal, args)
        if op["op"] == "categories":
            self._note_categories(op, pid)
        if op["op"] == "bulk":
            new_cat = op.get("new_category") or ""
            for it in op.get("items") or []:
                self.bulk_cards.setdefault(bulk_key(it["id"], it["body"], new_cat), pid)
        if op["op"] == "update" and op["id"] == self.editor_id:
            # Built on the editor's unsaved version: it goes into the editor.
            op["basis"] = "editor"
        twin = self._twin(op) if op["op"] == "create" else None
        if twin is not None and _same_item(twin, op["body"]):
            # Sent again unchanged after its card's warning: nothing new.
            self._next_pid -= 1
            return (f"{tool}: this is exactly card {twin['_proposed']}, which is already on "
                    "screen; nothing changed. If its warning needs a fix, change what it "
                    "says; otherwise answer now")
        if twin is not None:
            self._take_place(proposal, twin)
        elif op["op"] == "create":
            self._adopt(proposal)
        elif not after:
            self._replace_earlier(proposal)
            if proposal.get("replaces"):
                return proposal
        elif self._fold(proposal):
            after = proposal.get("after")
        self._absorb_category(proposal)
        if op.get("new_category") and "new_category_style" not in op:
            # A new category gets an icon and a color, as the page offers.
            op["new_category_style"] = default_style(
                str(op["new_category"]), self._taken_colors())
        # A change that points at an item proposed earlier in this answer
        # (a constraint between two new wildcards, a bundle of new modules)
        # waits for that one: its id only exists once it is applied.
        if not after:
            body = json.dumps(op.get("body") or {}, ensure_ascii=False)
            deps = list(dict.fromkeys(p for i, p in self._created.items()
                                      if i in body and p != pid))
            if deps:
                proposal["after"] = after = deps[-1]
                if len(deps) > 1:
                    proposal["needs"] = deps
        proposal["warnings"] = [*proposal.get("warnings", []), *self._broken_links(op)]
        if self.editor_new and self.editor_id and op.get("id") != self.editor_id \
                and self.editor_id in json.dumps(op.get("body") or {}):
            proposal["warnings"].append(f"Points at the new item {self.editor_id}, which exists "
                                        "only once the user saves it in its editor")
        base = self._current(op["id"])[0] if op["op"] == "update" else None
        if op["op"] in ("create", "update"):
            body = op.get("body") or {}
            item = {**(base or {}), **body}
            if isinstance(body.get("payload"), dict) and base:
                item["payload"] = {**(base.get("payload") or {}), **body["payload"]}
            found = ai_lint.check(op, item, self.get, base)
            if op["op"] == "create" and item.get("type") == "wildcard" \
                    and not (item.get("payload") or {}).get("var_binding") \
                    and not self._pointed_at(str(item.get("name") or ""),
                                             str((op.get("body") or {}).get("id") or "")):
                # The 9B made a Pose list with no variable for the prompt to read.
                found = [*found, ai_lint.NO_VAR]
            proposal["warnings"] += found
            fixes = ai_lint.fixes(op, item, base, found)
            if fixes:
                proposal["fixes"] = fixes
        # Names of the items the card points at, for its view (a constraint's
        # source and target, a bundle's children), proposed ones included.
        named = {}
        for iid in dict.fromkeys(_HEX_ID.findall(json.dumps(op.get("body") or {}))):
            row = self.get(iid)
            if row is not None and iid != (op.get("body") or {}).get("id"):
                named[iid] = str(row.get("name") or "")
        if named:
            proposal["names"] = dict(list(named.items())[:40])
        if op["op"] == "update":
            base = self._current(op["id"])[0] or {}
            self._pending[op["id"]] = (pid, {**base, **op["body"]})
            if after:
                proposal["warnings"] = [
                    f"Builds on the earlier change to {op.get('name')}; apply that one first",
                    *proposal["warnings"],
                ]
        notes = [w for w in proposal["warnings"] if isinstance(w, str) and _NOTE.match(w)]
        if notes:
            proposal["notes"] = notes
        self._answer_cards[pid] = proposal
        return proposal

    def _absorb_category(self, proposal: dict[str, Any]) -> None:
        """A card that files items into a category a Categories card of this
        answer makes takes that card's place: it creates the category as it
        applies (`new_category`), so "create Outfit" and "put Shirt in
        Outfit" are one card (Dumi, 2026-10-22). Only a Categories card that
        makes just that one category and renames or restyles nothing."""
        name = str((proposal["op"]).get("new_category") or "").strip()
        if not name:
            return
        pid, _ = self.proposed_categories.get(name.lower(), ("", ""))
        card = self._answer_cards.get(pid)
        cop = (card or {}).get("op") or {}
        styles = cop.get("styles") or []
        if (card is None or cop.get("op") != "categories" or cop.get("rename")
                or any("id" in st for st in styles)
                or [n.lower() for n in cop.get("create") or []] != [name.lower()]):
            return
        # The card's color and icon come along.
        look = next((st for st in styles if st.get("name", "").lower() == name.lower()), {})
        proposal["op"]["new_category_style"] = {
            k: look[k] for k in ("color", "icon") if look.get(k)}
        proposal["absorbs"] = [*proposal.get("absorbs", []), pid]
        proposal["parts"] = _join_parts(_card_parts(card), _card_parts(proposal))
        if card.get("risk") != "low":
            proposal.pop("risk", None)
        del self._answer_cards[pid]
        self.proposed_categories[name.lower()] = (proposal["pid"], name)

    def _fold(self, proposal: dict[str, Any]) -> bool:
        """Fold a later change to the same item in this answer into one
        card, whatever the tool: it was built on the earlier card's result,
        so it holds both changes. The card keeps each step in `parts`, in
        order (Dumi, 2026-10-22: category, fallback and re-weight on one
        wildcard as one card). Re-test on 367a6a5 (9B): edit_bundle three
        times, two near-identical cards left on screen."""
        op = proposal["op"]
        prev = self._answer_cards.get(str(proposal.get("after")))
        prev_op = (prev or {}).get("op") or {}
        if (prev is not None and op.get("op") == "update" and prev_op.get("op") == "create"
                and (prev_op.get("body") or {}).get("id") == op.get("id")):
            return self._fold_into_create(proposal, prev)
        if (prev is None or op.get("op") != "update"
                or prev_op.get("op") != "update" or prev_op.get("id") != op.get("id")):
            return False
        parts = _join_parts(_card_parts(prev), _card_parts(proposal))
        later = op.get("body") or {}
        op["body"] = {**copy.deepcopy(prev_op.get("body") or {}), **(op.get("body") or {})}
        # The earliest value of each key is what the library holds.
        op["before"] = {**(op.get("before") or {}), **copy.deepcopy(prev_op.get("before") or {})}
        if "category_id" not in later:
            # Only the earlier step set the category.
            op["new_category"] = prev_op.get("new_category") or ""
        proposal["preview"] = list(dict.fromkeys(
            [*(prev.get("preview") or []), *(proposal.get("preview") or [])]))
        if len({part["tool"] for part in parts}) > 1:
            proposal["title"] = f"Change {op.get('name') or prev_op.get('name') or ''}".strip()
            proposal["summary"] = " · ".join(dict.fromkeys(
                str(part["summary"]) for part in parts if part["summary"]))
        else:
            start = re.match(r"(\d+) → ", str(prev.get("summary") or ""))
            end = re.match(r"\d+ → (.*)", str(proposal.get("summary") or ""))
            if start and end:
                proposal["summary"] = f"{start.group(1)} → {end.group(1)}"
        proposal["parts"] = parts
        if prev.get("risk") != "low":
            proposal.pop("risk", None)
        proposal["replaces"] = prev["pid"]
        proposal["after"] = prev.get("after")
        if prev.get("needs"):
            proposal["needs"] = prev["needs"]
        return True

    def _fold_into_create(self, proposal: dict[str, Any], prev: dict[str, Any]) -> bool:
        """An edit to an item a create card of this answer makes becomes
        that create card, with the edit in it: one card for a new wildcard
        and its nested refs, not "create" then "add the refs" (Dumi,
        2026-10-22)."""
        op, prev_op, pid = proposal["op"], prev["op"], proposal["pid"]
        body = copy.deepcopy(prev_op.get("body") or {})
        for key, value in (op.get("body") or {}).items():
            if key == "payload" and isinstance(value, dict):
                body["payload"] = {**(body.get("payload") or {}), **copy.deepcopy(value)}
            else:
                body[key] = copy.deepcopy(value)
        # A later step that sets the category decides it.
        new_cat = (op.get("new_category") or "") if "category_id" in (op.get("body") or {}) \
            else prev_op.get("new_category", "")
        op.clear()
        op.update({"op": "create", "kind": prev_op.get("kind", "module"),
                   "new_category": new_cat, "body": body})
        proposal["title"] = prev.get("title") or proposal.get("title")
        proposal["preview"] = list(dict.fromkeys(
            [*(prev.get("preview") or []), *(proposal.get("preview") or [])]))
        proposal["replaces"] = prev["pid"]
        proposal["after"] = prev.get("after")
        if prev.get("needs"):
            proposal["needs"] = prev["needs"]
        iid = body["id"]
        rows = self.modules if op["kind"] == "module" else (
            self.bundles if op["kind"] == "bundle" else self.templates)
        rows[iid] = {**copy.deepcopy(body), "_proposed": pid}
        if op["kind"] == "module":
            self.names[iid] = str(body.get("name") or "")
            self._catalog = None
            self._pending[iid] = (pid, rows[iid])
        self._created[iid] = pid
        return True


#: Card warnings that only tell the user something (what was kept, what to
#: apply first, what to check by hand): asking the model changes nothing, so
#: they get no Ask to fix button.
_NOTE = re.compile(
    r"Kept .*: a constraint points at it$"
    r"|.* may name the old tags; check its rules$"
    r"|Points at the new item "
    r"|Builds on the earlier change to ")


def _same_item(row: dict[str, Any], body: dict[str, Any]) -> bool:
    """Whether a new item's body is the unapplied card's item again."""
    def bare(v: Any) -> Any:  # rule and option ids are new on every call
        if isinstance(v, dict):
            return {k: bare(x) for k, x in v.items() if k != "id"}
        return [bare(x) for x in v] if isinstance(v, list) else v

    keys = ("name", "description", "tags", "category_id", "payload", "children")
    return all(bare(row.get(k)) == bare(body.get(k)) for k in keys)


def _card_parts(card: dict[str, Any]) -> list[dict[str, Any]]:
    """A card's steps: its own `parts` once it holds several changes, else
    itself as one."""
    if card.get("parts"):
        return list(card["parts"])
    return [{"tool": card.get("tool"), "title": card.get("title") or "",
             "summary": card.get("summary") or "", "preview": list(card.get("preview") or [])}]


def _join_parts(first: list[dict[str, Any]],
                then: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Two cards' steps in order; the same tool twice in a row is one step
    (its second call built on the first, so it holds both)."""
    out = [dict(p) for p in first]
    for part in then:
        if out and out[-1]["tool"] == part["tool"]:
            last = out[-1]
            last["preview"] = list(dict.fromkeys([*last["preview"], *part["preview"]]))
            last["summary"] = part["summary"] or last["summary"]
        else:
            out.append(dict(part))
    return out


def proposal_note(tool: str, proposal: dict[str, Any]) -> str:
    """What the model is told after a change tool: a card, not a change.
    Small models read "proposal shown" as done, then search the library for
    what they "made" and claim it exists."""
    op = proposal.get("op") or {}
    pid, title = proposal.get("pid"), proposal.get("title")
    head = (f"{tool}: card {pid} ({title}) is waiting for the user's Apply. NOTHING has "
            "changed yet")
    body = _got if isinstance(_got := op.get("body"), dict) else {}
    if op.get("op") == "create" and isinstance(body.get("id"), str):
        name = re.sub(r"[\[\]\n#]", " ", str(body.get("name") or "")).strip()
        head += (f": it will be created as [[{body['id']}#{name}]]. Point at it by that id "
                 "now (constraints, bundles, @{id} refs, more changes)")
    if proposal.get("replaces"):
        head += (f". It replaces card {proposal['replaces']} (the same item): there is one "
                 "card for it, don't propose it again")
    if proposal.get("absorbs"):
        head += (f". It also creates the category {op.get('new_category')}, so card"
                 f" {', '.join(proposal['absorbs'])} is gone: this one card does both")
    needs = proposal.get("needs") or ([proposal["after"]] if proposal.get("after") else [])
    if needs:
        head += (f". It needs card{'s' if len(needs) > 1 else ''} {', '.join(needs)} applied "
                 "first (its Apply all button does that)")
    if tool == "edit_categories":
        # All-tools eval: it made "Lighting" and stopped at "apply it, and I'll
        # move your wildcards into it"; update_many makes the category itself.
        head += (". If items should go into a new category too, call update_many with "
                 "that category's name now, in this answer: it files them there once "
                 "applied, no need to wait for this card")
    head += ". Tell the user you proposed it and what to apply; don't say you made it."
    warns = [w for w in proposal.get("warnings") or [] if isinstance(w, str)]
    if warns:
        # The card shows these too; the model reads them to fix its card.
        head += ("\nThe card warns: " + " | ".join(_short(w, 240) for w in warns[:4])
                 + "\nIf a warning is right, call the same tool again for this item "
                 "(it replaces the card); if it's what the user asked for, say so.")
    return head


def _skip_notes(skipped: list[dict[str, str]]) -> list[str]:
    return [f"Left out {_short(s.get('text'), 60)}: {s.get('reason')}" for s in skipped[:8]]


def _skipped(skipped: list[dict[str, str]]) -> str:
    if not skipped:
        return ""
    return " (" + "; ".join(f"{_short(s.get('text'), 40)}: {s.get('reason')}"
                            for s in skipped[:5]) + ")"


def args_note(tool: str, args: dict[str, Any], lib: Library | None = None) -> str:
    """A short line for the user saying what a read tool looked at."""
    if tool == "search":
        bits = [f'"{_short(args.get("query"), 40)}"' if args.get("query") else "everything"]
        if args.get("type"):
            bits.append(f"in {_short(args['type'], 20)}")
        if args.get("tag"):
            bits.append(f"tagged #{_short(args['tag'], 20)}")
        return "Searched " + " ".join(bits)
    if tool == "read":
        item = lib.get(args.get("id")) if lib else None
        return f"Read {_short(item.get('name'), 40) if item else _short(args.get('id'), 20)}"
    if tool == "docs_search":
        return f'Searched the docs for "{_short(args.get("query"), 40)}"'
    if tool == "docs_read":
        doc = ai_docs.page(args.get("page"))
        title = doc["title"] if doc else _short(args.get("page"), 30)
        sec = f" › {_short(args.get('section'), 30)}" if args.get("section") else ""
        return f"Read the docs: {title}{sec}"
    if tool == "run_test":
        stack = _got if isinstance(_got := args.get("stack"), list) else []
        names = [_short(x.get("item") if isinstance(x, dict) else x, 30) for x in stack[:4]]
        more = f" +{len(stack) - 4}" if len(stack) > 4 else ""
        n = _got if isinstance(_got := args.get("seeds"), int) else 100
        return f"Ran {', '.join(names)}{more} on {n} seeds" + (
            " with the proposed changes" if args.get("proposed") else "")
    if tool == "find_duplicates":
        kind = _short(args.get("type"), 20).replace("_", " ")
        return "Looked for duplicates" + (f" among {kind}s" if kind else "")
    if tool == "more_tools":
        return "Looked up more tools"
    if tool == "variables" and args.get("var"):
        return f"Looked up ${_short(args.get('var'), 40).lstrip('$')}"
    return "Listed the library's variables"
