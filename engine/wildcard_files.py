"""Convert Dynamic Prompts / Prompt-PostProcessor / Impact Pack wildcard
files into a Wildcard Pipeline import payload.

Pure Python, no ComfyUI imports. Input is a list of ``(relative path,
bytes)`` pairs (a dropped folder, several files, or a zip read by
:func:`read_zip`). Output is the same 8-bucket envelope the JSON exporter
writes, so the manager feeds it through the normal import picker, conflict
modal and commit, plus a report of everything that could not be carried
over exactly.

The three source tools share one layout:

* every ``.txt`` file is one wildcard, one choice per line;
* every list inside a ``.yaml`` / ``.yml`` / ``.json`` file is one
  wildcard (a top-level dict drops the file name, a top-level list is
  named after the file);
* a wildcard's name is its path from the wildcards root, and other
  values reference it as ``__path/name__``.

Each wildcard becomes one wildcard module. Module and option ids are
derived from the wildcard path, so importing the same pack again lands on
the same ids and the import picker reports unchanged wildcards as already
present instead of duplicating them.
"""
from __future__ import annotations

import fnmatch
import hashlib
import io
import json
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Any

from engine._fingerprint import module_fingerprint
from engine.modules.snapshot import payload_hash
from engine.syntax.subcat_filter import validate_subcat_name

try:  # PyYAML ships with ComfyUI; the converter degrades without it.
    import yaml as _yaml
except ImportError:  # pragma: no cover - exercised only on bare installs
    _yaml = None

WILDCARD_EXTENSIONS = frozenset({".txt", ".yaml", ".yml", ".json"})

# Hard caps so a hostile or accidental upload can't exhaust memory.
MAX_FILES = 20_000
MAX_TOTAL_BYTES = 200 * 1024 * 1024
MAX_FILE_BYTES = 32 * 1024 * 1024

# Wildcard names become the `#name` segment of `@{uuid#name}`, so these
# characters can't appear in them (mirrors wp_api REF_GRAMMAR_FORBIDDEN_CHARS).
_NAME_FORBIDDEN = re.compile(r"[{}:#@,!]")
_MAX_NAME_LEN = 200
_MAX_DESCRIPTION_LEN = 2000
_MAX_IDENT_LEN = 64

_IGNORED_PARTS = frozenset({"__MACOSX", ".git", ".svn", "node_modules"})

# --- choice micro-grammar (PPP) ------------------------------------------
# Options written before `::` on a choice: `%` (command), `'labels'`,
# a weight, `if <condition>`, `else`. All optional, in this order.
_CHOICE_OPTS_RE = re.compile(
    r"""^\s*
    (?P<cmd>%)?\s*
    (?:'(?P<l1>[^']*)'|"(?P<l2>[^"]*)")?\s*
    (?P<w>\d+(?:\.\d+)?|\.\d+)?\s*
    (?:if\s+(?P<cond>.+?))?\s*
    (?P<else>else)?\s*$""",
    re.VERBOSE | re.DOTALL,
)

# Wildcard / choice parameters before `$$`: sampler, repeat flag, optional
# flag, count or range, quoted description.
_PARAMS_RE = re.compile(
    r"""^\s*
    (?P<sampler>[~@])?\s*
    (?P<r>r)?\s*
    (?P<o>o)?\s*
    (?P<range>\d*\s*-\s*\d*|\d+)?\s*
    (?:'(?P<d1>[^']*)'|"(?P<d2>[^"]*)")?\s*$""",
    re.VERBOSE,
)

# Object-form parameter keys (PPP); a first choice made only of these is
# the wildcard's default parameters, not a choice.
_PARAM_KEYS = frozenset({
    "sampler", "repeating", "optional", "count", "from", "to", "prefix",
    "suffix", "separator", "container", "description",
})

# `__…__` reference. Body: optional `params$$`, the identifier (may hold
# globs), an optional quoted filter and an optional `(var=value)` list.
_REF_RE = re.compile(
    r"""(?:(?P<icount>\d+)\#)?
    __
    (?P<sampler>[~@])?
    (?:(?P<params>[^_$'"()\s][^$]*?)\$\$(?:(?P<sep>[^$]*)\$\$)?)?
    (?P<name>[A-Za-z0-9.\-*/\\][A-Za-z0-9_.\-*/\\ ]*?)
    (?:'(?P<f1>[^']*)'|"(?P<f2>[^"]*)")?
    (?:\((?P<args>[^()]*)\))?
    __""",
    re.VERBOSE,
)

# Dynamic Prompts variables: `${name}`, `${name:default}`, `${name=value}`,
# `${name?=!value}`. Only the first two are reads.

_WP_REF_START = re.compile(r"@\{[0-9a-f]{8}")
_INLINE_COMMENT_RE = re.compile(r"\s+#.*$")

# The report keeps at most this many examples per note kind, and this
# many notes per wildcard in the plan.
_MAX_EXAMPLES = 8
_MAX_WILDCARD_NOTES = 6

# How faithfully a wildcard came across, from the notes it raised.
# Lossy: some text no longer renders as it did in the source tool.
# Close: same outputs, but a setting or a label didn't carry over.
_LOSSY_KINDS = frozenset({
    "condition_dropped", "unresolved_reference", "template_args_dropped",
    "variable_kept_as_text", "wrap_kept_as_text", "filter_dropped",
    "command_dropped",
})
_CLOSE_KINDS = frozenset({
    "default_params_dropped", "label_dropped", "extra_else_dropped",
    "inline_else_dropped", "multi_pick_range_capped",
})


