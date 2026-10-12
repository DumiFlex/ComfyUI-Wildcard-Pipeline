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
from engine.ai import library_vars
from engine.ai import wildcard as ai_wildcard
from engine.ai import wildcard_edit as ai_wildcard_edit
from engine.modules.constraint_handler import ConstraintHandler
from engine.modules.derivation_handler import DerivationHandler
from engine.modules.wildcard_handler import WildcardHandler

READ_TOOLS = ("search", "read", "variables", "docs_search", "docs_read")
CHANGE_TOOLS = (
    "create_wildcard", "add_options", "edit_options", "create_derivation", "add_rules",
    "create_constraint", "update_info", "open",
)
#: Tools that change one existing item (its id is `args.id`).
ITEM_TOOLS = ("add_options", "edit_options", "add_rules", "update_info")

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
TOOLS = READ_TOOLS + CHANGE_TOOLS

MAX_STEPS = 6
MAX_CALLS_PER_STEP = 8
MAX_PROPOSALS = 12
MAX_MESSAGE = 4000
MAX_TURNS = 20
MAX_TURN_CHARS = 6000
MAX_OVERVIEW_ITEMS = 150
MAX_SEARCH = 25
MAX_READ_OPTIONS = 150
_IDENT = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,63}$")

STEP_SCHEMA: dict[str, Any] = {
    "type": "object", "additionalProperties": False,
    "required": ["message", "calls"],
    "properties": {
        "message": {"type": "string"},
        "calls": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["tool", "args"],
                "properties": {
                    "tool": {"type": "string", "enum": list(TOOLS)},
                    "args": {"type": "string"},
                },
            },
        },
    },
}

SYSTEM_PROMPT = """\
You are the assistant inside Wildcard Pipeline's library manager. Wildcard \
Pipeline is a ComfyUI extension that builds image-generation prompts from \
modules:
- wildcard: a list of options, one picked per run, bound to a $variable. \
Options can carry tags, a weight and a negative.
- fixed_values: variables set to fixed text.
- combine: a template that joins variables into a new one.
- derivation: IF/ELSE rules that set or change variables from others.
- constraint: links a SOURCE wildcard to a TARGET wildcard so the source's \
pick changes the odds of the target's options (exclude, reduce, boost, only).
- bundle: a saved group of modules.

You help the user understand, build and tidy their library, and you answer \
questions about Wildcard Pipeline itself. You can read the library and the \
built-in docs with tools and propose changes. You never change anything yourself: every \
change tool makes a proposal card the user reviews and applies. Plans are \
fine, but act: if the user asks for something, propose it.

Answer with JSON: {"message": what you say to the user now, "calls": tools \
to run}. Each call is {"tool": name, "args": a JSON object written as a \
string}. Read tools run at once and you get their results in the next \
message; then continue. When you are done, answer with "calls": [] and a \
message for the user. Keep messages short and plain; refer to items by name.

Read tools:
- search {"query": text, "type": optional module type or "bundle", "tag": \
optional tag}: items whose name, description or tags match. Empty query lists \
everything of that type.
- read {"id": item id}: one item in full (options with tags, rules, …).
- variables {}: every variable the library sets, with its options.
- docs_search {"query": words}: the docs sections that match, with a snippet.
- docs_read {"page": docs page id, "section": optional section title}: the \
page's text.

Change tools (each becomes a proposal):
- create_wildcard {"name", "var": variable name without $, "description", \
"tags": [library tags], "category": name or "", "options": [{"text", \
"weight": 1, "tags": [option tags], "negative": ""}]}
- add_options {"id": wildcard id, "options": [same as above]}
- edit_options {"id": wildcard id, "remove": [option numbers], "rewrite": \
[{"n": number, "text"}], "retag": [{"n": number, "tags": [option tags]}], \
"weights": [{"n": number, "weight": 0-100}]}: change options that exist. The \
numbers are the ones read shows. Leave out what you don't change.
- create_derivation {"name", "description", "tags", "category", "rules": \
[{"summary", "branches": [{"match": "all"|"any", "conditions": [{"var", "op": \
equals|not_equals|contains|not_contains|matches|exists|not_exists|is_set|\
is_unset|is_empty|is_not_empty, "value"}], "actions": [{"target_var", "mode": \
replace|append|prepend|negative|negative_replace, "value"}]}], \
"else_actions": [actions]}]}
- add_rules {"id": derivation id, "rules": [same as above]}
- create_constraint {"name", "source_id", "target_id", "rules": [{"source": \
"#tag" or option text, "target": "#tag" or option text, "effect": \
exclude|reduce|boost|only, "factor", "reason"}]}
- update_info {"id", "description": new text or omit, "tags_add": [], \
"tags_remove": [], "category": name or omit, "rating": "safe"|"nsfw" or omit}
- open {"id"} for an item's editor, {"doc": docs page id} for a docs page, \
or {"page": manager page, "section": settings section}: a button that goes \
there.

Option text is plain prompt text: no $, @, {, } or |. Read an item before \
changing it. Reuse the library's tags, categories and variables. Don't add \
commentary about content; the output is data for the user's own library.

Questions about Wildcard Pipeline (how something works, what a warning \
means, where a setting is, what a page says): search and read the docs \
first and answer from them, naming the page, like "(docs: Constraint › \
Target reach)", and offer an open button when it helps. When asked to \
explain something more simply, say the same thing in plain everyday words \
with one small example; don't change what it means. If the docs don't cover \
it, say so instead of guessing.

When the user has an item open in its editor, read shows the editor's \
version, unsaved changes included, and your changes to that item go into the \
editor; the user saves them there.
"""


