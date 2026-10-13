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
from engine.ai import patterns as ai_patterns
from engine.ai import refs as ai_refs
from engine.ai import safety as ai_safety
from engine.ai import search_index as ai_search
from engine.ai import tools as ai_tools
from engine.ai import use as ai_use
from engine.ai import wildcard as ai_wildcard
from engine.ai import wildcard_edit as ai_wildcard_edit
from engine.ai.chat_tools import MoreTools, _num, _reach, _reach_text
from engine.modules.constraint_handler import ConstraintHandler
from engine.modules.derivation_handler import DerivationHandler
from engine.modules.wildcard_handler import WildcardHandler

READ_TOOLS = ai_tools.READ
CHANGE_TOOLS = ai_tools.CHANGE
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
_ASKS_LEAVE = re.compile(
    r"\b(?:should|shall|may|can) i (?:go ahead|proceed|start|continue|create|build|make|"
    r"add|set (?:it|them|this) up)\b|\b(?:do you )?want me to\b|\bwould you like me to\b|"
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


def is_go_ahead(text: str) -> bool:
    """The user's message is a short yes ("yes", "ok do it", "go ahead")."""
    t = re.sub(r"\s+", " ", text or "").strip()
    return 0 < len(t) <= 40 and bool(_GO_AHEAD.match(t))


def stalls(said: str, user_text: str, last_answer: str) -> bool:
    """A step that ended with no calls but should have acted: it asks leave,
    it repeats its last answer, or it met the user's yes with more talk."""
    if asks_leave(said) or (is_go_ahead(user_text) and asks_leave(last_answer)):
        return True
    norm = lambda t: re.sub(r"\W+", " ", t or "").strip().lower()  # noqa: E731
    return bool(last_answer) and norm(said) == norm(last_answer)


TOOLS = READ_TOOLS + CHANGE_TOOLS

MAX_STEPS = 6
MAX_CALLS_PER_STEP = 8
MAX_PROPOSALS = 12
MAX_MESSAGE = 4000
#: User messages one chat holds; older turns are shortened or left out first.
MAX_TURNS = 100
MAX_TURN_CHARS = 6000
MAX_OVERVIEW_ITEMS = 150
MAX_SEARCH = 25
_FIELD_NAMES = {"name": "name", "var": "variable", "tags": "tags", "desc": "description",
                "content": "options/content"}
MAX_READ_OPTIONS = 150
_REF = re.compile(r"\[\[([^\[\]\n]{1,80})\]\]")
_IDENT = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,63}$")

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
- derivation: IF/ELSE rules that set or change variables from others.
- constraint: links a SOURCE wildcard to a TARGET wildcard so the source's \
pick changes the odds of the target's options (exclude, reduce, boost, only).
- bundle: a saved stack of modules in order; each child has per-use settings.
- template: the WP Prompt Assembler's prompt and negative, reading variables.

You help the user understand, build and tidy their library, and you answer \
questions about Wildcard Pipeline itself. You can read the library and the \
built-in docs, run stacks on the engine, and propose changes. You never \
change anything yourself: every change tool makes a proposal card the user \
reviews and applies. Plans are fine, but act: if the user asks for \
something, propose it. Never ask "should I proceed?" or "want me to?": a \
proposal already waits for the user's Apply, so asking first only makes \
them say yes twice. When the user says yes, make the calls. Answer the \
user's actual question with what you found: no greeting, no list of what you \
can do.