@dataclass
class SourceFile:
    """One file from the upload. ``path`` is POSIX-style and relative."""

    path: str
    data: bytes


@dataclass
class _Wildcard:
    path: str
    source: str
    items: list[Any]
    id: str = ""
    name: str = ""
    options: list[dict[str, Any]] = field(default_factory=list)
    sub_categories: list[str] = field(default_factory=list)
    # `#` comment lines from the source, kept as the module description.
    comments: list[str] = field(default_factory=list)


@dataclass
class _Group:
    pattern: str
    members: list[_Wildcard]
    display: str
    id: str = ""
    name: str = ""


class _Report:
    """Aggregates per-kind notes so a 20k-wildcard pack gives a readable
    report: one row per kind, a count, and a handful of examples."""

    def __init__(self) -> None:
        self.files: list[dict[str, Any]] = []
        self._notes: dict[str, dict[str, Any]] = {}
        # Per wildcard, for the plan: every kind it raised, a few details.
        self.by_wildcard: dict[str, list[dict[str, str]]] = {}
        self.kinds_by_wildcard: dict[str, set[str]] = {}

    def note(self, kind: str, wildcard: str, detail: str) -> None:
        row = self._notes.setdefault(kind, {"kind": kind, "count": 0, "examples": []})
        row["count"] += 1
        if len(row["examples"]) < _MAX_EXAMPLES:
            row["examples"].append({"wildcard": wildcard, "detail": detail[:200]})
        self.kinds_by_wildcard.setdefault(wildcard, set()).add(kind)
        mine = self.by_wildcard.setdefault(wildcard, [])
        if len(mine) < _MAX_WILDCARD_NOTES:
            mine.append({"kind": kind, "detail": detail[:200]})

    def notes(self) -> list[dict[str, Any]]:
        return list(self._notes.values())


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


def read_zip(data: bytes, *, prefix: str = "") -> list[SourceFile]:
    """Expand a zip into :class:`SourceFile` entries. Only wildcard
    extensions are read; size caps guard against zip bombs."""
    out: list[SourceFile] = []
    total = 0
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            path = _clean_path(prefix + info.filename)
            if path is None or not is_wildcard_file(path):
                continue
            if info.file_size > MAX_FILE_BYTES:
                raise ValueError(f"{path} is larger than {MAX_FILE_BYTES // (1024 * 1024)} MB")
            total += info.file_size
            if total > MAX_TOTAL_BYTES or len(out) >= MAX_FILES:
                raise ValueError("the zip holds too much wildcard data to import at once")
            out.append(SourceFile(path, zf.read(info)))
    return out


def _clean_path(raw: str) -> str | None:
    """Normalise to a relative POSIX path, or None for paths to ignore."""
    parts = [p for p in raw.replace("\\", "/").split("/") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts):
        return None
    if any(p in _IGNORED_PARTS or p.startswith(".") for p in parts):
        return None
    return "/".join(parts)


def is_wildcard_file(path: str) -> bool:
    return PurePosixPath(path).suffix.lower() in WILDCARD_EXTENSIONS


def _decode(data: bytes) -> str:
    """UTF-8 (BOM stripped) first, then windows-1252, as PPP does."""
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("cp1252", errors="replace")
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _strip_common_root(paths: list[str]) -> int:
    """Number of leading folders every file shares. A dropped `wildcards/`
    folder or a zip's top folder isn't part of the wildcard names the
    files use to reference each other."""
    split = [p.split("/")[:-1] for p in paths]
    if not split:
        return 0
    depth = 0
    for parts in zip(*split, strict=False):
        if all(part == parts[0] for part in parts):
            depth += 1
        else:
            break
    return depth


def _load_structured(text: str, ext: str) -> Any:
    if ext == ".json":
        return json.loads(text)
    if _yaml is None:
        raise ValueError("YAML support is not installed (PyYAML missing)")
    # BaseLoader keeps every scalar a string: the default loaders turn
    # `yes`, `no`, `on`, `off` into booleans and `1.10` into 1.1, which
    # would quietly corrupt word lists.
    # The C loader (libyaml) is ~20x faster on big packs; same output.
    loader = getattr(_yaml, "CBaseLoader", _yaml.BaseLoader)
    return _yaml.load(text, Loader=loader)  # noqa: S506 - BaseLoader builds no objects


def _collect(
    files: list[SourceFile], report: _Report, exclude: set[str],
) -> list[_Wildcard]:
    """Turn files into wildcards (raw items, not yet converted)."""
    wanted = sorted(
        (f for f in files if _clean_path(f.path) and is_wildcard_file(f.path)),
        key=lambda f: f.path.lower(),
    )
    cleaned = [_clean_path(f.path) or "" for f in wanted]
    root_depth = _strip_common_root(cleaned)
    found: list[_Wildcard] = []
    for f, path in zip(wanted, cleaned, strict=True):
        rel = "/".join(path.split("/")[root_depth:])
        pure = PurePosixPath(rel)
        ext = pure.suffix.lower()
        stem_path = str(pure.with_suffix(""))
        folder = str(pure.parent) if str(pure.parent) != "." else ""
        entry: dict[str, Any] = {"path": rel, "status": "ok", "wildcards": 0}
        report.files.append(entry)
        if rel in exclude:
            entry["status"] = "excluded"
            continue
        try:
            text = _decode(f.data)
            if ext == ".txt":
                lines = []
                comments: list[str] = []
                for line in text.split("\n"):
                    s = line.strip()
                    if s.startswith("#"):
                        comments.append(s.lstrip("#").strip())
                        continue
                    if not s:
                        continue
                    stripped = _INLINE_COMMENT_RE.sub("", s)
                    if stripped != s:
                        report.note("inline_comment", stem_path, s)
                    if stripped:
                        lines.append(stripped)
                found.append(_Wildcard(stem_path, rel, lines, comments=[c for c in comments if c]))
                entry["wildcards"] = 1
                continue
            data = _load_structured(text, ext)
        except Exception as exc:  # noqa: BLE001 - one bad file never stops the import
            entry["status"] = "error"
            entry["error"] = str(exc).split("\n")[0][:200]
            continue
        before = len(found)
        if isinstance(data, dict):
            _walk_dict(data, folder, rel, found, report)
        elif isinstance(data, list):
            found.append(_Wildcard(stem_path, rel, data))
        elif isinstance(data, (str, int, float)) and str(data).strip():
            found.append(_Wildcard(stem_path, rel, [str(data)]))
        else:
            entry["status"] = "empty"
        entry["wildcards"] = len(found) - before
    return found


