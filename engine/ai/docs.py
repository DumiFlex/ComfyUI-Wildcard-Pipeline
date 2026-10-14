"""The built-in docs as plain text, for the chat to search and quote.

`docs_index.json` is rendered from the manager's docs pages (plus the
Settings page's entries) by `src/manager/docs/__tests__/docs-index.test.ts`;
`pnpm docs:index` regenerates it and the test fails when it is stale.
"""
from __future__ import annotations

import json
import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

INDEX_PATH = Path(__file__).with_name("docs_index.json")
MAX_HITS = 6
MAX_READ = 7000
SNIPPET = 220
_WORD = re.compile(r"[a-z0-9_$#@]+")
_STOP = frozenset(
    "a an and are as at be by can do does for from how i in is it my of on or "
    "the this to what when where which who why with you your".split()
)


@lru_cache(maxsize=1)
def pages() -> list[dict[str, Any]]:
    try:
        data = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    out = [p for p in data.get("pages") or [] if isinstance(p, dict) and p.get("id")]
    return [*out, abilities()]


#: Jobs the assistant's tools are listed under, by tool group, in order.
_JOBS: tuple[tuple[str, str], ...] = (
    ("core", "Reading the library and the docs"),
    ("wildcards", "Wildcards"),
    ("fixed-values", "Fixed values"),
    ("combines", "Combines"),
    ("derivations", "Derivations"),
    ("constraints", "Constraints"),
    ("bundles", "Bundles"),
    ("templates", "Templates"),
    ("lists", "Organizing the library"),
    ("pack", "Packs"),
    ("test", "Testing"),
    ("delete", "Deleting (only while Settings allows it)"),
    ("web", "Web search (only when set up; each search asks first)"),
)


def abilities() -> dict[str, Any]:
    """A docs page written from the tool catalog itself: what the assistant
    can do, by job, and how its answers look. It can't drift from the tools
    the assistant really has."""
    from engine.ai.tools import catalog  # the catalog imports chat modules

    seen: set[str] = set()
    lines: list[str] = []
    for group, title in _JOBS:
        tools = [t for t in catalog.TOOLS if group in t.groups and t.name not in seen
                 and t.name != "more_tools"]
        if group == "core":
            tools = [t for t in tools if t.kind in ("read", "client", "ask")]
        if not tools:
            continue
        seen.update(t.name for t in tools)
        lines.append(f"{title}:\n" + "\n".join(f"- {t.name}: {t.summary}" for t in tools))
    rest = [t for t in catalog.TOOLS if t.name not in seen and t.name != "more_tools"]
    if rest:
        lines.append("Also:\n" + "\n".join(f"- {t.name}: {t.summary}" for t in rest))
    return {
        "id": "assistant-tools",
        "title": "What the assistant can do",
        "blurb": "Every tool the AI assistant has, by job, and how its answers look.",
        "sections": [
            {"title": "Tools by job", "text": "\n\n".join(lines)},
            {"title": "How changes work", "text": (
                "Read tools run at once. Every change tool makes a proposal card; nothing "
                "changes until the user applies it (or, with Settings › AI assistant › "
                "Apply small changes automatically on, a low-risk card such as new tags or a new "
                "category applies itself, with Undo). Cards that create items keep their "
                "ids while the chat is open, so later cards can already point at them. "
                "Small models get the tools for the page they are on plus more_tools, "
                "which lists the rest.")},
            {"title": "How answers look", "text": (
                "Items show as chips: the model writes [[id#Name]] and the user sees the "
                "name, which opens the item. The chat shows **bold**, *italic*, lists, "
                "`code`, ``` blocks, tables and ### headings, and a paragraph starting "
                "Tip: or Warning: as a highlighted box. Under each answer the chat says "
                "which model wrote it and whether it used native tool calls or JSON "
                "steps.")},
        ],
    }


def page(page_id: Any) -> dict[str, Any] | None:
    if not isinstance(page_id, str):
        return None
    pid = page_id.strip().lower()
    return next((p for p in pages() if p["id"] == pid), None)


def contents() -> str:
    """One line per page, for the model's system prompt."""
    return "\n".join(f"- {p['id']}: {p['title']}. {p.get('blurb', '')}" for p in pages())


def _stem(word: str) -> str:
    if word.endswith("ing") and len(word) > 6:
        return word[:-3]
    if word.endswith("s") and not word.endswith("ss") and len(word) > 3:
        return word[:-1]
    return word


def _terms(text: str) -> list[str]:
    return [_stem(t) for t in _WORD.findall(text.lower()) if t not in _STOP and len(t) > 1]


