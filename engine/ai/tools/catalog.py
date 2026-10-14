"""Every tool the chat can call. Adding a tool is one entry here plus its
method on `chat.Library` (named like the tool).

`line` is what JSON-mode models read; `summary` and `params` are what
native tool calling sends. `tests/engine/ai/test_ai_tools.py` checks that
the two name the same arguments.
"""
from __future__ import annotations

from engine.ai.tools.registry import Tool, any_of, arr, b, n, obj, s

_META = {
    "description": s("one or two sentences on what it is for"),
    "tags": arr(s(), "library tags"),
    "category": s("category name, or \"\" for none"),
}
_OPTION = obj({
    "text": s("the option text"), "weight": n("relative odds, default 1"),
    "tags": arr(s(), "option tags"), "negative": s("negative prompt text, or \"\""),
    "fallback": b("taken when nothing else is live"),
}, ("text",))
_AXIS = obj({"name": s(), "kind": s("classify or accepts"), "tags": arr(s())},
            ("name", "tags"))
_ACTION = obj({
    "target_var": s("variable to write, without $"),
    "mode": s("replace, append, prepend, negative or negative_replace"),
    "value": s(),
}, ("target_var", "value"))
_RULE = obj({
    "summary": s("what the rule does, in a few words"),
    "branches": arr(obj({
        "match": s("all or any"),
        "conditions": arr(obj({
            "var": s(), "op": s("equals, not_equals, contains, matches, exists, not_exists, "
                                "is_set, is_unset, is_empty or is_not_empty"),
            "value": s(),
        }, ("var", "op"))),
        "actions": arr(_ACTION),
    })),
    "else_actions": arr(_ACTION),
})
_CRULE = obj({
    "source": s("#tag or option text of the source wildcard"),
    "target": s("#tag or option text of the target wildcard"),
    "effect": s("exclude, reduce, boost or only"),
    "factor": n("for reduce and boost"), "reason": s(),
}, ("source", "target", "effect"))
_USE = obj(desc="per-use settings, see the guide")
_ITEM = any_of(s("name or id"), obj({"item": s("name or id"), "use": _USE}, ("item",)))
_NUMS = arr(n(integer=True), "numbers as read shows them")
_REACH = s("all, first or next N: which target wildcards after it it changes")