def _walk_dict(
    node: dict[Any, Any], prefix: str, source: str,
    out: list[_Wildcard], report: _Report,
) -> None:
    for key, value in node.items():
        if key is None or str(key).strip() == "":
            continue
        path = f"{prefix}/{key}" if prefix else str(key)
        if isinstance(value, dict):
            _walk_dict(value, path, source, out, report)
        elif isinstance(value, list):
            out.append(_Wildcard(path, source, value))
        elif value is None or str(value).strip() == "":
            report.note("empty_wildcard", path, "no values")
        else:
            out.append(_Wildcard(path, source, [str(value)]))


# ---------------------------------------------------------------------------
# Naming + ids
# ---------------------------------------------------------------------------


def _short_hash(*parts: str) -> str:
    return hashlib.sha1("\x00".join(parts).encode("utf-8")).hexdigest()[:8]


def _display_name(path: str) -> str:
    name = _NAME_FORBIDDEN.sub("_", path).strip()
    return name[:_MAX_NAME_LEN] or "wildcard"


def _ident(text: str) -> str:
    """A variable binding from a wildcard's last path segment."""
    s = re.sub(r"[^A-Za-z0-9_]+", "_", text).strip("_")
    if not s:
        s = "wildcard"
    if s[0].isdigit():
        s = "w_" + s
    return s[:_MAX_IDENT_LEN]


def _slug_tag(label: str) -> str | None:
    s = re.sub(r"\s+", "_", label.strip())
    s = re.sub(r"[()!,#:}@{$]", "_", s)
    if not s:
        return None
    if validate_subcat_name(s) is not None:
        s = s + "_"
        if validate_subcat_name(s) is not None:
            return None
    return s


def _norm(name: str) -> str:
    return name.replace("\\", "/").strip("/").lower()


# ---------------------------------------------------------------------------
# Conversion
# ---------------------------------------------------------------------------


@dataclass
class _Ctx:
    report: _Report
    by_path: dict[str, _Wildcard]
    impact_path: dict[str, _Wildcard]
    library: dict[str, str]
    groups: dict[str, _Group]
    all_wildcards: list[_Wildcard]
    current: str = ""
    # Reference graph, by normalised path: what each wildcard points at
    # (imported wildcards and group patterns), and how many refs it has
    # in total (library refs included).
    edges: dict[str, set[str]] = field(default_factory=dict)
    ref_counts: dict[str, int] = field(default_factory=dict)
    comments: dict[str, list[str]] = field(default_factory=dict)


