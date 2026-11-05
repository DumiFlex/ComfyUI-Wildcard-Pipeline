"""Matching for WP_VarToChoice — pure string logic, no ComfyUI imports.

The node hands this module the variable's text and the option lists of the
dropdown inputs its output is wired into (read off the hidden ``prompt``).
This module finds those consumers and picks the option the text names.

Match modes, each a superset of the one before:

* ``exact``   — the text equals an option.
* ``loose``   — also ignores case, folders, the file extension and the
  separators ``space _ - .``; then an option whose name starts with, or
  contains, the text (several → the shortest, so ``v14`` beats ``v140``).
* ``closest`` — also the most similar option by ``difflib`` ratio, when it is
  at least :data:`CLOSEST_CUTOFF` (typos).
"""
from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field
from typing import Any

MATCH_MODES = ("exact", "loose", "closest")
NO_MATCH_MODES = ("use fallback", "stop the run")
#: The fallback dropdown's first entry: no fallback picked, use the first
#: option. The frontend fills the rest of that dropdown with the options of
#: the input the node feeds.
FIRST_OPTION = "(first option)"
CLOSEST_CUTOFF = 0.6

_SEP_RE = re.compile(r"[\s_\-.]+")
# An extension starts with a letter, so ``v1.4`` keeps its ``.4``.
_EXT_RE = re.compile(r"\.[a-z][a-z0-9]{0,11}$", re.IGNORECASE)


def _base(text: str) -> str:
    """``SDXL\\pony\\x.safetensors`` → ``x.safetensors``."""
    return re.split(r"[\\/]", text)[-1]


def normalize(text: str) -> str:
    """Lowercase stem without folders, extension or separators."""
    base = _base((text or "").strip())
    base = _EXT_RE.sub("", base)
    return _SEP_RE.sub("", base.lower())


def normalize_path(text: str) -> str:
    """Like :func:`normalize` but keeps folder names, so ``pony/x`` can tell
    two same-named files apart."""
    parts = [p for p in re.split(r"[\\/]", (text or "").strip()) if p]
    if not parts:
        return ""
    parts[-1] = _EXT_RE.sub("", parts[-1])
    return "/".join(_SEP_RE.sub("", p.lower()) for p in parts)


def _prefer_folder(value: str, options: list[str]) -> str:
    """Several options share a stem: prefer the one whose folders the value
    names (``pony/x`` → ``SDXL\\pony\\x.safetensors``), else the first."""
    want = normalize_path(value)
    for opt in options:
        if normalize_path(opt).endswith(want):
            return opt
    return options[0]


def match_option(value: str, options: list[str], mode: str = "loose") -> tuple[str | None, str]:
    """Return ``(option, how)``; ``how`` is ``exact`` / ``loose`` /
    ``closest``, or ``""`` with ``None`` when nothing matches."""
    text = (value or "").strip()
    if not text or not options:
        return None, ""
    if text in options:
        return text, "exact"
    if mode not in ("loose", "closest"):
        return None, ""

    want = normalize(text)
    if not want:
        return None, ""
    keyed = [(opt, normalize(opt)) for opt in options]

    same = [opt for opt, key in keyed if key == want]
    if same:
        return _prefer_folder(text, same), "loose"

    # Starts-with before contains; the shortest name is the closest one.
    for test in (str.startswith, str.__contains__):
        hits = [(len(key), i, opt) for i, (opt, key) in enumerate(keyed) if test(key, want)]
        if hits:
            shortest = min(h[0] for h in hits)
            return _prefer_folder(text, [h[2] for h in sorted(hits) if h[0] == shortest]), "loose"

    if mode == "closest":
        best_ratio = 0.0
        best: str | None = None
        for opt, key in keyed:
            ratio = difflib.SequenceMatcher(None, want, key).ratio()
            if ratio > best_ratio:
                best_ratio, best = ratio, opt
        if best is not None and best_ratio >= CLOSEST_CUTOFF:
            return best, "closest"
    return None, ""


# ------------------------------------------------------------ consumers ---


@dataclass(frozen=True)
class Target:
    """One input fed by the node's output."""

    node_id: str
    class_type: str
    input_name: str
    #: The input's dropdown options, or ``None`` when it has none (a switch,
    #: an ``*`` input, a text input).
    options: tuple[str, ...] | None


def _is_link(v: Any) -> bool:
    return isinstance(v, (list, tuple)) and len(v) == 2 and isinstance(v[1], int)


