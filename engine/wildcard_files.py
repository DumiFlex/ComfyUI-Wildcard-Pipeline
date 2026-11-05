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
from engine.wildcard_logic import (
    MODEL_FAMILIES,
    MODEL_VARIANTS,
    UMI_QUERY_RE,
    cond_vars,
    eval_condition,
    extract_negatives,
    model_env,
    model_source,
    normalize_ppp,
    parse_condition,
    parse_umi_query,
    split_ppp_if,
    umi_matches,
)

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
# Umi AI tag queries: `<[tag]>`, `<[a][b]>`, `<[a|b]>`, `<[--a]>`, `<file:[tag]>`.
_UMI_QUERY_RE = re.compile(r"<(?P<file>[\w .\-/]+)?:?\[(?P<body>[^<>]*?)\]>")
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
    "command_dropped", "ppp_directive_kept_as_text", "tag_query_kept_as_text",
    "tag_query_no_match", "negative_dropped", "variable_read_in_nested_list",
    "too_many_copies",
})
_CLOSE_KINDS = frozenset({
    "default_params_dropped", "label_dropped", "extra_else_dropped",
    "inline_else_dropped", "multi_pick_range_capped", "merged_fallback_dropped",
    "affixes_per_pick", "immediate_variable_as_macro", "negative_moved_to_option",
})

# Merging: a folder of small related lists (hair/colors/red.txt,
# hair/colors/blonde.txt, …) becomes ONE wildcard whose options carry the
# list names as tags, like a hand-built wildcard with tag groups. A folder
# merges when it holds at least two lists, at most this many options in
# total and at most this many folder levels below it.
MERGE_MAX_OPTIONS = 1000
MERGE_MAX_DEPTH = 3

_GENDER_TAGS = frozenset({
    "male", "female", "man", "woman", "men", "women", "boy", "girl", "boys",
    "girls", "masculine", "feminine", "unisex", "neutral", "androgynous",
})

# `@{id#name}` / `@{id#name:expr}` as the converter writes them. Names
# never hold `}` or `:` (_NAME_FORBIDDEN), so the match can't overrun.
_OWN_REF_RE = re.compile(r"@\{([0-9a-f]{8})#([^}:]*)(?::([^}]*))?\}")


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
    # PPP default parameters (first choice `2-3$$, $$` or an object):
    # see :func:`_read_defaults`. A reference with no parameters of its
    # own uses these, as PPP does.
    defaults: dict[str, Any] | None = None
    # An Umi AI YAML file (prompt text as keys, a `Tags:` list each).
    umi: bool = False
    # Tag axes to store on the row (Umi `Yaml Tags.txt` headers).
    tag_groups: dict[str, list[str]] = field(default_factory=dict)
    # Umi files are split into layers so a query never reaches its own
    # entry (see _umi_layers); 0 for everything else.
    layer: int = 0
    # The variable a generated wildcard writes (default: from the path).
    binding: str | None = None
    # Built by the converter (a variable setter, a part of a stack, a
    # specialised copy): never merged, never an entry point of its own.
    generated: bool = False
    # A specialised copy (`__t(x=v)__`): the variables its text reads,
    # bound to the source text that replaces each read.
    copy_env: dict[str, str] | None = None


@dataclass
class _Group:
    pattern: str
    members: list[_Wildcard]
    display: str
    id: str = ""
    name: str = ""


@dataclass
class _Merge:
    """Lists folded into one tagged wildcard. ``root`` is the folder's
    display path; each member's options carry one tag per path segment
    below it (``female/footwear`` → ``female``, ``footwear``), and
    ``expr`` is the filter that picks exactly that member's options."""

    root: str
    members: list[_Wildcard]
    id: str = ""
    name: str = ""
    expr: dict[str, str] = field(default_factory=dict)
    member_tags: dict[str, list[str]] = field(default_factory=dict)
    tag_groups: dict[str, list[str]] = field(default_factory=dict)
    # Set for a table / grid (see :func:`_choose_grids`): the list name
    # every member shares. Members are then tagged by the folders BETWEEN
    # the root and that name, and the wildcard is named ``root/leaf``.
    leaf: str | None = None

    @property
    def display(self) -> str:
        return f"{self.root}/{self.leaf}" if self.leaf else self.root

    @property
    def separate_key(self) -> str:
        """What ``keep_separate`` takes to undo this merge."""
        return f"{self.root}/*/{self.leaf}" if self.leaf else self.root


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
    umi_axes: dict[str, list[str]] | None = None,
) -> list[_Wildcard]:
    """Turn files into wildcards (raw items, not yet converted).

    An Umi AI ``Yaml Tags.txt`` is not a list: its ``Header:`` blocks name
    tag axes, which go to ``umi_axes``."""
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
            if ext == ".txt" and pure.name.lower() == "yaml tags.txt":
                axes = _read_umi_axes(text)
                if axes:
                    if umi_axes is not None:
                        umi_axes.update(axes)
                    entry["status"] = "axes"
                    continue
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
        umi_items = _umi_items(data) if isinstance(data, dict) else None
        if umi_items is not None:
            found.append(_Wildcard(stem_path, rel, umi_items, umi=True))
        elif isinstance(data, dict):
            _walk_dict(data, folder, rel, found, report)
        elif isinstance(data, list):
            found.append(_Wildcard(stem_path, rel, data))
        elif isinstance(data, (str, int, float)) and str(data).strip():
            found.append(_Wildcard(stem_path, rel, [str(data)]))
        else:
            entry["status"] = "empty"
        entry["wildcards"] = len(found) - before
    return found


def _umi_items(data: dict[Any, Any]) -> list[dict[str, Any]] | None:
    """An Umi AI YAML file: each key is a prompt, each value holds a
    ``Tags`` list. Returns PPP-style ``{text, labels}`` items, or None
    when the file isn't shaped like that."""
    tagged = 0
    for value in data.values():
        if isinstance(value, dict) and any(str(k).casefold() == "tags" for k in value):
            tagged += 1
    if not data or tagged * 2 < len(data):
        return None
    items: list[dict[str, Any]] = []
    for key, value in data.items():
        if key is None or not str(key).strip():
            continue
        tags: list[str] = []
        if isinstance(value, dict):
            raw = next((v for k, v in value.items() if str(k).casefold() == "tags"), None)
            if isinstance(raw, str):
                raw = [raw]
            tags = [str(t).strip() for t in raw or [] if str(t).strip()]
        items.append({
            "text": str(key),
            "labels": [t for t in (_umi_tag(x) for x in tags) if t],
            "umi_tags": {t.casefold() for t in tags},
        })
    return items


def _umi_tag(label: str) -> str | None:
    """Umi tags compare without case: store them lowercased."""
    return _slug_tag(label.casefold())


def _read_umi_axes(text: str) -> dict[str, list[str]]:
    """``Header:`` followed by ``- tag`` lines → ``{header: [tags]}``."""
    axes: dict[str, list[str]] = {}
    current: str | None = None
    for line in text.split("\n"):
        s = line.strip()
        if not s:
            continue
        if s.endswith(":") and not s.startswith("-"):
            current = s[:-1].strip()
            axes.setdefault(current, [])
        elif s.startswith("-") and current is not None:
            tag = _umi_tag(s[1:].strip().strip("'\""))
            if tag and tag not in axes[current]:
                axes[current].append(tag)
        else:
            return {}
    return {k: v for k, v in axes.items() if v}


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
    # Ids already in the user's library: a reference the upload can't
    # resolve still links to a wildcard an earlier import of the same
    # pack created (ids are derived from the path).
    library_ids: set[str] = field(default_factory=set)
    # Which tool the pack was written for (see :func:`detect_dialect`).
    dialect: str = "mixed"
    # The wildcard the last resolved reference points at, or None for a
    # group / library target: lets `_reference` read its defaults.
    target: _Wildcard | None = None
    # --- logic layer (P3) ---
    current_wc: _Wildcard | None = None
    used_ids: set[str] = field(default_factory=set)
    # Macro variables in effect while converting one value: `${x=v}`
    # assignments and `__t(x=v)__` arguments, by name → source text.
    env: dict[str, str] = field(default_factory=dict)
    # While converting a line of an entry point: the variables it sets
    # with `${x=!v}` (rolled once) and the ones it reads that nothing
    # sets (template slots). Reads of both become `$x` in a Combine.
    line_vars: dict[str, dict[str, Any]] | None = None
    # Negative text pulled out of the value being converted.
    negatives: list[str] = field(default_factory=list)
    depth: int = 0
    # Raw scan: the variables each wildcard reads, what it references.
    reads: dict[str, set[str]] = field(default_factory=dict)
    raw_refs: dict[str, set[str]] = field(default_factory=dict)
    entry_keys: set[str] = field(default_factory=set)
    copies: dict[tuple[str, tuple[tuple[str, str], ...]], _Wildcard] = field(default_factory=dict)
    pending: list[_Wildcard] = field(default_factory=list)
    # Stacks: ordered module lists that run together (see _line_stack).
    stacks: list[dict[str, Any]] = field(default_factory=list)
    extra_rows: list[dict[str, Any]] = field(default_factory=list)
    # Variable → the stacks whose setter writes it, for constraints.
    setters: dict[str, list[tuple[dict[str, Any], tuple[str, Any, dict[str, Any]]]]] = (
        field(default_factory=dict)
    )
    # (wildcard, option id, condition AST) for PPP `if` conditions.
    option_conds: list[tuple[_Wildcard, str, Any]] = field(default_factory=list)
    # Lists a merge must leave alone: the ones a setter rolls a variable
    # from when a condition tests that variable (a constraint needs that
    # list's own options as its source).
    merge_held: set[str] = field(default_factory=set)
    # Umi AI: every tagged entry, for `<[tag]>` queries.
    umi_db: list[dict[str, Any]] = field(default_factory=list)
    umi_axes: dict[str, list[str]] = field(default_factory=dict)
    # Wildcards the logic layer built (setters, stack parts, model checks).
    pending_generated: list[_Wildcard] = field(default_factory=list)
    reads_memo: dict[str, set[str]] = field(default_factory=dict)
    umi_tagsets: dict[int, set[str]] = field(default_factory=dict)
    model_stacks: dict[str, dict[str, Any]] = field(default_factory=dict)