def convert_files(
    files: list[SourceFile],
    *,
    library_wildcards: dict[str, str] | None = None,
    pack_tag: str | None = None,
    category_name: str | None = None,
    exclude: set[str] | None = None,
    make_bundles: bool = True,
    pack_name: str | None = None,
) -> dict[str, Any]:
    """Convert wildcard files into ``{"payload": envelope, "report": …}``.

    ``library_wildcards`` maps existing library wildcard names to ids, so
    a reference to a wildcard that isn't in the upload can still link to
    one the user already has. ``pack_tag`` adds a library tag to every
    imported module. ``category_name`` overrides the per-folder category.
    ``exclude`` lists file paths (as the report names them) to leave out.
    ``make_bundles`` also files the wildcards into bundles: one inner
    bundle per top folder (or top YAML key), inside one pack bundle named
    ``pack_name`` — our one level of bundle nesting.
    """
    report = _Report()
    wildcards: list[_Wildcard] = []
    seen: dict[str, _Wildcard] = {}
    for wc in _collect(files, report, exclude or set()):
        key = _norm(wc.path)
        if key in seen:
            report.note(
                "duplicate_wildcard", wc.path,
                f"also defined in {seen[key].source}; kept the one in {seen[key].source}",
            )
            for entry in report.files:
                if entry["path"] == wc.source:
                    entry["duplicates"] = entry.get("duplicates", 0) + 1
            continue
        seen[key] = wc
        wildcards.append(wc)

    used_ids: set[str] = set()
    for wc in wildcards:
        wc.id = _unique_id(_short_hash("wildcard", _norm(wc.path)), used_ids)
        wc.name = _display_name(wc.path)

    ctx = _Ctx(
        report=report,
        by_path={_norm(w.path): w for w in wildcards},
        impact_path={_norm(w.path).replace(" ", "-"): w for w in wildcards},
        library={k.lower(): v for k, v in (library_wildcards or {}).items()},
        groups={},
        all_wildcards=wildcards,
    )
    for wc in wildcards:
        ctx.current = wc.path
        _convert_wildcard(wc, ctx)

    for grp in ctx.groups.values():
        grp.id = _unique_id(_short_hash("group", grp.pattern), used_ids)
        grp.name = _display_name(grp.display)

    # Options are converted before group ids exist; patch the placeholders.
    placeholders = {f"\x00group:{p}\x00": g for p, g in ctx.groups.items()}
    for wc in wildcards:
        for opt in wc.options:
            if "\x00group:" in opt["value"]:
                for ph, grp in placeholders.items():
                    opt["value"] = opt["value"].replace(ph, f"@{{{grp.id}#{grp.name}}}")

    categories: dict[str, dict[str, Any]] = {}

    def category_for(path: str) -> str | None:
        name = category_name or (path.split("/")[0] if "/" in path else None)
        if not name:
            return None
        name = name.strip()[:_MAX_NAME_LEN]
        key = name.lower()
        if key not in categories:
            categories[key] = {
                "id": "cat" + _short_hash("category", key)[:5],
                "name": name,
                "color": None,
                "icon": None,
                "sort_order": 0,
            }
        return categories[key]["id"]

    tags = [pack_tag] if pack_tag else []
    rows: list[dict[str, Any]] = []
    for wc in wildcards:
        if not wc.options:
            report.note("empty_wildcard", wc.path, "no usable values")
            continue
        description = f"Imported from {wc.source}"
        comments = wc.comments + ctx.comments.get(wc.path, [])
        if comments:
            description += "\n\n" + "\n".join(comments)
        rows.append(_module_row(
            wc.id, wc.name, description[:_MAX_DESCRIPTION_LEN],
            category_for(wc.path), tags,
            {
                "var_binding": _ident(wc.path.split("/")[-1]),
                "sub_categories": wc.sub_categories,
                "options": wc.options,
            },
        ))
    kept = {r["id"] for r in rows}
    for grp in ctx.groups.values():
        members = [m for m in grp.members if m.id in kept]
        options = [
            {
                "id": _short_hash(grp.pattern, m.id),
                "value": f"@{{{m.id}#{m.name}}}",
                # Weight by pool size so the odds match the source tool,
                # which flattens every matched file into one list.
                "weight": max(1, sum(1 for o in m.options if not o.get("is_null"))),
                "sub_categories": [],
            }
            for m in members
        ]
        if not options:
            continue
        rows.append(_module_row(
            grp.id, grp.name,
            f"Picks from every wildcard matching {grp.display} (imported)",
            category_for(grp.display), tags,
            {
                "var_binding": _ident(grp.pattern.replace("*", "").split("/")[-1] or "group"),
                "sub_categories": [],
                "options": options,
            },
        ))

    group_ids = {g.id for g in ctx.groups.values()}
    group_rows = sum(1 for r in rows if r["id"] in group_ids)
    plan = _plan(rows, wildcards, ctx)
    entry_ids = {p["id"] for p in plan if p["role"] == "entry"}
    entries = [r for r in rows if r["id"] in entry_ids]
    bundles = _build_bundles(entries, used_ids, tags, pack_name) if make_bundles else []
    payload = {
        "schema_version": 2,
        "bundles": bundles,
        "wildcards": rows,
        "fixed_values": [],
        "combines": [],
        "derivations": [],
        "constraints": [],
        "categories": list(categories.values()),
        "templates": [],
    }
    # Fallback options need v9; reuse the exporter's content stamp.
    from engine.migrations.stamping import schema_version_for_payload

    payload["schema_version"] = schema_version_for_payload(
        {k: v for k, v in payload.items() if isinstance(v, list)},
    )
    return {
        "payload": payload,
        "report": {
            "files": report.files,
            "notes": report.notes(),
            "wildcards": len(rows) - group_rows,
            "groups": group_rows,
            "options": sum(len(r["payload"]["options"]) for r in rows),
            "bundles": len(bundles),
            "plan": plan,
        },
    }


def _plan(
    rows: list[dict[str, Any]], wildcards: list[_Wildcard], ctx: _Ctx,
) -> list[dict[str, Any]]:
    """One entry per imported row: its role in the pack and how
    faithfully it came across.

    Roles: ``vocabulary`` (a plain list, no references), ``composition``
    (references other wildcards and is referenced itself), ``entry``
    (references others and nothing in the pack references it: what a
    user drops on a Context) and ``group`` (generated for a glob or a
    parent key).
    """
    by_id = {w.id: w for w in wildcards}
    referenced: dict[str, int] = {}
    for targets in ctx.edges.values():
        for t in targets:
            referenced[t] = referenced.get(t, 0) + 1
    group_by_id = {g.id: g for g in ctx.groups.values()}
    for g in ctx.groups.values():
        for m in g.members:
            key = _norm(m.path)
            referenced[key] = referenced.get(key, 0) + 1
    out: list[dict[str, Any]] = []
    for row in rows:
        wc = by_id.get(row["id"])
        grp = group_by_id.get(row["id"])
        if grp is not None:
            path, key = grp.display, grp.pattern
            role, refs = "group", len(row["payload"]["options"])
        elif wc is not None:
            path, key = wc.path, _norm(wc.path)
            refs = ctx.ref_counts.get(key, 0)
            if refs == 0:
                role = "vocabulary"
            elif referenced.get(key):
                role = "composition"
            else:
                role = "entry"
        else:  # pragma: no cover - every row comes from one of the two
            continue
        kinds = ctx.report.kinds_by_wildcard.get(path, set())
        if kinds & _LOSSY_KINDS:
            fidelity = "lossy"
        elif kinds & _CLOSE_KINDS:
            fidelity = "close"
        else:
            fidelity = "exact"
        out.append({
            "id": row["id"],
            "name": row["name"],
            "domain": path.split("/", 1)[0] if "/" in path else "",
            "role": role,
            "options": len(row["payload"]["options"]),
            "refs": refs,
            "referenced_by": referenced.get(key, 0),
            "fidelity": fidelity,
            "notes": ctx.report.by_wildcard.get(path, []),
            "source": wc.source if wc is not None else "",
        })
    return out