@lru_cache(maxsize=1)
def _sections() -> list[tuple[dict[str, Any], dict[str, Any], set[str], set[str], list[str]]]:
    """(page, section, title terms, page-head terms, body terms) per section."""
    out = []
    for p in pages():
        head = set(_terms(" ".join([p["title"], p.get("blurb", ""), *p.get("keywords", [])])))
        for sec in p.get("sections") or []:
            out.append((p, sec, set(_terms(sec.get("title", ""))), head,
                        _terms(sec.get("text", ""))))
    return out


def _snippet(text: str, terms: list[str]) -> str:
    low = text.lower()
    at = min((i for i in (low.find(t) for t in terms) if i >= 0), default=0)
    start = max(0, at - 60)
    s = re.sub(r"\s+", " ", text[start:start + SNIPPET]).strip()
    return ("…" if start else "") + s + ("…" if start + SNIPPET < len(text) else "")


def _scored(query: str) -> list[tuple[float, float, dict[str, Any], dict[str, Any]]]:
    """(score, share of the query's terms matched, page, section), best first."""
    terms = list(dict.fromkeys(_terms(query)))
    if not terms:
        return []
    secs = _sections()
    n = max(1, len(secs))
    idf = {}
    for t in terms:
        df = sum(1 for _p, _s, title, head, body in secs if t in title or t in head or t in body)
        idf[t] = math.log((n + 1) / (df + 1)) + 0.1
    scored: list[tuple[float, float, dict[str, Any], dict[str, Any]]] = []
    for p, sec, title, head, body in secs:
        score = 0.0
        hit = 0
        for t in terms:
            tf = min(body.count(t), 4) + (3 if t in title else 0) + (2 if t in head else 0)
            if tf:
                hit += 1
                score += tf * idf[t]
        if score > 0:
            share = hit / len(terms)
            scored.append((score * share ** 2, share, p, sec))
    scored.sort(key=lambda x: -x[0])
    return scored


def _raw_terms(query: str) -> list[str]:
    return [t for t in _WORD.findall(query.lower()) if t not in _STOP and len(t) > 1]


def search(query: str) -> str:
    if not _terms(query):
        return "Pages:\n" + contents()
    scored = _scored(query)
    if not scored:
        return "no matches; the pages are:\n" + contents()
    raw_terms = _raw_terms(query)
    return "\n".join(f"- {p['id']} › {sec['title']}: {_snippet(sec['text'], raw_terms)}"
                     for _score, _share, p, sec in scored[:MAX_HITS])


#: Docs sections handed to the model up front: only when they cover most of
#: a question of at least this many terms.
RETRIEVE_MIN_TERMS = 2
RETRIEVE_MIN_SHARE = 0.67


_QUESTION = re.compile(
    r"^\s*(how|what|why|where|when|which|can|could|does|do|is|are|should|explain)\b|\?",
    re.IGNORECASE)


def retrieve(query: str, *, seen: set[str], limit: int = 2) -> tuple[str, list[str]]:
    """Up to `limit` docs sections a question is clearly about, as
    "- page › section" pointers (no text: a wrong section quoted at length
    misleads more than a pointer the model can choose to read), and their
    keys ("page#section"). Only for questions."""
    from engine.ai.index import query_words  # the request words left out
    if not _QUESTION.search(query) or len(query_words(query)) < RETRIEVE_MIN_TERMS:
        return "", []
    scored = _scored(query)
    if not scored:
        return "", []
    best = scored[0][0]
    lines: list[str] = []
    keys: list[str] = []
    for score, share, p, sec in scored[:6]:
        key = f"{p['id']}#{sec['title']}"
        if share < RETRIEVE_MIN_SHARE or score < best * 0.5 or key in seen:
            continue
        lines.append(f"- {p['id']} › {sec['title']}")
        keys.append(key)
        if len(lines) >= limit:
            break
    return "\n".join(lines), keys


def read(page_id: Any, section: Any = None) -> str:
    p = page(page_id)
    if p is None:
        raise ValueError(f"no docs page {str(page_id)[:40]!r}; search the docs first")
    secs = p.get("sections") or []
    if isinstance(section, str) and section.strip():
        want = section.strip().lower()
        picked = [s for s in secs if want in s["title"].lower()]
        if picked:
            secs = picked
    out = [f"{p['title']} ({p['id']}): {p.get('blurb', '')}"]
    for s in secs:
        out.append(f"## {s['title']}\n{s['text']}")
    text = "\n\n".join(out)
    if len(text) > MAX_READ:
        names = ", ".join(s["title"] for s in p.get("sections") or [])
        text = text[:MAX_READ] + f"\n… (cut; read one section: {names})"
    return text
