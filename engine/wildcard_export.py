"""Export library content as plain wildcard files (a zip of ``.txt``).

The reverse of :mod:`engine.wildcard_files`: Dynamic Prompts, Impact Pack,
Prompt-PostProcessor, Easy-Use and A1111/Forge all read a folder of
``.txt`` files, one choice per line, and expand ``__folder/name__``. A pack
exported this way works in any of them, without Wildcard Pipeline.

What carries over:

* **wildcards** → ``<pack>/<name>.txt``, one line per option. Uneven
  weights become repeated lines (those tools pick lines evenly), scaled
  down to at most ``MAX_COPIES`` copies of one option.
* **fixed values** and **combines** → one file per variable, one line.
* **templates** → ``<pack>/templates/<name>.txt`` (+ ``.negative.txt``).
* ``$var`` reads of a variable an exported item writes → ``__<pack>/<file>__``;
  ``@{id#name}`` refs → the file of that wildcard; ``{a|b}``, ``{2$$, $$a|b}``
  and ``N::`` weights inside braces are Dynamic Prompts syntax already.

What can't (each is listed per file in the zip's ``README.md``): the
chance of nothing (null options), tag groups, ref filters, constraints,
derivations, fallbacks, negatives on options, ``.K`` / axis accessors, the
``~`` repeat flag. A ``$var`` read in WP reuses the pick already made;
``__file__`` in those tools makes a new pick.

Pure Python, standard library only, so the community site can vendor this
file as is (``api/app/services/plain_export.py`` there). Its small parser
follows ``engine/syntax/tokenize.py``; ``tests/engine/test_wildcard_export.py``
checks the two agree on the shared syntax corpus.
"""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field
from fractions import Fraction
from typing import Any

FORMAT_NOTE = "Plain wildcard files (Dynamic Prompts / Impact Pack / PPP)"
MAX_COPIES = 10
MAX_LINES = 5000  # per file, after weight copies

# Same shapes as engine/syntax/tokenize.py (_VAR_RE / _REF_RE / multi prefix).
_VAR_RE = re.compile(
    r"\$([A-Za-z_][A-Za-z0-9_]*)"
    r"(?:\.(?:(\d+)(?:\.([A-Za-z_][A-Za-z0-9_]*))?"
    r"|([A-Za-z_][A-Za-z0-9_]*)(?:\.(\d+))?))?"
)
_REF_RE = re.compile(
    r"@\{([0-9a-f]{8})(?:#([^#:}@{!]*))?(?::((?:[^}!]|!(?!null\}))*))?(?:!([^}]*))?\}"
)
_MULTI_PREFIX_RE = re.compile(r"^(\d+(?:-\d+)?)(~?)\$\$(?:(.*?)\$\$)?", re.DOTALL)
_SLUG_RE = re.compile(r"[^a-z0-9]+")


@dataclass
class _File:
    path: str  # inside the pack folder, no extension
    title: str
    kind: str
    lines: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def note(self, text: str) -> None:
        if text not in self.notes:
            self.notes.append(text)


@dataclass
class PlainExport:
    """The converted pack: files keyed by path, plus what was left out."""

    pack: str
    files: list[_File]
    skipped: list[str]

    def file_texts(self) -> dict[str, str]:
        out: dict[str, str] = {}
        for f in self.files:
            out[f"{self.pack}/{f.path}.txt"] = "\n".join(f.lines) + "\n"
        return out

    def readme(self, *, title: str, source: str | None = None) -> str:
        lines = [
            title,
            "=" * len(title),
            "",
            "Plain wildcard files exported from Wildcard Pipeline. Put the",
            f"`{self.pack}` folder in your wildcards folder (Dynamic Prompts,",
            "Impact Pack, Prompt-PostProcessor, Easy-Use, A1111/Forge) and use",
            f"`__{self.pack}/<name>__` in a prompt.",
            "",
        ]
        if source:
            lines += [
                "The full pack, with everything listed below, installs in one",
                "click in Wildcard Pipeline for ComfyUI:",
                f"  {source}",
                "",
            ]
        lines.append("Files")
        lines.append("-----")
        for f in self.files:
            lines.append(f"__{self.pack}/{f.path}__  ({f.kind}: {f.title})")
            for n in f.notes:
                lines.append(f"    - {n}")
        if self.skipped:
            lines += ["", "Not exported (no plain-file equivalent)", "-" * 39]
            lines += [f"- {s}" for s in self.skipped]
        return "\n".join(lines) + "\n"

    def to_zip(self, *, title: str, source: str | None = None) -> bytes:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for path, text in sorted(self.file_texts().items()):
                zf.writestr(path, text)
            zf.writestr(f"{self.pack}/README.md", self.readme(title=title, source=source))
        return buf.getvalue()