def _child_snapshot(row: dict[str, Any]) -> dict[str, Any]:
    """A wildcard as a bundle child: the same frozen widget snapshot the
    bundle editor stores when you add a library module."""
    return {
        "id": row["id"],
        "type": "wildcard",
        "enabled": True,
        "collapsed": False,
        "meta": {"name": row["name"], "library_name": row["name"]},
        "payload": row["payload"],
        "payload_hash": payload_hash(row["payload"]),
        "instance": {},
        "entries": [],
    }


def _bundle_row(
    bid: str, name: str, description: str, tags: list[str],
    children: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "id": bid,
        "name": name[:_MAX_NAME_LEN],
        "description": description,
        "color": None,
        "category_id": None,
        "tags": list(tags),
        "is_favorite": False,
        "children": children,
    }


def _build_bundles(
    rows: list[dict[str, Any]], used_ids: set[str], tags: list[str],
    pack_name: str | None,
) -> list[dict[str, Any]]:
    """One bundle per top folder, inside one pack bundle. ``rows`` are the
    entry points only: vocabulary stays in the library, where the entry
    points reach it by reference, so dropping a bundle rolls the prompts
    the pack was written to make, not every list in it.

    Wildcards with no folder sit directly in the pack bundle. When
    everything lives under a single folder, that folder's bundle is the
    only one: a pack bundle around one bundle adds nothing.
    """
    if not rows:
        return []
    folders: dict[str, list[dict[str, Any]]] = {}
    loose: list[dict[str, Any]] = []
    for row in rows:
        name = row["name"]
        if "/" in name:
            folders.setdefault(name.split("/", 1)[0], []).append(row)
        else:
            loose.append(row)
    pack = (pack_name or "").strip() or "Imported wildcards"
    if len(folders) == 1 and not loose:
        ((folder, members),) = folders.items()
        bid = _unique_id(_short_hash("bundle", folder.lower()), used_ids)
        return [_bundle_row(
            bid, folder, f"Wildcards imported from {folder}/", tags,
            [_child_snapshot(r) for r in members],
        )]
    out: list[dict[str, Any]] = []
    outer_children: list[dict[str, Any]] = []
    for folder, members in folders.items():
        bid = _unique_id(_short_hash("bundle", folder.lower()), used_ids)
        out.append(_bundle_row(
            bid, folder, f"Wildcards imported from {folder}/", tags,
            [_child_snapshot(r) for r in members],
        ))
        outer_children.append(
            {"id": bid, "type": "bundle", "name": folder[:_MAX_NAME_LEN], "color": None},
        )
    outer_children.extend(_child_snapshot(r) for r in loose)
    outer_id = _unique_id(_short_hash("pack", pack.lower()), used_ids)
    # The pack bundle goes first so the picker lists it on top; the
    # importer inserts every bundle before the commit ends either way.
    return [_bundle_row(outer_id, pack, "Imported wildcard pack", tags, outer_children), *out]


def _unique_id(candidate: str, used: set[str]) -> str:
    salt = 0
    out = candidate
    while out in used:
        salt += 1
        out = _short_hash(candidate, str(salt))
    used.add(out)
    return out


def _module_row(
    mid: str, name: str, description: str, category_id: str | None,
    tags: list[str], payload: dict[str, Any],
) -> dict[str, Any]:
    row = {
        "id": mid,
        "type": "wildcard",
        "name": name,
        "description": description,
        "category_id": category_id,
        "tags": list(tags),
        "is_favorite": False,
        "payload": payload,
        "payload_hash": payload_hash(payload),
    }
    # Stamped like an export row, so importing the same pack again finds
    # each unchanged wildcard identical and skips it quietly.
    row["snapshot_fingerprint"] = module_fingerprint(row)
    return row


def _convert_wildcard(wc: _Wildcard, ctx: _Ctx) -> None:
    items = list(wc.items)
    if items and _is_params(items[0]):
        first = items.pop(0)
        if not (isinstance(first, dict) and set(first) <= {"description"}):
            ctx.report.note("default_params_dropped", wc.path, _short(first))
    seen_values: dict[str, dict[str, Any]] = {}
    tags: dict[str, None] = {}
    fallback_used = False
    for idx, item in enumerate(items):
        choice = _parse_choice(item, ctx)
        if choice is None:
            continue
        value, weight, labels, is_else = choice
        if not value.strip():
            continue
        if value in seen_values:
            # Each copy of a line is one more ticket in the source draw:
            # fold it into the weight so the odds stay the same.
            prev = seen_values[value]
            total = prev["weight"] + weight
            prev["weight"] = int(total) if float(total).is_integer() else total
            ctx.report.note("duplicate_value", wc.path, _readable(value))
            continue
        opt: dict[str, Any] = {
            "id": _short_hash(wc.path, str(idx)),
            "value": value,
            "weight": weight,
            "sub_categories": [],
        }
        for label in labels:
            tag = _slug_tag(label)
            if tag is None:
                ctx.report.note("label_dropped", wc.path, label)
                continue
            if tag not in opt["sub_categories"]:
                opt["sub_categories"].append(tag)
            tags[tag] = None
        if is_else:
            if fallback_used:
                ctx.report.note("extra_else_dropped", wc.path, value)
            else:
                opt["fallback"] = True
                fallback_used = True
        seen_values[value] = opt
        wc.options.append(opt)
    # Option ids come from the position in the file; keep them unique if a
    # pathological file still collides on the 8-char hash.
    used: set[str] = set()
    for opt in wc.options:
        opt["id"] = _unique_id(opt["id"], used)
    wc.sub_categories = list(tags)