TOOLS: list[Tool] = [
    # ── read ─────────────────────────────────────────────────────────────
    Tool(
        "search", "read",
        "Find library items by what they are and what they hold (names, variables, tags, "
        "descriptions, option texts, values, rules), best match first.",
        '{"query": words, "type": optional module type, "bundle" or "template", "tag": '
        'optional tag}: items ranked by how well their name, variable, tags, description '
        'AND content (option texts, values, rules) match, with matching options as '
        'examples. Broad subjects widen on their own ("character" also finds hair, eyes, '
        'outfits). Search the subject, not the user\'s whole sentence. Empty query lists '
        'everything of that type.',
        obj({"query": s("the subject, a few words; empty lists everything of the type"),
             "type": s("wildcard, fixed_values, combine, derivation, constraint, bundle or "
                       "template"),
             "tag": s("only items with this tag")}),
        ("core",),
    ),
    Tool(
        "read", "read",
        "Read one item in full: numbered options with tags, negatives and groups, numbered "
        "rules, a bundle's children with their use settings.",
        '{"id": item id}: one item in full (numbered options with tags, negatives and '
        "groups, numbered rules, a bundle's children with their use settings, …).",
        obj({"id": s("item id or exact name")}, ("id",)),
        ("core",),
    ),
    Tool(
        "variables", "read",
        "List every variable the library sets, with its options.",
        "{}: every variable the library sets, with its options.",
        obj(),
        ("core",),
    ),
    Tool(
        "docs_search", "read",
        "Search the built-in Wildcard Pipeline docs; returns matching sections with a snippet.",
        '{"query": words}: the docs sections that match, with a snippet.',
        obj({"query": s()}, ("query",)),
        ("core",),
    ),
    Tool(
        "docs_read", "read",
        "Read a docs page, or one section of it.",
        '{"page": docs page id, "section": optional section title}: the page\'s text.',
        obj({"page": s("docs page id"), "section": s("section title")}, ("page",)),
        ("core",),
    ),
    Tool(
        "run_test", "read",
        "Run a stack of modules and bundles on the engine over many seeds: each variable's "
        "top values, options never picked, warnings and sample prompts. Use it to check a "
        "change, or to answer \"why do I never get X?\".",
        '{"stack": [names or ids of modules and bundles, or {"item", "use"} (or {"item", '
        '"instance"} as the Test Runner page gives it)], "pins": {"var": value set from '
        'outside, like an Injector}, "seeds": 100, "template": a template name or id for '
        'sample prompts, "proposed": true to run it with the changes you proposed in this '
        "answer (was → now)}: runs the stack on the engine and reports each variable's top "
        "values, options never picked, warnings with counts and sample prompts. Use it to "
        'check a change before or after proposing it, and to answer "why do I never get X?".',
        obj({
            "stack": arr(any_of(s("name or id"), obj({"item": s("name or id"), "use": _USE,
                                                      "instance": obj()}, ("item",))),
                         "modules and bundles, top to bottom"),
            "pins": obj(desc="variable -> value set from outside, like an Injector"),
            "seeds": n("how many seeds, default 100", integer=True),
            "template": s("template name or id for sample prompts"),
            "proposed": b("run with the changes proposed in this answer"),
        }, ("stack",)),
        ("core",),
    ),
    Tool(
        "more_tools", "read",
        "List the tools this chat hasn't offered yet and make them available.",
        "{}: the tools not listed here (other module types), which you can call after.",
        obj(),
        (),
    ),
    # ── change ───────────────────────────────────────────────────────────
    Tool(
        "create_wildcard", "change",
        "Propose a new wildcard: options picked one per run, bound to a $variable (or a "
        "vocabulary with no variable).",
        '{"name", "var": variable name without $ ("" for a vocabulary), "description", '
        '"tags": [library tags], "category": name or "", "options": [{"text", "weight": 1, '
        '"tags": [option tags], "negative": "", "fallback": false}], "axes": [{"name", '
        '"kind": "classify"|"accepts", "tags"}] or [], "null_weight": 0}',
        obj({"name": s(), "var": s("variable name without $, \"\" for a vocabulary"), **_META,
             "options": arr(_OPTION), "axes": arr(_AXIS, "tag groups"),
             "null_weight": n("weight of an empty option, 0 for none")},
            ("name", "options")),
        ("wildcards",),
    ),
    Tool(
        "add_options", "change",
        "Propose new options for a wildcard that exists.",
        '{"id": wildcard id, "options": [same as above], "axes"?}',
        obj({"id": s("wildcard id or name"), "options": arr(_OPTION),
             "axes": arr(_AXIS)}, ("id", "options")),
        ("wildcards",),
    ),
    Tool(
        "edit_options", "change",
        "Propose changes to a wildcard's existing options by the numbers read shows: remove, "
        "rewrite, retag, reweight, negatives, fallback, empty option, tag groups.",
        '{"id": wildcard id, "remove": [option numbers], "rewrite": [{"n": number, "text"}], '
        '"retag": [{"n": number, "tags": [option tags]}], "weights": [{"n": number, '
        '"weight": 0-100}], "negatives": [{"n": number, "negative": text or ""}], '
        '"fallback": option number (0 for none), "null_weight": weight of the empty option '
        '(0 removes it), "axes": [{"name", "kind", "tags"}] to group existing tags}: change '
        "options that exist. The numbers are the ones read shows. Leave out what you don't "
        "change.",
        obj({
            "id": s("wildcard id or name"), "remove": _NUMS,
            "rewrite": arr(obj({"n": n(integer=True), "text": s()}, ("n", "text"))),
            "retag": arr(obj({"n": n(integer=True), "tags": arr(s())}, ("n", "tags"))),
            "weights": arr(obj({"n": n(integer=True), "weight": n()}, ("n", "weight"))),
            "negatives": arr(obj({"n": n(integer=True), "negative": s()}, ("n", "negative"))),
            "fallback": n("option number, 0 for none", integer=True),
            "null_weight": n("weight of the empty option, 0 removes it"),
            "axes": arr(_AXIS),
        }, ("id",)),
        ("wildcards",),
    ),
    Tool(
        "create_derivation", "change",
        "Propose a new derivation: IF/ELSE rules that set or change variables from others.",
        '{"name", "description", "tags", "category", "rules": [{"summary", "branches": '
        '[{"match": "all"|"any", "conditions": [{"var", "op": equals|not_equals|contains|'
        "matches|exists|not_exists|is_set|is_unset|is_empty|is_not_empty, \"value\"}], "
        '"actions": [{"target_var", "mode": replace|append|prepend|negative|'
        'negative_replace, "value"}]}], "else_actions": [actions]}]}. There is no "not '
        'contains": test "contains" and act in else_actions.',
        obj({"name": s(), **_META, "rules": arr(_RULE)}, ("name", "rules")),
        ("derivations",),
    ),
    Tool(
        "add_rules", "change",
        "Propose new rules for a derivation that exists.",
        '{"id": derivation id, "rules": [same as above]}',
        obj({"id": s("derivation id or name"), "rules": arr(_RULE)}, ("id", "rules")),
        ("derivations",),
    ),
    Tool(
        "create_constraint", "change",
        "Propose a constraint: a SOURCE wildcard's pick changes the odds of a TARGET "
        "wildcard's options (exclude, reduce, boost, only).",
        '{"name", "description", "tags", "category", "source_id", "target_id", "rules": '
        '[{"source": "#tag" or option text, '
        '"target": "#tag" or option text, "effect": exclude|reduce|boost|only, "factor", '
        '"reason"}], "reach": "all" | "first" | "next N"}',
        obj({"name": s(), "source_id": s("source wildcard id or name"),
             "target_id": s("target wildcard id or name"), "rules": arr(_CRULE),
             "reach": _REACH, **_META},
            ("source_id", "target_id", "rules")),
        ("constraints",),
    ),
    Tool(
        "create_fixed_values", "change",
        "Propose fixed values: variables set to the same text every run.",
        '{"name", "description", "tags", "category", "values": [{"name": variable, "value": '
        'text (may use {a|b}, no $), "negative": ""}]}',
        obj({"name": s(), **_META, "values": arr(obj({
            "name": s("variable name"), "value": s("text, may use {a|b}"),
            "negative": s()}, ("name", "value")))}, ("name", "values")),
        ("fixed-values",),
    ),
    Tool(
        "edit_values", "change",
        "Propose changes to fixed values that exist: set or remove variables.",
        '{"id", "set": [same as values; a name that exists is replaced], "remove": [variable '
        "names]}",
        obj({"id": s("fixed values id or name"), "set": arr(obj({
            "name": s(), "value": s(), "negative": s()}, ("name", "value"))),
            "remove": arr(s("variable name"))}, ("id",)),
        ("fixed-values",),
    ),
    Tool(
        "create_combine", "change",
        "Propose a combine: a template that joins variables into a new one.",
        '{"name", "var": the variable it sets, "description", "tags", "category", '
        '"template": text reading $variables (may use {a|b}), "negative": ""}',
        obj({"name": s(), "var": s("the variable it sets"), **_META,
             "template": s("text reading $variables"), "negative": s()},
            ("name", "var", "template")),
        ("combines",),
    ),
    Tool(
        "edit_combine", "change",
        "Propose a new template or negative for a combine that exists.",
        '{"id", "template"?, "negative"?}',
        obj({"id": s("combine id or name"), "template": s(), "negative": s()}, ("id",)),
        ("combines",),
    ),
    Tool(
        "create_template", "change",
        "Propose a prompt template for the WP Prompt Assembler (prompt and negative, "
        "reading variables).",
        '{"name", "description", "tags", "template": the final prompt reading $variables '
        'only (no picks), "negative": standing negative with $negatives where the used '
        "variables' negatives go}",
        obj({"name": s(), "description": _META["description"], "tags": _META["tags"],
             "template": s("the prompt, reading $variables only"),
             "negative": s("standing negative; $negatives marks where variables' negatives "
                           "go")}, ("name", "template")),
        ("templates",),
    ),
    Tool(
        "edit_template", "change",
        "Propose a new prompt or negative for a template that exists.",
        '{"id", "template"?, "negative"?}',
        obj({"id": s("template id or name"), "template": s(), "negative": s()}, ("id",)),
        ("templates",),
    ),
    Tool(
        "edit_rules", "change",
        "Propose replacing or removing a derivation's rules by the numbers read shows.",
        '{"id": derivation id, "replace": [{"n": rule number, "rule": a rule like in '
        'add_rules}], "remove": [rule numbers]}',
        obj({"id": s("derivation id or name"),
             "replace": arr(obj({"n": n(integer=True), "rule": _RULE}, ("n", "rule"))),
             "remove": _NUMS}, ("id",)),
        ("derivations",),
    ),
    Tool(
        "edit_constraint", "change",
        "Propose changes to a constraint that exists: add or replace rules, remove rules by "
        "number, change its reach.",
        '{"id", "rules": [like create_constraint; a pair that exists is replaced], "remove": '
        '[rule numbers read shows], "reach": "all" | "first" | "next N" (which target '
        "wildcards after it it changes)}",
        obj({"id": s("constraint id or name"), "rules": arr(_CRULE), "remove": _NUMS,
             "reach": _REACH}, ("id",)),
        ("constraints",),
    ),
    Tool(
        "create_bundle", "change",
        "Propose a bundle: a saved stack of modules in order, each with per-use settings.",
        '{"name", "description", "tags", "category", "items": [name or id, or {"item": name or id, '
        '"use": per-use settings}], "order": "auto" (default: producers, then constraints '
        'before their target, rules, combines) or "as_given"}',
        obj({"name": s(), **_META, "items": arr(_ITEM),
             "order": s("auto (default) or as_given")}, ("name", "items")),
        ("bundles",),
    ),
    Tool(
        "edit_bundle", "change",
        "Propose changes to a bundle that exists: add or remove children, change their use "
        "settings or order.",
        '{"id", "add": [like items], "remove": [numbers], "use": [{"n", "use"}], "order"?}',
        obj({"id": s("bundle id or name"), "add": arr(_ITEM), "remove": _NUMS,
             "use": arr(obj({"n": n(integer=True), "use": _USE}, ("n", "use"))),
             "order": s("auto or as_given")}, ("id",)),
        ("bundles",),
    ),
    Tool(
        "update_info", "change",
        "Propose a new description, tags, category or rating for any item.",
        '{"id", "description": new text or omit, "tags_add": [], "tags_remove": [], '
        '"category": name or omit, "rating": "safe"|"nsfw" or omit}',
        obj({"id": s("item id or name"), "description": s(), "tags_add": arr(s()),
             "tags_remove": arr(s()), "category": s(), "rating": s("safe or nsfw")},
            ("id",)),
        ("core",),
    ),
    Tool(
        "edit_categories", "change",
        "Propose new categories, or renaming categories that exist.",
        '{"create": [category names], "rename": [{"from": name, "to": new name}]}: makes '
        "or renames categories. Put items in a category with update_info.",
        obj({"create": arr(s("category name")),
             "rename": arr(obj({"from": s("category name"), "to": s("new name")},
                               ("from", "to")))}),
        ("lists",),
    ),
    Tool(
        "edit_tags", "change",
        "Propose renaming library tags everywhere; renaming to a tag that exists merges them.",
        '{"rename": [{"from": tag, "to": new tag}]}: renames library tags on every item that '
        "has them; a \"to\" that exists merges the two. Add or remove a tag on one item with "
        "update_info.",
        obj({"rename": arr(obj({"from": s("library tag"), "to": s("new tag")},
                               ("from", "to")))}, ("rename",)),
        ("lists",),
    ),
    Tool(
        "delete_items", "change",
        "Propose deleting library items, categories or library tags. The user confirms on the "
        "card and can undo it.",
        '{"items": [names or ids], "categories": [names], "tags": [library tags]}: a card that '
        "deletes them once the user confirms it (Undo brings them back). Only for what the "
        "user asked to delete. Items keep working in saved workflows.",
        obj({"items": arr(s("item name or id")), "categories": arr(s("category name")),
             "tags": arr(s("library tag"))}),
        ("delete",),
    ),
    Tool(
        "plan_pack", "change",
        "Hand a pack description to the Pack builder, which plans, builds, tests and installs "
        "a whole pack. Use it for a new pack or a whole set of modules for one subject.",
        '{"description": what the pack makes, its parts and its rules, in the user\'s words '
        "plus what they answered}: a button that hands the description to the Pack builder, "
        "which plans, builds, tests and installs a whole pack (wildcards, rules, constraints, "
        "a template) on its own. Use it when the user wants a new pack or a whole set of "
        "modules for one subject; use the create tools for one or a few items.",
        obj({"description": s("what the pack makes, its parts and its rules")},
            ("description",)),
        ("pack",),
    ),
    Tool(
        "open", "client",
        "Go to an item's editor, a docs page or a manager page in the user's browser, or "
        "open a proposed new wildcard or derivation in an editor before it is applied.",
        '{"id"} for an item\'s editor, {"doc": docs page id} for a docs page, {"page": '
        'manager page, "section": settings section}, or {"proposal": pid} to open a '
        'proposal card (a new wildcard or derivation, or a change to an item) in its editor '
        'unsaved: takes the user there now.',
        obj({"id": s("item id or name"), "doc": s("docs page id"),
             "page": s("manager page"), "section": s("settings section"),
             "proposal": s("pid of a proposal card, like p3")}),
        ("core",),
    ),
    Tool(
        "read_page", "client",
        "List what the user's current page shows and the parts you can point at: sections, "
        "buttons, fields, images; with within, everything inside one part or section "
        "(paragraphs, list items, code, table rows).",
        '{"within": an anchor, optional}: what the user\'s page shows now, each part with an '
        "anchor for highlight: marked parts, sections (headings, with what they hold), "
        "buttons, fields and images. With within, every part inside that section or part, "
        "paragraphs, list items, code blocks and table rows included, with their text.",
        obj({"within": s("anchor of a section or part to list in full")}),
        ("core",),
    ),
    Tool(
        "highlight", "client",
        "Point at parts of the user's page: scroll to them and outline each with a short "
        "caption; text marks a quote inside the part (a sentence in a docs paragraph).",
        '{"anchor": an anchor from read_page, "caption": a few words, "text": optional exact '
        'quote inside that part to mark} or {"points": [up to 5 of those]}: scrolls to the '
        "parts and outlines them, numbered, with your captions. Call read_page first for "
        "anchors.",
        obj({"anchor": s("anchor from read_page"), "caption": s("a few words"),
             "text": s("exact words inside that part to mark"),
             "points": arr(obj({"anchor": s("anchor from read_page"),
                                "caption": s("a few words"),
                                "text": s("exact words inside that part to mark")},
                               ("anchor",)), "several parts at once, up to 5")}),
        ("core",),
    ),
    Tool(
        "select_rows", "client",
        "Select items in the list the user has open (a list page).",
        '{"ids": [ids or names]}: selects those rows in the list page the user has open.',
        obj({"ids": arr(s("item id or name"))}, ("ids",)),
        ("lists",),
    ),
    Tool(
        "organize", "client",
        "Open Organize for some items in the user's list: the assistant panel suggests "
        "categories, tags and ratings, and the user applies what they like.",
        '{"ids": [ids or names], "note": how to organize them, optional}: selects them in the '
        "list and runs Organize; the user reviews and applies the suggestions there.",
        obj({"ids": arr(s("item id or name")), "note": s("how to organize them")}, ("ids",)),
        ("lists",),
    ),
    Tool(
        "draft_options", "client",
        "Open a wildcard and draft new options with its AI panel; the user ticks the ones "
        "to add.",
        '{"id": wildcard, "instruction": what options to write, "count": how many (10)}: '
        "opens the wildcard and drafts options in its AI panel, where the user picks which "
        "to add. Use add_options instead when you know the exact options.",
        obj({"id": s("wildcard id or name"), "instruction": s("what options to write"),
             "count": n("how many, 1-50", integer=True)}, ("id", "instruction")),
        ("wildcards",),
    ),
    Tool(
        "show_test", "client",
        "Open the Test Runner with a stack and run it, so the user sees the results.",
        '{"stack": [names or ids of modules and bundles], "seeds": how many runs (20)}: opens '
        "the Test Runner with that stack and runs it for the user to see. Use run_test to "
        "check something yourself.",
        obj({"stack": arr(s("name or id")), "seeds": n("how many runs", integer=True)},
            ("stack",)),
        ("test",),
    ),
    Tool(
        "web_search", "web",
        "Search the web with the user's search engine. The user sees the query and allows "
        "it first; you get short result snippets.",
        '{"query": a short search, no private details}: searches the web with the user\'s '
        "own engine after the user allows the query; returns a few snippets with links.",
        obj({"query": s("a short search")}, ("query",)),
        ("web",),
    ),
]

