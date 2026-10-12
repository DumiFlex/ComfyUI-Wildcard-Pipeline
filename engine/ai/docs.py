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
        return []
    return [p for p in data.get("pages") or [] if isinstance(p, dict) and p.get("id")]


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


def search(query: str) -> str:
    terms = list(dict.fromkeys(_terms(query)))
    if not terms:
        return "Pages:\n" + contents()
    secs = _sections()
    n = max(1, len(secs))
    idf = {}
    for t in terms:
        df = sum(1 for _p, _s, title, head, body in secs if t in title or t in head or t in body)
        idf[t] = math.log((n + 1) / (df + 1)) + 0.1
    scored: list[tuple[float, dict[str, Any], dict[str, Any]]] = []
    for p, sec, title, head, body in secs:
        score = 0.0
        hit = 0
        for t in terms:
            tf = min(body.count(t), 4) + (3 if t in title else 0) + (2 if t in head else 0)
            if tf:
                hit += 1
                score += tf * idf[t]
        if score > 0:
            scored.append((score * (hit / len(terms)) ** 2, p, sec))
    scored.sort(key=lambda x: -x[0])
    if not scored:
        return "no matches; the pages are:\n" + contents()
    raw_terms = [t for t in _WORD.findall(query.lower()) if t not in _STOP and len(t) > 1]
    return "\n".join(f"- {p['id']} › {sec['title']}: {_snippet(sec['text'], raw_terms)}"
                     for _score, p, sec in scored[:MAX_HITS])


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