def _readable(value: str) -> str:
    """Show a value that still holds a group placeholder the way it will
    read once the group exists."""
    return re.sub(r"\x00group:([^\x00]*)\x00", r"@{\1}", value)


def _is_params(item: Any) -> bool:
    if isinstance(item, dict):
        keys = set(item)
        return bool(keys) and keys <= _PARAM_KEYS
    if isinstance(item, str) and "$$" in item:
        head = item.split("$$", 1)[0]
        if not head.strip():
            # `$$sep$$` alone, or the empty-parameter `$$`.
            return item.strip().endswith("$$")
        return _PARAMS_RE.match(head) is not None and item.strip().endswith("$$")
    return False


def _short(value: Any) -> str:
    return (value if isinstance(value, str) else json.dumps(value, default=str))[:200]


def _parse_choice(item: Any, ctx: _Ctx) -> tuple[str, float, list[str], bool] | None:
    """One raw item → (value, weight, labels, is_else), or None to skip."""
    if item is None:
        return None
    if isinstance(item, list):
        return (_anonymous(item, ctx), 1, [], False)
    if isinstance(item, dict):
        if len(item) == 1:
            ((key, value),) = item.items()
            if isinstance(value, list) and not ({str(key)} & {"text", "content"}):
                # `options: [anonymous list]` form.
                parsed = _parse_options(str(key), ctx)
                if parsed is not None:
                    weight, labels, is_else, _ = parsed
                    return (_anonymous(value, ctx), weight, labels, is_else)
        content = item.get("text", item.get("content"))
        if isinstance(content, list):
            text = _anonymous(content, ctx)
        elif content is None or str(content).strip() == "":
            ctx.report.note("unsupported_item", ctx.current, _short(item))
            return None
        else:
            text = _join_lines(str(content), ctx)
            if _truthy(item.get("command")):
                text = _include(text, ctx)
            else:
                text = convert_text(text, ctx)
        weight = _weight(item.get("weight", 1))
        labels = item.get("labels") or []
        if isinstance(labels, str):
            labels = [s for s in labels.split(",") if s.strip()]
        if item.get("if"):
            ctx.report.note("condition_dropped", ctx.current, f"if {item['if']}")
        return (text, weight, [str(x) for x in labels], _truthy(item.get("else")))
    raw = _join_lines(str(item), ctx)
    weight: float = 1
    labels: list[str] = []
    is_else = False
    command = False
    if "::" in raw:
        head, _, rest = raw.partition("::")
        parsed = _parse_options(head, ctx)
        if parsed is not None:
            weight, labels, is_else, command = parsed
            raw = rest
    raw = raw.strip()
    if command:
        return (_include(raw, ctx), weight, labels, is_else)
    return (convert_text(raw, ctx), weight, labels, is_else)


def _join_lines(text: str, ctx: _Ctx) -> str:
    """A multi-line YAML value (prompt templates use them) → one line.

    Dynamic Prompts drops `#` comment lines and joins the rest; the
    comments usually explain the template, so they go to the module
    description instead of the prompt.
    """
    if "\n" not in text:
        return text
    kept: list[str] = []
    for line in text.split("\n"):
        s = line.strip()
        if not s:
            continue
        if s.startswith("#"):
            comment = s.lstrip("#").strip()
            if comment:
                ctx.comments.setdefault(ctx.current, []).append(comment)
            continue
        kept.append(s)
    return " ".join(kept)


def _parse_options(head: str, ctx: _Ctx) -> tuple[float, list[str], bool, bool] | None:
    m = _CHOICE_OPTS_RE.match(head)
    if m is None or not head.strip():
        return None
    labels_raw = m.group("l1") if m.group("l1") is not None else m.group("l2")
    labels = [s.strip() for s in (labels_raw or "").split(",") if s.strip()]
    if m.group("cond"):
        ctx.report.note("condition_dropped", ctx.current, f"if {m.group('cond').strip()}")
    weight = _weight(m.group("w") or 1)
    return (weight, labels, m.group("else") is not None, m.group("cmd") is not None)


def _weight(raw: Any) -> float:
    try:
        w = float(raw)
    except (TypeError, ValueError):
        return 1.0
    if w != w or w < 0:  # NaN or negative
        return 1.0
    return int(w) if w.is_integer() else w


def _truthy(raw: Any) -> bool:
    if raw is True:
        return True
    return isinstance(raw, str) and raw.strip().lower() in ("true", "yes", "on", "1")


def _include(text: str, ctx: _Ctx) -> str:
    """PPP `%include path/name` → a reference to that wildcard."""
    m = re.match(r"^\s*include\s+(\S+)\s*$", text)
    if m is None:
        ctx.report.note("command_dropped", ctx.current, text)
        return ""
    return convert_text(f"__{m.group(1)}__", ctx)


