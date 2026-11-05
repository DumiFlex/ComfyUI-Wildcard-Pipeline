"""A "fits" constraint as a pick list.

"A weapon that fits the class" written as tag cells is where a small model
fails most: it tags a staff #melee and the mage gets a greatsword. Asked
instead to tick, for each class, the weapons that fit it from the real
numbered list, it answers well. The ticks become `only` exceptions (each
class keeps only the weapons ticked for it), which this module writes, so
the model never handles tags, modes or factors.
"""
from __future__ import annotations

import re
from typing import Any

#: The rule says one pick fits, suits or goes with another.
_FITS = re.compile(r"\b(?:fits?|fitting|suits?|suited|goes with|go with|appropriate|"
                   r"matching|matches)\b", re.I)
#: Lists longer than this go the usual way (the prompt would be too long).
MAX_SOURCES = 24
MAX_TARGETS = 40

SYSTEM_PROMPT = """\
You decide which options of one list fit each option of another, for an \
image-prompt generator. For every numbered option of the first list, give \
the numbers of the options in the second list that fit it, using common \
sense (a mage fits a staff or a wand, not a greatsword). Give at least one \
for each. List every one that fits, not just the best. Answer with JSON only.\
"""

SCHEMA: dict[str, Any] = {
    "type": "object", "additionalProperties": False, "required": ["fits"],
    "properties": {"fits": {"type": "array", "items": {
        "type": "object", "additionalProperties": False,
        "required": ["source", "targets"],
        "properties": {"source": {"type": "integer"},
                       "targets": {"type": "array", "items": {"type": "integer"}}},
    }}},
}


def _options(payload: dict[str, Any]) -> list[dict[str, Any]]:
    return [o for o in payload.get("options") or [] if isinstance(o, dict)
            and not o.get("is_null") and isinstance(o.get("value"), str) and o["value"].strip()]


def applies(about: str, source: dict[str, Any], target: dict[str, Any]) -> bool:
    """Whether a constraint described by ``about`` between these two built
    wildcard payloads is a plain "fits" rule this module can write: no tags
    named, lists of a size one prompt can hold."""
    s, t = _options(source), _options(target)
    return bool(_FITS.search(about or "")) and "#" not in (about or "") \
        and 2 <= len(s) <= MAX_SOURCES and 2 <= len(t) <= MAX_TARGETS


def build_prompt(*, about: str, source_name: str, target_name: str,
                 source: dict[str, Any], target: dict[str, Any], note: str = "") -> str:
    lines = [f"The rule: {about.strip()}", "", f"{source_name} options:"]
    lines += [f"{n}. {o['value']}" for n, o in enumerate(_options(source), 1)]
    lines += ["", f"{target_name} options:"]
    lines += [f"{n}. {o['value']}" for n, o in enumerate(_options(target), 1)]
    lines += ["", f"For each {source_name} option, which {target_name} options fit it? "
              f'Answer {{"fits": [{{"source": 1, "targets": [2, 5]}}, …]}} with one entry '
              f"per {source_name} option."]
    if note:
        lines += ["", note]
    return "\n".join(lines)


def compile_answer(raw: Any, *, source: dict[str, Any],
                   target: dict[str, Any]) -> tuple[list[dict[str, Any]], list[str]]:
    """``(exceptions, warnings)``: an `only` exception per fitting pair. A
    source option given every target (or none) gets no rule. Raises
    ValueError when fewer than half the source options got an answer."""
    if not isinstance(raw, dict) or not isinstance(raw.get("fits"), list):
        raise ValueError("the answer had no fits list")
    s_opts, t_opts = _options(source), _options(target)
    picked: dict[int, list[int]] = {}
    for entry in raw["fits"]:
        if not isinstance(entry, dict):
            continue
        si = _index(entry.get("source"), len(s_opts))
        if si is None or si in picked:
            continue
        tis = []
        for t in _got if isinstance(_got := entry.get("targets"), list) else []:
            ti = _index(t, len(t_opts))
            if ti is not None and ti not in tis:
                tis.append(ti)
        if tis:
            picked[si] = tis
    if len(picked) * 2 < len(s_opts):
        raise ValueError(f"it answered for {len(picked)} of {len(s_opts)} options")
    exceptions: list[dict[str, Any]] = []
    warnings: list[str] = []
    open_ = [s_opts[i]["value"] for i in range(len(s_opts)) if i not in picked]
    for si, tis in sorted(picked.items()):
        if len(tis) == len(t_opts):
            continue  # everything fits: no rule needed
        a = s_opts[si]
        for ti in tis:
            b = t_opts[ti]
            exc: dict[str, Any] = {"source": a["value"], "target": b["value"],
                                   "mode": "only", "factor": 1.0}
            if a.get("id"):
                exc["source_id"] = a["id"]
            if b.get("id"):
                exc["target_id"] = b["id"]
            exceptions.append(exc)
    if open_:
        warnings.append("No answer for " + ", ".join(f'"{v}"' for v in open_[:4])
                        + ": those keep every option")
    if not exceptions:
        raise ValueError("everything fits everything, so the rule changes nothing")
    return exceptions, warnings


def _index(raw: Any, size: int) -> int | None:
    if isinstance(raw, bool):
        return None
    if isinstance(raw, str) and re.fullmatch(r"\s*\d+\.?\s*", raw):
        raw = int(raw.strip(" ."))
    if isinstance(raw, int) and 1 <= raw <= size:
        return raw - 1
    return None