def slug(text: str, fallback: str = "item") -> str:
    s = _SLUG_RE.sub("_", text.lower()).strip("_")
    return s[:60] or fallback


def _items_from_envelope(env: dict[str, Any]) -> list[dict[str, Any]]:
    """Flatten an 8-bucket export (bundles' children included) into module
    rows ``{id, type, name, payload}`` plus template rows."""
    items: list[dict[str, Any]] = []
    for bucket, kind in (
        ("wildcards", "wildcard"),
        ("fixed_values", "fixed_values"),
        ("combines", "combine"),
        ("derivations", "derivation"),
        ("constraints", "constraint"),
    ):
        for row in env.get(bucket) or []:
            if isinstance(row, dict):
                items.append({**row, "type": row.get("type") or kind})
    for b in env.get("bundles") or []:
        if isinstance(b, dict):
            items.extend(bundle_children(b))
    for t in env.get("templates") or []:
        if isinstance(t, dict):
            items.append({**t, "type": "template"})
    return items


def bundle_children(bundle: dict[str, Any]) -> list[dict[str, Any]]:
    """A bundle's children (frozen widget snapshots) as module rows."""
    out: list[dict[str, Any]] = []
    for c in bundle.get("children") or []:
        if not isinstance(c, dict):
            continue
        meta = _dict(c.get("meta"))
        out.append({
            "id": c.get("id"),
            "type": c.get("type"),
            "name": meta.get("name") or c.get("name") or c.get("type") or "item",
            "payload": _dict(c.get("payload")),
        })
    return out


def items_from_post_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """A community post payload (one module row, or a bundle with
    ``children``) as module rows."""
    if isinstance(payload.get("children"), list):
        return bundle_children(payload)
    return [payload]


