"""Strip orphan / leading / trailing punctuation.

Two cleanups:

  1. Tags mode — drop tags whose only content is punctuation
     (`.`, `,`, `:`, `;`, `!`, `?`, `-`, `_`, plus runs of those).
  2. Tags + text mode — strip leading + trailing punctuation runs
     from each tag (tags mode) or from the whole string (text mode,
     which keeps a closing `.` `!` `?` since prose ends in one).

Emoticon tags (`:3`, `-_-`, `^_^`) are kept whole in tags mode.

Idempotent: re-running on the same input produces the same output.
Reports `stats.stripped` = total tags + edges trimmed.
"""
from __future__ import annotations

import re

from engine.cleaner.atoms import contains_atom, ends_with_atom
from engine.cleaner.types import RuleResult

_PUNCT_CHARS = r".,:;!?\-_"
_PURE_PUNCT_RE = re.compile(rf"^[{_PUNCT_CHARS}\s]+$")
_LEADING_PUNCT_RE = re.compile(rf"^[{_PUNCT_CHARS}\s]+")
_TRAILING_PUNCT_RE = re.compile(rf"[{_PUNCT_CHARS}\s]+$")
# Text mode keeps the end of the last sentence (`.`, `!`, `?`, `...`) and
# strips only what can't end prose: `,` `:` `;` `-` `_`.
_TEXT_TRAILING_RE = re.compile(r"[,:;\-_\s]+$")

# Emoticon tags (Danbooru `:3`, `:d`, `;)`, `-_-`, `^_^`, `>_<`, `o_o`) are
# made of the very characters this rule strips, and they are real tags.
_EMOTICON_RE = re.compile(
    r"^(?:[:;=][-']?[^\s,.:;!?_-]{1,2}"  # :3  :d  ;)  :<  =)  :-p (not `::`)
    r"|[^\s,]_[^\s,]"                # -_-  ^_^  >_<  o_o  ;_;  ._.
    r"|[()<>\[\]]{1,2}[:;=]"           # ):  (;
    r")$",
)


def is_emoticon(tag: str) -> bool:
    return bool(_EMOTICON_RE.match(tag))


def _strip_edges(s: str) -> tuple[str, bool]:
    new = _LEADING_PUNCT_RE.sub("", s)
    new = _TRAILING_PUNCT_RE.sub("", new)
    return new, new != s


def apply(text: str, mode: str, config: dict) -> RuleResult:
    stripped = 0
    if mode == "tags":
        tags = [t.strip() for t in text.split(",") if t.strip()]
        kept: list[str] = []
        for tag in tags:
            if is_emoticon(tag):
                kept.append(tag)
                continue
            if _PURE_PUNCT_RE.match(tag):
                stripped += 1
                continue
            # `embedding:name` / `<lora:name:1.0>` are file references, and
            # `_` and `-` are in the stripped set — trimming an edge renames
            # the file. ComfyUI resolves a missing embedding to nothing, so
            # the damage is silent. See engine/cleaner/atoms.py.
            if contains_atom(tag):
                kept.append(tag)
                continue
            edged, changed = _strip_edges(tag)
            if changed:
                stripped += 1
            if edged:
                kept.append(edged)
        out = ", ".join(kept)
    else:
        # Text mode trims the whole string's edges rather than per tag, so the
        # only risk is a prompt that ENDS in an atom.
        if ends_with_atom(text):
            out = _LEADING_PUNCT_RE.sub("", text)
        else:
            out = _TEXT_TRAILING_RE.sub("", _LEADING_PUNCT_RE.sub("", text))
        if out != text:
            stripped += 1
    return {"text": out, "stats": {"stripped": stripped}}
