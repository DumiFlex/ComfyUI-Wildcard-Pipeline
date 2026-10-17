"""Tools that run in the user's browser, and web search, checked here first.

The model's call is turned into exactly what the browser should do: item
names become ids, pages come from fixed lists, text is cut to size. The
browser runs it (`src/manager/composables/useAiActions.ts`) and posts the
result back, and the turn goes on. The browser re-checks route names, but
nothing a model writes reaches the page without passing through here.

See `/pr-drafts/ai-client-tools.md`.
"""
from __future__ import annotations

import re
from typing import Any

from engine.ai import ask as ai_ask
from engine.ai import docs as ai_docs
from engine.ai import safety

MAX_IDS = 200
MAX_ORGANIZE = 40
MAX_STACK = 40
MAX_QUERY = 200
#: Most parts one highlight call points at.
MAX_POINTS = 5
#: The AI panels each kind of editor has, for `use_panel`. "describe" is
#: the Identity card's (name, description, tags); the wildcard's tabs are
#: add / remove / rewrite / retag / reweight; "draft" is Draft with AI.
PANELS: dict[str, tuple[str, ...]] = {
    "wildcard": ("describe", "add", "remove", "rewrite", "retag", "reweight"),
    "fixed_values": ("describe", "draft"),
    "combine": ("describe", "draft"),
    "template": ("describe", "draft"),
    "derivation": ("describe", "draft"),
    "constraint": ("describe", "draft"),
    "bundle": ("describe",),
}
MAX_PIN_VALUE = 300

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
    if row is not None and row.get("_proposed"):
        raise ValueError(f"no {what} {_text(raw, 40)!r} (proposed items exist only once applied)")
    if row is None:
        finder = getattr(lib, "not_found", None)
        raise ValueError(finder(raw, what) if finder else f"no {what} {_text(raw, 40)!r}")
    return row


def prepare(lib: Any, tool: str, args: dict[str, Any]) -> tuple[dict[str, Any], str]:
    """(the args the browser gets, a short label for the steps list).
    Raises ValueError with a message for the model."""
    fn = _PREPARE.get(tool)
    if fn is None:
        raise ValueError(f"unknown tool {tool}")
    return fn(lib, args)


def _open(lib: Any, args: dict[str, Any]) -> tuple[dict[str, Any], str]:
    if not any(str(args.get(k) or "").strip() for k in ("doc", "page", "id", "proposal")):
        # The 9B opened "" after every proposal: its card is already shown.
        raise ValueError("open needs an item id, a page or a docs page; a card you just "
                         "proposed is already on screen, so don't open it")
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
        label = f"Opened the {name} list" if name in LIST_PAGES else f"Opened {name}"
        if name == "settings" and args.get("section"):
            section = _text(args.get("section"), 30).lower()
            if section not in SETTINGS_SECTIONS:
                raise ValueError(f"no settings section {section!r}; sections: "
                                 + ", ".join(SETTINGS_SECTIONS))
            out["section"] = section
            label += f" › {section}"
        return out, label
    raw = args.get("proposal") or args.get("id")
    mine = _this_answer(lib, raw)
    if mine:
        raise ValueError(f"card {mine} is from this answer and already on screen; the user "
                         "applies it or opens it from its card, so don't open it")
    pid = _proposal(lib, raw)
    if pid:
        title = str((lib.earlier_proposals.get(pid) or {}).get("title") or pid)
        return {"proposal": pid}, f"Opened {title} in an editor"
    try:
        row = _row(lib, raw)
    except ValueError:
        # A docs page id given as an item id (the 9B opened {"id":
        # "constraints"} for the constraints docs): open the doc.
        doc = ai_docs.page(raw) if isinstance(raw, str) and not args.get("proposal") else None
        if doc is None or doc["id"] == "settings":
            raise
        return {"doc": doc["id"]}, f"Opened the docs: {doc['title']}"
    return ({"id": row["id"], "type": lib._kind(row)},
            f"Opened {row.get('name') or row['id']}")