def convert_files(
    files: list[SourceFile],
    *,
    library_wildcards: dict[str, str] | None = None,
    pack_tag: str | None = None,
    category_name: str | None = None,
    exclude: set[str] | None = None,
    make_bundles: bool = True,
    pack_name: str | None = None,
    merge: bool = True,
    keep_separate: set[str] | None = None,
    library_ids: set[str] | None = None,
    dialect: str | None = None,
    axis_names: dict[str, dict[str, str]] | None = None,
    bundle_mode: str | None = None,
    samples: int = 3,
    fold_copies: bool = True,
) -> dict[str, Any]:
    """Convert wildcard files into ``{"payload": envelope, "report": …}``.

    ``library_wildcards`` maps existing library wildcard names to ids, so
    a reference to a wildcard that isn't in the upload can still link to
    one the user already has. ``pack_tag`` adds a library tag to every
    imported module. ``category_name`` overrides the per-folder category.
    ``exclude`` lists file paths (as the report names them) to leave out.
    ``make_bundles`` also files the wildcards into bundles: one inner
    bundle per top folder (or top YAML key), inside one pack bundle named
    ``pack_name`` — our one level of bundle nesting. ``merge`` folds
    folders of related lists into one tagged wildcard each (see
    :func:`_choose_merges`); ``keep_separate`` lists folders (as the plan
    names them) whose lists stay one wildcard each. ``library_ids`` are
    the ids already in the library (see :class:`_Ctx`). ``dialect``
    forces the source tool instead of detecting it (``dynamicprompts``,
    ``ppp``, ``impact``, ``umi`` or ``mixed``). ``axis_names`` renames
    the tag groups of a merged wildcard: ``{wildcard name: {old: new}}``.
    ``bundle_mode`` picks the bundles: ``stacks`` (the default: one per
    stack of modules that must run together, see :func:`_line_stack`),
    ``entries`` (also one per top folder holding its entry points, the
    older layout) or ``none``; ``make_bundles=False`` means ``none``.
    ``samples`` rolls each entry point and stack that many times with the
    engine, for the review. ``fold_copies`` folds entry points that differ
    only by one tag into one wildcard steered by a source (see
    :func:`_fold_copies`).
    """
    if bundle_mode not in ("stacks", "entries", "none"):
        bundle_mode = "stacks"
    if not make_bundles:
        bundle_mode = "none"
    report = _Report()
    umi_axes: dict[str, list[str]] = {}
    wildcards: list[_Wildcard] = []
    seen: dict[str, _Wildcard] = {}
    for wc in _collect(files, report, exclude or set(), umi_axes):
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
    wildcards, umi_db = _umi_layers(wildcards)

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
        library_ids=set(library_ids or ()),
        used_ids=used_ids,
        umi_db=umi_db,
        umi_axes=umi_axes,
    )
    detected = detect_dialect(wildcards)
    ctx.dialect = dialect if dialect in DIALECTS else detected["dialect"]
    _scan_raw(wildcards, ctx)
    # Defaults first: a reference reads its target's defaults, and the
    # target may come later in the pack.
    for wc in wildcards:
        ctx.current = wc.path
        _read_defaults(wc, ctx)
    for wc in wildcards:
        ctx.current = wc.path
        _convert_wildcard(wc, ctx)
    # Specialised copies (`__t(x=v)__`) can ask for more copies.
    while ctx.pending:
        copy = ctx.pending.pop(0)
        ctx.current = copy.path
        _convert_wildcard(copy, ctx)
        wildcards.append(copy)
    for _wc, _, cond in ctx.option_conds:
        src = model_source(cond)
        if src is not None:
            _model_stack(src, ctx)
    wildcards.extend(ctx.pending_generated)
    stacked = {_norm(st["entry"].path) for st in ctx.stacks if st.get("entry") is not None}

    for grp in ctx.groups.values():
        grp.id = _unique_id(_short_hash("group", grp.pattern), used_ids)
        grp.name = _display_name(grp.display)

    merges: list[_Merge] = []
    if merge:
        # What the converter built stays as it is: never merged.
        base = [w for w in wildcards if not w.generated]
        ctx.merge_held = _condition_sources(ctx)
        grids = _choose_grids(base, ctx, keep_separate or set())
        merges = _choose_merges(base, ctx, keep_separate or set(), grids)
    for m in merges:
        kind = "grid" if m.leaf else "merge"
        m.id = _unique_id(_short_hash(kind, _norm(m.display)), used_ids)
        m.name = _display_name(m.display)
        _tag_merge(m, ctx)
        _rename_axes(m, (axis_names or {}).get(m.name) or {})
    retarget = {_norm(w.path): (m, m.expr[_norm(w.path)]) for m in merges for w in m.members}
    collapsed = _collapse_groups(merges, ctx)

    # Options are converted before group ids exist; patch the placeholders.
    placeholders = {
        f"\x00group:{p}\x00": collapsed.get(p) or f"@{{{g.id}#{g.name}}}"
        for p, g in ctx.groups.items()
    }
    by_id = {w.id: _norm(w.path) for w in wildcards}

    def point(value: str) -> str:
        """Re-aim a reference to a merged list at the merged wildcard,
        filtered by the list's tag."""
        def sub(mm: re.Match[str]) -> str:
            hit = retarget.get(by_id.get(mm.group(1), ""))
            if hit is None:
                return mm.group(0)
            m, own = hit
            expr = own if not mm.group(3) else f"{own} and ({mm.group(3)})"
            return f"@{{{m.id}#{m.name}:{expr}}}"
        return _OWN_REF_RE.sub(sub, value) if retarget else value

    for wc in wildcards:
        for opt in wc.options:
            if "\x00group:" in opt["value"]:
                for ph, ref in placeholders.items():
                    opt["value"] = opt["value"].replace(ph, ref)
            opt["value"] = point(opt["value"])

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
            if _norm(wc.path) not in stacked:
                report.note("empty_wildcard", wc.path, "no usable values")
            continue
        if _norm(wc.path) in retarget:
            continue
        if wc.generated and not wc.copy_env:
            description = f"Built by the import ({wc.source or 'model checks'})"
        else:
            description = f"Imported from {wc.source}"
        comments = wc.comments + ctx.comments.get(wc.path, [])
        if comments:
            description += "\n\n" + "\n".join(comments)
        payload_w: dict[str, Any] = {
            "var_binding": wc.binding or _ident(wc.path.split("/")[-1]),
            "sub_categories": wc.sub_categories,
            "options": wc.options,
        }
        if wc.tag_groups:
            payload_w["tag_groups"] = wc.tag_groups
        rows.append(_module_row(
            wc.id, wc.name, description[:_MAX_DESCRIPTION_LEN],
            category_for(wc.path) if wc.source else None, tags, payload_w,
        ))
    for m in merges:
        rows.append(_merge_row(m, category_for(m.members[0].path), tags, ctx))
    kept = {r["id"] for r in rows}
    for grp in ctx.groups.values():
        if grp.pattern in collapsed:
            continue
        members = [
            m for m in grp.members if m.id in kept or _norm(m.path) in retarget
        ]
        options = [
            {
                "id": _short_hash(grp.pattern, m.id),
                "value": point(f"@{{{m.id}#{m.name}}}"),
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
    rows_by_id = {r["id"]: r for r in rows}
    _build_constraints(ctx, rows_by_id, retarget)
    if fold_copies:
        roles = {p["id"]: p["role"] for p in _plan(rows, wildcards, ctx, merges, collapsed)}
        folded = _fold_copies(rows, roles, ctx)
        if folded:
            rows = [r for r in rows if r["id"] not in folded]
            rows_by_id = {r["id"]: r for r in rows}
    logic_rows: list[dict[str, Any]] = []
    for st in ctx.stacks:
        for kind, obj, _inst in st["children"]:
            if kind == "row" and obj["id"] not in rows_by_id:
                entry = st.get("entry")
                folder = st.get("folder")
                row = _module_row(
                    obj["id"], obj["name"], obj["description"][:_MAX_DESCRIPTION_LEN],
                    category_for(entry.path if entry is not None else folder or "")
                    if entry is not None or folder else None,
                    tags, obj["payload"], mtype=obj["type"],
                )
                rows_by_id[row["id"]] = row
                if row["type"] == "wildcard":
                    rows.append(row)
                else:
                    logic_rows.append(row)
    stacks = _finish_stacks(ctx, rows_by_id, retarget)
    plan = _plan(rows, wildcards, ctx, merges, collapsed)
    plan.extend(_stack_plan(stacks, ctx))
    entry_ids = {p["id"] for p in plan if p["role"] == "entry"}
    entries = [r for r in rows if r["id"] in entry_ids]
    bundles: list[dict[str, Any]] = []
    if bundle_mode == "entries":
        bundles = _build_bundles(entries, used_ids, tags, pack_name)
    if bundle_mode != "none":
        bundles += _stack_bundles(stacks, used_ids, tags)
    by_type: dict[str, list[dict[str, Any]]] = {}
    for row in logic_rows:
        by_type.setdefault(row["type"], []).append(row)
    payload = {
        "schema_version": 2,
        "bundles": bundles,
        "wildcards": rows,
        "fixed_values": [],
        "combines": by_type.get("combine", []),
        "derivations": by_type.get("derivation", []),
        "constraints": by_type.get("constraint", []),
        "categories": list(categories.values()),
        "templates": [],
    }
    if samples > 0:
        _roll_samples(plan, payload, stacks, samples)
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
            "merged": len(merges),
            "merged_lists": sum(len(m.members) for m in merges),
            "stacks": len(stacks),
            "constraints": len(by_type.get("constraint", [])),
            "combines": len(by_type.get("combine", [])),
            "bundle_mode": bundle_mode,
            "dialect": ctx.dialect,
            "dialect_detected": detected["dialect"],
            "dialect_evidence": detected["evidence"],
            "plan": plan,
        },
    }