def _anonymous(items: list[Any], ctx: _Ctx) -> str:
    """A nested list inside a wildcard → an inline `{a|b}` pick."""
    branches: list[str] = []
    for item in items:
        if _is_params(item):
            ctx.report.note("default_params_dropped", ctx.current, _short(item))
            continue
        parsed = _parse_choice(item, ctx)
        if parsed is None:
            continue
        value, weight, labels, _ = parsed
        if labels:
            ctx.report.note("label_dropped", ctx.current, ",".join(labels))
        branches.append(value if weight == 1 else f"{weight}::{value}")
    if not branches:
        return ""
    if len(branches) == 1:
        return branches[0]
    return "{" + "|".join(branches) + "}"


# ---------------------------------------------------------------------------
# Text rewriting
# ---------------------------------------------------------------------------


def convert_text(text: str, ctx: _Ctx) -> str:
    """Rewrite one value's prompt text into Wildcard Pipeline syntax."""
    out: list[str] = []
    i = 0
    n = len(text)
    lit_start = 0

    def flush(end: int) -> None:
        if end > lit_start:
            out.append(_escape(text[lit_start:end]))

    while i < n:
        ch = text[i]
        if ch == "$" and text.startswith("${", i):
            end = _match_brace(text, i + 1)
            if end is not None:
                flush(i)
                out.append(_dp_variable(text[i:end + 1], ctx))
                i = lit_start = end + 1
                continue
        if ch == "%" and text.startswith("%{", i):
            ctx.report.note("wrap_kept_as_text", ctx.current, text)
        if ch == "{" and not (i > 0 and text[i - 1] in "$%"):
            end = _match_brace(text, i)
            if end is not None:
                flush(i)
                out.append(_variant(text[i + 1:end], ctx))
                i = lit_start = end + 1
                continue
        if ch == "_" or ch.isdigit():
            m = _REF_RE.match(text, i)
            if m is not None and (m.group("icount") or ch == "_"):
                flush(i)
                out.append(_reference(m, ctx))
                i = lit_start = m.end()
                continue
        i += 1
    flush(n)
    return "".join(out)


def _escape(literal: str) -> str:
    """Keep source text literal under our grammar: `$name` would read a
    variable and `@{xxxxxxxx}` would be a reference."""
    literal = re.sub(r"\$(?=[$A-Za-z_])", "$$", literal)
    return _WP_REF_START.sub(lambda m: "@" + m.group(0), literal)


def _match_brace(text: str, start: int) -> int | None:
    depth = 0
    for j in range(start, len(text)):
        c = text[j]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return j
    return None


def _split_top(text: str, sep: str) -> list[str]:
    parts: list[str] = []
    depth = 0
    last = 0
    j = 0
    while j < len(text):
        c = text[j]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        elif depth == 0 and text.startswith(sep, j):
            parts.append(text[last:j])
            j += len(sep)
            last = j
            continue
        j += 1
    parts.append(text[last:])
    return parts


def _variant(body: str, ctx: _Ctx) -> str:
    """`{…}` from the source → our inline pick or multi-pick."""
    stripped = body.lstrip()
    if stripped[:1] in ("~", "@") and "$$" not in _split_top(stripped, "|")[0]:
        body = stripped[1:]  # `{~a|b}` / `{@a|b}` sampler marks
    pieces = _split_top(body, "$$")
    count: tuple[int | None, int | None] | None = None
    repeat = False
    sep = ", "
    if len(pieces) >= 2:
        head = _PARAMS_RE.match(pieces[0])
        if head is not None and pieces[0].strip():
            rng = (head.group("range") or "").replace(" ", "")
            repeat = head.group("r") is not None
            if "-" in rng:
                lo, hi = rng.split("-", 1)
                count = (int(lo) if lo else 1, int(hi) if hi else None)
            elif rng:
                count = (int(rng), int(rng))
            else:
                count = (1, 1)
            if len(pieces) >= 3:
                sep = pieces[1]
                body = "$$".join(pieces[2:])
            else:
                body = pieces[1]
    branches = [_convert_branch(b, ctx) for b in _split_top(body, "|")]
    if count is None:
        if len(branches) == 1:
            return branches[0].split("::", 1)[-1] if _has_weight(branches[0]) else branches[0]
        return "{" + "|".join(branches) + "}"
    lo, hi = count
    if hi is None:
        hi = len(branches)
    if lo is None:
        lo = 1
    rng_txt = str(lo) if lo == hi else f"{min(lo, hi)}-{max(lo, hi)}"
    return "{" + rng_txt + ("~" if repeat else "") + "$$" + sep + "$$" + "|".join(branches) + "}"


def _has_weight(branch: str) -> bool:
    return re.match(r"^\s*(\d+(?:\.\d+)?|\.\d+)::", branch) is not None


def _convert_branch(branch: str, ctx: _Ctx) -> str:
    if "::" in branch:
        head, _, rest = branch.partition("::")
        parsed = _parse_options(head, ctx)
        if parsed is not None:
            weight, labels, is_else, command = parsed
            if labels:
                ctx.report.note("label_dropped", ctx.current, ",".join(labels))
            if is_else:
                ctx.report.note("inline_else_dropped", ctx.current, branch)
            value = _include(rest, ctx) if command else convert_text(rest, ctx)
            return value if weight == 1 else f"{weight}::{value}"
    return convert_text(branch, ctx)


def _dp_variable(raw: str, ctx: _Ctx) -> str:
    """Dynamic Prompts variables (`${x}`, `${x:default}`, `${x=…}`).

    A wildcard can't read a variable (it is a producer, so `$x` would
    print literally and warn every run), and assignments have no inline
    equivalent. Keep the text, which the engine leaves alone, and flag it
    so the user rebuilds the logic with a Combine.
    """
    ctx.report.note("variable_kept_as_text", ctx.current, raw)
    return raw