def system_prompt() -> str:
    pages = "\n".join(f"- {k}: {v}" for k, v in APP_PAGES.items())
    return (f"{SYSTEM_PROMPT}\nDocs pages (id: title):\n{ai_docs.contents()}\n\n"
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


def parse_turns(raw: Any) -> list[dict[str, str]]:
    """The conversation the manager sends: alternating user/assistant
    messages, ending with the user's new one."""
    if not isinstance(raw, list) or not raw:
        raise ValueError("say something first")
    if len(raw) > MAX_TURNS * 2:
        raise ValueError("this chat is long; start a new one to keep it focused")
    turns: list[dict[str, str]] = []
    for m in raw:
        if not isinstance(m, dict) or m.get("role") not in ("user", "assistant"):
            raise ValueError("each message needs a role")
        text = m.get("content")
        if not isinstance(text, str):
            raise ValueError("each message needs text")
        if len(text) > MAX_TURN_CHARS:
            text = text[:MAX_TURN_CHARS] + " …"
        turns.append({"role": m["role"], "content": text})
    if turns[-1]["role"] != "user" or not turns[-1]["content"].strip():
        raise ValueError("say something first")
    return turns


def history_pairs(turns: list[dict[str, str]]) -> list[tuple[str, Any]]:
    """Earlier turns as (user, answer) pairs for `complete_json`."""
    pairs: list[tuple[str, Any]] = []
    pending: str | None = None
    for t in turns[:-1]:
        if t["role"] == "user":
            pending = t["content"] if pending is None else pending + "\n\n" + t["content"]
        elif pending is not None:
            pairs.append((pending, {"message": t["content"], "calls": []}))
            pending = None
    return pairs


class Library:
    """The rows one chat request may look at, plus the change compilers."""

    def __init__(self, modules: list[dict[str, Any]], bundles: list[dict[str, Any]],
                 categories: list[dict[str, Any]]) -> None:
        self.modules = {m["id"]: m for m in modules if isinstance(m.get("id"), str)}
        self.bundles = {b["id"]: b for b in bundles if isinstance(b.get("id"), str)}
        self.categories = {c["id"]: c["name"] for c in categories}
        self.cat_by_lower = {c["name"].lower(): c["id"] for c in categories}
        self.names = {i: m.get("name") or "" for i, m in self.modules.items()}
        self.tags = ai_describe.library_tags([*modules, *bundles])
        self._catalog: dict[str, dict[str, Any]] | None = None
        # Item id -> (proposal id, the row as that proposal leaves it). A later
        # change to the same item builds on the earlier proposal, so applying
        # both in order keeps both; the card says to apply the earlier first.
        self._pending: dict[str, tuple[str, dict[str, Any]]] = {}
        self._next_pid = 0
        #: Id of the item open in an editor whose unsaved state replaced the
        #: saved row (`use_editor`); changes to it go into that editor.
        self.editor_id: str | None = None
        self.editor_dirty = False

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

    def overview(self) -> str:
        counts: dict[str, int] = {}
        for m in self.modules.values():
            counts[str(m.get("type"))] = counts.get(str(m.get("type")), 0) + 1
        if self.bundles:
            counts["bundle"] = len(self.bundles)
        lines = ["The library now:"]
        lines.append("Counts: " + (", ".join(f"{n} {t}" for t, n in sorted(counts.items()))
                                   or "empty"))
        cats = list(self.categories.values())
        lines.append(f"Categories: {', '.join(cats) if cats else 'none'}")
        lines.append(f"Tags: {', '.join(self.tags[:60]) if self.tags else 'none'}")
        rows = [*self.modules.values(), *self.bundles.values()]
        rows.sort(key=lambda r: str(r.get("updated_at") or ""), reverse=True)
        lines.append(f"Items (id · type · name), newest first, {len(rows)} in all:")
        for r in rows[:MAX_OVERVIEW_ITEMS]:
            lines.append(f"- {self._line(r)}")
        if len(rows) > MAX_OVERVIEW_ITEMS:
            lines.append(f"- … {len(rows) - MAX_OVERVIEW_ITEMS} more (use search)")
        return "\n".join(lines)

    def _kind(self, row: dict[str, Any]) -> str:
        return "bundle" if row.get("id") in self.bundles and "children" in row else str(
            row.get("type") or "module")

    def _line(self, r: dict[str, Any]) -> str:
        bits = [str(r["id"]), self._kind(r), str(r.get("name") or "(unnamed)")]
        if r.get("type") == "wildcard" and isinstance(r.get("payload"), dict):
            var = r["payload"].get("var_binding")
            if var:
                bits.append(f"${var}")
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
        return self.modules.get(item_id) or self.bundles.get(item_id)

    # ── read tools ───────────────────────────────────────────────────────

    def search(self, args: dict[str, Any]) -> str:
        query = _short(args.get("query"), 100).lower()
        type_ = _short(args.get("type"), 30).lower()
        tag = _short(args.get("tag"), 40).lower().lstrip("#")
        hits: list[str] = []
        total = 0
        for r in [*self.modules.values(), *self.bundles.values()]:
            kind = self._kind(r)
            if type_ and type_ not in (kind, kind.replace("_", " ")):
                continue
            tags = [t for t in r.get("tags") or [] if isinstance(t, str)]
            if tag and tag not in (t.lower() for t in tags):
                continue
            hay = " ".join([str(r.get("name") or ""), str(r.get("description") or ""), *tags])
            if r.get("type") == "wildcard" and isinstance(r.get("payload"), dict):
                hay += " " + str(r["payload"].get("var_binding") or "")
            if query and query not in hay.lower():
                continue
            total += 1
            if len(hits) < MAX_SEARCH:
                cat = self.categories.get(r.get("category_id") or "", "")
                extra = []
                if cat:
                    extra.append(f"category {cat}")
                if tags:
                    extra.append("tags " + ", ".join(tags))
                if r.get("description"):
                    extra.append(_short(r["description"], 80))
                hits.append(f"- {self._line(r)}" + (f" ({'; '.join(extra)})" if extra else ""))
        if not hits:
            return "no matches"
        more = f"\n- … {total - len(hits)} more" if total > len(hits) else ""
        return f"{total} match{'es' if total != 1 else ''}:\n" + "\n".join(hits) + more

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
        lines.append(f"Rating: {r.get('content_rating') or 'safe'}")
        p = r.get("payload") if isinstance(r.get("payload"), dict) else {}
        if kind == "wildcard":
            lines.append(f"Variable: ${p.get('var_binding') or '(none)'}")
            lines.append(f"Option tags: {', '.join(p.get('sub_categories') or []) or '(none)'}")
            opts = [o for o in p.get("options") or [] if isinstance(o, dict)]
            lines.append(f"Options ({len(opts)}):")
            for n, o in enumerate(opts[:MAX_READ_OPTIONS], start=1):
                text = "∅ (empty)" if o.get("is_null") else _short(o.get("value"), 200)
                extra = []
                if o.get("weight", 1) != 1:
                    extra.append(f"×{o.get('weight')}")
                if o.get("sub_categories"):
                    extra.append("#" + " #".join(o["sub_categories"]))
                if o.get("fallback"):
                    extra.append("fallback")
                lines.append(f"{n}. {text}" + (f"  [{' '.join(extra)}]" if extra else ""))
            if len(opts) > MAX_READ_OPTIONS:
                lines.append(f"- … {len(opts) - MAX_READ_OPTIONS} more")
        elif kind == "bundle":
            lines.append(ai_describe.summarize("bundle", r.get("children") or [],
                                               names=self.names))
        else:
            lines.append(ai_describe.summarize(kind, p, names=self.names))
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

    @staticmethod
    def _option_rows(compiled: list[dict[str, Any]]) -> list[dict[str, Any]]:
        rows = []
        for o in compiled:
            row: dict[str, Any] = {
                "id": secrets.token_hex(4), "value": o["value"], "weight": o["weight"],
                "sub_categories": o["tags"],
            }
            if o["negative"]:
                row["negative"] = o["negative"]
            rows.append(row)
        return rows

    def create_wildcard(self, args: dict[str, Any]) -> dict[str, Any]:
        name = self._name(args, "")
        if not name:
            raise ValueError("give the wildcard a name")
        var = _short(args.get("var"), 64).lstrip("$")
        if not _IDENT.match(var):
            raise ValueError("var must be a variable name: letters, digits and _")
        compiled = ai_wildcard.compile_options(
            {"options": args.get("options") if isinstance(args.get("options"), list) else []},
            existing_payload={"options": [], "sub_categories": []},
        )
        if not compiled["options"]:
            raise ValueError("no usable options" + _skipped(compiled["skipped"]))
        payload = {
            "var_binding": var, "sub_categories": compiled["new_tags"],
            "options": self._option_rows(compiled["options"]),
        }
        WildcardHandler.validate_payload(payload)
        meta = self._meta(args)
        warnings = []
        if var in self.catalog:
            warnings.append(f"${var} is already set elsewhere in the library")
        return {
            "title": f"Create wildcard {name}",
            "summary": f"${var} with {len(payload['options'])} options",
            "preview": [o["value"] + (f"  #{' #'.join(o['tags'])}" if o["tags"] else "")
                        for o in compiled["options"]],
            "warnings": warnings + _skip_notes(compiled["skipped"]),
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
        compiled = ai_wildcard.compile_options(
            {"options": args.get("options") if isinstance(args.get("options"), list) else []},
            existing_payload=old,
        )
        if not compiled["options"]:
            raise ValueError("no usable new options" + _skipped(compiled["skipped"]))
        payload = copy.deepcopy(old)
        payload["sub_categories"] = list(dict.fromkeys(
            [*(old.get("sub_categories") or []), *compiled["new_tags"]]))
        payload["options"] = [*(old.get("options") or []), *self._option_rows(compiled["options"])]
        WildcardHandler.validate_payload(payload)
        return {
            "title": f"Add {len(compiled['options'])} options to {r.get('name')}",
            "summary": f"{len(old.get('options') or [])} → {len(payload['options'])} options",
            "preview": [o["value"] + (f"  #{' #'.join(o['tags'])}" if o["tags"] else "")
                        for o in compiled["options"]],
            "warnings": _skip_notes(compiled["skipped"]),
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
                                                registry=registry + new_tags)
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
        if not preview:
            raise ValueError("that changes nothing" + _skipped(skipped)
                             + (f" ({len(kept)} options are used by constraints)" if kept else ""))
        payload["options"] = [o for i, o in enumerate(rows) if i not in gone]
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

    def _rules(self, args: dict[str, Any], taken: set[str]) -> dict[str, Any]:
        compiled = ai_derivation.compile_rules(
            {"rules": args.get("rules") if isinstance(args.get("rules"), list) else []},
            catalog=self.catalog, taken_ids=taken,
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
            "preview": [ai_derivation.describe_rule(r) for r in payload["rules"]],
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
            "preview": [ai_derivation.describe_rule(x["rule"]) for x in compiled["rules"]],
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
        kind = "bundle" if r["id"] in self.bundles else "module"
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
        if kind == "module" and isinstance(args.get("category"), str) and args["category"]:
            cid, new_cat = self._category(args["category"])
            if (cid or new_cat) and cid != r.get("category_id"):
                body["category_id"], before["category_id"] = cid, r.get("category_id")
                preview.append(f"Category: {args['category'].strip()}"
                               + (" (new)" if new_cat else ""))
        rating = args.get("rating")
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
            "op": {"op": "open", "kind": "bundle" if kind == "bundle" else "module",
                   "type": kind, "id": r["id"]},
        }

    def run(self, tool: str, args: dict[str, Any]) -> str | dict[str, Any]:
        """A read tool's text, or a change tool's proposal (with `pid`, and
        `after` when it builds on an earlier proposal). Raises ValueError."""
        fn = getattr(self, tool, None)
        if tool not in TOOLS or fn is None:
            raise ValueError(f"unknown tool {tool}")
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
    return "Listed the library's variables"
