"""Fixed values, combines and prompt templates from plain language.

Three small answers, each forced by a JSON schema, each checked here and by
its engine handler, shared by the editor panels, the chat and the pack
builder:

    fixed values  {"values": [{"name", "value", "negative"}]}
    combine       {"template", "negative"}
    template      {"template", "negative"}

What each may hold follows the engine (see `refs.compile_text`): a fixed
value is text with optional ``{a|b}`` picks; a combine reads ``$vars`` and
may pick; the Assembler's template reads ``$vars`` only (it has no seed, so a
pick would stay as written) and its negative has a ``$negatives`` slot where
the negatives of the variables the prompt used go.
"""
from __future__ import annotations

import re
import secrets
from typing import Any

from engine.ai import about, adult
from engine.ai import refs as ai_refs
from engine.modules.combine_handler import CombineHandler
from engine.modules.fixed_values_handler import FixedValuesHandler
from engine.syntax.tokenize import tokenize_text
from engine.syntax.types import TokenKind

MAX_VALUES = 40
MAX_TEXT = 2000
MAX_TEMPLATE = 4000
_IDENT = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,63}$")
_VAR_READ = re.compile(r"\$([a-zA-Z_][a-zA-Z0-9_]*)")

_STR = {"type": "string"}


def _obj(props: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "additionalProperties": False,
            "required": list(props), "properties": props}


FIXED_SCHEMA = _obj({"values": {"type": "array", "items": _obj({
    "name": _STR, "value": _STR, "negative": _STR,
})}})
COMBINE_SCHEMA = _obj({"template": _STR, "negative": _STR})
TEMPLATE_SCHEMA = _obj({"template": _STR, "negative": _STR})

_INTRO = """\
You write for Wildcard Pipeline, a ComfyUI extension that builds \
image-generation prompts from variables ($name) that modules set in order. \
Write text exactly as it should appear in the prompt, in the style of the \
library (usually comma-separated tags; sentences for models like Flux). Don't \
add commentary; the output is data for the user's own library.\
"""

FIXED_SYSTEM = _INTRO + """

You write a fixed values module: variables set to the same text every run, \
like a style preset or quality tags ("$quality = masterpiece, best quality"). \
Each value is {name, value, negative}:
- name: the variable it sets, letters, digits and _ (no $).
- value: the text. It can't read $variables. {a|b} picks one of a or b each \
run when a little variation helps.
- negative: words this value puts in the negative prompt when the prompt uses \
it (a style preset's "3d render, photo" for an anime style), or "".\
"""

COMBINE_SYSTEM = _INTRO + """

You write a combine: a template that joins variables into a new one ("$hair \
$eyes" → $look). Read variables as $name ($name.0 for the first of a \
multi-pick, $name.AXIS for an accepts tag group's rolled tag, $name.neg for \
a variable's negative words). {a|b} picks one of a or b each run. You can't \
point at wildcards here (@{...} stays as written); read their variables. \
In the tags style, put ", " between the variables it joins ("$hair, $eyes"), \
since each holds its own tags. \
negative: words this combine adds to the negative prompt when the prompt \
uses it, or "". It also carries the negatives of the variables it reads.\
"""

TEMPLATE_SYSTEM = _INTRO + """

You write the final prompt template for the WP Prompt Assembler. It reads \
variables as $name and nothing else: the Assembler has no seed, so {a|b} \
and @{...} would stay as written. Put every choice in a wildcard or combine \
and read its variable here. Order it the way the model reads best (subject \
first, then details, then style and quality).
negative: the standing negative prompt. Write $negatives where the negative \
words of the variables the prompt used should go (e.g. "$negatives, lowres, \
bad hands, watermark"); without $negatives they are added at the end. "" \
gives just those words.\
"""


def build_prompt(
    *, kind: str, instruction: str, name: str, catalog_text: str,
    description: str = "", labels: list[str] | None = None, current: str = "",
    out_var: str = "",
    others: dict[str, str] | None = None,
) -> str:
    what = {"fixed_values": "Fixed values", "combine": "Combine",
            "template": "Prompt template"}[kind]
    lines = [f"{what}: {name or '(unnamed)'}"]
    lines.extend(about.lines(description, labels or []))
    if out_var:
        lines.append(f"It sets ${out_var}." if kind != "fixed_values" else
                     f"Its main value is ${out_var}: always set it.")
    if others:
        lines.append("Other items set these; don't set them here: " + ", ".join(
            f"${v} ({n})" for v, n in list(others.items())[:40]) + ".")
    if current:
        lines.append("It holds now:")
        lines.append(current)
    lines.append("")
    lines.append("Variables in the library (name, where it comes from, its options):")
    lines.append(catalog_text or "(none yet)")
    lines.append("")
    lines.append(f"Request: {instruction.strip()}")
    return "\n".join(lines)


def _flat(raw: Any, limit: int) -> str:
    s = re.sub(r"\s+", " ", raw).strip() if isinstance(raw, str) else ""
    return s[:limit]


def reads(text: str) -> list[str]:
    return list(dict.fromkeys(_VAR_READ.findall(text or "")))


