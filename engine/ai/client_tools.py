"""Tools that run in the user's browser, and web search, checked here first.

The model's call is turned into exactly what the browser should do: item
names become ids, pages come from fixed lists, text is cut to size. The
browser runs it (`src/manager/composables/useAiActions.ts`) and posts the
result back, and the turn goes on. The browser re-checks route names, but
nothing a model writes reaches the page without passing through here.

See `/pr-drafts/ai-client-tools.md`.
"""
from __future__ import annotations

from typing import Any

from engine.ai import docs as ai_docs
from engine.ai import safety

MAX_IDS = 200
MAX_ORGANIZE = 40
MAX_STACK = 40
MAX_QUERY = 200
#: Pages the model may send the user to (route names in the manager).
PAGES = ("dashboard", "all", "wildcards", "fixed-values", "combines", "derivations",
         "constraints", "bundles", "templates", "categories", "tags", "import-export", "test",
         "pack-builder", "settings", "whats-new", "community")
SETTINGS_SECTIONS = ("general", "appearance", "editing", "autocomplete", "canvas",
                     "test-runner", "ai", "library", "advanced")


def _text(value: Any, n: int) -> str:
    out = safety.strip_invisible(value).strip() if isinstance(value, str) else ""
    return " ".join(out.split())[:n]


def _row(lib: Any, raw: Any, what: str = "item") -> dict[str, Any]:
    row = lib.get(raw) if isinstance(raw, str) else None
    if row is None and isinstance(raw, str):
        row = lib._find(raw)
    if row is None or row.get("_proposed"):
        raise ValueError(f"no {what} {_text(raw, 40)!r}"
                         + (" (proposed items exist only once applied)"
                            if row is not None else ""))
    return row


def prepare(lib: Any, tool: str, args: dict[str, Any]) -> tuple[dict[str, Any], str]:
    """(the args the browser gets, a short label for the steps list).
    Raises ValueError with a message for the model."""
    fn = _PREPARE.get(tool)
    if fn is None:
        raise ValueError(f"unknown tool {tool}")
    return fn(lib, args)


def _open(lib: Any, args: dict[str, Any]) -> tuple[dict[str, Any], str]:
    if args.get("doc"):
        doc = ai_docs.page(args.get("doc"))
        if doc is None or doc["id"] == "settings":
            raise ValueError(f"no docs page {_text(args.get('doc'), 40)!r}")
        return {"doc": doc["id"]}, f"Opened the docs: {doc['title']}"
    if args.get("page") and not args.get("id"):
        name = _text(args.get("page"), 40).lower().strip("/ ")
        if name not in PAGES:
            raise ValueError(f"no manager page {name!r}; pages: {', '.join(PAGES)}")
        out: dict[str, Any] = {"page": name}
        label = f"Opened {name}"
        if name == "settings" and args.get("section"):
            section = _text(args.get("section"), 30).lower()
            if section not in SETTINGS_SECTIONS:
                raise ValueError(f"no settings section {section!r}; sections: "
                                 + ", ".join(SETTINGS_SECTIONS))
            out["section"] = section
            label += f" › {section}"
        return out, label
    row = _row(lib, args.get("id"))
    return ({"id": row["id"], "type": lib._kind(row)},
            f"Opened {row.get('name') or row['id']}")


def _read_page(lib: Any, args: dict[str, Any]) -> tuple[dict[str, Any], str]:
    return {}, "Read the page"


def _highlight(lib: Any, args: dict[str, Any]) -> tuple[dict[str, Any], str]:
    anchor = _text(args.get("anchor"), 80)
    if not anchor:
        raise ValueError("highlight needs an anchor from read_page")
    caption = _text(args.get("caption"), 160)
    return {"anchor": anchor, "caption": caption}, f"Pointed at {caption or anchor}"


