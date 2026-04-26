"""Template variable substitution: $var, $$ escape, __internal skip."""

from __future__ import annotations

import re
from typing import Any

_VAR_RE = re.compile(r"\$(\w+)")
_SENTINEL = "\x00DOLLAR\x00"
# Two-or-more whitespace runs left by removed variables. Single space stays.
_WS_RUN = re.compile(r"[ \t]{2,}")
# Trailing/leading whitespace inside a comma-separated list left by drops.
_COMMA_GAP = re.compile(r",\s*,")
_TRIM_PUNCT = re.compile(r"\s+([,.;:!?])")


def resolve_variables(template: str, ctx: dict[str, Any]) -> str:
    """Replace ``$var`` with ``str(ctx[var])``.

    - ``$$`` escapes a literal ``$``.
    - Keys beginning with ``__`` are engine internals — never substituted.
    - Missing vars are dropped (replaced with empty string), and the
      surrounding whitespace is normalized so the output reads cleanly:
      doubled spaces collapse to one, ``", ,"`` collapses to ``","``,
      whitespace before punctuation is trimmed.
    """
    result = template.replace("$$", _SENTINEL)

    def _replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name.startswith("__"):
            return match.group(0)
        if name in ctx:
            return str(ctx[name])
        return ""

    result = _VAR_RE.sub(_replace, result)
    result = result.replace(_SENTINEL, "$")
    # Cleanup gaps left by dropped variables.
    result = _WS_RUN.sub(" ", result)
    result = _COMMA_GAP.sub(",", result)
    result = _TRIM_PUNCT.sub(r"\1", result)
    return result.strip()