def _copies(weights: list[float]) -> tuple[list[int], bool]:
    """Line copies per option keeping the odds; ``(copies, exact)``."""
    if not weights:
        return [], True
    fr = [Fraction(w).limit_denominator(100) for w in weights]
    if len(set(fr)) == 1:
        return [1] * len(fr), True
    low = min(fr)
    ratios = [f / low for f in fr]
    # Smallest whole numbers in the same ratio.
    den = 1
    for r in ratios:
        den = den * r.denominator // _gcd(den, r.denominator)
    ints = [int(r * den) for r in ratios]
    g = 0
    for n in ints:
        g = _gcd(g, n)
    ints = [n // g for n in ints]
    if max(ints) <= MAX_COPIES:
        return ints, True
    top = max(fr)
    scaled = [max(1, round(float(f / top) * MAX_COPIES)) for f in fr]
    return scaled, False


def _gcd(a: int, b: int) -> int:
    while b:
        a, b = b, a % b
    return a


class _Converter:
    def __init__(self, pack: str) -> None:
        self.pack = pack
        self.by_id: dict[str, str] = {}  # module id -> file path
        self.by_var: dict[str, str] = {}  # variable -> file path
        self.used: set[str] = set()

    def claim(self, base: str) -> str:
        path, n = base, 2
        while path in self.used:
            path, n = f"{base}_{n}", n + 1
        self.used.add(path)
        return path

    def ref(self, path: str) -> str:
        return f"__{self.pack}/{path}__"

    # --- text -----------------------------------------------------------
    def text(self, raw: str, f: _File) -> str:
        out: list[str] = []
        i = 0
        n = len(raw)
        while i < n:
            ch = raw[i]
            if ch in "$@" and i + 1 < n and raw[i + 1] == ch:
                out.append(ch)  # `$$` / `@@` are WP's escapes
                i += 2
                continue
            if ch == "$":
                m = _VAR_RE.match(raw, i)
                if m:
                    out.append(self.var(m, f))
                    i = m.end()
                    continue
            if ch == "@":
                m = _REF_RE.match(raw, i)
                if m:
                    out.append(self.wp_ref(m, f))
                    i = m.end()
                    continue
            if ch == "{":
                end = _close(raw, i)
                if end is not None:
                    out.append(self.brace(raw[i + 1 : end], f))
                    i = end + 1
                    continue
            out.append(ch)
            i += 1
        return "".join(out)

    def var(self, m: re.Match[str], f: _File) -> str:
        name = m.group(1)
        accessor = m.group(0)[len(name) + 1 :]
        if accessor == ".neg":
            f.note(f"`{m.group(0)}` (a variable's negatives) dropped")
            return ""
        path = self.by_var.get(name)
        if path is None:
            f.note(f"`${name}` is set by something not in this pack; kept as text")
            return m.group(0)
        if accessor:
            f.note(f"`{m.group(0)}` reads one part of a pick; exported as a whole new pick")
        f.note(f"`${name}` becomes a new pick of {self.ref(path)}, not the same one")
        return self.ref(path)

    def wp_ref(self, m: re.Match[str], f: _File) -> str:
        uid, label, expr = m.group(1), m.group(2), m.group(3)
        path = self.by_id.get(uid)
        if expr:
            f.note(f"the tag filter `{expr}` on a reference was dropped")
        if path is None:
            name = label or uid
            f.note(f"refers to `{name}`, not in this pack; written as __{slug(name)}__")
            return f"__{slug(name)}__"
        return self.ref(path)

    def brace(self, body: str, f: _File) -> str:
        prefix = ""
        m = _MULTI_PREFIX_RE.match(body)
        if m:
            count, independent, sep = m.group(1), m.group(2), m.group(3)
            if independent:
                f.note("the `~` (repeats allowed) flag on a multi-pick was dropped")
            prefix = f"{count}$${sep}$$" if sep is not None else f"{count}$$"
            body = body[m.end() :]
        branches = _split_top(body)
        return "{" + prefix + "|".join(self.text(b, f) for b in branches) + "}"

    # --- items ----------------------------------------------------------
    def convert(self, items: list[dict[str, Any]]) -> PlainExport:
        files: list[tuple[_File, dict[str, Any]]] = []
        skipped: list[str] = []
        seen: set[str] = set()
        for it in items:
            kind = it.get("type")
            name = str(it.get("name") or kind or "item")
            key = f"{kind}:{it['id']}" if it.get("id") else ""
            if key and key in seen:
                continue
            if key:
                seen.add(key)
            payload = _dict(it.get("payload"))
            if kind == "wildcard":
                var = str(payload.get("var_binding") or "")
                path = self.claim(slug(var or name, "wildcard"))
                f = _File(path, name, "wildcard")
                if it.get("id"):
                    self.by_id[str(it["id"])] = path
                if var:
                    self.by_var.setdefault(var, path)
                files.append((f, it))
            elif kind == "fixed_values":
                for row in payload.get("values") or []:
                    if not isinstance(row, dict) or not row.get("name"):
                        continue
                    var = str(row["name"])
                    path = self.claim(slug(var, "value"))
                    self.by_var.setdefault(var, path)
                    files.append((_File(path, f"{name} · {var}", "fixed value"), {"row": row}))
            elif kind == "combine":
                var = str(payload.get("output_var") or "")
                path = self.claim(slug(var or name, "combine"))
                if var:
                    self.by_var.setdefault(var, path)
                files.append((_File(path, name, "combine"), it))
            elif kind == "template":
                path = self.claim(f"templates/{slug(name, 'template')}")
                files.append((_File(path, name, "template"), it))
            elif kind in ("derivation", "constraint"):
                skipped.append(f"{name} ({kind}: rules that need Wildcard Pipeline)")
            elif kind:
                skipped.append(f"{name} ({kind})")
        out: list[_File] = []
        for f, it in files:
            self.fill(f, it)
            out.append(f)
            if f.kind == "template":
                neg = it.get("negative_template")
                if isinstance(neg, str) and neg.strip():
                    nf = _File(
                        self.claim(f"{f.path}.negative"), f"{f.title} (negative)", "template"
                    )
                    nf.lines = [self.text(neg, nf).strip()]
                    out.append(nf)
        return PlainExport(self.pack, out, skipped)

    def fill(self, f: _File, it: dict[str, Any]) -> None:
        payload = _dict(it.get("payload"))
        if f.kind == "fixed value":
            row = it["row"]
            f.lines = [self.text(str(row.get("value") or ""), f).strip()]
            if row.get("negative"):
                f.note("its negative prompt was dropped")
        elif f.kind == "combine":
            f.lines = [self.text(str(payload.get("template") or ""), f).strip()]
            if payload.get("negative"):
                f.note("its negative prompt was dropped")
        elif f.kind == "template":
            f.lines = [self.text(str(it.get("template_string") or ""), f).strip()]
        else:
            self.fill_wildcard(f, payload)
        f.lines = [ln for ln in f.lines if ln] or ["# (empty)"]

    def fill_wildcard(self, f: _File, payload: dict[str, Any]) -> None:
        opts = [o for o in payload.get("options") or [] if isinstance(o, dict)]
        live = [o for o in opts if not o.get("is_null")]
        nulls = [o for o in opts if o.get("is_null")]
        weights = [_weight(o) for o in live]
        total = sum(weights) + sum(_weight(o) for o in nulls)
        keep = [(o, w) for o, w in zip(live, weights, strict=True) if w > 0]
        if nulls and total > 0:
            share = round(100 * sum(_weight(o) for o in nulls) / total)
            if share:
                f.note(f"a {share}% chance of nothing was dropped")
        if len(keep) < len(live):
            f.note("options with weight 0 were left out")
        if payload.get("tag_groups") or any(o.get("sub_categories") for o in live):
            f.note("tags on options were dropped")
        if any(o.get("negative") for o in live):
            f.note("negative prompts on options were dropped")
        if any(o.get("fallback") for o in live):
            f.note("the fallback option is now an ordinary option")
        copies, exact = _copies([w for _, w in keep])
        if not exact:
            f.note(f"weights rounded to whole line copies (at most {MAX_COPIES})")
        elif any(c > 1 for c in copies):
            f.note("uneven weights written as repeated lines")
        lines: list[str] = []
        for (o, _), c in zip(keep, copies, strict=True):
            text = self.text(str(o.get("value") or ""), f).replace("\n", " ").strip()
            if not text:
                continue
            if text.startswith("#"):
                # A line starting with # is a comment in those tools.
                text = text.lstrip("# ").strip()
                f.note("a leading # was removed (it starts a comment there)")
                if not text:
                    continue
            lines.extend([text] * c)
        if len(lines) > MAX_LINES:
            f.note(f"cut to the first {MAX_LINES} lines")
            lines = lines[:MAX_LINES]
        f.lines = lines


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _weight(o: dict[str, Any]) -> float:
    w = o.get("weight", 1)
    try:
        v = float(w)
    except (TypeError, ValueError):
        return 1.0
    return v if v >= 0 else 0.0


def _close(text: str, start: int) -> int | None:
    depth = 0
    i = start
    while i < len(text):
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return None


def _split_top(body: str) -> list[str]:
    parts: list[str] = []
    cur: list[str] = []
    depth = i = 0
    while i < len(body):
        ch = body[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        if ch == "|" and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
        i += 1
    parts.append("".join(cur))
    return parts


def export_items(items: list[dict[str, Any]], pack: str) -> PlainExport:
    """Convert module / template rows into plain wildcard files."""
    return _Converter(slug(pack, "pack")).convert(items)


def export_envelope(env: dict[str, Any], pack: str) -> PlainExport:
    """Convert an 8-bucket export (``engine.exporter``) into plain files."""
    return export_items(_items_from_envelope(env), pack)
