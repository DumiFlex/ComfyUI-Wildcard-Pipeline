"""Every tool the chat can call. Adding a tool is one entry here plus its
method on `chat.Library` (named like the tool).

`line` is what JSON-mode models read; `summary` and `params` are what
native tool calling sends. `tests/engine/ai/test_ai_tools.py` checks that
the two name the same arguments.
"""
from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import replace
from typing import Any

from engine.ai.chat_manage import CATEGORY_ICONS
from engine.ai.tools.registry import Tool, any_of, arr, b, n, obj, s

_META = {
    "description": s("one or two sentences on what it is for"),
    "tags": arr(s(), "library tags"),
    "category": s("category name, or \"\" for none"),
}
_OPTION = obj({
    "text": s("the option text; @{Name} puts in a pick from another wildcard, "
              "@{Name:tag} one of its options tagged tag"),
    "weight": n("relative odds, default 1"),
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
#: Text, or a bare number for a frame test ($iteration equals 1): under a
#: JSON grammar small models garble a digit inside a string ("}]}],").
_COND_VALUE = any_of(s(), n(integer=True), desc="text, or a number for $iteration")
_RULE = obj({
    "summary": s("what the rule does, in a few words"),
    "branches": arr(obj({
        "match": s("all or any"),
        "conditions": arr(obj({
            "var": s("variable name; may read name.0, name.AXIS or name.neg"),
            "op": _COND_OP, "value": _COND_VALUE,
            "match": s("for a nested group: all or any"),
            "conditions": arr(obj({"var": s(), "op": _COND_OP, "value": _COND_VALUE},
                                  ("var", "op")),
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

#: Groups `more_tools` can add one at a time, with what they hold (said in
#: its description, which stays the same for every chat).
MORE_GROUPS: dict[str, str] = {
    "wildcards": "create and edit wildcards, draft options",
    "derivations": "derivation rules",
    "constraints": "constraints",
    "fixed-values": "fixed values",
    "combines": "combines",
    "templates": "prompt templates",
    "bundles": "bundles",
    "lists": "tidying many items: organize, select rows, duplicates, many at once, tags, "
             "categories",
    "test": "show a run in the Test Runner",
    "pack": "the Pack builder",
    "web": "web search and reading result pages, when the user set it up",
    "danbooru": "Danbooru tag lookup, when the user turned it on",
}

TOOLS: list[Tool] = [
    # ── read ─────────────────────────────────────────────────────────────
    Tool(
        "search", "read",
        "Find library items by what they are and what they hold (names, variables, tags, "
        "descriptions, option texts, values, rules), best match first.",
        '{"query": words, "type": optional module type, "bundle" or "template", "tag": '
        'optional tag, "category": optional category name, or "none" for items with no '
        'category}: items ranked by how well their name, variable, tags, description '
        'AND content (option texts, values, rules) match, with matching options as '
        'examples. Broad subjects widen on their own ("character" also finds hair, eyes, '
        'outfits). Search the subject, not the user\'s whole sentence. Empty query lists '
        'everything of that type or category (a category listing goes up to 100).',
        obj({"query": s("the subject, a few words; empty lists everything of the type"),
             "type": s("wildcard, fixed_values, combine, derivation, constraint, bundle or "
                       "template"),
             "tag": s("only items with this tag"),
             "category": s("only items in this category; none for items with no category")}),
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
        "explain", "read",
        "Answer a how-to question from the built-in docs in one call: the best section's "
        "text, with pointers to related sections.",
        '{"topic": a few words}: the docs section that best covers it, in full, plus related '
        "sections to read next. One call instead of docs_search then docs_read.",
        obj({"topic": s("what to explain, a few words")}, ("topic",)),
        ("core",),
    ),
    Tool(
        "react", "read",
        "Put one emoji on the user's message, like a chat reaction: for thanks, praise or "
        "good news. With nothing else to say, react and write no reply.",
        '{"emoji": one of 👍 ❤️ 🎉 😄 🙏 👀}: shows that emoji on the user\'s message. For '
        "thanks or praise, react and leave your message empty; never react instead of "
        "answering a question or a request.",
        obj({"emoji": s("one of 👍 ❤️ 🎉 😄 🙏 👀", enum=["👍", "❤️", "🎉", "😄", "🙏", "👀"])},
            ("emoji",)),
        ("core",),
    ),
    Tool(
        "lookup", "read",
        "Look up the user's own vocabulary: Danbooru tags from their tag list (with post "
        "counts), or their LoRA and embedding files. Check tags before writing tag-style "
        "options, and name real LoRAs instead of guessing.",
        '{"kind": "tags", "loras" or "embeddings", "query": a start of a name, or for tags '
        'several tags joined by ", " to check each}: tags list the most used ones that '
        "start with the query (or say which of yours aren't real tags); loras / embeddings "
        "list the user's files that match.",
        obj({"kind": s("tags, loras or embeddings"),
             "query": s("a word or start of a name; for tags, several tags joined by "
                        "\", \" checks each one")}, ("kind", "query")),
        ("vocab",),
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
        "Make more tools available: one group, or every tool this chat hasn't offered yet. "
        "Call it first whenever the job needs a tool you don't have (a combine, a bundle, "
        "web search…); never fake one item type with another's tool. Groups: "
        + "; ".join(f"{k} ({v})" for k, v in MORE_GROUPS.items()) + ".",
        '{"group": one of ' + ", ".join(MORE_GROUPS) + ', or leave it out for every '
        "tool}: makes those tools available (listed in the result) so you can call them "
        "next. Call it whenever the job needs a tool you don't have; never fake one item "
        "type with another's tool.",
        obj({"group": s("one group; leave out for every tool", enum=list(MORE_GROUPS))}),
        (),
    ),
    # ── change ───────────────────────────────────────────────────────────
    Tool(
        "create_wildcard", "change",
        "Propose a new wildcard: options picked one per run, bound to a $variable (or a "
        "vocabulary with no variable, only when other options point at it with @{Name}). "
        "Options that point at other wildcards carry their @{Name} here, in the same card.",
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
        '{"id"} for an item\'s editor, {"doc": docs page id} for a docs page (the docs '
        'about constraints are a doc, not the constraints page), {"page": manager page, '
        '"section": settings section}, or {"proposal": pid} to open a '
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
        '{"stack": [names or ids of modules and bundles], "change": "replace" (the default: '
        'a new stack), "add" (put these after what is there) or "remove" (take these out of '
        'the stack that is open), "seeds": how many runs (20), '
        '"from": first seed for a fixed run (random when left out), "pins": {"var": value '
        'set from outside}, "output": variable to show first, "save": scenario name to save '
        'it as, "run": false to only set it up}: opens the Test Runner with that set-up and '
        "runs it for the user to see. The stack runs in order: put what sets a variable "
        "before what reads it; a constraint gets its source and target wildcards added. Use "
        "run_test to check something yourself.",
        obj({"stack": arr(s("name or id")),
             "change": s("replace, add or remove", enum=["replace", "add", "remove"]),
             "seeds": n("how many runs", integer=True),
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
        "ask", "ask",
        "Ask the user up to 4 short questions with answers they click, only when the answer "
        "changes what you will build and you can't read it from the library or the page. "
        "Never ask permission, and never ask again what the user already answered.",
        '{"questions": [{"header": 1-3 words, "question": text, "choices": ["Label", '
        '"Label: hint", 2-5 of them], "multi": true if several apply}]}: shows the questions '
        "with clickable answers and waits. Last call in its step, never with change tools.",
        obj({"questions": arr(obj({
            "header": s("1-3 words, e.g. Style"),
            "question": s("one sentence"),
            "choices": arr(any_of(s("a label, or 'Label: hint'"),
                                  obj({"label": s(), "hint": s("one line")}, ("label",))),
                           "2 to 5 answers, most likely first"),
            "multi": b("several answers may apply"),
        }), "1 to 4 questions")}, ("questions",)),
        ("core",),
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
    Tool(
        "read_result", "web",
        "Read the text of one page from your web search results when its snippet isn't "
        "enough (a character's outfit, a model's recommended tags). The user allows it "
        "first; you get the page's text, cut to a few thousand characters.",
        '{"url": a link from your web_search results in this chat}: reads that page\'s '
        "text after the user allows it. Only links your searches returned.",
        obj({"url": s("a result link from web_search")}, ("url",)),
        ("web",),
    ),
    Tool(
        "danbooru", "web",
        "Look one tag up on Danbooru: post count, category, alias, what it implies, its "
        "wiki text and the tags used with it most. Use it to learn what a tag means or "
        "which tags go with a character or outfit; for spellings, lookup is enough.",
        '{"tag": one Danbooru tag, e.g. "hatsune_miku"}: the user allows it first; returns '
        "the tag's wiki excerpt, aliases, implications and related tags.",
        obj({"tag": s("one tag")}, ("tag",)),
        ("danbooru",),
    ),
]

#: When to pick each easily confused tool, the look-alike to pick when not,
#: and one sample call (research note "Small model tool use", T4: a small
#: model picks better from use-when lines and examples than from the
#: schema, which a grammar never shows it).
_GUIDE: dict[str, tuple[str, dict[str, Any] | None]] = {
    "search": ("you need to find items by subject; not for an item you already know by name "
               "or id (read it).", {"query": "hair color", "type": "wildcard"}),
    "read": ("you need an item's options or rules before you change or explain it; not to "
             "find items (search).", {"id": "Weather"}),
    "variables": ("you need which variables exist, or what sets and reads one; not for an "
                  "item's content (read).", {"var": "hair_color"}),
    "docs_search": ("the user asks how the app, a setting or a feature works; then docs_read "
                    "the best hit. Not for the user's own items (search).",
                    {"query": "constraint reach"}),
    "docs_read": ("docs_search found the page; link it in your answer as Docs › page › "
                  "section.", {"page": "constraints", "section": "Target reach"}),
    "explain": ("the user asks how a feature, a setting or a node works; one call gives the "
                "section to answer from. Not for the user's own items (search, read).",
                {"topic": "constraint reach"}),
    "react": ("thanks, praise or good news; never instead of answering.", {"emoji": "👍"}),
    "run_test": ("you check a change you proposed (proposed: true) or find why something "
                 "never shows; not to show the user the Test Runner (show_test).",
                 {"stack": ["Season", "Weather"], "proposed": True}),
    "more_tools": ("the job needs a tool you don't have; never fake one item type with "
                   "another's tool.", {"group": "templates"}),
    "create_wildcard": ("a new list of options picked one per run; not new options for a "
                        "wildcard that exists (add_options), text that never changes "
                        "(create_fixed_values) or variables joined (create_combine).",
                        {"name": "Weather", "var": "weather",
                         "options": [{"text": "light rain"}, {"text": "clear sky", "weight": 2}]}),
    "add_options": ("new options for a wildcard that exists; not to change its options "
                    "(edit_options).", {"id": "Weather", "options": [{"text": "thick fog"}]}),
    "edit_options": ("you change, remove, retag or reweight options a wildcard has, by the "
                     "numbers read shows; read it first.",
                     {"id": "Weather", "weights": [{"n": 2, "weight": 5}], "remove": [4]}),
    "create_derivation": ("a variable is set or changed from others with IF / ELSE; not to "
                          "change a wildcard's odds (create_constraint).",
                          {"name": "Rain gear", "rules": [{
                              "summary": "an umbrella when it rains",
                              "branches": [{"conditions": [{"var": "weather", "op": "contains",
                                                            "value": "rain"}],
                                            "actions": [{"target_var": "props", "mode": "append",
                                                         "value": "umbrella"}]}]}]}),
    "add_rules": ("new rules for a derivation that exists; to change its rules use "
                  "edit_rules.", None),
    "edit_rules": ("you change, move or remove a derivation's rules by the numbers read "
                   "shows; new rules go in add_rules.",
                   {"id": "Rain gear", "remove": [2]}),
    "create_constraint": ("one wildcard's pick should rule out, lower, raise or limit "
                          "another's options; not to set a variable (create_derivation).",
                          {"name": "No snow in summer", "source_id": "Season",
                           "target_id": "Weather", "rules": [
                               {"source": "summer", "target": "snow", "effect": "exclude"}]}),
    "create_fixed_values": ("variables that are the same text every run (quality tags, a "
                            "style line); not a list to pick from (create_wildcard).",
                            {"name": "Quality", "values": [
                                {"name": "quality", "value": "masterpiece, best quality"}]}),
    "create_combine": ("one variable built from others ($top, $shoes); not text that never "
                       "changes (create_fixed_values).",
                       {"name": "Outfit line", "var": "outfit",
                        "template": "$top, $bottom, $shoes"}),
    "create_template": ("the final prompt the Prompt Assembler writes from variables.", None),
    "update_info": ("you rename, describe, tag, file or rate ONE item; many items: "
                    "update_many; option tags: edit_options.",
                    {"id": "Weather", "tags_add": ["scene"]}),
    "update_many": ("one change (category, tags, rating) to many items at once.", None),
    "plan_pack": ("a whole pack or a set of modules for one subject; one to a few items: "
                  "the create tools.", None),
    "open": ("the user asks to go to an item, a docs page or a settings page; never to answer "
             "a question or to give a link (write the link in your answer).",
             {"doc": "constraints"}),
    "read_page": ("the user asks about what is on their screen, or before highlight; not for "
                  "library items (read).", {}),
    "highlight": ("the user asks where something is on their page; read_page first for its "
                  "anchors.", {"anchor": "s2", "caption": "Target reach"}),
    "draft_options": ("the user wants option ideas to pick from; when you know the options, "
                      "add_options.", None),
    "show_test": ("the user wants to see a run on the Test Runner page; to check results "
                  "yourself, run_test.", {"stack": ["Weather"], "seeds": 20}),
    "use_panel": ("the user asks for an editor's AI panel, or wants to look before anything "
                  "changes; otherwise propose with the change tools.", None),
    "ask": ("the answer changes what you build and you can't read it anywhere; never for "
            "permission.", None),
}
TOOLS = [replace(t, when=_GUIDE[t.name][0], example=_GUIDE[t.name][1])
         if t.name in _GUIDE else t for t in TOOLS]

BY_NAME: dict[str, Tool] = {t.name: t for t in TOOLS}
READ = tuple(t.name for t in TOOLS if t.kind == "read")
CHANGE = tuple(t.name for t in TOOLS if t.kind == "change")
#: Run in the browser, or need the user's OK: the turn pauses for them.
CLIENT = tuple(t.name for t in TOOLS if t.kind == "client")
WEB = tuple(t.name for t in TOOLS if t.kind == "web")
ASK = tuple(t.name for t in TOOLS if t.kind == "ask")

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
    "categories": ("lists",),
    "tags": ("lists",),
}
#: Words in the user's message that load a tool group a scoped chat lacks
#: (`groups_for`): the 9B called more_tools once in 69 turns of the
#: all-tools eval and faked fixed values, templates and bundles with
#: create_wildcard, and retags with edit_options.
ASK_GROUPS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("fixed-values", re.compile(r"\bfixed[ -]?values?\b|\bpresets?\b|\bquality tags?\b")),
    ("combines", re.compile(r"\bcombines?\b")),
    ("templates", re.compile(r"\btemplates?\b")),
    ("bundles", re.compile(r"\bbundles?\b")),
    ("derivations", re.compile(r"\bderivations?\b|\brules?\b")),
    ("constraints", re.compile(r"\bconstraints?\b|\bnever (?:go|goes|gets?|pairs?)\b")),
    ("wildcards", re.compile(r"\bwildcards?\b|\bweights?\b|\brarer\b|\bmore often\b"
                             r"|\boptions?\b")),
    ("lists", re.compile(r"\b(?:re)?tag(?:s|ged|ging)?\b|\bcategor(?:y|ies)\b|\brename\b"
                         r"|\bduplicates?\b|\brating\b|\borgani[sz]e\b|\btidy\b"
                         r"|\bclean ?up\b|\bnsfw\b|\bsfw\b")),
    ("test", re.compile(r"\btest(?:s|ing)?\b|\btest runner\b")),
)


def groups_for(text: str) -> list[str]:
    """The tool groups a user's message asks for by its words."""
    low = (text or "").lower()
    return [g for g, pat in ASK_GROUPS if pat.search(low)]


DEFAULT_GROUPS = ("wildcards", "constraints", "derivations", "pack")
#: What a medium model gets on every page besides the page's own groups:
#: the item types most asks touch and tests. Bundles, templates, combines,
#: fixed values and the list tools stay one more_tools call away off their
#: own pages.
WIDE_GROUPS = ("wildcards", "constraints", "derivations", "pack", "test")
#: Groups a scoped chat never declares up front, even when switched on: a
#: rare ask loads them with more_tools (`more`), so their declarations don't
#: cost every request.
LAZY_GROUPS = ("web", "danbooru")


#: Offered only while Settings › AI assistant › "Let the assistant delete
#: items" is on (`sync_delete`).
DELETE = tuple(t.name for t in TOOLS if "delete" in t.groups)
#: Offered only while a LoRA, embedding or tag autocomplete source is on
#: and has data (`engine/ai/vocab.py`).
VOCAB = tuple(t.name for t in TOOLS if "vocab" in t.groups)
#: Offered while web search is set up (web_search; read_result also needs
#: a page reader) and while the Danbooru lookup is on.
WEB_SEARCH = ("web_search",)
READER = ("read_result",)
DANBOORU = tuple(t.name for t in TOOLS if "danbooru" in t.groups)


def web_allowed(name: str, *, web: bool, reader: bool, danbooru: bool) -> bool:
    """Whether a kind "web" tool is offered with these settings."""
    if name in READER:
        return web and reader
    if name in DANBOORU:
        return danbooru
    return web


def toolset(route: str | None, *, scoped: bool, web: bool = False,
            delete: bool = False, vocab: bool = False, reader: bool = False,
            danbooru: bool = False, wide: bool = False) -> list[str]:
    """Tool names a new chat offers. Unscoped (large models): all of them.
    Scoped (small and medium models): the core tools, the page's groups
    and `more_tools`, in catalog order so the list is stable; `wide`
    (medium) adds the common groups (`WIDE_GROUPS`) on every page; web and
    Danbooru tools are never declared up front (`LAZY_GROUPS`). `web`: web
    search is set up (Settings › AI assistant), so `web_search` is offered
    (unscoped; scoped chats load it with more_tools).
    `delete`: deleting is allowed, so `delete_items` is offered. `vocab`: a
    lookup source is on, so `lookup` is offered. `reader`: a page reader is
    set (with `web`, `read_result`); `danbooru`: the Danbooru lookup is on."""
    def on(t: Tool) -> bool:
        return t.kind != "web" or web_allowed(t.name, web=web, reader=reader,
                                              danbooru=danbooru)
    if not scoped:
        return [t.name for t in TOOLS if t.name != "more_tools" and on(t)
                and (delete or t.name not in DELETE) and (vocab or t.name not in VOCAB)]
    key = str(route or "")
    for suffix in ("-new", "-edit"):
        if key.endswith(suffix):
            key = key[: -len(suffix)]
    # Web and Danbooru stay lazy (`LAZY_GROUPS`): one more_tools call away.
    groups = {"core", *PAGE_GROUPS.get(key, DEFAULT_GROUPS), *(WIDE_GROUPS if wide else ()),
              *(("delete",) if delete else ()), *(("vocab",) if vocab else ())}
    names = [t.name for t in TOOLS if groups.intersection(t.groups) and on(t)]
    return [*names, "more_tools"]


def more(names: list[str], group: str | None, allowed: Callable[[Tool], bool]) -> \
        tuple[list[str], list[Tool]]:
    """`more_tools`: the chat's tool list with one group (or, with no
    group, every tool) that `allowed` lets in added AT THE END, so the
    declarations already sent keep their place and the cached prefix stays.
    Returns the new list and the tools it added."""
    if group is not None and group not in MORE_GROUPS:
        raise ValueError("no group " + repr(str(group)[:30]) + "; groups: "
                         + ", ".join(MORE_GROUPS))
    have = set(names)
    added = [t for t in TOOLS if t.name not in have and t.name != "more_tools"
             and (group is None or group in t.groups) and allowed(t)]
    return [*names, *(t.name for t in added)], added


def sync_delete(names: list[str], allowed: bool, group: tuple[str, ...] = DELETE) -> list[str]:
    """A chat's tool list with the delete tools (or another ``group``)
    added at the end or removed to match the setting now (unchanged when it
    already matches, so the cached prompt prefix stays)."""
    have = set(names)
    if allowed == have.issuperset(group) and (allowed or not have.intersection(group)):
        return names
    if not allowed:
        return [n for n in names if n not in group]
    return [*names, *(t.name for t in TOOLS if t.name in group and t.name not in have)]


#: Always on a shortlist: finding and reading, the docs, a reaction, a
#: test, a question, and the way to every other tool.
SHORTLIST_CORE = ("search", "read", "variables", "explain", "docs_search", "docs_read", "react",
                  "run_test", "ask", "more_tools")
#: Words that put the page tools on a shortlist.
_PAGE_WORDS = re.compile(r"\b(?:page|screen|where|open|go to|take me|show me|point|highlight"
                         r"|button|field|section|this|here|link)\b", re.I)
_INFO_WORDS = re.compile(r"\b(?:rename|describ\w*|description|name it|call it)\b", re.I)
_WORD = re.compile(r"[a-z]{4,}")


def _stems(text: str) -> set[str]:
    return {w.rstrip("s") for w in _WORD.findall(text.lower())}


def shortlist(names: list[str], text: str, route: str | None = None,
              extra: int = 3) -> list[str] | None:
    """The tools one message's steps offer a small model (research note
    "Small model tool use", T2): the core reads, the groups the message
    names (else the page's main group), the page tools when it talks about
    the page, and the `extra` tools whose names and use-when lines share
    the most words with it. The prompt still lists all of the chat's
    tools, and `more_tools` (always offered) opens the rest for the turn,
    so a miss costs one step. None when it would offer everything anyway."""
    if not text:
        return None
    key = str(route or "")
    for suffix in ("-new", "-edit"):
        if key.endswith(suffix):
            key = key[: -len(suffix)]
    groups = set(groups_for(text) or PAGE_GROUPS.get(key, DEFAULT_GROUPS)[:1])
    want = set(SHORTLIST_CORE)
    if _PAGE_WORDS.search(text):
        want |= {"open", "read_page", "highlight"}
    if _INFO_WORDS.search(text) or "lists" in groups:
        want.add("update_info")
    if re.search(r"\bpacks?\b", text, re.I):
        want.add("plan_pack")  # the turn steers a pack ask to it (`PACK_FIRST`)
    have = tools(names)
    want |= {t.name for t in have if groups.intersection(t.groups)}
    words = _stems(text)
    scored = sorted(
        ((3 * len(words & _stems(t.name.replace("_", " ")))
          + len(words & _stems(t.when or t.summary)), i, t.name)
         for i, t in enumerate(have) if t.name not in want), reverse=True)
    want |= {n for score, _, n in scored[:extra] if score >= 2}
    out = [n for n in names if n in want]
    return None if len(out) >= len(names) else out


def tools(names: list[str]) -> list[Tool]:
    """Registry entries for `names`, in the order given (a chat's list is in
    catalog order with later additions at the end); unknown names drop."""
    return [BY_NAME[n] for n in dict.fromkeys(names) if n in BY_NAME]