def find_consumers(prompt: Any, node_id: Any, slot: int = 0) -> list[tuple[str, str, str]]:
    """``(consumer_id, class_type, input_name)`` for every input linked to
    ``node_id``'s output ``slot`` in ComfyUI's API prompt, in prompt order."""
    if not isinstance(prompt, dict) or node_id is None:
        return []
    me = str(node_id)
    found: list[tuple[str, str, str]] = []
    for cid, node in prompt.items():
        inputs = node.get("inputs") if isinstance(node, dict) else None
        if not isinstance(inputs, dict):
            continue
        for name, val in inputs.items():
            if _is_link(val) and str(val[0]) == me and val[1] == slot:
                found.append((str(cid), str(node.get("class_type") or ""), str(name)))
    return found


def options_from_input_types(input_types: Any, input_name: str) -> tuple[str, ...] | None:
    """The dropdown options an ``INPUT_TYPES()`` dict declares for
    ``input_name``: a V1 list, or a V3 ``("COMBO", {"options": [...]})``."""
    if not isinstance(input_types, dict):
        return None
    for group in ("required", "optional"):
        spec = (input_types.get(group) or {}).get(input_name)
        if spec is None:
            continue
        if not isinstance(spec, (list, tuple)) or not spec:
            return None
        kind = spec[0]
        if isinstance(kind, (list, tuple)):
            return tuple(str(o) for o in kind)
        if kind == "COMBO" and len(spec) > 1 and isinstance(spec[1], dict):
            opts = spec[1].get("options")
            if isinstance(opts, (list, tuple)):
                return tuple(str(o) for o in opts)
        return None
    return None


# --------------------------------------------------------------- resolve ---


@dataclass
class ChoiceResult:
    value: str
    #: ``exact`` / ``loose`` / ``closest`` (matched), ``fallback``,
    #: ``passthrough`` (no option list to check), ``no_match`` (stop mode).
    status: str
    #: One plain sentence for the widget and the warning toast.
    note: str = ""
    target: str = ""
    option_count: int = 0
    warnings: list[str] = field(default_factory=list)


def titles_from_prompt(prompt: Any) -> dict[str, str]:
    """Node titles the frontend puts in each API node's ``_meta``."""
    out: dict[str, str] = {}
    if isinstance(prompt, dict):
        for nid, node in prompt.items():
            meta = node.get("_meta") if isinstance(node, dict) else None
            title = meta.get("title") if isinstance(meta, dict) else None
            if isinstance(title, str) and title.strip():
                out[str(nid)] = title.strip()
    return out


def describe_target(t: Target, titles: dict[str, str] | None = None) -> str:
    title = (titles or {}).get(t.node_id) or t.class_type or f"node {t.node_id}"
    return f"{title} › {t.input_name}"


def resolve_choice(
    value: str,
    targets: list[Target],
    *,
    mode: str = "loose",
    fallback: str = "",
    stop_on_no_match: bool = False,
    titles: dict[str, str] | None = None,
) -> ChoiceResult:
    """Pick the option ``value`` names among the first target's options.

    Never raises: with ``stop_on_no_match`` a miss comes back as status
    ``no_match`` and the node raises with ``note``.
    """
    text = (value or "").strip()
    if (fallback or "").strip() == FIRST_OPTION:
        fallback = ""
    listed = [t for t in targets if t.options is not None]
    if not listed:
        why = (
            "the output isn't wired" if not targets
            else "what it's wired into has no option list"
        )
        out = text or (fallback or "").strip()
        return ChoiceResult(
            out, "passthrough", f"Passed through unchecked: {why}.",
            target=describe_target(targets[0], titles) if targets else "",
        )

    first = listed[0]
    options = list(first.options or ())
    target = describe_target(first, titles)
    if not options:
        return ChoiceResult(
            text or (fallback or "").strip(), "passthrough",
            f"Passed through unchecked: {target} has no options.",
            target=target,
        )

    hit, how = match_option(text, options, mode)
    if hit is not None:
        notes = {
            "exact": "Exact match.",
            "loose": f"Matched “{text}” loosely.",
            "closest": f"Closest to “{text}”.",
        }
        note = notes[how]
        result = ChoiceResult(hit, how, note, target, len(options))
    else:
        reason = f"No match for “{text}”" if text else "The variable is empty"
        if stop_on_no_match:
            sample = ", ".join(options[:5]) + (", …" if len(options) > 5 else "")
            return ChoiceResult(
                "", "no_match",
                f"{reason} in {target} ({len(options)} options: {sample}).",
                target, len(options),
            )
        fb = (fallback or "").strip()
        if fb == FIRST_OPTION:
            fb = ""
        fb_hit = match_option(fb, options, mode)[0] if fb else None
        used = fb_hit or options[0]
        extra = (
            f" (fallback “{fb}” isn't an option either)" if fb and fb_hit is None else ""
        )
        result = ChoiceResult(
            used, "fallback", f"{reason}. Used {used}{extra}.", target, len(options),
        )

    for other in listed[1:]:
        if result.value not in (other.options or ()):
            result.warnings.append(
                f"{result.value} isn't an option of {describe_target(other, titles)}.",
            )
    return result