"""
#: How a JSON-mode model answers.
FORMAT_JSON = """While you still have calls to make, leave "message" empty. \
Answer with JSON: {"plan": one or two sentences for yourself: what the \
user wants, which features fit (see "Which feature for which job") and what \
you'll call next, "message": what you say to the user now, "calls": tools \
to run}. Each call is {"tool": name, "args": a JSON object written as a \
string}. Read tools run at once and you get their results in the next \
message; then continue. When you are done, answer with "calls": [] and a \
message for the user. Keep messages short and plain. Write every library \
item you mention as [[its exact name]]: the user sees a chip that opens it. \
Markdown works: **bold**, lists with "- ", `code` for $variables. \
Wherever a tool takes an id you can also give the item's exact name.
"""
#: How a model with native tool calling answers.
FORMAT_NATIVE = """\
Use the tools: read tools run at once and their results come back to you; \
then continue. Change tools each make a proposal card. Before your first \
call, think in a sentence about what the user wants, which features fit \
(see "Which feature for which job") and what you'll call. When you are \
done, answer the user in plain text without calling a tool. Keep messages \
short and plain. Write every library item you mention as [[its exact \
name]]: the user sees a chip that opens it. Markdown works: **bold**, lists \
with "- ", `code` for $variables. Wherever a tool takes an id you can also \
give the item's exact name.
"""


def tools_section(names: list[str] | None = None) -> str:
    """The JSON-mode list of tools, generated from the registry."""
    chosen = ai_tools.tools(names if names is not None
                            else ai_tools.toolset(None, scoped=False))
    out = "Read tools:\n" + ai_tools.prompt_lines(chosen, "read") + "\n"
    change = ai_tools.prompt_lines(chosen, "change")
    if change:
        out += "\nChange tools (each becomes a proposal):\n" + change + "\n"
    return out + "\n"


SYSTEM_HEAD = SYSTEM_INTRO + FORMAT_JSON + "\n" + tools_section()
SYSTEM_TAIL = """
Per-use settings ("use" on bundle items and run_test items): """ + ai_use.GUIDE + """

Read an item before changing it. Don't add commentary about content; the \
output is data for the user's own library.

""" + ai_safety.UNTRUSTED_RULE + """

Questions about Wildcard Pipeline (how something works, what a warning \
means, where a setting is, what a page says): search and read the docs \
first and answer from them, naming the page, like "(docs: Constraint › \
Target reach)", and offer an open button when it helps. When asked to \
explain something more simply, say the same thing in plain everyday words \
with one small example; don't change what it means. If the docs don't cover \
it, say so instead of guessing.

When the user has an item open in its editor, read shows the editor's \
version, unsaved changes included, and your changes to that item go into the \
editor; the user saves them there. On the Test Runner page the note under \
the user's message shows the last run; use run_test to try changes.
"""
SYSTEM_PROMPT = SYSTEM_HEAD + ai_guide.text() + SYSTEM_TAIL


def system_prompt(*, slim: bool = False, examples: bool = True, native: bool = False,
                  tools: list[str] | None = None) -> str:
    """The chat's instructions. `slim` (small models) keeps the tools and
    the core guide but leaves out the coherence notes and the docs and page
    tables (docs_search still finds pages), about a third shorter.
    `native`: the tools travel as native declarations, so the prompt says
    how to use them instead of listing them. `tools`: the names this chat
    offers (default: all)."""
    pages = "\n".join(f"- {k}: {v}" for k, v in APP_PAGES.items())
    if native:
        head = SYSTEM_INTRO + FORMAT_NATIVE + "\n"
        shown = ai_guide.EXAMPLES_CHAT_NATIVE if examples else ""
    else:
        head = SYSTEM_INTRO + FORMAT_JSON + "\n" + tools_section(tools)
        shown = ai_guide.EXAMPLES_CHAT if examples else ""
    if slim:
        return (head + ai_guide.text(slim=True) + shown + SYSTEM_TAIL
                + "\nDocs: find pages with docs_search. Manager pages: "
                + ", ".join(APP_PAGES))
    return (f"{head}{ai_guide.text()}{shown}{SYSTEM_TAIL}\n"
            f"Docs pages (id: title):\n{ai_docs.contents()}\n\n"
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
    message = raw.get("message") if isinstance(raw.get("message"), str) else ""
    calls: list[dict[str, Any]] = []
    for c in raw.get("calls") if isinstance(raw.get("calls"), list) else []:
        if isinstance(c, dict) and c.get("tool") in TOOLS:
            calls.append({"tool": c["tool"], "args": c.get("args", "")})
    return message.strip()[:MAX_MESSAGE], calls[:MAX_CALLS_PER_STEP]


class Library(MoreTools):
    """The rows one chat request may look at, plus the change compilers."""

    def __init__(self, modules: list[dict[str, Any]], bundles: list[dict[str, Any]],
                 categories: list[dict[str, Any]],
                 templates: list[dict[str, Any]] | None = None) -> None:
        self.modules = {m["id"]: m for m in modules if isinstance(m.get("id"), str)}
        self.bundles = {b["id"]: b for b in bundles if isinstance(b.get("id"), str)}
        self.templates = {t["id"]: t for t in templates or [] if isinstance(t.get("id"), str)}
        self.categories = {c["id"]: c["name"] for c in categories}
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
        self._next_pid = 0
        #: Id of the item open in an editor whose unsaved state replaced the
        #: saved row (`use_editor`); changes to it go into that editor.
        self.editor_id: str | None = None
        self.editor_dirty = False
        #: The library index (`engine.ai.index`), synced by the route; None
        #: means search scores every row in Python.
        self.index: ai_index.Index | None = None
        #: Meaning search: the embedding model, and the vector of the query
        #: the next `search` runs (the route embeds it; tools are sync).
        self.embed_model = ""
        self.qvec: list[float] | None = None

    def use_editor(self, editor: Any) -> None:
        """Read the open editor's version of its item instead of the saved
        row: the fields it sends (name, description, tags, category_id,
        content_rating, payload) replace the saved ones."""
        if not isinstance(editor, dict) or not isinstance(editor.get("id"), str):
            return
        item_id = editor["id"]
        saved = self.modules.get(item_id) or self.bundles.get(item_id)
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
        if item_id in self.modules:
            self.modules[item_id] = row
            self.names[item_id] = row.get("name") or ""
            self._catalog = None
        else:
            self.bundles[item_id] = row
        self.editor_id = item_id
        self.editor_dirty = bool(editor.get("dirty"))

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

    def page_note(self, page: Any) -> str:
        """What the user is looking at, added under their message."""
        if not isinstance(page, dict):
            return ""
        lines: list[str] = []
        item = self.get(page.get("id")) if isinstance(page.get("id"), str) else None
        doc = ai_docs.page(page.get("doc")) if page.get("doc") else None
        if item is not None:
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

    def _resolve(self, args: dict[str, Any], *keys: str) -> dict[str, Any]:
        """``args`` with each of ``keys`` (an id or a unique name) turned
        into the item's id, so tools take either."""
        out = dict(args)
        for k in keys:
            if isinstance(out.get(k), str) and self.get(out[k]) is None:
                row = self._find(out[k])
                if row is not None:
                    out[k] = row["id"]
        return out

    # ── read tools ───────────────────────────────────────────────────────

    def message_refs(self, message: str) -> dict[str, dict[str, str]]:
        """The [[Name]] / [[id]] mentions in an answer that name a real item
        (not one only proposed), so the manager can show them as chips."""
        refs: dict[str, dict[str, str]] = {}
        for raw in _REF.findall(message or "")[:60]:
            row = self._find(raw)
            if row is None or row.get("_proposed") or raw in refs:
                continue
            refs[raw] = {"id": row["id"], "type": self._kind(row),
                         "name": str(row.get("name") or raw)}
        return refs

    def search(self, args: dict[str, Any]) -> str:
        query = _short(args.get("query"), 100).lower()
        type_ = _short(args.get("type"), 30).lower()
        tag = _short(args.get("tag"), 40).lower().lstrip("#")
        own, widened = ai_search.expand(query)
        if self.index is not None and own:
            return self._search_index(query, type_, tag)
        phrase = query.strip()
        ranked: list[tuple[float, int, dict[str, Any], list[str], list[str]]] = []
        rows = [*self.modules.values(), *self.bundles.values(), *self.templates.values()]
        for n, r in enumerate(rows):
            if not self._fits(r, type_, tag):
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
        hits = [self._hit_line(r, [_FIELD_NAMES[w] for w in where], snips)
                for _points, _n, r, where, snips in ranked[:MAX_SEARCH]]
        total = len(ranked)
        more = f"\n- … {total - len(hits)} more (narrow the query or give a type)" \
            if total > len(hits) else ""
        head = f"{total} match{'es' if total != 1 else ''}"
        if widened:
            head += " (best first; broad words widened to related ones)"
        return head + ":\n" + "\n".join(hits) + more

    def _fits(self, r: dict[str, Any], type_: str, tag: str) -> bool:
        kind = self._kind(r)
        if type_ and type_ not in (kind, kind.replace("_", " ")):
            return False
        tags = [t for t in r.get("tags") or [] if isinstance(t, str)]
        return not tag or tag in (t.lower() for t in tags)

    def _hit_line(self, r: dict[str, Any], where: list[str], snips: list[str],
                  used: int = 0) -> str:
        cat = self.categories.get(r.get("category_id") or "", "")
        tags = [t for t in r.get("tags") or [] if isinstance(t, str)]
        extra = []
        if cat:
            extra.append(f"category {cat}")
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

    def _search_index(self, query: str, type_: str, tag: str) -> str:
        """`search` over the library index (saved items), plus any item this
        chat proposed or the open editor changed, scored the old way."""
        assert self.index is not None
        fetch = MAX_SEARCH * (4 if tag or type_ else 1) + 1
        qvec, self.qvec = self.qvec, None
        hits = [h for h in self.index.search(query, limit=fetch, qvec=qvec,
                                             model=self.embed_model)
                if (r := self.get(h.id)) is not None and not r.get("_proposed")
                and h.id != self.editor_id and self._fits(r, type_, tag)]
        own, widened = ai_search.expand(query)
        fresh: list[tuple[float, dict[str, Any], list[str], list[str]]] = []
        for r in [*self.modules.values(), *self.bundles.values(), *self.templates.values()]:
            if not (r.get("_proposed") or r.get("id") == self.editor_id):
                continue
            if not self._fits(r, type_, tag):
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
            raise ValueError(f"no item with id {_short(args.get('id'), 20)!r}")
        kind = self._kind(r)
        lines = [f"{kind} \"{r.get('name')}\" ({r['id']})"]
        if r.get("description"):
            lines.append(f"Description: {_short(r['description'], 600)}")
        cat = self.categories.get(r.get("category_id") or "", "")
        lines.append(f"Category: {cat or '(none)'}")
        lines.append(f"Tags: {', '.join(r.get('tags') or []) or '(none)'}")
        if kind != "template":
            lines.append(f"Rating: {r.get('content_rating') or 'safe'}")
        lines.extend(self.read_body(kind, r))
        facts = self.index.facts(r["id"]) if self.index is not None else None
        if facts and facts.get("used_by"):
            lines.append("Used by: " + ", ".join(facts["used_by"]))
        if facts and facts.get("in_bundles"):
            lines.append("In bundles: " + ", ".join(facts["in_bundles"]))
        return "\n".join(lines)

    def variables(self, _args: dict[str, Any]) -> str:
        return library_vars.describe(self.catalog) or "the library sets no variables yet"

    def docs_search(self, args: dict[str, Any]) -> str:
        return ai_docs.search(_short(args.get("query"), 200))

    def docs_read(self, args: dict[str, Any]) -> str:
        return ai_docs.read(args.get("page"), args.get("section"))

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
        for t in args.get("tags") if isinstance(args.get("tags"), list) else []:
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
        return {"options": args.get("options") if isinstance(args.get("options"), list) else [],
                "axes": args.get("axes") if isinstance(args.get("axes"), list) else [],
                "null_weight": args.get("null_weight", 0)}

    def create_wildcard(self, args: dict[str, Any]) -> dict[str, Any]:
        name = self._name(args, "")
        if not name:
            raise ValueError("give the wildcard a name")
        var = _short(args.get("var"), 64).lstrip("$")
        if var and not _IDENT.match(var):
            raise ValueError("var must be a variable name: letters, digits and _ "
                             "(or \"\" for a vocabulary)")
        if not var and any(str(r.get("name") or "").lower() == name.lower()
                           for r in self.modules.values() if r.get("type") == "wildcard"):
            raise ValueError(f"a wildcard named {name} exists; a vocabulary needs a "
                             "unique name so @{{{name}}} finds it")
        out = ai_wildcard.compile_spec(self._spec(args), var=var or None, refs=self.refs)
        payload = out["payload"]
        meta = self._meta(args)
        warnings = []
        if var and var in self.catalog:
            warnings.append(f"${var} is already set elsewhere in the library")
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

    def _current(self, item_id: Any) -> tuple[dict[str, Any] | None, str | None]:
        """The item as earlier proposals in this answer leave it, and the
        last such proposal's id."""
        if isinstance(item_id, str) and item_id in self._pending:
            pid, row = self._pending[item_id]
            return row, pid
        return self.get(item_id), None

    def _module(self, args: dict[str, Any], type_: str) -> dict[str, Any]:
        r = self.modules.get(args.get("id")) if isinstance(args.get("id"), str) else None
        if r is not None:
            r = self._current(r["id"])[0]
        if r is None or r.get("type") != type_:
            raise ValueError(f"no {type_.replace('_', ' ')} with id "
                             f"{_short(args.get('id'), 20)!r}; search for it first")
        return r

    def add_options(self, args: dict[str, Any]) -> dict[str, Any]:
        r = self._module(args, "wildcard")
        old = r.get("payload") if isinstance(r.get("payload"), dict) else {}
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
        old = r.get("payload") if isinstance(r.get("payload"), dict) else {}
        opts = [o for o in old.get("options") or [] if isinstance(o, dict)]
        shown = [
            {"id": str(n), "value": "" if o.get("is_null") else str(o.get("value") or ""),
             "weight": o.get("weight", 1), "sub_categories": list(o.get("sub_categories") or []),
             "negative": o.get("negative") or ""}
            for n, o in enumerate(opts, start=1)
        ]
        registry = [t for t in old.get("sub_categories") or [] if isinstance(t, str)]
        nulls = {str(n) for n, o in enumerate(opts, start=1) if o.get("is_null")}

        def _numbered(key: str, field: str) -> list[dict[str, Any]]:
            rows = args.get(key) if isinstance(args.get(key), list) else []
            return [{"id": str(x.get("n")), field: x.get(field)}
                    for x in rows if isinstance(x, dict)]

        asks = {
            "remove": {"remove": [{"id": str(n), "reason": ""}
                                  for n in (args.get("remove") or [])
                                  if isinstance(n, (int, str)) and not isinstance(n, bool)]},
            "rewrite": {"options": _numbered("rewrite", "text")},
            "retag": {"options": _numbered("retag", "tags")},
            "reweight": {"options": _numbered("weights", "weight")},
        }
        changes: dict[str, list[dict[str, Any]]] = {}
        skipped: list[dict[str, str]] = []
        new_tags: list[str] = []
        for action, raw in asks.items():
            if not next(iter(raw.values())):
                continue
            out = ai_wildcard_edit.compile_edit(action, raw, options=shown,
                                                registry=registry + new_tags,
                                                refs=self.refs, self_id=r["id"])
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
        if not preview and not isinstance(args.get("null_weight"), (int, float)):
            raise ValueError("that changes nothing" + _skipped(skipped)
                             + (f" ({len(kept)} options are used by constraints)" if kept else ""))
        payload["options"] = [o for i, o in enumerate(rows) if i not in gone]
        null_w = args.get("null_weight")
        if isinstance(null_w, (int, float)) and not isinstance(null_w, bool):
            preview += self._null_weight(payload, null_w, refs)
        if not preview:
            raise ValueError("that changes nothing" + _skipped(skipped))
        if new_tags:
            payload["sub_categories"] = list(dict.fromkeys([*registry, *new_tags]))
        WildcardHandler.validate_payload(payload)
        warnings = [f"Kept {_short(v, 60)}: a constraint points at it" for v in kept[:8]]
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
            {"rules": args.get("rules") if isinstance(args.get("rules"), list) else []},
            catalog=self.catalog, taken_ids=taken, refs=self.refs,
        )
        if not compiled["rules"]:
            raise ValueError("no usable rules" + _skipped(compiled["skipped"]))
        return compiled

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
        old = r.get("payload") if isinstance(r.get("payload"), dict) else {}
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
            {"rules": args.get("rules") if isinstance(args.get("rules"), list) else []},
            source=source, target=target,
        )
        if not compiled["cells"] and not compiled["exceptions"]:
            raise ValueError("no usable rules" + _skipped(compiled["skipped"]))
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
            raise ValueError(f"no item with id {_short(args.get('id'), 20)!r}")
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
        if adds or rms:
            lower = {t.lower(): t for t in self.tags}
            added = list(dict.fromkeys(lower.get(a.lower(), a.lower()) for a in adds))
            body["tags"] = [t for t in tags if t.lower() not in rms] + added
            before["tags"] = tags
            preview.append("Tags: " + " ".join(
                [f"+#{a}" for a in added] + [f"−#{t}" for t in tags if t.lower() in rms]))
        if kind != "bundle" and isinstance(args.get("category"), str) and args["category"]:
            cid, new_cat = self._category(args["category"])
            if (cid or new_cat) and cid != r.get("category_id"):
                body["category_id"], before["category_id"] = cid, r.get("category_id")
                preview.append(f"Category: {args['category'].strip()}"
                               + (" (new)" if new_cat else ""))
        rating = args.get("rating") if kind != "template" else None
        if rating in ("safe", "nsfw") and rating != (r.get("content_rating") or "safe"):
            body["content_rating"] = rating
            before["content_rating"] = r.get("content_rating") or "safe"
            preview.append(f"Rating: {rating}")
        if not body:
            raise ValueError("that changes nothing")
        return {
            "title": f"Update {r.get('name')}",
            "summary": f"{kind} info",
            "preview": preview,
            "warnings": [],
            "op": {"op": "update", "kind": kind, "type": self._kind(r), "id": r["id"],
                   "name": r.get("name"), "body": body, "before": before,
                   "new_category": new_cat},
        }

    def open(self, args: dict[str, Any]) -> dict[str, Any]:
        if args.get("doc"):
            doc = ai_docs.page(args.get("doc"))
            if doc is None or doc["id"] == "settings":
                raise ValueError(f"no docs page {_short(args.get('doc'), 40)!r}")
            return {
                "title": f"Open the docs: {doc['title']}", "summary": "docs",
                "preview": [], "warnings": [],
                "op": {"op": "open", "kind": "doc", "type": "doc", "id": doc["id"]},
            }
        if args.get("page") and not args.get("id"):
            name = _short(args.get("page"), 40).lower().strip("/ ")
            if name not in APP_PAGES:
                raise ValueError(f"no manager page {name!r}")
            section = _short(args.get("section"), 30).lower() if name == "settings" else ""
            label = APP_PAGES[name].split(":")[0].split(" (")[0]
            return {
                "title": f"Go to {label}" + (f" › {section}" if section else ""),
                "summary": "page", "preview": [], "warnings": [],
                "op": {"op": "open", "kind": "page", "type": "page", "id": name,
                       **({"section": section} if section else {})},
            }
        r = self.get(args.get("id"))
        if r is None:
            raise ValueError(f"no item with id {_short(args.get('id'), 20)!r}")
        kind = self._kind(r)
        return {
            "title": f"Open {r.get('name')}", "summary": kind.replace("_", " "),
            "preview": [], "warnings": [],
            "op": {"op": "open", "kind": kind if kind in ("bundle", "template") else "module",
                   "type": kind, "id": r["id"]},
        }

    def plan_pack(self, args: dict[str, Any]) -> dict[str, Any]:
        text = args.get("description")
        text = text.strip() if isinstance(text, str) else ""
        if len(text) < 10:
            raise ValueError("describe the pack: what it makes, its parts and its rules")
        text = text[:MAX_PACK_DESCRIPTION]
        return {
            "title": "Plan this pack in the Pack builder", "summary": "pack",
            "preview": [_short(text, 300)], "warnings": [],
            "op": {"op": "open", "kind": "pack", "type": "pack", "id": "pack-builder",
                   "description": text},
        }

    def _adopt(self, proposal: dict[str, Any]) -> None:
        """Make a proposed new item visible to the rest of this answer, so
        later calls can name it, point at it and run it. A module gets the
        id it will be created with; a bundle or template, which nothing
        points at by id, is only findable by name here."""
        op, pid = proposal["op"], proposal["pid"]
        body = op["body"]
        if op["kind"] == "module":
            new_id = secrets.token_hex(4)
            while new_id in self.modules:
                new_id = secrets.token_hex(4)
            body["id"] = new_id
            self.modules[new_id] = {**copy.deepcopy(body), "id": new_id, "_proposed": pid}
            self.names[new_id] = str(body.get("name") or "")
            self._catalog = None
            self._created[new_id] = pid
            self._pending[new_id] = (pid, self.modules[new_id])
        elif op["kind"] == "bundle":
            self.bundles[pid] = {**copy.deepcopy(body), "id": pid, "_proposed": pid}
        elif op["kind"] == "template":
            self.templates[pid] = {**copy.deepcopy(body), "id": pid, "_proposed": pid}

    def run(self, tool: str, args: dict[str, Any]) -> str | dict[str, Any]:
        """A read tool's text, or a change tool's proposal (with `pid`, and
        `after` when it builds on an earlier proposal). Raises ValueError."""
        fn = getattr(self, tool, None)
        if tool not in TOOLS or fn is None:
            raise ValueError(f"unknown tool {tool}")
        args = self._resolve(args, "id", "source_id", "target_id")
        if tool in READ_TOOLS:
            return fn(args)
        item_id = args.get("id") if tool in ITEM_TOOLS else None
        after = self._current(item_id)[1]
        proposal = fn(args)
        self._next_pid += 1
        pid = f"p{self._next_pid}"
        proposal = {"pid": pid, "tool": tool, **proposal, "after": after}
        op = proposal["op"]
        if op["op"] == "update" and op["id"] == self.editor_id:
            # Built on the editor's unsaved version: it goes into the editor.
            op["basis"] = "editor"
        if op["op"] == "create":
            self._adopt(proposal)
        # A change that points at an item proposed earlier in this answer
        # (a constraint between two new wildcards, a bundle of new modules)
        # waits for that one: its id only exists once it is applied.
        if not after:
            body = json.dumps(op.get("body") or {}, ensure_ascii=False)
            deps = [p for i, p in self._created.items() if i in body and p != pid]
            if deps:
                proposal["after"] = after = deps[-1]
        if op["op"] == "update":
            base = self._current(op["id"])[0] or {}
            self._pending[op["id"]] = (pid, {**base, **op["body"]})
            if after:
                proposal["warnings"] = [
                    f"Builds on the earlier change to {op.get('name')}; apply that one first",
                    *proposal["warnings"],
                ]
        return proposal


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
        stack = args.get("stack") if isinstance(args.get("stack"), list) else []
        names = [_short(x.get("item") if isinstance(x, dict) else x, 30) for x in stack[:4]]
        more = f" +{len(stack) - 4}" if len(stack) > 4 else ""
        n = args.get("seeds") if isinstance(args.get("seeds"), int) else 100
        return f"Ran {', '.join(names)}{more} on {n} seeds" + (
            " with the proposed changes" if args.get("proposed") else "")
    return "Listed the library's variables"