def _ids(lib: Any, raw: Any, cap: int) -> list[dict[str, Any]]:
    if not isinstance(raw, list) or not raw:
        raise ValueError("give a list of item ids or names")
    rows: list[dict[str, Any]] = []
    missing: list[str] = []
    for value in raw[:cap]:
        try:
            row = _row(lib, value)
        except ValueError:
            missing.append(_text(value, 30))
            continue
        if all(r["id"] != row["id"] for r in rows):
            rows.append(row)
    if missing and not rows:
        raise ValueError("none of those items exist: " + ", ".join(missing[:8]))
    return rows


def _select_rows(lib: Any, args: dict[str, Any]) -> tuple[dict[str, Any], str]:
    rows = _ids(lib, args.get("ids"), MAX_IDS)
    return {"ids": [r["id"] for r in rows]}, f"Selected {len(rows)} row" + (
        "" if len(rows) == 1 else "s")


def _organize(lib: Any, args: dict[str, Any]) -> tuple[dict[str, Any], str]:
    rows = _ids(lib, args.get("ids"), MAX_ORGANIZE)
    return ({"ids": [r["id"] for r in rows], "note": _text(args.get("note"), 500)},
            f"Organize {len(rows)} item" + ("" if len(rows) == 1 else "s"))


def _draft_options(lib: Any, args: dict[str, Any]) -> tuple[dict[str, Any], str]:
    row = _row(lib, args.get("id"), "wildcard")
    if row.get("type") != "wildcard":
        raise ValueError(f"{row.get('name')} is a {lib._kind(row)}, not a wildcard")
    instruction = _text(args.get("instruction"), 1000)
    if len(instruction) < 3:
        raise ValueError("say what options to write")
    count = args.get("count") if isinstance(args.get("count"), int) else 10
    count = max(1, min(50, count))
    return ({"id": row["id"], "instruction": instruction, "count": count},
            f"Drafting {count} options for {row.get('name')}")


def _show_test(lib: Any, args: dict[str, Any]) -> tuple[dict[str, Any], str]:
    raw = args.get("stack")
    if not isinstance(raw, list) or not raw:
        raise ValueError("give the stack: names or ids of modules and bundles")
    stack: list[dict[str, str]] = []
    for value in raw[:MAX_STACK]:
        row = _row(lib, value)
        kind = lib._kind(row)
        if kind == "template":
            raise ValueError(f"{row.get('name')} is a template; the stack takes modules and "
                             "bundles")
        stack.append({"bundle": row["id"]} if kind == "bundle" else {"module": row["id"]})
    seeds = args.get("seeds") if isinstance(args.get("seeds"), int) else 20
    seeds = max(1, min(500, seeds))
    return {"stack": stack, "seeds": seeds}, f"Ran {len(stack)} item" + (
        "" if len(stack) == 1 else "s") + " in the Test Runner"


def _web_search(lib: Any, args: dict[str, Any]) -> tuple[dict[str, Any], str]:
    query = _text(args.get("query"), MAX_QUERY)
    if len(query) < 2:
        raise ValueError("web_search needs a query")
    return {"query": query}, f"Web search: {query}"


_PREPARE = {
    "open": _open, "read_page": _read_page, "highlight": _highlight,
    "select_rows": _select_rows, "organize": _organize, "draft_options": _draft_options,
    "show_test": _show_test, "web_search": _web_search,
}

#: Longest browser answer kept for the model.
MAX_RESULT = 4000


def result_text(tool: str, answer: dict[str, Any]) -> str:
    """What the model reads back for one paused call: the browser's text,
    or that the user declined or the page couldn't do it."""
    if answer.get("denied"):
        return f"{tool}: the user declined this"
    if answer.get("cancelled"):
        return f"{tool}: not run (the user moved on)"
    text = answer.get("text")
    if not isinstance(text, str) or not text.strip():
        return f"{tool}: done"
    text = safety.strip_invisible(text).strip()
    if len(text) > MAX_RESULT:
        text = text[:MAX_RESULT] + " …"
    return f"{tool}: {text}"
