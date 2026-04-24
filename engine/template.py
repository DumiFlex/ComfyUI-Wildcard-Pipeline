"""Template variable substitution: $var, $$ escape, __internal skip."""

from __future__ import annotations

import re
from typing import Any

_VAR_RE = re.compile(r"\$(\w+)")
_SENTINEL = "\x00DOLLAR\x00"


def resolve_variables(template: str, ctx: dict[str, Any]) -> str:
    """Replace ``$var`` with ``str(ctx[var])``. ``$$`` escapes a literal ``$``.

    Keys beginning with ``__`` are engine internals and are never substituted.
    Missing vars are left unchanged.
    """
    result = template.replace("$$", _SENTINEL)

    def _replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name.startswith("__"):
            return match.group(0)
        if name in ctx:
            return str(ctx[name])
        return match.group(0)

    result = _VAR_RE.sub(_replace, result)
    return result.replace(_SENTINEL, "$")
