"""How the user builds: a short note on the library's own conventions.

The chat and the pack planner read it so what they make extends the user's
system instead of starting a parallel one: options written the way the
user writes them (tags or sentences, how long), the tags and axis names
they already use, the variables their stacks set, the standing negatives in
their templates, and the wildcards worth reusing. Computed from the rows
the route read; nothing is stored.
"""
from __future__ import annotations

import re
from collections import Counter
from typing import Any

MAX_REUSE = 25
MAX_TAGS = 30


def option_style(texts: list[str]) -> str | None:
    """"tags" when most options are comma lists of short pieces,
    "sentences" when they read as phrases; None with too few to tell."""
    texts = [t for t in texts if isinstance(t, str) and t.strip() and "{" not in t]
    if len(texts) < 6:
        return None
    taggy = 0
    for t in texts:
        parts = [p.strip() for p in t.split(",") if p.strip()]
        words = len(t.split())
        if "_" in t or (len(parts) > 1 and words / len(parts) <= 3) or words <= 2:
            taggy += 1
    share = taggy / len(texts)
    if share >= 0.65:
        return "tags"
    if share <= 0.35:
        return "sentences"
    return None


def _words(texts: list[str]) -> float:
    lens = [len(t.split()) for t in texts if isinstance(t, str) and t.strip()]
    return sum(lens) / len(lens) if lens else 0.0


def summarize(modules: list[dict[str, Any]], bundles: list[dict[str, Any]] | None = None,
              templates: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """``{style, words, tags, axes, vars, negatives, reuse}``."""
    wilds = [m for m in modules if m.get("type") == "wildcard"
             and isinstance(m.get("payload"), dict)]
    texts: list[str] = []
    tags: Counter[str] = Counter()
    axes: Counter[str] = Counter()
    reuse: list[dict[str, Any]] = []
    for m in wilds:
        p = m["payload"]
        opts = [o for o in p.get("options") or [] if isinstance(o, dict)]
        texts += [v for o in opts if isinstance(v := o.get("value"), str)]
        for o in opts:
            tags.update(t for t in o.get("sub_categories") or [] if isinstance(t, str))
        axes.update(k for k in (p.get("tag_groups") or {}) if isinstance(k, str))
        if p.get("var_binding") and len(opts) >= 4:
            reuse.append({"name": m.get("name") or "", "var": p["var_binding"],
                          "count": len(opts), "tags": sorted(
                              {t for o in opts for t in o.get("sub_categories") or []
                               if isinstance(t, str)})[:8]})
    var_use: Counter[str] = Counter()
    for b in bundles or []:
        for c in b.get("children") or []:
            p = c.get("payload") if isinstance(c, dict) else None
            if isinstance(p, dict):
                v = p.get("var_binding") or p.get("output_var")
                if isinstance(v, str) and v:
                    var_use[v] += 1
    negatives: Counter[str] = Counter()
    for t in templates or []:
        neg = t.get("negative_template")
        if isinstance(neg, str):
            for part in re.split(r"[,\n]", neg):
                part = part.strip()
                if part and not part.startswith("$"):
                    negatives[part.lower()] += 1
    reuse.sort(key=lambda r: -r["count"])
    return {
        "style": option_style(texts),
        "words": round(_words(texts), 1),
        "tags": [t for t, _ in tags.most_common(MAX_TAGS)],
        "axes": [a for a, _ in axes.most_common(10)],
        "vars": [v for v, _ in var_use.most_common(12)],
        "negatives": [n for n, _ in negatives.most_common(12)],
        "reuse": reuse[:MAX_REUSE],
    }


def note(summary: dict[str, Any], *, reuse: bool = True) -> str:
    """The summary as a few lines for a prompt. Empty for an empty library."""
    lines: list[str] = []
    if summary["style"]:
        how = ("comma-separated tags" if summary["style"] == "tags"
               else "natural phrases")
        lines.append(f"Options are written as {how}, about {summary['words']:g} words each.")
    if summary["tags"]:
        lines.append("Option tags in use: " + ", ".join(summary["tags"]))
    if summary["axes"]:
        lines.append("Tag groups (axes) in use: " + ", ".join(summary["axes"]))
    if summary["vars"]:
        lines.append("Variables their stacks set most: $" + ", $".join(summary["vars"]))
    if summary["negatives"]:
        lines.append("Standing negatives in their templates: " + ", ".join(summary["negatives"]))
    if reuse and summary["reuse"]:
        lines.append("Wildcards they have (name · $var · options · tags):")
        lines += [f"- {r['name']} · ${r['var']} · {r['count']}"
                  + (f" · {', '.join(r['tags'])}" if r["tags"] else "")
                  for r in summary["reuse"]]
    if not lines:
        return ""
    return "The user's library (match its conventions; reuse what fits):\n" + "\n".join(lines)
