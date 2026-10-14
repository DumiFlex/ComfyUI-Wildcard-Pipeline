"""Every tool the chat can call. Adding a tool is one entry here plus its
method on `chat.Library` (named like the tool).

`line` is what JSON-mode models read; `summary` and `params` are what
native tool calling sends. `tests/engine/ai/test_ai_tools.py` checks that
the two name the same arguments.
"""
from __future__ import annotations

from engine.ai.chat_manage import CATEGORY_ICONS
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
_COND_OP = s("equals, not_equals, contains, not_contains, matches, not_matches, exists, "
              "not_exists, is_empty, is_not_empty, is_set (set and not empty) or is_unset "
              "(missing or empty)")
_RULE = obj({
    "summary": s("what the rule does, in a few words"),
    "branches": arr(obj({
        "match": s("all or any"),
        "conditions": arr(obj({
            "var": s("variable name; may read name.0, name.AXIS or name.neg"),
            "op": _COND_OP, "value": s(),
            "match": s("for a nested group: all or any"),
            "conditions": arr(obj({"var": s(), "op": _COND_OP, "value": s()}, ("var", "op")),
                              "a nested group's tests, instead of var/op/value"),
        })),
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
        "List every variable the library sets, with its options; or, for one variable, "
        "what sets it and what reads it.",
        '{} for every variable the library sets, with its options; {"var": name} for one '
        "variable: what sets it and every item that reads it (what breaks if it's renamed "
        "or removed).",
        obj({"var": s("one variable name")}),
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
        "List the tools this chat hasn't offered yet and make them available. Call it first "
        "whenever the job needs a tool you don't have (a combine, a bundle, a template…); "
        "never fake one item type with another's tool.",
        "{}: the tools not listed here (other module types), which you can call after. Call "
        "it whenever the job needs a tool you don't have; never fake one item type with "
        "another's tool.",
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
        "rewrite, retag, reweight, negatives, fallback, empty option, tag groups (make, "
        "rename, ungroup, switch kind), rename or drop tags.",
        '{"id": wildcard id, "remove": [option numbers], "rewrite": [{"n": number, "text"}], '
        '"retag": [{"n": number, "tags": [option tags]}], "weights": [{"n": number, '
        '"weight": 0-100}], "negatives": [{"n": number, "negative": text or ""}], '
        '"fallback": option number (0 for none), "null_weight": weight of the empty option '
        '(0 removes it), "axes": [{"name", "kind", "tags"}] to group existing tags (a tag '
        'moves out of its old group), "groups": [{"group", "rename", "kind": classify|accepts, '
        '"ungroup": true}] to change groups as they are, "rename_tags": [{"from", "to"}] '
        '(onto an existing tag merges), "drop_tags": [tags] to take off every option, "move": '
        '[{"n", "to"}] to reorder (original numbers), "var": new variable name it sets}: '
        "change options that exist. The numbers are the ones read shows. Leave out what you "
        "don't change.",
        obj({
            "id": s("wildcard id or name"), "remove": _NUMS,
            "rewrite": arr(obj({"n": n(integer=True), "text": s()}, ("n", "text"))),
            "retag": arr(obj({"n": n(integer=True), "tags": arr(s())}, ("n", "tags"))),
            "weights": arr(obj({"n": n(integer=True), "weight": n()}, ("n", "weight"))),
            "negatives": arr(obj({"n": n(integer=True), "negative": s()}, ("n", "negative"))),
            "fallback": n("option number, 0 for none", integer=True),
            "null_weight": n("weight of the empty option, 0 removes it"),
            "axes": arr(_AXIS),
            "groups": arr(obj({"group": s("tag group name"), "rename": s("new name"),
                               "kind": s("classify or accepts"),
                               "ungroup": b("send its tags back to loose tags")},
                              ("group",))),
            "rename_tags": arr(obj({"from": s("option tag"), "to": s("new tag")},
                                   ("from", "to"))),
            "drop_tags": arr(s("option tag")),
            "move": arr(obj({"n": n(integer=True), "to": n(integer=True)}, ("n", "to"))),
            "var": s("new variable name"),
        }, ("id",)),
        ("wildcards",),
    ),
    Tool(
        "create_derivation", "change",
        "Propose a new derivation: rules that set or change variables from others. Each "
        "rule runs on its own; its branches are IF, ELIF, ELIF… (the first whose test holds "
        "runs its actions) and else_actions is its ELSE. A branch's test is one condition or "
        "several joined by match all (AND) / any (OR), and a condition can itself be a "
        "nested group. A branch can run several actions in order. At most 20 rules, 12 "
        "branches a rule, 8 conditions a branch and 6 actions a branch: split bigger jobs, "
        "or use a constraint.",
        '{"name", "description", "tags", "category", "rules": [{"summary", "branches": '
        '[{"match": "all"|"any", "conditions": [{"var", "op": equals|not_equals|contains|'
        "not_contains|matches|not_matches|exists|not_exists|is_empty|is_not_empty|is_set|"
        "is_unset, "
        '"value"} or a '
        'nested group {"match", "conditions": [tests]}], "actions": [{"target_var", "mode": '
        'replace|append|prepend|negative|negative_replace, "value"}]}], "else_actions": '
        '[actions]}]}. var may read name.0, name.AXIS or name.neg. Branches are IF, ELIF…; '
        'else_actions is the ELSE. Example, "mage or warlock with a staff gets a robe, '
        'rogues get a cloak, else armor": {"branches": [{"match": "all", "conditions": '
        '[{"match": "any", "conditions": [{"var": "class", "op": "equals", "value": "mage"}, '
        '{"var": "class", "op": "equals", "value": "warlock"}]}, {"var": "weapon", "op": '
        '"contains", "value": "staff"}], "actions": [{"target_var": "outfit", "mode": '
        '"replace", "value": "robe"}]}, {"conditions": [{"var": "class", "op": "equals", '
        '"value": "rogue"}], "actions": [{"target_var": "outfit", "mode": "replace", '
        '"value": "cloak"}]}], "else_actions": [{"target_var": "outfit", "mode": '
        '"replace", "value": "armor"}]}.',
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
        "Propose changes to fixed values that exist: set, rename or remove variables.",
        '{"id", "set": [same as values; on a name that exists, a left-out value or negative '
        'stays as it is and "negative": "" clears it], "rename": [{"from", "to"}], "remove": '
        "[variable names]}",
        obj({"id": s("fixed values id or name"), "set": arr(obj({
            "name": s(), "value": s("left out on a name that exists: keep it"),
            "negative": s("left out: keep it; \"\": clear it")}, ("name",))),
            "rename": arr(obj({"from": s("variable name"), "to": s("new name")},
                              ("from", "to"))),
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
        "Propose a new template, negative or variable for a combine that exists.",
        '{"id", "template"?, "negative"?, "var"?: the variable it sets}',
        obj({"id": s("combine id or name"), "template": s(), "negative": s(),
             "var": s("new variable name")}, ("id",)),
        ("combines",),
    ),
    Tool(
        "create_template", "change",
        "Propose a prompt template for the WP Prompt Assembler (prompt and negative, "
        "reading variables).",
        '{"name", "description", "tags", "category", "template": the final prompt reading '
        '$variables only (no picks), "negative": standing negative with $negatives where '
        "the used variables' negatives go (always give one: lowres, watermark, … plus "
        "$negatives)}",
        obj({"name": s(), "description": _META["description"], "tags": _META["tags"],
             "category": _META["category"],
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
        "Propose replacing, moving or removing a derivation's rules by the numbers read "
        "shows (rules run top to bottom).",
        '{"id": derivation id, "replace": [{"n": rule number, "rule": a rule like in '
        'add_rules}], "move": [{"n": rule number, "to": its new place}], "remove": [rule '
        'numbers]}',
        obj({"id": s("derivation id or name"),
             "replace": arr(obj({"n": n(integer=True), "rule": _RULE}, ("n", "rule"))),
             "move": arr(obj({"n": n(integer=True), "to": n(integer=True)}, ("n", "to"))),
             "remove": _NUMS}, ("id",)),
        ("derivations",),
    ),
    Tool(
        "edit_constraint", "change",
        "Propose changes to a constraint that exists: add or replace rules, remove rules by "
        "number, change its reach, or point it at another source or target wildcard.",
        '{"id", "rules": [like create_constraint; a pair that exists is replaced], "remove": '
        '[rule numbers read shows], "reach": "all" | "first" | "next N" (which target '
        'wildcards after it it changes), "source_id" / "target_id": another wildcard (rules '
        "it can't match are dropped)}",
        obj({"id": s("constraint id or name"), "rules": arr(_CRULE), "remove": _NUMS,
             "reach": _REACH, "source_id": s("new source wildcard"),
             "target_id": s("new target wildcard")}, ("id",)),
        ("constraints",),
    ),
    Tool(
        "create_bundle", "change",
        "Propose a bundle: a saved stack of modules in order, each with per-use settings. "
        "A bundle can hold other bundles (sub-bundles, one level deep) to group a pack's "
        "parts, e.g. an Outfit sub-bundle and a Scene sub-bundle in one Character bundle.",
        '{"name", "description", "tags", "category", "items": [name or id (modules or '
        'sub-bundles), or {"item": name or id, "use": per-use settings}], "order": "auto" '
        '(default: producers, then constraints before their target, rules, combines; '
        'sub-bundles stay where given) or "as_given"}. A sub-bundle can\'t hold bundles '
        "itself, and a bundle inside another can't get sub-bundles.",
        obj({"name": s(), **_META, "items": arr(_ITEM),
             "order": s("auto (default) or as_given")}, ("name", "items")),
        ("bundles",),
    ),
    Tool(
        "edit_bundle", "change",
        "Propose changes to a bundle that exists: add or remove children (modules or "
        "sub-bundles), switch them off or on, change their use settings or order.",
        '{"id", "add": [like items], "remove": [numbers], "off": [numbers], "on": [numbers], '
        '"use": [{"n", "use"}], "order"?}. Numbers are the order read shows.',
        obj({"id": s("bundle id or name"), "add": arr(_ITEM), "remove": _NUMS,
             "off": _NUMS, "on": _NUMS,
             "use": arr(obj({"n": n(integer=True), "use": _USE}, ("n", "use"))),
             "order": s("auto or as_given")}, ("id",)),
        ("bundles",),
    ),
    Tool(
        "update_info", "change",
        "Propose a new name, description, tags, category or rating for any item.",
        '{"id", "name": new name or omit, "description": new text or omit, "tags_add": [], '
        '"tags_remove": [], "category": name, "none" to take it out of its category, or '
        'omit, "rating": "safe"|"nsfw" or omit}. For many items at once use update_many.',
        obj({"id": s("item id or name"), "name": s("new name"), "description": s(),
             "tags_add": arr(s()), "tags_remove": arr(s()),
             "category": s("category name, or none to remove it"),
             "rating": s("safe or nsfw")},
            ("id",)),
        ("core",),
    ),
    Tool(
        "edit_categories", "change",
        "Propose new categories, or renaming or recoloring categories that exist (name, "
        "color, icon).",
        '{"create": [name or {"name", "color", "icon"}], "rename": [{"from": name, "to": new '
        'name (optional), "color", "icon"}]}: makes, renames or restyles categories. Color: '
        "#rrggbb or a word like teal; icon: one of " + ", ".join(CATEGORY_ICONS) + ". Put "
        "items in a category with update_info or update_many.",
        obj({"create": arr(any_of(s("category name"), obj(
                {"name": s("category name"), "color": s("#rrggbb or a color word"),
                 "icon": s("icon name")}, ("name",)))),
             "rename": arr(obj({"from": s("category name"), "to": s("new name"),
                                "color": s("#rrggbb or a color word"),
                                "icon": s("icon name")}, ("from",)))}),
        ("lists",),
    ),
    Tool(
        "find_duplicates", "read",
        "List items that share a name (same type) or have the same content under "
        "different names, each marked identical or not.",
        '{"type"?: wildcard|fixed_values|combine|derivation|constraint|bundle|template}: '
        "sets of duplicates, to tidy the library.",
        obj({"type": s("only this type")}),
        ("lists",),
    ),
    Tool(
        "update_many", "change",
        "Propose one change to many items at once: move them into a category (or out of "
        "one), add or remove library tags, or set their rating.",
        '{"ids": [ids or names, up to 100], "category": name or "none", "tags_add": [], '
        '"tags_remove": [], "rating": "safe"|"nsfw"}: one card for all of them; give only '
        "what changes.",
        obj({"ids": arr(s("item id or name")),
             "category": s("category name, or none to remove it"),
             "tags_add": arr(s()), "tags_remove": arr(s()), "rating": s("safe or nsfw")},
            ("ids",)),
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
        "Set up the Test Runner with a stack (seeds, pinned variables) and run it, so the "
        "user sees the results; it can save it as a scenario.",
        '{"stack": [names or ids of modules and bundles], "seeds": how many runs (20), '
        '"from": first seed for a fixed run (random when left out), "pins": {"var": value '
        'set from outside}, "output": variable to show first, "save": scenario name to save '
        'it as, "run": false to only set it up}: opens the Test Runner with that set-up and '
        "runs it for the user to see. Use run_test to check something yourself.",
        obj({"stack": arr(s("name or id")), "seeds": n("how many runs", integer=True),
             "from": n("first seed (fixed seeds)", integer=True),
             "pins": obj(desc="variable -> value set from outside, like an Injector"),
             "output": s("variable to show first"), "save": s("save as a scenario named"),
             "run": b("false to set it up without running")},
            ("stack",)),
        ("test",),
    ),
    Tool(
        "use_panel", "client",
        "Open an item's editor and ask one of its AI panels, as if the user typed it there "
        "(Describe for name, description and tags; a wildcard's add / remove / rewrite / "
        "retag / reweight tabs; Draft with AI in the other editors). The user reviews the "
        "answer in the panel and applies it.",
        '{"id": item, "panel": "describe" | "add" | "remove" | "rewrite" | "retag" | '
        '"reweight" (wildcards) | "draft" (fixed values, combines, templates, derivations, '
        'constraints), "request": what to ask}: opens the item and asks that panel. Use it '
        "when the user asks for this on the page, or wants to look before anything changes; "
        "a wildcard edit works on the options the user selected, else all.",
        obj({"id": s("item id or name"),
             "panel": s("describe, add, remove, rewrite, retag, reweight or draft"),
             "request": s("what to ask the panel")}, ("id", "panel", "request")),
        ("wildcards", "text", "rules", "bundles"),
    ),
    Tool(
        "web_search", "web",
        "Search the web with the user's search engine. The user sees the query and allows "
        "it first; you get short result snippets. Use it on your own whenever facts would "
        "make the answer better, without being asked: a character, franchise, outfit, art "
        "style, artist, place or era you don't know well; which tags a model family (Pony, "
        "Illustrious, Flux) understands; a new model or LoRA. Search before you write the "
        "options, not after; asking costs the user one click, guessing costs a wrong pack.",
        '{"query": a short search, no private details}: searches the web with the user\'s '
        "own engine after the user allows the query; returns a few snippets with links. "
        "Call it yourself when references would help; don't wait to be asked.",
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
    "all": ("lists", "wildcards", "constraints", "derivations", "pack"),
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
DEFAULT_GROUPS = ("wildcards", "constraints", "derivations", "pack")


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


def sync_delete(names: list[str], allowed: bool, group: tuple[str, ...] = DELETE) -> list[str]:
    """A chat's tool list with the delete tools (or another ``group``)
    added or removed to match the setting now, in catalog order (unchanged
    when it already matches, so the cached prompt prefix stays)."""
    have = set(names)
    if allowed == have.issuperset(group) and (allowed or not have.intersection(group)):
        return names
    want = (have | set(group)) if allowed else (have - set(group))
    return [t.name for t in TOOLS if t.name in want]


def tools(names: list[str]) -> list[Tool]:
    """Registry entries for `names`, in catalog order; unknown names drop."""
    wanted = set(names)
    return [t for t in TOOLS if t.name in wanted]