def _plan(
    rows: list[dict[str, Any]], wildcards: list[_Wildcard], ctx: _Ctx,
    merges: list[_Merge] | None = None, collapsed: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """One entry per imported row: its role in the pack and how
    faithfully it came across.

    Roles: ``vocabulary`` (a plain list, no references), ``composition``
    (references other wildcards and is referenced itself), ``entry``
    (references others and nothing in the pack references it: what a
    user drops on a Context) and ``group`` (generated for a glob or a
    parent key). A merged wildcard takes the role its lists add up to
    and lists them in ``merged_from``.
    """
    by_id = {w.id: w for w in wildcards}
    referenced = _referenced(ctx)
    group_by_id = {g.id: g for g in ctx.groups.values()}
    merge_by_id = {m.id: m for m in merges or []}
    out: list[dict[str, Any]] = []
    for row in rows:
        wc = by_id.get(row["id"])
        grp = group_by_id.get(row["id"])
        mrg = merge_by_id.get(row["id"])
        if mrg is not None:
            out.append(_merge_plan(row, mrg, ctx, referenced, collapsed or {}))
            continue
        if grp is not None:
            path, key = grp.display, grp.pattern
            role, refs = "group", len(row["payload"]["options"])
        elif wc is not None:
            path, key = wc.path, _norm(wc.path)
            refs = ctx.ref_counts.get(key, 0)
            if wc.copy_env:
                role = "copy"
            elif wc.generated:
                role = "stack part"
            elif refs == 0:
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


def _merge_plan(
    row: dict[str, Any], m: _Merge, ctx: _Ctx, referenced: dict[str, int],
    collapsed: dict[str, str],
) -> dict[str, Any]:
    keys = {_norm(w.path) for w in m.members}
    refs = sum(ctx.ref_counts.get(k, 0) for k in keys)
    inside = sum(
        1 for src, targets in ctx.edges.items() if src in keys
        for t in targets if t in keys
    )
    from_groups = sum(
        referenced.get(p, 0) for p, ref in collapsed.items() if f"@{{{m.id}#" in ref
    )
    by_ref = sum(referenced.get(k, 0) for k in keys) - inside + from_groups
    if refs == 0:
        role = "vocabulary"
    elif by_ref:
        role = "composition"
    else:
        role = "entry"
    kinds: set[str] = set()
    notes: list[dict[str, str]] = []
    for w in m.members:
        kinds |= ctx.report.kinds_by_wildcard.get(w.path, set())
        for n in ctx.report.by_wildcard.get(w.path, []):
            if len(notes) < _MAX_WILDCARD_NOTES:
                rel = w.path[len(m.root) + 1:]
                notes.append({"kind": n["kind"], "detail": f"{rel}: {n['detail']}"})
    fidelity = (
        "lossy" if kinds & _LOSSY_KINDS else "close" if kinds & _CLOSE_KINDS else "exact"
    )
    return {
        "id": row["id"],
        "name": row["name"],
        "domain": m.root.split("/", 1)[0] if "/" in m.root else "",
        "role": role,
        "options": len(row["payload"]["options"]),
        "refs": refs,
        "referenced_by": by_ref,
        "fidelity": fidelity,
        "notes": notes,
        "source": m.members[0].source,
        "merge_root": m.root,
        "separate_key": m.separate_key,
        "structure": "table" if m.leaf else "folder",
        "merged_from": [
            {
                "name": w.path[len(m.root) + 1:],
                "tag": m.expr[_norm(w.path)],
                "options": len(w.options),
            }
            for w in m.members
        ],
        "tag_groups": [
            {"name": g, "tags": len(t)} for g, t in m.tag_groups.items()
        ],
    }


def _referenced(ctx: _Ctx) -> dict[str, int]:
    """How many references point at each wildcard (by normalised path)
    or group pattern; membership of a group counts as one."""
    out: dict[str, int] = {}
    for targets in ctx.edges.values():
        for t in targets:
            out[t] = out.get(t, 0) + 1
    for g in ctx.groups.values():
        for m in g.members:
            key = _norm(m.path)
            out[key] = out.get(key, 0) + 1
    return out


def _condition_sources(ctx: _Ctx) -> set[str]:
    """Paths of the lists setters roll a condition-tested variable from."""
    tested: set[str] = set()
    for _wc, _oid, cond in ctx.option_conds:
        if model_source(cond) is None:
            tested |= set(cond_vars(cond))
    out: set[str] = set()
    for var in tested:
        for _stack, spec in ctx.setters.get(var, []):
            w = spec[1]
            if isinstance(w, _Wildcard):
                out.add(_norm(w.path))
    return out


def _choose_merges(
    wildcards: list[_Wildcard], ctx: _Ctx, keep_separate: set[str],
    grids: list[_Merge] | None = None,
) -> list[_Merge]:
    """Pick the folders whose lists become one tagged wildcard.

    Walks each top folder downwards and merges the highest folder that
    holds at least two lists, at most :data:`MERGE_MAX_OPTIONS` options
    and at most :data:`MERGE_MAX_DEPTH` levels; a folder too big for that
    is split into its subfolders, and the lists sitting directly in it
    merge on their own. Left out: entry points (what a user drops on a
    Context, so they stay one module each), lists that reference
    themselves, folders that are also a list's name, and any folder in
    ``keep_separate`` (with everything below it).
    """
    referenced = _referenced(ctx)
    blocked = {_norm(k) for k in keep_separate if k.strip()}
    names = {_norm(w.path) for w in wildcards}
    claimed = {_norm(w.path) for g in grids or [] for w in g.members}
    claimed |= _grid_kept_apart(wildcards, blocked)

    def eligible(w: _Wildcard) -> bool:
        key = _norm(w.path)
        if not w.options or "/" not in key or key in claimed or key in ctx.merge_held:
            return False
        if any(key.startswith(b + "/") or key == b for b in blocked):
            return False
        if ctx.ref_counts.get(key, 0) and not referenced.get(key):
            return False  # an entry point
        own = f"@{{{w.id}#"
        return not any(own in o["value"] for o in w.options)

    tree: dict[str, list[_Wildcard]] = {}
    for w in wildcards:
        if not eligible(w):
            continue
        parts = _norm(w.path).split("/")
        for i in range(1, len(parts)):
            tree.setdefault("/".join(parts[:i]), []).append(w)

    merges: list[_Merge] = []
    done: set[str] = set()

    def depth(w: _Wildcard) -> int:
        return _norm(w.path).count("/") + 1

    def take(node: str, lists: list[_Wildcard]) -> None:
        # Start at the deepest folder the lists share: a level every
        # list has in common would be a tag on every option.
        segs = lists[0].path.replace("\\", "/").strip("/").split("/")
        keys = [_norm(w.path).split("/") for w in lists]
        n = node.count("/") + 1
        while all(len(k) > n + 1 and k[n] == keys[0][n] for k in keys):
            if "/".join(keys[0][: n + 1]) in names:
                break
            n += 1
        root = "/".join(segs[:n])
        merges.append(_Merge(root=root, members=list(lists)))
        done.update(_norm(w.path) for w in lists)

    def visit(node: str) -> None:
        lists = [w for w in tree.get(node, []) if _norm(w.path) not in done]
        if len(lists) < 2:
            return
        base = node.count("/") + 1
        levels = max(depth(w) - base for w in lists)
        total = sum(len(w.options) for w in lists)
        mergeable = node not in names and node not in blocked
        if mergeable and levels <= MERGE_MAX_DEPTH and total <= MERGE_MAX_OPTIONS:
            take(node, lists)
            return
        for child in sorted({
            "/".join(_norm(w.path).split("/")[: base + 1]) for w in lists
        }):
            if child in tree:
                visit(child)
        direct = [w for w in lists if depth(w) == base + 1 and _norm(w.path) not in done]
        if (
            mergeable and len(direct) >= 2
            and sum(len(w.options) for w in direct) <= MERGE_MAX_OPTIONS
        ):
            take(node, direct)

    for top in sorted({k.split("/", 1)[0] for k in tree}):
        visit(top)
    return _break_cycles([*(grids or []), *merges], ctx)


#: A table or grid needs the shared list name in at least this many
#: sibling folders, and at most this many options per merged wildcard.
GRID_MIN_RECORDS = 3
GRID_MAX_OPTIONS = 2000


def _grid_kept_apart(wildcards: list[_Wildcard], blocked: set[str]) -> set[str]:
    """Lists the user un-merged from a table (``root/*/leaf`` keys): they
    stay one wildcard each, so folder merging leaves them alone too."""
    out: set[str] = set()
    for key in blocked:
        if "/*/" not in key:
            continue
        root, leaf = key.rsplit("/*/", 1)
        for w in wildcards:
            k = _norm(w.path)
            if k.startswith(root + "/") and k.rsplit("/", 1)[-1] == leaf:
                out.add(k)
    return out


def _choose_grids(
    wildcards: list[_Wildcard], ctx: _Ctx, keep_separate: set[str],
) -> list[_Merge]:
    """Find tables and grids: folders whose subfolders repeat the same
    list names, like ``magical-beings/<161 beings>/{name, prompt}`` or
    ``clothings/<era>/<gender>/<slot>``.

    Each shared list name becomes ONE wildcard across the subfolders
    (``magical-beings/prompt``), its options tagged by the folders in
    between (the being; the era and gender), one tag group per level.
    That turns a folder dimension into an axis you can filter or steer,
    where merging by folder would give one wildcard per era. A reference
    to one list becomes the merged wildcard filtered by its folders.

    A folder qualifies when at least two list names each appear under
    :data:`GRID_MIN_RECORDS` of its subfolders and those names cover
    most of the lists below it. Unlike folder merging, entry points
    merge too: a table's prompt lists become one entry wildcard. Shallow
    folders are tried first; what a grid doesn't take is left for
    :func:`_choose_merges`.
    """
    blocked = {_norm(k) for k in keep_separate if k.strip()}
    names = {_norm(w.path) for w in wildcards}

    def usable(w: _Wildcard) -> bool:
        key = _norm(w.path)
        if not w.options or key.count("/") < 2 or key in ctx.merge_held:
            return False
        if any(key.startswith(b + "/") or key == b for b in blocked if "/*/" not in b):
            return False
        own = f"@{{{w.id}#"
        return not any(own in o["value"] for o in w.options)

    tree: dict[str, list[_Wildcard]] = {}
    for w in wildcards:
        if not usable(w):
            continue
        parts = _norm(w.path).split("/")
        for i in range(1, len(parts) - 1):
            tree.setdefault("/".join(parts[:i]), []).append(w)

    grids: list[_Merge] = []
    done: set[str] = set()
    for folder in sorted(tree, key=lambda f: (f.count("/"), f)):
        under = [w for w in tree[folder] if _norm(w.path) not in done]
        base = folder.count("/") + 1
        by_leaf: dict[str, list[_Wildcard]] = {}
        for w in under:
            rel = _norm(w.path).split("/")[base:]
            if len(rel) >= 2:
                by_leaf.setdefault(rel[-1], []).append(w)
        good: dict[str, list[_Wildcard]] = {}
        kept = 0  # lists of columns the user kept apart still count
        for leaf, ws in by_leaf.items():
            if f"{folder}/{leaf}" in names:
                continue
            firsts = {_norm(w.path).split("/")[base] for w in ws}
            if len(firsts) < GRID_MIN_RECORDS:
                continue
            if sum(len(w.options) for w in ws) > GRID_MAX_OPTIONS:
                continue
            if not _tags_tell_apart(ws, base):
                continue
            if f"{folder}/*/{leaf}" in blocked:
                kept += len(ws)
                continue
            good[leaf] = ws
        if not good or len(good) + (1 if kept else 0) < 2:
            continue
        covered = sum(len(ws) for ws in good.values()) + kept
        if covered * 2 < len(under):
            continue  # a few shared names in a folder of other things
        display = "/".join(
            next(iter(good.values()))[0].path.replace("\\", "/").strip("/").split("/")[: base],
        )
        for leaf, ws in sorted(good.items()):
            grids.append(_Merge(root=display, members=list(ws), leaf=leaf))
            done.update(_norm(w.path) for w in ws)
    return grids


def _tags_tell_apart(ws: list[_Wildcard], base: int) -> bool:
    """True when each list's folders (level, name) pick it alone: no
    list's folders are all among another's, as with ``x/female/top``
    next to ``x/female/dress/top``."""
    sets = [
        frozenset(enumerate(_norm(w.path).split("/")[base:-1]))
        for w in ws
    ]
    for i, a in enumerate(sets):
        for j, b in enumerate(sets):
            if i != j and a <= b:
                return False
    return True


_NO_SINGULAR = frozenset({"clothes", "clothing", "series", "species", "news", "pants", "glasses"})


def _singular(word: str) -> str:
    w = word.strip()
    if w.lower() in _NO_SINGULAR:
        return w
    if w.endswith("ies") and len(w) > 4:
        return w[:-3] + "y"
    if w.endswith("s") and not w.endswith("ss") and len(w) > 3:
        return w[:-1]
    return w


def _rename_axes(m: _Merge, names: dict[str, str]) -> None:
    """Apply the review's tag group renames (``{old: new}``) to a merge."""
    if not names:
        return
    out: dict[str, list[str]] = {}
    for old, tags in m.tag_groups.items():
        new = (names.get(old) or "").strip()[:_MAX_NAME_LEN] or old
        while new in out:
            new += "+"
        out[new] = tags
    m.tag_groups = out


def _break_cycles(merges: list[_Merge], ctx: _Ctx) -> list[_Merge]:
    """A merged wildcard that reaches itself through references would be
    flagged as a cycle and render nothing. Take the lists that reference
    other wildcards out of any merge that sits on a loop (plain lists
    have no outgoing references, so what remains can't loop) and drop
    merges left with fewer than two lists."""
    while True:
        succ = _merge_graph(merges, ctx)
        changed = False
        for i, m in enumerate(merges):
            if _loops(succ, f"m:{i}"):
                m.members = [w for w in m.members if not ctx.edges.get(_norm(w.path))]
                changed = True
        merges = [m for m in merges if len(m.members) >= 2]
        if not changed:
            return merges


def _merge_graph(merges: list[_Merge], ctx: _Ctx) -> dict[str, set[str]]:
    """The reference graph with each merge as one node (``m:<index>``)
    and each group as ``g:<pattern>``."""
    owner = {_norm(w.path): i for i, m in enumerate(merges) for w in m.members}

    def node(key: str) -> str:
        if key in ctx.groups:
            return "g:" + key
        return f"m:{owner[key]}" if key in owner else key

    succ: dict[str, set[str]] = {}
    for src, targets in ctx.edges.items():
        succ.setdefault(node(src), set()).update(node(t) for t in targets)
    for pattern, g in ctx.groups.items():
        succ.setdefault("g:" + pattern, set()).update(node(_norm(w.path)) for w in g.members)
    return succ


def _loops(succ: dict[str, set[str]], start: str) -> bool:
    stack, seen = list(succ.get(start, ())), set()
    while stack:
        cur = stack.pop()
        if cur == start:
            return True
        if cur in seen:
            continue
        seen.add(cur)
        stack.extend(succ.get(cur, ()))
    return False


def _tag_merge(m: _Merge, ctx: _Ctx) -> None:
    """Tag every option with the path segments of its list below the
    merge root, one tag group per level.

    Segments with the same name at the same level share a tag, so
    ``female/footwear`` and ``male/footwear`` give two axes (gender ×
    garment) instead of two unrelated tags, and a list is picked by the
    AND of its tags. Two things would let one list's filter also match
    another's options, so they get a tag of their own: a name used at
    two levels (the deeper one is suffixed with its level) and a list
    that is also a folder (its own options get ``<name>_list``). A tag
    that would clash with one of the lists' own labels is suffixed too.
    """
    base = m.root.count("/") + 1
    labels = {t.lower() for w in m.members for o in w.options for t in o["sub_categories"]}
    cut = -1 if m.leaf else None
    rels = {
        _norm(w.path): w.path.replace("\\", "/").strip("/").split("/")[base:cut]
        for w in m.members
    }
    folders = {"/".join(r[:i]).lower() for r in rels.values() for i in range(1, len(r))}
    taken: dict[str, int] = {}  # tag (lowercase) → the level that owns it
    by_level: dict[int, dict[str, None]] = {}

    def claim(raw: str, level: int) -> str:
        tag = _slug_tag(raw) or "list"
        for candidate in (tag, f"{tag}_{level}"):
            low = candidate.lower()
            if low not in labels and taken.get(low, level) == level:
                taken[low] = level
                return candidate
        n = 2
        while f"{tag}_{level}_{n}".lower() in taken or f"{tag}_{level}_{n}".lower() in labels:
            n += 1
        taken[f"{tag}_{level}_{n}".lower()] = level
        return f"{tag}_{level}_{n}"

    order = sorted(rels.items(), key=lambda kv: (len(kv[1]), [x.lower() for x in kv[1]]))
    for key, rel in order:
        tags: list[str] = []
        for i, seg in enumerate(rel, start=1):
            raw = seg
            if i == len(rel) and "/".join(rel).lower() in folders:
                raw = f"{seg}_list"
            tag = claim(raw, i)
            tags.append(tag)
            by_level.setdefault(i, {})[tag] = None
        m.member_tags[key] = tags
        m.expr[key] = " and ".join(tags)

    last = m.root.split("/")[-1]
    named = 0
    for level in sorted(by_level):
        members = list(by_level[level])
        if all(t.lower().removesuffix("_list") in _GENDER_TAGS for t in members):
            name = "gender"
        elif m.leaf:
            # A table's first level is its records (`magical-beings` →
            # `magical-being`); a small deeper level reads best as its
            # members (`dress/attire`).
            named += 1
            if named == 1:
                name = _singular(last)
            elif len(members) <= 3:
                name = "/".join(members)
            else:
                name = f"{_singular(last)} ({named})"
        else:
            named += 1
            name = last if named == 1 else f"{last} ({named})"
        while name in m.tag_groups:
            name += "+"
        m.tag_groups[name] = members


def _collapse_groups(merges: list[_Merge], ctx: _Ctx) -> dict[str, str]:
    """A group whose lists all sit in one merged wildcard becomes a
    reference to that wildcard: plain when it covers every list, else
    filtered by the tags its lists share (or, for a few lists, by each
    list's own filter)."""
    owner = {_norm(w.path): m for m in merges for w in m.members}
    out: dict[str, str] = {}
    for pattern, g in ctx.groups.items():
        keys = [_norm(w.path) for w in g.members if w.options]
        if not keys or any(owner.get(k) is not owner.get(keys[0]) for k in keys):
            continue
        m = owner.get(keys[0])
        if m is None:
            continue
        want = set(keys)
        if want == set(m.member_tags):
            out[pattern] = f"@{{{m.id}#{m.name}}}"
            continue
        common = set.intersection(*(set(m.member_tags[k]) for k in keys))
        hits = {k for k, tags in m.member_tags.items() if common <= set(tags)}
        expr = None
        if common and hits == want:
            expr = " and ".join(t for t in m.member_tags[keys[0]] if t in common)
        elif len(want) <= 8:
            expr = " or ".join(f"({m.expr[k]})" if " " in m.expr[k] else m.expr[k] for k in keys)
        if expr is not None:
            out[pattern] = f"@{{{m.id}#{m.name}:{expr}}}"
    return out


def _merge_row(
    m: _Merge, category_id: str | None, tags: list[str], ctx: _Ctx,
) -> dict[str, Any]:
    options: list[dict[str, Any]] = []
    used: set[str] = set()
    registry: dict[str, None] = {t: None for g in m.tag_groups.values() for t in g}
    has_fallback = False
    for w in m.members:
        mine = m.member_tags[_norm(w.path)]
        for o in w.options:
            opt = dict(o)
            opt["id"] = _unique_id(o["id"], used)
            opt["sub_categories"] = mine + [t for t in o["sub_categories"] if t not in mine]
            for t in o["sub_categories"]:
                registry[t] = None
            if opt.get("fallback"):
                if has_fallback:
                    del opt["fallback"]
                    ctx.report.note(
                        "merged_fallback_dropped", w.path,
                        f"{_readable(o['value'])} (the merged wildcard keeps one fallback)",
                    )
                has_fallback = True
            options.append(opt)
    example = next(iter(m.expr.values()))
    if m.leaf:
        description = (
            f"The {m.leaf} list of {len(m.members)} folders under {m.root}/ "
            "(imported), as one wildcard. Each option is tagged with the "
            f"folders it came from, so filtering by them (for example {example}) "
            "draws from one folder's list."
        )
        binding = _ident(f"{_singular(m.root.split('/')[-1])}_{m.leaf}")
    else:
        description = (
            f"Merged from {len(m.members)} lists under {m.root}/ (imported). "
            "Each option is tagged with the folders and list it came from, so "
            f"filtering by those tags (for example {example}) draws from one list."
        )
        binding = _ident(m.root.split("/")[-1])
    return _module_row(
        m.id, m.name, description[:_MAX_DESCRIPTION_LEN], category_id, tags,
        {
            "var_binding": binding,
            "sub_categories": list(registry),
            "tag_groups": m.tag_groups,
            "options": options,
        },
    )


def _child_snapshot(
    row: dict[str, Any], instance: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """A module as a bundle child: the same frozen widget snapshot the
    bundle editor stores when you add a library module."""
    return {
        "id": row["id"],
        "type": row.get("type", "wildcard"),
        "enabled": True,
        "collapsed": False,
        "meta": {"name": row["name"], "library_name": row["name"]},
        "payload": row["payload"],
        "payload_hash": payload_hash(row["payload"]),
        "instance": dict(instance or {}),
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
    tags: list[str], payload: dict[str, Any], mtype: str = "wildcard",
) -> dict[str, Any]:
    row = {
        "id": mid,
        "type": mtype,
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
    ctx.current_wc = wc
    items = list(wc.items)
    if items and _is_params(items[0]):
        items.pop(0)  # read by _read_defaults
    seen_values: dict[tuple[str, str, str], dict[str, Any]] = {}
    tags: dict[str, None] = {}
    fallback_used = False
    # Lines of an entry point may become stacks (see _line_stack).
    collect = not wc.generated and _norm(wc.path) in ctx.entry_keys
    stack_lines: list[dict[str, Any]] = []
    for idx, item in enumerate(items):
        ctx.env = dict(wc.copy_env or {})
        ctx.line_vars = {} if collect else None
        ctx.negatives = []
        ctx.depth = 0
        choices = _parse_choice(item, ctx, conds=True)
        line_vars, negatives = ctx.line_vars, ctx.negatives
        ctx.line_vars = None
        ctx.env = {}
        for sub, (value, weight, labels, is_else, cond) in enumerate(choices):
            value = value.strip()
            if line_vars:
                stack_lines.append({
                    "value": value, "vars": line_vars, "negatives": negatives,
                    "cond": cond, "weight": weight,
                })
                continue
            if not value.strip():
                continue
            negative = ", ".join(n for n in negatives if n.strip())
            dedupe = (value, negative, repr(cond))
            if dedupe in seen_values:
                # Each copy of a line is one more ticket in the source draw:
                # fold it into the weight so the odds stay the same.
                prev = seen_values[dedupe]
                total = prev["weight"] + weight
                prev["weight"] = int(total) if float(total).is_integer() else total
                ctx.report.note("duplicate_value", wc.path, _readable(value))
                continue
            opt: dict[str, Any] = {
                "id": _short_hash(wc.path, str(idx) if sub == 0 else f"{idx}.{sub}"),
                "value": value,
                "weight": weight,
                "sub_categories": [],
            }
            if negative:
                opt["negative"] = negative
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
            if cond is not None:
                ctx.option_conds.append((wc, opt["id"], cond))
            seen_values[dedupe] = opt
            wc.options.append(opt)
    # Option ids come from the position in the file; keep them unique if a
    # pathological file still collides on the 8-char hash.
    used: set[str] = set()
    renamed: dict[str, str] = {}
    for opt in wc.options:
        new = _unique_id(opt["id"], used)
        if new != opt["id"]:
            renamed[opt["id"]] = new
            opt["id"] = new
    if renamed:
        ctx.option_conds = [
            (w, renamed.get(oid, oid) if w is wc else oid, c) for w, oid, c in ctx.option_conds
        ]
    wc.sub_categories = list(tags)
    if wc.umi and ctx.umi_axes:
        have = set(tags)
        wc.tag_groups = {
            name: [t for t in members if t in have]
            for name, members in ctx.umi_axes.items()
            if any(t in have for t in members)
        }
    _bake_affixes(wc)
    for n, line in enumerate(stack_lines, start=1):
        _line_stack(wc, line, n if len(stack_lines) > 1 or wc.options else 0, ctx)


def _bake_affixes(wc: _Wildcard) -> None:
    """PPP ``prefix`` / ``suffix`` around a wildcard that picks one value
    by default go into every option, so the wildcard reads the same on a
    Context as through a reference. A wildcard that picks several gets
    them around the pick at each reference instead (prefix + the joined
    values + suffix, as PPP writes it)."""
    d = wc.defaults
    if not d or not (d.get("prefix") or d.get("suffix")):
        return
    if d.get("hi") not in (None, 1):
        return
    for opt in wc.options:
        if opt.get("is_null"):
            continue
        opt["value"] = _affix(d, opt["value"])
    d["baked"] = True


def _affix(defaults: dict[str, Any], text: str) -> str:
    """``text`` between the defaults' prefix and suffix (source text,
    escaped so a `$` in it stays literal)."""
    return _escape(defaults.get("prefix") or "") + text + _escape(defaults.get("suffix") or "")


def _read_defaults(wc: _Wildcard, ctx: _Ctx) -> None:
    """PPP wildcard default parameters: a first choice made only of
    parameters (``r2-3'description'$$, $$``) or an object of parameter
    keys. Stored on ``wc.defaults`` for the references to this wildcard
    and for :func:`_bake_affixes`; what has no home here is noted."""
    if not wc.items or not _is_params(wc.items[0]):
        return
    first = wc.items[0]
    d: dict[str, Any] = {
        "lo": None, "hi": None, "repeat": False, "optional": False,
        "sep": None, "prefix": "", "suffix": "",
    }
    dropped: list[str] = []
    description = ""
    if isinstance(first, dict):
        if str(first.get("sampler", "")).strip() == "@":
            dropped.append("cyclical sampler")
        d["repeat"] = _truthy(first.get("repeating"))
        d["optional"] = _truthy(first.get("optional"))
        count = first.get("count")
        lo, hi = first.get("from"), first.get("to")
        if count not in (None, ""):
            d["lo"] = d["hi"] = _int_or_none(count)
        if lo not in (None, "") or hi not in (None, ""):
            d["lo"] = _int_or_none(lo) if lo not in (None, "") else 1
            d["hi"] = _int_or_none(hi) if hi not in (None, "") else None
        for key in ("prefix", "suffix"):
            if isinstance(first.get(key), str):
                d[key] = first[key]
        if isinstance(first.get("separator"), str):
            d["sep"] = first["separator"]
        if first.get("container"):
            dropped.append("container")
        if isinstance(first.get("description"), str):
            description = first["description"].strip()
    else:
        pieces = str(first).strip().split("$$")
        head = _PARAMS_RE.match(pieces[0])
        if head is not None:
            if head.group("sampler") == "@":
                dropped.append("cyclical sampler")
            d["repeat"] = head.group("r") is not None
            d["optional"] = head.group("o") is not None
            rng = (head.group("range") or "").replace(" ", "")
            if rng:
                d["lo"], d["hi"] = _parse_range(rng)
            description = (head.group("d1") or head.group("d2") or "").strip()
        if len(pieces) >= 3:
            d["sep"] = pieces[1]
    if d["optional"] and d["lo"] is None:
        d["lo"], d["hi"] = 0, 1
    elif d["optional"]:
        d["lo"] = 0
    if description:
        wc.comments.append(description)
    if dropped:
        ctx.report.note("default_params_dropped", wc.path, ", ".join(dropped))
    wc.defaults = d


def _int_or_none(raw: Any) -> int | None:
    try:
        return max(0, int(str(raw).strip()))
    except ValueError:
        return None


def _parse_range(rng: str) -> tuple[int | None, int | None]:
    """``3`` → (3, 3); ``1-2`` → (1, 2); ``-2`` → (1, 2); ``2-`` → (2, None)."""
    if "-" in rng:
        lo, hi = rng.split("-", 1)
        return (int(lo) if lo else 1, int(hi) if hi else None)
    return (int(rng), int(rng))


def _default_sep(ctx: _Ctx) -> str:
    """Impact Pack (and LoRA Manager / Easy-Use) join a multi-pick with a
    space; Dynamic Prompts and PPP with a comma."""
    return " " if ctx.dialect == "impact" else ", "


#: Source tools the converter knows. ``mixed`` = plain lists that any of
#: them reads the same way.
DIALECTS = ("dynamicprompts", "ppp", "impact", "umi", "mixed")

_DIALECT_SIGNS: dict[str, list[re.Pattern[str]]] = {
    "ppp": [
        re.compile(r"<ppp:"),
        re.compile(r"^\s*%\s*(?:::)?\s*include\b|^\s*%::"),
        re.compile(r"^\s*'[^']*'\s*\d*(?:\.\d+)?\s*(?:if\b[^:]*)?::"),
        re.compile(r"^\s*\d*(?:\.\d+)?\s*if\s+[^:]+::"),
        re.compile(r"^\s*else\s*::"),
        re.compile(r"__[^_\s]*'[^']*'__"),
    ],
    "impact": [re.compile(r"\d+#__[\w.\-+/*\\]+__")],
    "dynamicprompts": [
        re.compile(r"\$\{[A-Za-z_]"),
        re.compile(r"__[\w.\-/]+\([^)]*=[^)]*\)__"),
        re.compile(r"%\{"),
    ],
    "umi": [_UMI_QUERY_RE],
}


def detect_dialect(wildcards: list[_Wildcard]) -> dict[str, Any]:
    """Which tool a pack was written for, from what it uses.

    Counts the constructs only one tool reads (PPP directives, labels,
    conditions and object choices; Impact's ``N#__x__``; Dynamic Prompts
    variables, templates and wraps; Umi's tag queries and ``Tags:``
    entries). The most specific tool with any evidence wins; a pack with
    none is ``mixed``: plain lists every tool reads the same way.
    """
    counts = {k: 0 for k in _DIALECT_SIGNS}
    for wc in wildcards:
        if wc.path.lower().endswith("/tags"):
            counts["umi"] += 1
        if wc.umi:
            counts["umi"] += len(wc.items)
            continue
        for item in wc.items:
            if isinstance(item, dict):
                if set(item) & {"labels", "if", "else", "command"}:
                    counts["ppp"] += 1
                continue
            text = item if isinstance(item, str) else json.dumps(item, default=str)
            for dialect, signs in _DIALECT_SIGNS.items():
                if any(sign.search(text) for sign in signs):
                    counts[dialect] += 1
        if wc.items and _is_params(wc.items[0]):
            counts["ppp"] += 1
    evidence = {k: v for k, v in counts.items() if v}
    for dialect in ("umi", "ppp", "impact", "dynamicprompts"):
        if counts[dialect]:
            return {"dialect": dialect, "evidence": evidence}
    return {"dialect": "mixed", "evidence": evidence}


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


_Choice = tuple[str, float, list[str], bool, Any]


def _parse_choice(item: Any, ctx: _Ctx, conds: bool = False) -> list[_Choice]:
    """One raw item → its ``(value, weight, labels, is_else, condition)``
    choices: usually one, several when a PPP ``<ppp:if>`` splits the value
    (each branch with its condition). ``conds`` says the caller turns
    conditions into constraints; without it they are noted as dropped."""
    if item is None:
        return []
    if isinstance(item, list):
        return [(_anonymous(item, ctx), 1, [], False, None)]
    cond_raw: str | None = None
    if isinstance(item, dict):
        if len(item) == 1:
            ((key, value),) = item.items()
            if isinstance(value, list) and not ({str(key)} & {"text", "content"}):
                # `options: [anonymous list]` form.
                parsed = _parse_options(str(key), ctx)
                if parsed is not None:
                    weight, labels, is_else, _, cond_raw = parsed
                    cond = _choice_cond(cond_raw, conds, ctx)
                    return [(_anonymous(value, ctx), weight, labels, is_else, cond)]
        content = item.get("text", item.get("content"))
        weight = _weight(item.get("weight", 1))
        labels = item.get("labels") or []
        if isinstance(labels, str):
            labels = [s for s in labels.split(",") if s.strip()]
        labels = [str(x) for x in labels]
        is_else = _truthy(item.get("else"))
        if item.get("if"):
            cond_raw = str(item["if"])
        cond = _choice_cond(cond_raw, conds, ctx)
        if isinstance(content, list):
            return [(_anonymous(content, ctx), weight, labels, is_else, cond)]
        if content is None or str(content).strip() == "":
            ctx.report.note("unsupported_item", ctx.current, _short(item))
            return []
        text = _join_lines(str(content), ctx)
        if _truthy(item.get("command")):
            return [(_include(text, ctx), weight, labels, is_else, cond)]
        return [
            (v, weight, labels, is_else, _and_cond(cond, c))
            for v, c in _convert_value(text, conds, ctx)
        ]
    raw = _join_lines(str(item), ctx)
    weight: float = 1
    labels: list[str] = []
    is_else = False
    command = False
    if "::" in raw:
        head, _, rest = raw.partition("::")
        parsed = _parse_options(head, ctx)
        if parsed is not None:
            weight, labels, is_else, command, cond_raw = parsed
            raw = rest
    raw = raw.strip()
    cond = _choice_cond(cond_raw, conds, ctx)
    if command:
        return [(_include(raw, ctx), weight, labels, is_else, cond)]
    return [
        (v, weight, labels, is_else, _and_cond(cond, c))
        for v, c in _convert_value(raw, conds, ctx)
    ]


def _choice_cond(raw: str | None, conds: bool, ctx: _Ctx) -> Any:
    """A choice's PPP ``if`` → condition AST, or None (noted as dropped
    when it can't become a constraint)."""
    if not raw or not raw.strip():
        return None
    ast = parse_condition(raw) if conds else None
    if ast is None:
        ctx.report.note("condition_dropped", ctx.current, f"if {raw.strip()}")
    return ast


def _and_cond(a: Any, b: Any) -> Any:
    if a is None:
        return b
    if b is None:
        return a
    return ("and", [a, b])


def _convert_value(text: str, conds: bool, ctx: _Ctx) -> list[tuple[str, Any]]:
    """Convert a choice's text; ``<ppp:if>`` blocks split it into one
    value per branch, each with the condition that selects it."""
    text = normalize_ppp(text)
    splits = split_ppp_if(text) if "<ppp:if" in text else None
    if splits is None:
        return [(convert_text(text, ctx), None)]
    if not conds:
        ctx.report.note("condition_dropped", ctx.current, text)
        return [(convert_text(splits[-1][0], ctx), None)]
    return [(convert_text(t, ctx), c) for t, c in splits]


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


def _parse_options(
    head: str, ctx: _Ctx,
) -> tuple[float, list[str], bool, bool, str | None] | None:
    """A choice head ``'labels' weight if cond else %`` → ``(weight,
    labels, is_else, is_command, condition text)``."""
    m = _CHOICE_OPTS_RE.match(head)
    if m is None or not head.strip():
        return None
    labels_raw = m.group("l1") if m.group("l1") is not None else m.group("l2")
    labels = [s.strip() for s in (labels_raw or "").split(",") if s.strip()]
    cond = m.group("cond").strip() if m.group("cond") else None
    weight = _weight(m.group("w") or 1)
    return (weight, labels, m.group("else") is not None, m.group("cmd") is not None, cond)


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
    ctx.depth += 1
    for item in items:
        if _is_params(item):
            ctx.report.note("default_params_dropped", ctx.current, _short(item))
            continue
        for value, weight, labels, _, _cond in _parse_choice(item, ctx):
            if labels:
                ctx.report.note("label_dropped", ctx.current, ",".join(labels))
            branches.append(value if weight == 1 else f"{weight}::{value}")
    ctx.depth -= 1
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
    text = normalize_ppp(text)
    if "<ppp:stn" in text or (ctx.dialect == "umi" and "**" in text):
        nested = ctx.depth > 0 or _inside_braces(text, ("<ppp:stn", "**"))
        text, negs = extract_negatives(text, umi=ctx.dialect == "umi")
        if negs and nested:
            ctx.report.note(
                "negative_moved_to_option", ctx.current,
                f"{', '.join(negs)} (applies whenever the option is picked)",
            )
        saved, ctx.line_vars = ctx.line_vars, None
        ctx.negatives.extend(convert_text(n, ctx) for n in negs)
        ctx.line_vars = saved
    if "<ppp:if" in text:
        splits = split_ppp_if(text)
        if splits is not None:
            # Only a whole value can split into conditioned options; here
            # (inside a `{…}` or a nested list) keep what renders when no
            # condition holds.
            ctx.report.note("condition_dropped", ctx.current, text)
            text = splits[-1][0]
    if "<ppp:" in text:
        ctx.report.note("ppp_directive_kept_as_text", ctx.current, text)
    if not ctx.umi_db and _UMI_QUERY_RE.search(text):
        ctx.report.note("tag_query_kept_as_text", ctx.current, text)
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
        if ch == "<" and ctx.umi_db:
            m = UMI_QUERY_RE.match(text, i)
            if m is not None:
                flush(i)
                out.append(_umi_query(m, ctx))
                i = lit_start = m.end()
                continue
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
    sep = _default_sep(ctx)
    if len(pieces) >= 2:
        head = _PARAMS_RE.match(pieces[0])
        if head is not None and pieces[0].strip():
            rng = (head.group("range") or "").replace(" ", "")
            repeat = head.group("r") is not None
            count = _parse_range(rng) if rng else (1, 1)
            if head.group("o") is not None:
                # PPP `o`: an empty result is allowed.
                count = (0, count[1])
            if len(pieces) >= 3:
                sep = pieces[1]
                body = "$$".join(pieces[2:])
            else:
                body = pieces[1]
    raw_branches = _split_top(body, "|")
    if ctx.dialect == "umi":
        raw_branches = _percent_weights(raw_branches)
    ctx.depth += 1
    branches = [_convert_branch(b, ctx) for b in raw_branches]
    ctx.depth -= 1
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


_PERCENT_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)%")


def _percent_weights(branches: list[str]) -> list[str]:
    """Umi AI ``{20%a|b}``: a branch with ``N%`` takes N percent, the
    others share the rest → ``{20::a|80::b}``."""
    pct = [_PERCENT_RE.match(b) for b in branches]
    if not any(pct):
        return branches
    given = sum(float(m.group(1)) for m in pct if m)
    rest = [b for b, m in zip(branches, pct, strict=True) if not m]
    share = max(0.0, 100.0 - given) / len(rest) if rest else 0.0
    out = []
    for b, m in zip(branches, pct, strict=True):
        w = float(m.group(1)) if m else share
        text = b[m.end():] if m else b
        w_txt = str(int(w)) if float(w).is_integer() else f"{w:g}"
        out.append(f"{w_txt}::{text}")
    return out


def _has_weight(branch: str) -> bool:
    return re.match(r"^\s*(\d+(?:\.\d+)?|\.\d+)::", branch) is not None


def _convert_branch(branch: str, ctx: _Ctx) -> str:
    if "::" in branch:
        head, _, rest = branch.partition("::")
        parsed = _parse_options(head, ctx)
        if parsed is not None:
            weight, labels, is_else, command, cond = parsed
            if cond:
                ctx.report.note("condition_dropped", ctx.current, f"if {cond}")
            if labels:
                ctx.report.note("label_dropped", ctx.current, ",".join(labels))
            if is_else:
                ctx.report.note("inline_else_dropped", ctx.current, branch)
            value = _include(rest, ctx) if command else convert_text(rest, ctx)
            return value if weight == 1 else f"{weight}::{value}"
    return convert_text(branch, ctx)


_DP_VAR_RE = re.compile(
    r"^\$\{\s*(?P<name>[A-Za-z_][\w]*)\s*"
    r"(?:(?P<op>\?=|\+=|=)\s*(?P<bang>!)?(?P<value>.*)|:(?P<default>.*))?\}$",
    re.DOTALL,
)


def _var_placeholder(name: str) -> str:
    return f"\x00var:{name}\x00"


def _dp_variable(raw: str, ctx: _Ctx) -> str:
    """Dynamic Prompts / PPP variables.

    ``${x=v}`` is a macro: every later read in the same value renders
    ``v`` again (its own roll), and a wildcard referenced after it that
    reads ``${x}`` becomes a specialised copy. ``${x=!v}`` is rolled once:
    in a line of an entry point it becomes a setter wildcard in a stack and
    reads become ``$x`` in a Combine (see :func:`_line_stack`); anywhere
    else it falls back to the macro reading. ``${x:d}`` reads ``x``, or
    renders ``d`` when nothing set it; in an entry point an unset read is a
    template slot the stack leaves to whatever runs upstream.
    """
    m = _DP_VAR_RE.match(raw)
    if m is None:
        ctx.report.note("variable_kept_as_text", ctx.current, raw)
        return raw
    name = m.group("name")
    lv = ctx.line_vars
    if m.group("op"):
        op, value = m.group("op"), m.group("value")
        if op == "?=" and (name in ctx.env or (lv is not None and name in lv)):
            return ""
        if m.group("bang") and lv is not None:
            lv[name] = {"kind": "set", "raw": value, "op": op}
            return ""
        if m.group("bang"):
            ctx.report.note(
                "immediate_variable_as_macro", ctx.current,
                f"{raw}: each read rolls again here (only an entry point's line can hold "
                "a value rolled once)",
            )
        if op == "+=" and name in ctx.env:
            ctx.env[name] = ctx.env[name] + value
        else:
            ctx.env[name] = value
        return ""
    if lv is not None and name in lv:
        return _var_placeholder(name)
    if name in ctx.env:
        saved = ctx.env
        ctx.env = {k: v for k, v in saved.items() if k != name}
        try:
            return convert_text(saved[name], ctx)
        finally:
            ctx.env = saved
    if lv is not None:
        lv[name] = {"kind": "slot", "default": m.group("default")}
        return _var_placeholder(name)
    if m.group("default") is not None:
        return convert_text(m.group("default"), ctx)
    ctx.report.note("variable_kept_as_text", ctx.current, raw)
    return raw


def _reference(m: re.Match[str], ctx: _Ctx) -> str:
    raw = m.group(0)
    name = m.group("name").strip().replace("\\", "/").strip("/")
    count_txt = m.group("icount")
    params = m.group("params")
    sep = m.group("sep")
    filt = m.group("f1") if m.group("f1") is not None else m.group("f2")
    args = _parse_ref_args(m.group("args") or "")

    target = _resolve_target(name, ctx)
    if target is None:
        ctx.report.note("unresolved_reference", ctx.current, raw)
        return _escape(raw)
    wc_target = ctx.target
    if wc_target is not None and (args or ctx.env or ctx.line_vars):
        copy = _maybe_specialize(wc_target, args, raw, ctx)
        if copy is not None:
            target = f"@{{{copy.id}#{copy.name}}}"
    elif args:
        ctx.report.note("template_args_dropped", ctx.current, raw)

    ref = target
    expr = _filter_expr(filt, raw, ctx) if filt else ""
    if expr and target.startswith("\x00"):
        # A group wildcard has no labels of its own to filter on.
        ctx.report.note("filter_dropped", ctx.current, raw)
    elif expr:
        ref = target[:-1] + f":{expr}}}"

    defaults = wc_target.defaults if wc_target is not None else None
    lo: int | None = 1
    hi: int | None = 1
    repeat = False
    if count_txt:
        lo = hi = int(count_txt)
    elif params:
        head = _PARAMS_RE.match(params)
        if head is not None:
            rng = (head.group("range") or "").replace(" ", "")
            repeat = head.group("r") is not None
            if rng:
                lo, hi = _parse_range(rng)
            if head.group("o") is not None:
                lo = 0
    elif defaults is not None:
        # PPP: a reference without parameters uses the wildcard's own.
        if defaults["lo"] is not None or defaults["hi"] is not None:
            lo = defaults["lo"] if defaults["lo"] is not None else 1
            hi = defaults["hi"]
        repeat = bool(defaults["repeat"])
    if sep is None and defaults is not None and defaults.get("sep") is not None:
        sep = defaults["sep"]
    if hi is None:
        # Open range: up to every value. A pick over one ref never takes
        # more unique values than the target has, so its size is a safe
        # ceiling.
        hi = max(lo or 1, _pool_size(name, ctx))
        if repeat:
            ctx.report.note("multi_pick_range_capped", ctx.current, raw)
    lo = 1 if lo is None else lo
    out = ref
    if not (hi <= 1 and lo == 1):
        # `{N$$sep$$@{x}}` draws N different values of x, which is
        # exactly what the source does; `~` allows repeats like the `r`
        # flag, and a 0 lower bound allows an empty result like `o`.
        rng_txt = str(lo) if lo == hi else f"{min(lo, hi)}-{max(lo, hi)}"
        sep_txt = sep if sep is not None else _default_sep(ctx)
        out = "{" + rng_txt + ("~" if repeat else "") + "$$" + sep_txt + "$$" + ref + "}"
    if defaults is not None and (defaults.get("prefix") or defaults.get("suffix")):
        if defaults.get("baked"):
            if hi > 1:
                ctx.report.note(
                    "affixes_per_pick", ctx.current,
                    f"{raw}: the prefix/suffix of {wc_target.path if wc_target else name} "
                    "now sits around each value",
                )
        else:
            out = _affix(defaults, out)
    return out


def _pool_size(name: str, ctx: _Ctx) -> int:
    key = _norm(name)
    wc = ctx.by_path.get(key)
    if wc is not None:
        params = 1 if wc.items and _is_params(wc.items[0]) else 0
        return max(1, len(wc.items) - params)
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
    ctx.target = None
    key = _norm(name)
    if "*" in key:
        return _group_ref(key, name, ctx)
    wc = ctx.by_path.get(key) or ctx.impact_path.get(key.replace(" ", "-"))
    if wc is None:
        # Impact Pack, LoRA Manager and Easy-Use read a bare name as
        # `*/name`: every list with that name in any folder, pooled.
        hits = [w for k, w in ctx.by_path.items() if k.endswith("/" + key)]
        if len(hits) == 1:
            wc = hits[0]
        elif len(hits) > 1:
            ctx.report.note(
                "suffix_pooled", ctx.current,
                f"__{name}__ matches {len(hits)} lists in different folders; "
                "picks from all of them, as Impact Pack does",
            )
            return _group_ref("*/" + key, "*/" + name, ctx)
    if wc is not None:
        _edge(_norm(wc.path), ctx)
        ctx.target = wc
        return f"@{{{wc.id}#{wc.name}}}"
    lib = ctx.library.get(key) or ctx.library.get(_display_name(name).lower())
    if lib is not None:
        return f"@{{{lib}#{_display_name(name)}}}"
    # An earlier import of the same pack: ids come from the path.
    for kind in ("wildcard", "merge"):
        own = _short_hash(kind, key)
        if own in ctx.library_ids:
            ctx.report.note("resolved_from_library", ctx.current, f"__{name}__ (imported earlier)")
            return f"@{{{own}#{_display_name(name)}}}"
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

# ---------------------------------------------------------------------------
# Raw scan: variables and references before conversion
# ---------------------------------------------------------------------------

_READ_RE = re.compile(r"\$\{\s*([A-Za-z_]\w*)\s*(?::[^}]*)?\}")
_INCLUDE_RE = re.compile(r"%\s*include\s+(\S+)")
MAX_COPIES = 500


def _raw_text(item: Any) -> str:
    if isinstance(item, str):
        return item
    if isinstance(item, list):
        return "\n".join(_raw_text(x) for x in item)
    if isinstance(item, dict):
        return "\n".join(
            _raw_text(v) for k, v in item.items() if k not in ("umi_tags", "labels")
        ) + "\n" + "\n".join(str(k) for k in item if not isinstance(k, str) or len(item) == 1)
    return "" if item is None else str(item)


def _scan_raw(wildcards: list[_Wildcard], ctx: _Ctx) -> None:
    """Which variables each wildcard reads and which wildcards it
    references, from the source text: lets a reference know whether its
    target needs a specialised copy, and marks entry points (nothing
    references them) whose lines may become stacks."""
    for wc in wildcards:
        key = _norm(wc.path)
        text = normalize_ppp("\n".join(_raw_text(i) for i in wc.items))
        ctx.reads[key] = set(_READ_RE.findall(text))
        refs: set[str] = set()
        for m in _REF_RE.finditer(text):
            name = m.group("name").strip().replace("\\", "/").strip("/")
            refs |= _quiet_targets(name, ctx)
        for m in _INCLUDE_RE.finditer(text):
            refs |= _quiet_targets(m.group(1), ctx)
        refs.discard(key)
        ctx.raw_refs[key] = refs
    referenced: set[str] = set()
    for refs in ctx.raw_refs.values():
        referenced |= refs
    ctx.entry_keys = {k for k in ctx.raw_refs if k not in referenced}


def _quiet_targets(name: str, ctx: _Ctx) -> set[str]:
    key = _norm(name)
    if not key:
        return set()
    if "*" in key:
        if key.endswith("/**"):
            return {k for k in ctx.by_path if k.startswith(key[:-3] + "/")}
        return {k for k in ctx.by_path if fnmatch.fnmatchcase(k, key)}
    if key in ctx.by_path:
        return {key}
    hit = ctx.impact_path.get(key.replace(" ", "-"))
    if hit is not None:
        return {_norm(hit.path)}
    found = {k for k in ctx.by_path if k.endswith("/" + key)}
    return found or {k for k in ctx.by_path if k.startswith(key + "/")}


def _reads_deep(key: str, ctx: _Ctx, stack: set[str] | None = None) -> set[str]:
    """The variables a wildcard reads, itself or through what it
    references."""
    memo = ctx.reads_memo
    if key in memo:
        return memo[key]
    stack = stack if stack is not None else set()
    if key in stack:
        return set()
    stack.add(key)
    out = set(ctx.reads.get(key, ()))
    for target in ctx.raw_refs.get(key, ()):
        out |= _reads_deep(target, ctx, stack)
    stack.discard(key)
    memo[key] = out
    return out


def _parse_ref_args(text: str) -> dict[str, str]:
    """``x=v, y='w'`` (Dynamic Prompts template arguments) → dict."""
    out: dict[str, str] = {}
    for part in _split_top(text, ","):
        if "=" not in part:
            continue
        k, _, v = part.partition("=")
        k = k.strip()
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
            v = v[1:-1]
        if re.fullmatch(r"[A-Za-z_]\w*", k):
            out[k] = v
    return out


def _short_text(text: str, limit: int = 40) -> str:
    t = re.sub(r"\s+", " ", text).strip()
    return t if len(t) <= limit else t[: limit - 1] + "…"


def _maybe_specialize(
    target: _Wildcard, args: dict[str, str], raw: str, ctx: _Ctx,
) -> _Wildcard | None:
    """A reference whose target reads variables this value binds (template
    arguments, ``${x=v}`` macros) points at a copy of the target with those
    reads filled in, the way Dynamic Prompts renders it."""
    needed = _reads_deep(_norm(target.path), ctx)
    if not needed:
        if args:
            ctx.report.note(
                "template_args_dropped", ctx.current, f"{raw}: the list reads no variables",
            )
        return None
    bind: dict[str, str] = {}
    lv = ctx.line_vars or {}
    for k in sorted(needed):
        if k in args:
            bind[k] = args[k]
        elif k in ctx.env:
            bind[k] = ctx.env[k]
        elif lv.get(k, {}).get("kind") == "set":
            bind[k] = lv[k]["raw"]
            ctx.report.note(
                "variable_read_in_nested_list", ctx.current,
                f"{raw} reads ${{{k}}}: a list can't read a variable, so it rolls "
                f"{_short_text(lv[k]['raw'])} on its own",
            )
    if not bind:
        return None
    key = (_norm(target.path), tuple(sorted(bind.items())))
    copy = ctx.copies.get(key)
    if copy is None:
        if len(ctx.copies) >= MAX_COPIES:
            ctx.report.note("too_many_copies", ctx.current, raw)
            return None
        desc = "; ".join(f"{k}={_short_text(v, 24)}" for k, v in sorted(bind.items()))
        path = f"{target.path} ({desc})"
        copy = _Wildcard(
            path, target.source, list(target.items), defaults=target.defaults,
            umi=target.umi, layer=target.layer, generated=True, copy_env=dict(bind),
        )
        copy.id = _unique_id(_short_hash("copy", key[0], repr(key[1])), ctx.used_ids)
        copy.name = _display_name(path)
        ctx.copies[key] = copy
        ctx.pending.append(copy)
        ctx.report.note("specialised_copy", ctx.current, f"{raw} → {copy.name}")
    _edge(_norm(copy.path), ctx)
    return copy


# ---------------------------------------------------------------------------
# Umi AI
# ---------------------------------------------------------------------------

UMI_MAX_LAYERS = 12


def _umi_layers(wildcards: list[_Wildcard]) -> tuple[list[_Wildcard], list[dict[str, Any]]]:
    """Split Umi YAML files into layers so a tag query never reaches its
    own entry: entries without queries are layer 0, an entry whose queries
    hit layer k entries is layer k + 1. Each layer of a file is its own
    wildcard (``Body``, ``Body (2)``); a query only draws from layers below
    the entry it sits in. Returns the wildcards and the tag database."""
    entries: list[dict[str, Any]] = []
    for wc in wildcards:
        if not wc.umi:
            continue
        file = PurePosixPath(wc.source).stem.casefold()
        for item in wc.items:
            text = str(item.get("text", "")) if isinstance(item, dict) else str(item)
            queries = [
                ((m.group("file") or "").strip().casefold(), parse_umi_query(m.group("body")))
                for m in UMI_QUERY_RE.finditer(text)
            ]
            entries.append({
                "wc": wc, "item": item, "file": file, "queries": queries, "layer": 0,
                "tags": item.get("umi_tags", set()) if isinstance(item, dict) else set(),
            })
    if not entries:
        return wildcards, []
    cache: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for e in entries:
        hits: list[dict[str, Any]] = []
        for f, q in e["queries"]:
            ck = (f, repr(q))
            if ck not in cache:
                cache[ck] = [
                    h for h in entries
                    if (not f or h["file"] == f) and umi_matches(q, h["tags"])
                ]
            hits.extend(cache[ck])
        e["hits"] = [h for h in hits if h is not e]
    for _ in range(UMI_MAX_LAYERS):
        changed = False
        for e in entries:
            if not e["queries"]:
                continue
            new = min(UMI_MAX_LAYERS, 1 + max((h["layer"] for h in e["hits"]), default=-1))
            if new != e["layer"]:
                e["layer"] = new
                changed = True
        if not changed:
            break
    # An entry no query reaches can sit in its file's top layer: fewer
    # wildcards, and its own queries still only reach lower layers.
    reached = {id(h) for e in entries for h in e["hits"]}
    top: dict[int, int] = {}
    for e in entries:
        top[id(e["wc"])] = max(top.get(id(e["wc"]), 0), e["layer"])
    for e in entries:
        if id(e) not in reached:
            e["layer"] = max(e["layer"], top[id(e["wc"])])
    out: list[_Wildcard] = []
    for wc in wildcards:
        if not wc.umi:
            out.append(wc)
            continue
        mine = [e for e in entries if e["wc"] is wc]
        for n, layer in enumerate(sorted({e["layer"] for e in mine}) or [0]):
            path = wc.path if n == 0 else f"{wc.path} ({n + 1})"
            part = _Wildcard(
                path, wc.source, [e["item"] for e in mine if e["layer"] == layer],
                comments=wc.comments if n == 0 else [], umi=True, layer=layer,
            )
            for e in mine:
                if e["layer"] == layer:
                    e["wc"] = part
            out.append(part)
    db = [
        {"wc": e["wc"], "tags": e["tags"], "file": e["file"], "layer": e["layer"]}
        for e in entries
    ]
    return out, db


def _umi_query(m: re.Match[str], ctx: _Ctx) -> str:
    """``<[a][b|--c]>`` → a filtered reference to the wildcard(s) holding
    the matching entries; several wildcards → a pick between them,
    weighted by how many entries each holds, as Umi pools them."""
    q = parse_umi_query(m.group("body"))
    f = (m.group("file") or "").strip().casefold()
    cur = ctx.current_wc
    own = cur.layer if cur is not None and cur.umi else None
    hits: dict[int, list[Any]] = {}
    for e in ctx.umi_db:
        if f and e["file"] != f:
            continue
        if own is not None and e["layer"] >= own:
            continue
        if umi_matches(q, e["tags"]):
            hits.setdefault(id(e["wc"]), [e["wc"], 0])[1] += 1
    if not hits:
        ctx.report.note("tag_query_no_match", ctx.current, m.group(0))
        return ""
    tagsets = ctx.umi_tagsets
    refs: list[tuple[str, int]] = []
    for w, n in hits.values():
        have = tagsets.get(id(w))
        if have is None:
            have = {t for it in w.items if isinstance(it, dict) for t in it.get("labels", [])}
            tagsets[id(w)] = have
        expr = "" if n == len(w.items) else _umi_expr(q, have)
        refs.append((f"@{{{w.id}#{w.name}" + (f":{expr}" if expr else "") + "}", n))
        _edge(_norm(w.path), ctx)
    cur_key = _norm(ctx.current)
    ctx.ref_counts[cur_key] = ctx.ref_counts.get(cur_key, 0) + 1
    if len(refs) == 1:
        return refs[0][0]
    return "{" + "|".join(f"{n}::{ref}" for ref, n in refs) + "}"


def _inside_braces(text: str, needles: tuple[str, ...]) -> bool:
    """True when any of ``needles`` starts inside a ``{…}``."""
    depth = 0
    for i, c in enumerate(text):
        if c == "{":
            depth += 1
        elif c == "}":
            depth = max(0, depth - 1)
        elif depth and any(text.startswith(n, i) for n in needles):
            return True
    return False


def _umi_expr(q: list[list[tuple[bool, str]]], have: set[str]) -> str:
    """The query as our tag filter, simplified against the tags the
    wildcard has (an absent tag is false, so ``--absent`` always holds)."""
    ands: list[str] = []
    for grp in q:
        ors: list[str] = []
        always = False
        for neg, term in grp:
            tag = _umi_tag(term)
            if tag is None or tag not in have:
                if neg:
                    always = True
                    break
                continue
            ors.append(f"not {tag}" if neg else tag)
        if always or not ors:
            continue
        ands.append(ors[0] if len(ors) == 1 else "(" + " or ".join(ors) + ")")
    return " and ".join(ands)


# ---------------------------------------------------------------------------
# Stacks: variables rolled once → setter wildcards + a Combine
# ---------------------------------------------------------------------------

_PLACEHOLDER_RE = re.compile(r"\x00var:([A-Za-z_]\w*)\x00")
_WHOLE_REF_RE = re.compile(r"^@\{([0-9a-f]{8})#[^}:!]*\}$")


def _generated(
    path: str, source: str, options: list[dict[str, Any]], binding: str, ctx: _Ctx,
) -> _Wildcard:
    w = _Wildcard(path, source, [], generated=True, binding=binding)
    w.id = _unique_id(_short_hash("generated", _norm(path)), ctx.used_ids)
    w.name = _display_name(path)
    used: set[str] = set()
    for i, o in enumerate(options):
        o.setdefault("id", _short_hash(path, str(i)))
        o["id"] = _unique_id(o["id"], used)
        o.setdefault("weight", 1)
        o.setdefault("sub_categories", [])
    w.options = options
    ctx.pending_generated.append(w)
    return w


def _with_env(raw: str, env: dict[str, str], ctx: _Ctx) -> str:
    """Convert setter / part text outside the line: earlier rolled-once
    variables it reads fall back to their source text."""
    saved_env, saved_lv = ctx.env, ctx.line_vars
    ctx.env, ctx.line_vars = dict(env), None
    try:
        return convert_text(raw, ctx)
    finally:
        ctx.env, ctx.line_vars = saved_env, saved_lv


def _setter(
    entry: _Wildcard, stack_name: str, var: str, binding: str, raw: str,
    env: dict[str, str], ctx: _Ctx,
) -> tuple[str, Any, dict[str, Any]]:
    """The module that rolls ``${var=!raw}`` once: the referenced wildcard
    itself (bound to ``var``) when ``raw`` is one plain reference, else a
    small generated wildcard holding ``raw``'s choices."""
    body = raw.strip()
    m = _REF_RE.fullmatch(body)
    if m is not None and not (m.group("params") or m.group("icount") or m.group("args")
                              or m.group("f1") or m.group("f2")):
        name = m.group("name").strip().replace("\\", "/").strip("/")
        targets = _quiet_targets(name, ctx)
        if len(targets) == 1:
            w = ctx.by_path[next(iter(targets))]
            _edge(_norm(w.path), ctx)
            return ("wc", w, {"variable_binding": binding})
    options: list[dict[str, Any]] = []
    if body.startswith("{") and _match_brace(body, 0) == len(body) - 1 \
            and "$$" not in _split_top(body[1:-1], "|")[0]:
        for branch in _split_top(body[1:-1], "|"):
            text = _with_env(branch, env, ctx)
            weight: float = 1
            wm = re.match(r"^\s*(\d+(?:\.\d+)?)::(.*)$", text, re.DOTALL)
            if wm:
                weight, text = _weight(wm.group(1)), wm.group(2)
            options.append({"value": text, "weight": weight})
    else:
        options.append({"value": _with_env(body, env, ctx)})
    w = _generated(f"{stack_name} · {var}", entry.source, options, binding, ctx)
    return ("wc", w, {})


def _derivation(
    stack_name: str, var: str, value: str, ctx: _Ctx, *, append: bool = False,
) -> dict[str, Any]:
    """``$var`` gets ``value`` when nothing upstream set it (or, with
    ``append``, gets it added when something did)."""
    rule_id = _short_hash("rule", stack_name, var)
    if append:
        rule = {
            "id": rule_id,
            "branches": [{
                "condition": {"var": var, "op": "is_set", "value": ""},
                "action": {"target_var": var, "mode": "append", "value": value},
            }],
            "else": {"action": {"target_var": var, "mode": "replace", "value": value}},
        }
    else:
        rule = {
            "id": rule_id,
            "branches": [{
                "condition": {"var": var, "op": "is_unset", "value": ""},
                "action": {"target_var": var, "mode": "replace", "value": value},
            }],
        }
    mid = _unique_id(_short_hash("derivation", stack_name, var), ctx.used_ids)
    return {
        "type": "derivation", "id": mid, "name": _display_name(f"{stack_name} · {var} default"),
        "description": f"Sets ${var} for {stack_name} (imported)",
        "payload": {"rules": [rule]},
    }


def _extract_parts(
    value: str, out_var: str, entry: _Wildcard, stack_name: str,
    env: dict[str, str], ctx: _Ctx,
) -> tuple[str, list[_Wildcard]]:
    """A Combine can't hold references, so every top-level piece of the
    line that does (a reference, a group, a ``{…}`` with one inside)
    becomes a one-option wildcard written to its own variable, and the
    template reads that variable instead."""
    parts: list[_Wildcard] = []
    out: list[str] = []
    i = 0
    last = 0
    n = len(value)

    def add(piece: str) -> str:
        if _PLACEHOLDER_RE.search(piece):
            def sub(m: re.Match[str]) -> str:
                raw = env.get(m.group(1))
                ctx.report.note(
                    "variable_read_in_nested_list", entry.path,
                    f"${m.group(1)} inside {_readable(piece)} rolls again there",
                )
                return _with_env(raw, env, ctx) if raw is not None else f"$${m.group(1)}"
            piece = _PLACEHOLDER_RE.sub(sub, piece)
        binding = _ident(f"{out_var}_part{len(parts) + 1}")
        w = _generated(
            f"{stack_name} · part {len(parts) + 1}", entry.source,
            [{"value": piece}], binding, ctx,
        )
        parts.append(w)
        return f"${binding}"

    while i < n:
        if value.startswith("@{", i) and _WP_REF_START.match(value, i):
            end = value.find("}", i)
            if end != -1:
                out.append(value[last:i])
                out.append(add(value[i:end + 1]))
                i = last = end + 1
                continue
        if value.startswith("\x00group:", i):
            end = value.find("\x00", i + 1)
            out.append(value[last:i])
            out.append(add(value[i:end + 1]))
            i = last = end + 1
            continue
        if value[i] == "{":
            end = _match_brace(value, i)
            if end is not None:
                block = value[i:end + 1]
                if "@{" in block or "\x00group:" in block:
                    out.append(value[last:i])
                    out.append(add(block))
                    i = last = end + 1
                    continue
                i = end + 1
                continue
        i += 1
    out.append(value[last:])
    return "".join(out), parts


def _line_stack(wc: _Wildcard, line: dict[str, Any], n: int, ctx: _Ctx) -> None:
    """A line of an entry point that sets variables rolled once
    (``${x=!v}``) or reads ones nothing sets (template slots) → a stack:
    setters, defaults, parts, then a Combine that renders the line into
    the entry point's variable."""
    name = wc.name if n == 0 else f"{wc.name} {n}"
    out_var = _ident(wc.path.split("/")[-1])
    stack: dict[str, Any] = {"name": name, "entry": wc, "children": [], "kind": "variables"}
    children: list[tuple[str, Any, dict[str, Any]]] = stack["children"]
    env = {k: v["raw"] for k, v in line["vars"].items() if v["kind"] == "set"}
    inputs: list[str] = []
    for var, info in line["vars"].items():
        if info["kind"] == "set":
            op = info["op"]
            binding = var if op == "=" else f"{var}_{'default' if op == '?=' else 'add'}"
            spec = _setter(wc, name, var, binding, info["raw"], env, ctx)
            children.append(spec)
            if op == "=":
                ctx.setters.setdefault(var, []).append((stack, spec))
            else:
                children.append(("row", _derivation(
                    name, var, f"${binding}", ctx, append=op == "+=",
                ), {}))
        else:
            default = info.get("default")
            if default:
                text = _with_env(default, env, ctx)
                if "@{" in text or "\x00group:" in text:
                    spec = _setter(wc, name, f"{var} default", f"{var}_default", default, env, ctx)
                    children.append(spec)
                    text = f"${var}_default"
                children.append(("row", _derivation(name, var, text, ctx), {}))
            else:
                ctx.report.note(
                    "template_slot", wc.path,
                    f"${var}: nothing in the pack sets it; set it upstream of {name}",
                )
        inputs.append(var)
    template, parts = _extract_parts(line["value"], out_var, wc, name, env, ctx)
    for p in parts:
        children.append(("wc", p, {}))
        inputs.append(p.binding or "")
    template = _PLACEHOLDER_RE.sub(lambda m: f"${m.group(1)}", template).strip()
    negative = ", ".join(x for x in line["negatives"] if x.strip())
    if negative and ("@{" in negative or "\x00group:" in negative):
        ctx.report.note("negative_dropped", wc.path, f"{negative} (holds a reference)")
        negative = ""
    if line.get("cond") is not None:
        ctx.report.note("condition_dropped", wc.path, f"{name}: a stack line can't be conditioned")
    if template:
        payload: dict[str, Any] = {
            "template": template,
            "output_var": out_var,
            "input_vars": list(dict.fromkeys(v for v in inputs if v)),
        }
        if negative:
            payload["negative"] = negative
        mid = _unique_id(_short_hash("combine", _norm(wc.path), str(n)), ctx.used_ids)
        children.append(("row", {
            "type": "combine", "id": mid, "name": _display_name(name),
            "description": f"Renders {name} from {wc.source} (imported)",
            "payload": payload,
        }, {}))
    ctx.stacks.append(stack)
    ctx.report.note("line_became_stack", wc.path, f"{name}: setters + Combine → ${out_var}")


# ---------------------------------------------------------------------------
# Conditions → constraints
# ---------------------------------------------------------------------------


def _model_stack(source: str, ctx: _Ctx) -> dict[str, Any]:
    """One "Model checks" stack per Model Info variable: a wildcard that
    takes the option matching ``$model_family`` / ``$model_variant``
    (``other`` when none does), as the source of the constraints."""
    stacks = ctx.model_stacks
    if source in stacks:
        return stacks[source]
    values = MODEL_FAMILIES if source == "model_family" else MODEL_VARIANTS
    options = [{"value": v} for v in values] + [{"value": "other", "fallback": True}]
    label = "family" if source == "model_family" else "variant"
    w = _generated(f"model checks · {label}", "", options, f"ppp_{source}", ctx)
    stack = {
        "name": f"Model checks ({label})",
        "entry": None,
        "kind": "model",
        "children": [("wc", w, {"match_variable": source})],
        "source": w,
    }
    stacks[source] = stack
    ctx.stacks.append(stack)
    return stack


def _build_constraints(
    ctx: _Ctx, rows_by_id: dict[str, dict[str, Any]],
    retarget: dict[str, tuple[_Merge, str]],
) -> list[dict[str, Any]]:
    """PPP ``if`` conditions → Constraints that exclude, for each value of
    the variable a condition reads, the options whose condition fails.
    The source is the wildcard that rolls the variable (a stack's setter)
    or, for model checks, the Model checks stack's wildcard. Each
    constraint goes into the stack(s) right after its source."""
    grouped: dict[tuple[Any, ...], list[tuple[str, Any]]] = {}
    order: list[tuple[Any, ...]] = []
    cond_wc: dict[int, _Wildcard] = {}
    for wc, oid, cond in ctx.option_conds:
        src = model_source(cond)
        if src is not None:
            key: tuple[Any, ...] = ("model", src, id(wc))
        else:
            names = cond_vars(cond)
            var = next(iter(names)) if len(names) == 1 else None
            if var is None or var not in ctx.setters:
                ctx.report.note(
                    "condition_dropped", wc.path,
                    f"{_cond_text(cond)}: nothing in the pack rolls "
                    f"{', '.join(sorted(names))} once",
                )
                continue
            key = ("var", var, id(wc))
        if key not in grouped:
            grouped[key] = []
            order.append(key)
            cond_wc[id(wc)] = wc
        grouped[key].append((oid, cond))
    out: list[dict[str, Any]] = []
    for key in order:
        kind, var, wid = key
        wc = cond_wc[wid]
        conds = grouped[key]
        tkey = _norm(wc.path)
        hit = retarget.get(tkey)
        target_row = rows_by_id.get(hit[0].id if hit else wc.id)
        if target_row is None:
            continue
        values_by_oid = {o["id"]: o["value"] for o in wc.options}
        target_ids = {o["value"]: o["id"] for o in target_row["payload"]["options"]}
        if kind == "model":
            stack = _model_stack(var, ctx)
            sources = [(
                stack, stack["source"],
                lambda v, s=var: model_env(s, "" if v == "other" else v),
            )]
        else:
            sources = []
            for stack, spec in ctx.setters[var]:
                w = spec[1]
                if _norm(w.path) in retarget:
                    ctx.report.note(
                        "condition_dropped", wc.path,
                        f"{_cond_text(conds[0][1])}: ${var} comes from a merged list",
                    )
                    continue
                sources.append((stack, w, lambda v, n=var: {n: v}))
        for stack, src, env_for in sources:
            exceptions: list[dict[str, Any]] = []
            seen: set[tuple[str, str]] = set()
            for so in src.options:
                env = env_for(so["value"])
                for oid, cond in conds:
                    if eval_condition(cond, env):
                        continue
                    tval = values_by_oid.get(oid)
                    if tval is None or (so["value"], tval) in seen:
                        continue
                    seen.add((so["value"], tval))
                    exceptions.append({
                        "source": so["value"], "target": tval,
                        "source_id": so["id"], "target_id": target_ids.get(tval, ""),
                        "mode": "exclude", "factor": 0,
                    })
            if not exceptions:
                continue
            cid = _unique_id(_short_hash("constraint", src.id, target_row["id"]), ctx.used_ids)
            row = {
                "type": "constraint", "id": cid,
                "name": _display_name(f"{target_row['name']} by {var}"),
                "description": (
                    f"PPP conditions of {wc.path} (imported): leaves out the options "
                    f"whose condition fails for each {var} value"
                ),
                "payload": {
                    "source_wildcard_id": src.id,
                    "target_wildcard_id": target_row["id"],
                    "source_wildcard_name": src.name,
                    "target_wildcard_name": target_row["name"],
                    "matrix": {},
                    "exceptions": exceptions,
                },
            }
            out.append(row)
            # After the source, before what reads it.
            children = stack["children"]
            at = next(
                (i + 1 for i, c in enumerate(children) if c[0] == "wc" and c[1] is src),
                len(children),
            )
            while at < len(children) and children[at][0] == "row" \
                    and children[at][1].get("type") == "constraint":
                at += 1
            children.insert(at, ("row", row, {}))
    return out


def _cond_text(cond: Any) -> str:
    if cond is None:
        return ""
    kind = cond[0]
    if kind == "cmp":
        _, var, op, values = cond
        if op is None:
            return str(var)
        vals = ", ".join(f"'{v}'" for v in values)
        return f"{var} {op} {vals if len(values) == 1 else '(' + vals + ')'}"
    if kind == "not":
        return f"not {_cond_text(cond[1])}"
    return f" {kind} ".join(
        f"({_cond_text(x)})" if x[0] in ("and", "or") else _cond_text(x) for x in cond[1]
    )



# ---------------------------------------------------------------------------
# Stacks → bundles, plan rows and sample rolls
# ---------------------------------------------------------------------------


def _finish_stacks(
    ctx: _Ctx, rows_by_id: dict[str, dict[str, Any]],
    retarget: dict[str, tuple[_Merge, str]],
) -> list[dict[str, Any]]:
    """Resolve each stack's children to rows. A setter that is a list
    merged away becomes the merged wildcard with the list's filter."""
    out: list[dict[str, Any]] = []
    for st in ctx.stacks:
        kids: list[tuple[dict[str, Any], dict[str, Any]]] = []
        for kind, obj, inst in st["children"]:
            if kind == "wc":
                hit = retarget.get(_norm(obj.path))
                if hit is not None:
                    m, expr = hit
                    row = rows_by_id.get(m.id)
                    inst = {**inst, "category_filter": expr}
                else:
                    row = rows_by_id.get(obj.id)
            else:
                row = rows_by_id.get(obj["id"])
            if row is not None:
                kids.append((row, inst))
        if not kids:
            continue
        sid = _unique_id(_short_hash("stack", st["name"].lower()), ctx.used_ids)
        out.append({**st, "id": sid, "rows": kids})
    return out


def _stack_output(st: dict[str, Any]) -> str:
    """The variable a stack renders: its Combine's, else its last
    module's."""
    for row, _ in reversed(st["rows"]):
        if row["type"] == "combine":
            return str(row["payload"].get("output_var") or "")
    row, inst = st["rows"][-1]
    return str(inst.get("variable_binding") or row["payload"].get("var_binding") or "")


def _stack_plan(stacks: list[dict[str, Any]], ctx: _Ctx) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for st in stacks:
        entry = st.get("entry")
        path = entry.path if entry is not None else ""
        kinds = ctx.report.kinds_by_wildcard.get(path, set()) if path else set()
        fidelity = (
            "lossy" if kinds & _LOSSY_KINDS else "close" if kinds & _CLOSE_KINDS else "exact"
        )
        out.append({
            "id": st["id"],
            "name": st["name"],
            "domain": path.split("/", 1)[0] if "/" in path else "",
            "role": "stack",
            "type": "bundle",
            "stack_kind": st.get("kind", "variables"),
            "options": len(st["rows"]),
            "refs": 0,
            "referenced_by": 0,
            "fidelity": fidelity,
            "notes": ctx.report.by_wildcard.get(path, []) if path else [],
            "source": entry.source if entry is not None else "",
            "output": _stack_output(st),
            "children": [
                {"id": row["id"], "name": row["name"], "type": row["type"],
                 **({"instance": inst} if inst else {})}
                for row, inst in st["rows"]
            ],
        })
    return out


def _stack_bundles(
    stacks: list[dict[str, Any]], used_ids: set[str], tags: list[str],
) -> list[dict[str, Any]]:
    out = []
    for st in stacks:
        if st.get("kind") == "model":
            desc = (
                "PPP model checks (imported). Put it after a WP Model Info node and "
                "before the prompt it steers: its wildcard takes the loaded model's "
                "value and its constraints leave out what the pack's conditions rule out."
            )
        else:
            desc = (
                f"Imported stack: rolls the variables of {st['name']} once, then renders "
                f"it into ${_stack_output(st)}."
            )
        out.append(_bundle_row(
            st["id"], st["name"], desc, tags,
            [_child_snapshot(row, inst) for row, inst in st["rows"]],
        ))
    return out


MAX_SAMPLED = 40


def _roll_samples(
    plan: list[dict[str, Any]], payload: dict[str, Any],
    stacks: list[dict[str, Any]], seeds: int,
) -> None:
    """Roll each entry point and stack a few times with the engine, so the
    review shows what the import makes; a warning the rolls raise makes
    the row lossy."""
    from engine.scenario import run_scenario

    catalog = {r["id"]: r["payload"] for r in payload["wildcards"]}
    by_id = {r["id"]: r for r in payload["wildcards"]}
    stack_by_id = {st["id"]: st for st in stacks}
    done = 0
    # Stacks first: they are what the import built, so worth a look.
    for item in sorted(plan, key=lambda p: p["role"] != "stack"):
        if done >= MAX_SAMPLED:
            break
        if item["role"] == "entry" and item["id"] in by_id:
            row = by_id[item["id"]]
            modules = [_scenario_module(row, {})]
            var = str(row["payload"].get("var_binding") or "")
        elif item["role"] == "stack" and item["id"] in stack_by_id \
                and stack_by_id[item["id"]].get("kind") != "model":
            # A model check stack only steers what comes after it.
            st = stack_by_id[item["id"]]
            modules = [_scenario_module(row, inst) for row, inst in st["rows"]]
            var = _stack_output(st)
        else:
            continue
        done += 1
        try:
            res = run_scenario(
                modules, seeds=list(range(1, seeds + 1)), catalog=catalog,
                track=[var], sample_limit=0,
            )
        except Exception:  # noqa: BLE001 - a preview never sinks the import
            continue
        tracked = (res.get("tracked") or {}).get("values", {}).get(var, [])
        item["samples"] = [v for v in tracked if v is not None]
        problems = [
            w for w in res.get("warnings", [])
            if w.get("severity") in ("warn", "warning", "error")
            and w.get("type") not in ("unknown_var", "match_variable_no_match")
        ]
        if problems:
            item["roll_warnings"] = [
                {"type": str(w.get("type", "")), "message": str(w.get("message", ""))[:200]}
                for w in problems[:4]
            ]
            item["fidelity"] = "lossy"


def _scenario_module(row: dict[str, Any], instance: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"], "_uid": row["id"], "type": row["type"], "enabled": True,
        "name": row["name"], "payload": row["payload"], "instance": dict(instance),
    }


# ---------------------------------------------------------------------------
# Parameterised copies (P4)
# ---------------------------------------------------------------------------

_FILTERED_REF_RE = re.compile(r"@\{([0-9a-f]{8})#([^}:]*):([^}]*)\}")


def _drop_tag(value: str, tag: str, touched: set[str]) -> str:
    """Remove ``tag`` from every reference filter that ANDs it in."""
    def sub(m: re.Match[str]) -> str:
        expr = m.group(3)
        if "(" in expr or " or " in expr or "not " in expr:
            return m.group(0)
        terms = [t.strip() for t in expr.split(" and ")]
        if tag not in terms:
            return m.group(0)
        touched.add(m.group(1))
        rest = [t for t in terms if t != tag]
        return f"@{{{m.group(1)}#{m.group(2)}" + (f":{' and '.join(rest)}" if rest else "") + "}"
    return _FILTERED_REF_RE.sub(sub, value)


def _skeleton(row: dict[str, Any], tag: str) -> tuple[Any, ...] | None:
    touched: set[str] = set()
    values = tuple(
        (_drop_tag(o["value"], tag, touched), o.get("weight", 1), o.get("negative", ""))
        for o in row["payload"]["options"]
    )
    return (values, tuple(sorted(touched))) if touched else None


def _row_tags(row: dict[str, Any]) -> list[str]:
    seen: dict[str, None] = {}
    for o in row["payload"]["options"]:
        for m in _FILTERED_REF_RE.finditer(o["value"]):
            expr = m.group(3)
            if "(" in expr or " or " in expr or "not " in expr:
                continue
            for t in expr.split(" and "):
                seen[t.strip()] = None
    return list(seen)


def _fold_copies(rows: list[dict[str, Any]], roles: dict[str, str], ctx: _Ctx) -> set[str]:
    """Entry points in one folder that are the same text except for one
    tag in their reference filters (``superhero @{heroes:marvel}`` and
    ``superhero @{heroes:dc}``) fold into one wildcard without that tag,
    plus a small source wildcard (``marvel``, ``dc``) and a Constraint
    whose ``only`` rows keep the referenced options to the tag the source
    picked. Pinning the source gives back each original. Returns the ids
    of the folded rows."""
    by_folder: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        if roles.get(row["id"]) != "entry" or "/" not in row["name"]:
            continue
        by_folder.setdefault(row["name"].rsplit("/", 1)[0], []).append(row)
    folded: set[str] = set()
    names = {r["id"]: r["name"] for r in rows}
    for folder, group in by_folder.items():
        left = list(group)
        while len(left) >= 2:
            first = left[0]
            cluster: list[tuple[dict[str, Any], str]] = []
            skel = None
            for tag in _row_tags(first):
                skel = _skeleton(first, tag)
                if skel is None:
                    continue
                cluster = [(first, tag)]
                for other in left[1:]:
                    for u in _row_tags(other):
                        if u != tag and u not in {t for _, t in cluster} \
                                and _skeleton(other, u) == skel:
                            cluster.append((other, u))
                            break
                if len(cluster) >= 2:
                    break
            if skel is None or len(cluster) < 2:
                left.pop(0)
                continue
            _fold_cluster(folder, cluster, skel, ctx, names)
            done = {id(r) for r, _ in cluster}
            folded |= {r["id"] for r, _ in cluster}
            left = [r for r in left if id(r) not in done]
    return folded


def _fold_cluster(
    folder: str, cluster: list[tuple[dict[str, Any], str]],
    skel: tuple[Any, ...], ctx: _Ctx, names: dict[str, str],
) -> None:
    values, targets = skel
    first = cluster[0][0]
    # `random-marvel-hero` folded over `marvel` → `random-hero`.
    stem = first["name"].rsplit("/", 1)[-1]
    tag0 = cluster[0][1]
    named = re.sub(r"[-_ ]{2,}", "-", stem.replace(tag0, "")).strip("-_ ") \
        if tag0 in stem else ""
    last = named or folder.split("/")[-1]
    base = f"{folder}/{named}" if named else f"{folder} · any"
    n = 2
    while any(st.get("name") == f"{base} (folded)" for st in ctx.stacks):
        base = f"{folder}/{named or 'any'} {n}"
        n += 1
    comp_payload = {
        "var_binding": _ident(last),
        "sub_categories": [],
        "options": [
            {
                "id": o["id"], "value": v, "weight": w, "sub_categories": list(o["sub_categories"]),
                **({"negative": neg} if neg else {}),
                **({"fallback": True} if o.get("fallback") else {}),
            }
            for o, (v, w, neg) in zip(first["payload"]["options"], values, strict=True)
        ],
    }
    comp_id = _unique_id(_short_hash("folded", _norm(base)), ctx.used_ids)
    source_opts = [
        # Matrix rows key on the source option's tags, so each option
        # carries its own value as its tag.
        {"id": _short_hash(base, "src", t), "value": t, "weight": 1, "sub_categories": [t]}
        for _, t in cluster
    ]
    src_id = _unique_id(_short_hash("folded-source", _norm(base)), ctx.used_ids)
    src_name = _display_name(f"{base} · choice")
    children: list[tuple[str, Any, dict[str, Any]]] = [("row", {
        "type": "wildcard", "id": src_id, "name": src_name,
        "description": (
            f"Which of the {len(cluster)} lists under {folder}/ to make (imported): "
            "pin it to get one of them back"
        ),
        "payload": {"var_binding": _ident(f"{last}_choice"),
                    "sub_categories": [t for _, t in cluster], "options": source_opts},
    }, {})]
    for tid in targets:
        cid = _unique_id(_short_hash("folded-constraint", src_id, tid), ctx.used_ids)
        children.append(("row", {
            "type": "constraint", "id": cid,
            "name": _display_name(f"{base} · choice → {names.get(tid, tid)}"),
            "description": f"Keeps each choice of {folder} to its own tag (imported)",
            "payload": {
                "source_wildcard_id": src_id,
                "target_wildcard_id": tid,
                "source_wildcard_name": src_name,
                "target_wildcard_name": names.get(tid, ""),
                "matrix": {t: {t: {"mode": "only", "factor": 1}} for _, t in cluster},
                "exceptions": [],
            },
        }, {}))
    children.append(("row", {
        "type": "wildcard", "id": comp_id, "name": _display_name(base),
        "description": (
            f"The lists {', '.join(r['name'].rsplit('/', 1)[-1] for r, _ in cluster)} "
            f"of {folder}/ as one (imported): {src_name} picks which"
        ),
        "payload": comp_payload,
    }, {}))
    ctx.stacks.append({
        "name": f"{base} (folded)", "entry": None, "folder": folder,
        "kind": "copies", "children": children,
    })
    for r, t in cluster:
        ctx.report.note(
            "copies_folded", r["name"],
            f"{r['name']} = {base} with {src_name} pinned to {t}",
        )


__all__ = [
    "SourceFile", "convert_files", "is_wildcard_file", "read_zip", "WILDCARD_EXTENSIONS",
]