def _this_answer(lib: Any, raw: Any) -> str:
    """The pid of a card proposed earlier in this same answer that ``raw``
    names (its pid or the id it will get), else "": the browser shows it
    only once the answer ends, so there is nothing to open yet."""
    if not isinstance(raw, str) or not raw.strip():
        return ""
    key = raw.strip()
    earlier = getattr(lib, "earlier_proposals", {}) or {}
    if re.fullmatch(r"p\d+", key) and key not in earlier \
            and int(key[1:]) <= int(getattr(lib, "_next_pid", 0) or 0):
        return key
    made = getattr(lib, "_created", {}) or {}
    pid = made.get(key.split("#", 1)[0].strip())
    return pid if isinstance(pid, str) and pid not in earlier else ""


def _proposal(lib: Any, raw: Any) -> str:
    """The pid of a proposal the user hasn't applied yet that ``raw`` names
    (its pid, the id it will get, or words of its title), else ""."""
    if not isinstance(raw, str) or not raw.strip():
        return ""
    key = raw.strip()
    earlier = getattr(lib, "earlier_proposals", {}) or {}
    if key in earlier and earlier[key].get("status") not in ("applied", "replaced"):
        return key
    row = lib.get(key) or lib._find(key)
    if row is not None:
        return str(row.get("_proposed") or "")
    low = key.lower().lstrip("$")
    for pid, p in earlier.items():
        if p.get("status") not in ("applied", "replaced") and low in str(
                p.get("title") or "").lower():
            return pid
    return ""


def _read_page(lib: Any, args: dict[str, Any]) -> tuple[dict[str, Any], str]:
    within = _anchor(args.get("within"))
    if within:
        return {"within": within}, f"Read the page: {within}"
    return {}, "Read the page"


def _anchor(raw: Any) -> str:
    # read_page lists parts as "[key] label"; models copy the brackets.
    return _text(raw, 80).strip().strip("[]").strip()