def _reference(m: re.Match[str], ctx: _Ctx) -> str:
    raw = m.group(0)
    name = m.group("name").strip().replace("\\", "/").strip("/")
    count_txt = m.group("icount")
    params = m.group("params")
    sep = m.group("sep")
    filt = m.group("f1") if m.group("f1") is not None else m.group("f2")
    if m.group("args"):
        ctx.report.note("template_args_dropped", ctx.current, raw)

    target = _resolve_target(name, ctx)
    if target is None:
        ctx.report.note("unresolved_reference", ctx.current, raw)
        return _escape(raw)

    ref = target
    expr = _filter_expr(filt, raw, ctx) if filt else ""
    if expr and target.startswith("\x00"):
        # A group wildcard has no labels of its own to filter on.
        ctx.report.note("filter_dropped", ctx.current, raw)
    elif expr:
        ref = target[:-1] + f":{expr}}}"

    lo = hi = 1
    repeat = False
    if count_txt:
        lo = hi = int(count_txt)
    elif params:
        head = _PARAMS_RE.match(params)
        if head is not None:
            rng = (head.group("range") or "").replace(" ", "")
            repeat = head.group("r") is not None
            if "-" in rng:
                a, b = rng.split("-", 1)
                lo = int(a) if a else 1
                if b:
                    hi = int(b)
                else:
                    # Open range: up to every value. A pick over one ref
                    # never takes more unique values than the target has,
                    # so its size is a safe ceiling.
                    hi = max(lo, _pool_size(name, ctx))
                    if repeat:
                        ctx.report.note("multi_pick_range_capped", ctx.current, raw)
            elif rng:
                lo = hi = int(rng)
    if hi <= 1 and lo <= 1:
        return ref
    # `{N$$sep$$@{x}}` draws N different values of x, which is exactly
    # what the source does; `~` allows repeats like the `r` flag.
    rng_txt = str(lo) if lo == hi else f"{lo}-{hi}"
    sep_txt = sep if sep is not None else ", "
    return "{" + rng_txt + ("~" if repeat else "") + "$$" + sep_txt + "$$" + ref + "}"


def _pool_size(name: str, ctx: _Ctx) -> int:
    key = _norm(name)
    wc = ctx.by_path.get(key)
    if wc is not None:
        return max(1, len(wc.items))
    members = [w for w in ctx.all_wildcards if fnmatch.fnmatchcase(_norm(w.path), key)]
    return max(1, sum(len(w.items) for w in members)) if members else 3


def _filter_expr(filt: str, raw: str, ctx: _Ctx) -> str:
    """PPP filter `'a,b+c'` → `a or (b and c)`; positional parts dropped."""
    filt = filt.lstrip("#")
    if filt.startswith("^"):
        ctx.report.note("filter_dropped", ctx.current, raw)
        return ""
    ors: list[str] = []
    for part in filt.split(","):
        ands = []
        for token in part.split("+"):
            token = token.strip()
            if not token:
                continue
            if re.fullmatch(r"\d+(-\d*)?|-\d+", token):
                ctx.report.note("filter_dropped", ctx.current, raw)
                ands = []
                break
            tag = _slug_tag(token)
            if tag is None:
                ands = []
                break
            ands.append(tag)
        if ands:
            ors.append(ands[0] if len(ands) == 1 else "(" + " and ".join(ands) + ")")
    return " or ".join(ors)


def _resolve_target(name: str, ctx: _Ctx) -> str | None:
    target = _find_target(name, ctx)
    if target is not None:
        cur = _norm(ctx.current)
        ctx.ref_counts[cur] = ctx.ref_counts.get(cur, 0) + 1
    return target


def _edge(target: str, ctx: _Ctx) -> None:
    cur = _norm(ctx.current)
    if target != cur:  # a list that names itself is still unreferenced
        ctx.edges.setdefault(cur, set()).add(target)


def _find_target(name: str, ctx: _Ctx) -> str | None:
    key = _norm(name)
    if "*" in key:
        return _group_ref(key, name, ctx)
    wc = ctx.by_path.get(key) or ctx.impact_path.get(key.replace(" ", "-"))
    if wc is None:
        # Dynamic Prompts / Impact also accept a name relative to any
        # folder; take a unique suffix match.
        hits = [w for k, w in ctx.by_path.items() if k.endswith("/" + key)]
        if len(hits) == 1:
            wc = hits[0]
    if wc is not None:
        _edge(_norm(wc.path), ctx)
        return f"@{{{wc.id}#{wc.name}}}"
    lib = ctx.library.get(key) or ctx.library.get(_display_name(name).lower())
    if lib is not None:
        return f"@{{{lib}#{_display_name(name)}}}"
    # Impact Pack: a folder / YAML key names every wildcard beneath it.
    if any(k.startswith(key + "/") for k in ctx.by_path):
        return _group_ref(key + "/*", name + "/*", ctx)
    return None


def _group_ref(pattern: str, display: str, ctx: _Ctx) -> str | None:
    if pattern not in ctx.groups:
        if pattern.endswith("/**"):
            base = pattern[:-3]
            members = [w for w in ctx.all_wildcards if _norm(w.path).startswith(base + "/")]
        else:
            members = [w for w in ctx.all_wildcards if fnmatch.fnmatchcase(_norm(w.path), pattern)]
        if not members:
            return None
        ctx.groups[pattern] = _Group(pattern, members, display)
    _edge(pattern, ctx)
    return f"\x00group:{pattern}\x00"


__all__ = [
    "SourceFile", "convert_files", "is_wildcard_file", "read_zip", "WILDCARD_EXTENSIONS",
]