def _unknown(text: str, catalog: dict[str, Any] | None, own: str = "") -> list[str]:
    if catalog is None:
        return []
    return [v for v in reads(text) if (v not in catalog or v == own) and v != "negatives"]


def compile_fixed(
    raw: Any, *, existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """New (or replaced) values. A value whose name is already in
    ``existing`` replaces that row's text and keeps its id, so a rewrite
    stays one row. Returns ``{payload, preview, warnings, skipped, changed}``.
    Raises ValueError when nothing is usable."""
    if not isinstance(raw, dict) or not isinstance(raw.get("values"), list):
        raise ValueError("the model's answer wasn't a list of values")
    rows = [dict(v) for v in (existing or {}).get("values") or [] if isinstance(v, dict)]
    by_name = {v.get("name"): v for v in rows if isinstance(v.get("name"), str)}
    taken = {v.get("id") for v in rows}
    preview: list[str] = []
    skipped: list[dict[str, str]] = []
    changed = 0
    for item in raw["values"][:MAX_VALUES]:
        if not isinstance(item, dict):
            continue
        name = _flat(item.get("name"), 70).lstrip("$")
        if not _IDENT.match(name) or name.startswith("__"):
            skipped.append({"text": name or "a value", "reason": "not a variable name"})
            continue
        try:
            value = ai_refs.compile_text(_flat(item.get("value"), MAX_TEXT), surface="fixed")
            negative = ai_refs.compile_text(_flat(item.get("negative"), MAX_TEXT),
                                            surface="fixed")
        except ValueError as e:
            skipped.append({"text": name, "reason": str(e)})
            continue
        row = by_name.get(name)
        # On a value that exists, a left-out text keeps it and a left-out
        # negative keeps that ("negative": "" clears it), so the model can
        # change just one of the two.
        if row is not None:
            value = value or str(row.get("value") or "")
            if "negative" not in item:
                negative = str(row.get("negative") or "")
        if not value:
            skipped.append({"text": name, "reason": "empty"})
            continue
        if adult.sexual_minor(value):
            skipped.append({"text": name, "reason": "it names a minor in a sexual context"})
            continue
        if row is None:
            row = {"id": _new_id(taken), "name": name}
            rows.append(row)
            by_name[name] = row
        elif row.get("value") == value and (row.get("negative") or "") == negative:
            continue
        row["value"] = value
        if negative:
            row["negative"] = negative
        else:
            row.pop("negative", None)
        changed += 1
        preview.append(f"${name} = {value}" + (f"  (negative: {negative})" if negative else ""))
    if not changed:
        raise ValueError("no usable values" + "".join(
            f"; {s['text'][:40]}: {s['reason']}" for s in skipped[:3]))
    payload = dict(existing or {})
    payload["values"] = rows
    FixedValuesHandler.validate_payload(payload)
    return {"payload": payload, "preview": preview, "skipped": skipped, "changed": changed,
            "warnings": [f"Left out {s['text'][:40]}: {s['reason']}" for s in skipped[:6]]}


def _new_id(taken: set[Any]) -> str:
    while True:
        vid = f"v{secrets.token_hex(4)}"
        if vid not in taken:
            taken.add(vid)
            return vid


_AXIS_READ = re.compile(r"\$([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)")


def _fix_axes(text: str, catalog: dict[str, Any] | None,
              warnings: list[str]) -> str:
    """``$x.WORD`` reads x's accepts tag group WORD (or ``.neg``). A word that
    isn't one of x's groups ("$race.tags", "$outerwear.AXIS") renders as
    nothing at run time, so it becomes a plain ``$x``."""
    def sub(m: re.Match[str]) -> str:
        var, word = m.group(1), m.group(2)
        entry = (catalog or {}).get(var)
        if word == "neg" or not entry or not entry.get("sources") \
                or word in (entry.get("axes") or []):
            return m.group(0)
        warnings.append(f"Read ${var} instead of ${var}.{word}: ${var} has no {word} tag group")
        return f"${var}"
    return _AXIS_READ.sub(sub, text)


_ASKED_VAR = re.compile(r"\$([a-zA-Z_][a-zA-Z0-9_]*)")
#: "{portrait}" or "{ }": braces around plain words, not a pick.
_STRAY_BRACES = re.compile(r"(?<![@$])\{([^{}|$]*)\}")
#: A ref or read with nothing inside ("@{ }", "${}"): raw braces in the
#: prompt (9B, 2026-10-20, pack 14).
_EMPTY_REF = re.compile(r"[@$]\{\s*\}")


def _unbrace(text: str, warnings: list[str]) -> str:
    """Braces around plain words, which the engine refuses as "not a pick",
    become the words (re-test on d6ac847: one template draft came back 502
    for a "{...}")."""
    def sub(m: re.Match[str]) -> str:
        inner = m.group(1).strip()
        if inner:
            warnings.append(f"Dropped the braces around \"{inner[:40]}\": a {{ }} is a pick, "
                            "written {a|b}")
        return inner
    out = _STRAY_BRACES.sub(sub, text or "")
    if _EMPTY_REF.search(out):
        warnings.append("Dropped an empty @{ } / ${ }: it names nothing and prints as written")
        out = _EMPTY_REF.sub("", out)
    return re.sub(r"[ \t]{2,}", " ", out).strip() if out != text else out


def _first_pick(text: str, warnings: list[str]) -> str:
    """A ``{a|b}`` pick in a template becomes its first branch, with a
    warning: the Assembler is seedless, so the pick would print as written
    and the route used to answer 502 (base 9B, 2026-10-19: one template
    draft in three wrote one). The choice belongs in a wildcard."""
    out: list[str] = []
    for tok in tokenize_text(text or ""):
        if tok.kind in (TokenKind.DP_BRACE, TokenKind.DP_MULTI):
            branches = [b.strip() for b in tok.meta.get("branches") or [] if b.strip()]
            first = branches[0] if branches else ""
            warnings.append(f"Kept \"{first[:40]}\" from {tok.raw[:40]}: the Assembler can't "
                            "pick; put the choice in a wildcard or a combine and read its "
                            "variable")
            out.append(first)
        else:
            out.append(tok.raw)
    return "".join(out)


def unasked(text: str, asked: str, reads_: list[str]) -> str:
    """A warning naming the ``$vars`` the draft reads that the request,
    which spelled out two or more, didn't ask for, or "". Re-test on
    d6ac847 (9B): two template drafts read ~20 library variables for a
    three-variable ask."""
    want = list(dict.fromkeys(_ASKED_VAR.findall(asked or "")))
    if len(want) < 2:
        return ""
    extra = [v for v in reads_ if v not in want and v != "negatives"]
    if not extra:
        return ""
    return ("Also reads $" + ", $".join(extra[:12]) + (", …" if len(extra) > 12 else "")
            + ", which you didn't ask for; take out what you don't want")


def missing_asked(text: str, asked: str) -> str:
    """A warning naming the ``$vars`` the request spelled out that the draft
    doesn't read, or "". Browser test (9B): a portrait template asked to read
    $quality_tags came back without it, quietly."""
    have = set(reads(text))
    gone = [v for v in dict.fromkeys(_ASKED_VAR.findall(asked or "")) if v not in have]
    return ("Doesn't read $" + ", $".join(gone) + ", which you asked for") if gone else ""


def compile_combine(
    raw: Any, *, out_var: str, catalog: dict[str, Any] | None = None,
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """A combine payload. Returns ``{payload, preview, warnings}``."""
    if not isinstance(raw, dict) or not isinstance(raw.get("template"), str):
        raise ValueError("the answer had no template")
    text = ai_refs.compile_text(_flat(raw["template"], MAX_TEMPLATE), surface="combine")
    if not text:
        raise ValueError("the template is empty")
    negative = ai_refs.compile_text(_flat(raw.get("negative"), MAX_TEXT), surface="combine")
    if adult.sexual_minor(text):
        raise ValueError("it names a minor in a sexual context")
    warnings: list[str] = []
    text = _fix_axes(text, catalog, warnings)
    if out_var in reads(text):
        raise ValueError(f"the template reads ${out_var}, which it sets itself")
    unknown = _unknown(text, catalog, out_var)
    if unknown:
        warnings.append("Reads $" + ", $".join(unknown) + ", which nothing in the library sets")
    payload = dict(existing or {})
    payload.update({"template": text, "output_var": out_var,
                    "input_vars": [v for v in reads(text) if v != out_var]})
    if negative:
        payload["negative"] = negative
    else:
        payload.pop("negative", None)
    CombineHandler.validate_payload(payload)
    preview = [f"${out_var} = {text}"] + ([f"Negative: {negative}"] if negative else [])
    return {"payload": payload, "preview": preview, "warnings": warnings}


def compile_template(raw: Any, *, catalog: dict[str, Any] | None = None) -> dict[str, Any]:
    """``{payload: {template_string, negative_template}, preview, warnings}``."""
    if not isinstance(raw, dict) or not isinstance(raw.get("template"), str):
        raise ValueError("the answer had no template")
    warnings: list[str] = []
    text = ai_refs.compile_text(
        _first_pick(_unbrace(_flat(raw["template"], MAX_TEMPLATE), warnings), warnings),
        surface="template")
    if not text:
        raise ValueError("the template is empty")
    negative = ai_refs.compile_text(
        _first_pick(_unbrace(_flat(raw.get("negative"), MAX_TEMPLATE), warnings), warnings),
        surface="template")
    if adult.sexual_minor(text):
        raise ValueError("it names a minor in a sexual context")
    text = _fix_axes(text, catalog, warnings)
    unknown = _unknown(text, catalog)
    if unknown:
        warnings.append("Reads $" + ", $".join(unknown) + ", which nothing in the library sets")
    if not reads(text):
        warnings.append("It reads no variables, so it's the same every run")
    if re.search(r"\$\w+[^$]{0,40}\s(?:OR|or)\s[^$]{0,40}\$", text):
        warnings.append("It joins picks with \"or\", but the Assembler prints every one; "
                        "read the one pick instead")
    return {"payload": {"template_string": text, "negative_template": negative},
            "preview": [text] + ([f"Negative: {negative}"] if negative else []),
            "warnings": warnings}