BY_NAME: dict[str, Tool] = {t.name: t for t in TOOLS}
READ = tuple(t.name for t in TOOLS if t.kind == "read")
CHANGE = tuple(t.name for t in TOOLS if t.kind == "change")
#: Run in the browser, or need the user's OK: the turn pauses for them.
CLIENT = tuple(t.name for t in TOOLS if t.kind == "client")
WEB = tuple(t.name for t in TOOLS if t.kind == "web")

#: Groups a small model gets on each page, besides "core". Keys are route
#: names with their -new / -edit suffix removed.
PAGE_GROUPS: dict[str, tuple[str, ...]] = {
    "all": ("lists", "wildcards", "pack"),
    "wildcards": ("wildcards", "pack", "lists"),
    "fixed-values": ("fixed-values", "lists"),
    "combines": ("combines", "lists"),
    "derivations": ("derivations", "lists"),
    "constraints": ("constraints", "wildcards", "lists"),
    "bundles": ("bundles", "lists"),
    "templates": ("templates", "lists"),
    "test": ("wildcards", "derivations", "constraints", "test"),
    "pack-builder": ("pack", "wildcards"),
}
DEFAULT_GROUPS = ("wildcards", "pack")


#: Offered only while Settings › AI assistant › "Let the assistant delete
#: items" is on (`sync_delete`).
DELETE = tuple(t.name for t in TOOLS if "delete" in t.groups)