def _point(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        raise ValueError("each point is {\"anchor\", \"caption\", \"text\"}")
    anchor = _anchor(raw.get("anchor"))
    if not anchor:
        raise ValueError("highlight needs an anchor from read_page")
    out = {"anchor": anchor, "caption": _text(raw.get("caption"), 160)}
    # A quote to mark inside the part; models often end it with an ellipsis.
    text = _text(raw.get("text"), 200).strip("…").strip().strip("\"'")
    if text:
        out["text"] = text
    return out


#: A highlight before any read_page on this page: its anchors are guesses.
READ_PAGE_FIRST = "call read_page first, then highlight an anchor it returned"


def _highlight(lib: Any, args: dict[str, Any]) -> tuple[dict[str, Any], str]:
    raw = args.get("points")
    if isinstance(raw, list) and raw:
        points = [_point(p) for p in raw[:MAX_POINTS]]
    else:
        points = [_point(args)]
    first = points[0]
    label = f"Pointed at {first['caption'] or first['anchor']}"
    if len(points) > 1:
        label += f" and {len(points) - 1} more"
    return {"points": points}, label


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
    change = _text(args.get("change"), 10).lower() or "replace"
    if change not in ("replace", "add", "remove"):
        raise ValueError("change is replace, add or remove")
    needs = getattr(lib, "with_needs", None)
    added: list[str] = []
    if needs is not None and change != "remove":
        ids, added = needs([x.get("module") or x.get("bundle") or "" for x in stack])
        stack = [{"bundle": i} if i in lib.bundles else {"module": i} for i in ids][:MAX_STACK]
    seeds = args.get("seeds") if isinstance(args.get("seeds"), int) else 20
    out: dict[str, Any] = {"stack": stack, "seeds": max(1, min(500, seeds))}
    if change != "replace":
        out["change"] = change
        if not isinstance(args.get("seeds"), int):
            out.pop("seeds")  # keep the open run's seeds
    if isinstance(args.get("from"), int) and not isinstance(args.get("from"), bool):
        out["from"] = max(0, args["from"])
    pins = args.get("pins")
    if isinstance(pins, dict) and pins:
        out["pins"] = {_text(str(k), 60).lstrip("$"): _text(v, MAX_PIN_VALUE)
                       for k, v in list(pins.items())[:30] if _text(str(k), 60).lstrip("$")}
    if args.get("output"):
        out["output"] = _text(args.get("output"), 60).lstrip("$")
    if args.get("save"):
        out["save"] = _text(args.get("save"), 80)
    run = args.get("run") is not False
    if not run:
        out["run"] = False
    n = len(stack)
    what = f"{n} item" + ("" if n == 1 else "s")
    label = (f"Ran {what} in the Test Runner" if run else f"Set up {what} in the Test Runner")
    if change == "add":
        label = f"Added {what} to the Test Runner" + (" and ran it" if run else "")
    elif change == "remove":
        label = f"Took {what} out of the Test Runner" + (" and ran it" if run else "")
    if out.get("save"):
        label += f", saved as {out['save']}"
    if added:
        out["notes"] = added
    return out, label


def _use_panel(lib: Any, args: dict[str, Any]) -> tuple[dict[str, Any], str]:
    row = _row(lib, args.get("id"))
    kind = lib._kind(row)
    panels = PANELS.get(kind, ())
    panel = _text(args.get("panel"), 20).lower()
    if panel not in panels:
        raise ValueError(f"a {kind.replace('_', ' ')} has no {panel or 'such'} panel; its "
                         "panels: " + ", ".join(panels))
    request = _text(args.get("request"), 1000)
    if len(request) < 3:
        raise ValueError("say what to ask the panel")
    name = row.get("name") or row["id"]
    what = {"describe": "Describe", "draft": "Draft with AI"}.get(panel, panel.capitalize())
    return ({"id": row["id"], "type": kind, "panel": panel, "request": request},
            f"Asked {what} in {name}")


def _web_search(lib: Any, args: dict[str, Any]) -> tuple[dict[str, Any], str]:
    query = _text(args.get("query"), MAX_QUERY)
    if len(query) < 2:
        raise ValueError("web_search needs a query")
    return {"query": query}, f"Web search: {query}"


def _same_url(a: str, b: str) -> bool:
    return a.rstrip("/").lower() == b.rstrip("/").lower()


def _read_result(lib: Any, args: dict[str, Any]) -> tuple[dict[str, Any], str]:
    url = _text(args.get("url"), 500).strip("<>[]() ")
    # Only links a search the user allowed in this chat returned.
    seen = list(getattr(lib, "web_urls", None) or [])
    hit = next((u for u in seen if _same_url(u, url)), None)
    if hit is None:
        raise ValueError("read_result only reads links from your web_search results in this "
                         "chat; search first, then pass one of their links exactly")
    short = hit.split("://", 1)[-1]
    return {"url": hit}, "Read page: " + (short if len(short) <= 80 else short[:79] + "…")


def _danbooru(lib: Any, args: dict[str, Any]) -> tuple[dict[str, Any], str]:
    tag = "_".join(_text(args.get("tag"), 120).lower().split())
    if len(tag) < 2 or "," in tag:
        raise ValueError("danbooru looks up one tag, e.g. {\"tag\": \"hatsune_miku\"}")
    return {"tag": tag}, f"Danbooru: {tag}"


def _ask(lib: Any, args: dict[str, Any]) -> tuple[dict[str, Any], str]:
    # The chat's settled answers ride on the library for the turn.
    return ai_ask.prepare(args, getattr(lib, "decisions", None))


_PREPARE = {
    "open": _open, "read_page": _read_page, "highlight": _highlight,
    "select_rows": _select_rows, "organize": _organize, "draft_options": _draft_options,
    "show_test": _show_test, "use_panel": _use_panel, "web_search": _web_search, "ask": _ask,
    "read_result": _read_result, "danbooru": _danbooru,
}

#: Longest browser answer kept for the model.
MAX_RESULT = 4000


#: Said after a page call that did nothing, so a small model doesn't tell
#: the user it worked (Nemotron said "I've highlighted the paragraph").
FAILED_NOTE = ("This call FAILED: nothing happened on the user's page. Don't say it worked; "
               "fix the call (read_page lists the parts) or tell the user it didn't work.")
#: Manager pages that list one kind of module; each has a docs page too.
LIST_PAGES = ("wildcards", "fixed-values", "combines", "derivations", "constraints", "bundles",
              "templates")


def failed(text: str) -> bool:
    """Whether a page call's result says it did nothing."""
    body = text.split(": ", 1)[1] if ": " in text else text
    return body.startswith("couldn't") or body.startswith("no part ")


def open_note(args: dict[str, Any]) -> str:
    """What the model is told after opening a list page, which it confuses
    with that module's docs page."""
    page = args.get("page")
    if page in LIST_PAGES:
        return (f" (the user's {page} list, not the docs: a docs page opens with "
                '{"doc": id})')
    return ""


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