def toolset(route: str | None, *, scoped: bool, web: bool = False,
            delete: bool = False) -> list[str]:
    """Tool names a new chat offers. Unscoped (medium and large models):
    all of them. Scoped (small models): the core tools, the page's groups
    and `more_tools`, in catalog order so the list is stable. `web`: web
    search is set up (Settings › AI assistant), so `web_search` is offered.
    `delete`: deleting is allowed, so `delete_items` is offered."""
    if not scoped:
        return [t.name for t in TOOLS if t.name != "more_tools" and (web or t.kind != "web")
                and (delete or t.name not in DELETE)]
    key = str(route or "")
    for suffix in ("-new", "-edit"):
        if key.endswith(suffix):
            key = key[: -len(suffix)]
    groups = {"core", *PAGE_GROUPS.get(key, DEFAULT_GROUPS), *(("web",) if web else ()),
              *(("delete",) if delete else ())}
    names = [t.name for t in TOOLS if groups.intersection(t.groups)]
    return [*names, "more_tools"]


def sync_delete(names: list[str], allowed: bool) -> list[str]:
    """A chat's tool list with the delete tools added or removed to match
    the setting now, in catalog order (unchanged when it already matches,
    so the cached prompt prefix stays)."""
    have = set(names)
    if allowed == have.issuperset(DELETE) and (allowed or not have.intersection(DELETE)):
        return names
    want = (have | set(DELETE)) if allowed else (have - set(DELETE))
    return [t.name for t in TOOLS if t.name in want]


def tools(names: list[str]) -> list[Tool]:
    """Registry entries for `names`, in catalog order; unknown names drop."""
    wanted = set(names)
    return [t for t in TOOLS if t.name in wanted]

