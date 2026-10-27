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
from engine.ai import scripts as ai_scripts
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


def _cap(n: int) -> dict[str, Any]:
    return {"type": "string", "maxLength": n}


#: Longest strings the answer schemas let a model write. Unbounded, a 9B
#: wrote one on until the output limit cut the answer off (the Template
#: panel on an empty library, 2026-10-24; the pack builder's slot
#: negatives the same day); a real template or value is far shorter.
SCHEMA_TEMPLATE_CHARS = 1200
SCHEMA_VALUE_CHARS = 400
SCHEMA_NEGATIVE_CHARS = 400

FIXED_SCHEMA = _obj({"values": {"type": "array", "maxItems": MAX_VALUES, "items": _obj({
    "name": _cap(64), "value": _cap(SCHEMA_VALUE_CHARS),
    "negative": _cap(SCHEMA_NEGATIVE_CHARS),
})}})
COMBINE_SCHEMA = _obj({"template": _cap(SCHEMA_TEMPLATE_CHARS),
                       "negative": _cap(SCHEMA_NEGATIVE_CHARS)})
TEMPLATE_SCHEMA = _obj({"template": _cap(SCHEMA_TEMPLATE_CHARS),
                        "negative": _cap(SCHEMA_NEGATIVE_CHARS)})

#: Fixed values can't read a variable, so their panel needs the library
#: only for its style and the names already taken: a few variables with a
#: few values each, the rest by name. With the full narrowed catalog the
#: panel's prompt was 5.6k tokens on Dumi's library (9B, 2026-10-24).
FIXED_CATALOG_VARS = 6
FIXED_CATALOG_VALUES = 6

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


def prompt_catalog(kind: str, catalog: dict[str, Any], request: str) -> dict[str, Any]:
    """The catalog a panel's prompt lists. A combine or template doesn't
    see the loop and model variables unless the request names them: they
    are for rules, and listed as ordinary variables the 9B printed them
    (bench T3: "$model_family $model_name $iteration $iteration_total")."""
    if kind == "fixed_values":
        return catalog
    from engine.ai.library_vars import RUNTIME_VARS

    named = set(_ASKED_VAR.findall(request or ""))
    return {k: v for k, v in catalog.items() if k not in RUNTIME_VARS or k in named
            or any(s.get("kind") not in ("loop", "model") for s in v.get("sources") or [])}


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
    from engine.ai import guide

    fmt = guide.format_line(instruction)
    if fmt and kind != "combine":
        lines.append("")
        lines.append(f"How that model reads a prompt: {fmt}")
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
    raw: Any, *, existing: dict[str, Any] | None = None, request: str = "",
) -> dict[str, Any]:
    """New (or replaced) values. A value whose name is already in
    ``existing`` replaces that row's text and keeps its id, so a rewrite
    stays one row. Returns ``{payload, rows, preview, warnings, skipped,
    changed}``; ``rows`` are the new and changed values, each
    ``{id, name, value, negative, status: "new"|"changed", before?}``, so a
    panel can offer them one by one. Raises ValueError when nothing is
    usable."""
    if not isinstance(raw, dict) or not isinstance(raw.get("values"), list):
        raise ValueError("the model's answer wasn't a list of values")
    rows = [dict(v) for v in (existing or {}).get("values") or [] if isinstance(v, dict)]
    by_name = {v.get("name"): v for v in rows if isinstance(v.get("name"), str)}
    taken = {v.get("id") for v in rows}
    reference = " ".join([request, *(f"{v.get('value') or ''}" for v in rows)])
    preview: list[str] = []
    skipped: list[dict[str, str]] = []
    out_rows: list[dict[str, Any]] = []
    notes: list[str] = []
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
        value, dropped = ai_scripts.strip_foreign(dedupe_list(value), reference)
        negative, dropped_neg = ai_scripts.strip_foreign(negative, reference)
        if dropped or dropped_neg:
            notes.append(f"Took {', '.join(dropped + dropped_neg)[:60]} out of ${name}: "
                         "it's in another script than your library")
        row = by_name.get(name)
        # On a value that exists, a left-out text keeps it and a left-out
        # negative keeps that ("negative": "" clears it), so the model can
        # change just one of the two.
        if row is not None:
            value = value or str(row.get("value") or "")
            if "negative" not in item:
                negative = str(row.get("negative") or "")
        negative = clean_negative(negative, value)
        if not value and not negative:
            skipped.append({"text": name, "reason": "empty"})
            continue
        why = adult.blocked(value)
        if why:
            skipped.append({"text": name, "reason": why})
            continue
        twin = next((r for r in rows if r is not row and value
                     and _list_key(str(r.get("value") or "")) == _list_key(value)), None)
        if twin is not None:
            # Bench F1: $quality and $style came back word for word the same.
            skipped.append({"text": name, "reason": f"same text as ${twin.get('name')}"})
            continue
        before = None if row is None else {"value": str(row.get("value") or ""),
                                            "negative": str(row.get("negative") or "")}
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
        if not value:
            # Bench Z9: a value that only adds negatives was dropped as empty.
            notes.append(f"${name} only adds negative words; they reach the negative when "
                         f"the template reads ${name}")
        changed += 1
        out_rows.append({"id": row["id"], "name": name, "value": value, "negative": negative,
                         "status": "new" if before is None else "changed",
                         **({"before": before} if before else {})})
        preview.append(f"${name} = {value}" + (f"  (negative: {negative})" if negative else ""))
    if not changed:
        raise ValueError("no usable values" + "".join(
            f"; {s['text'][:40]}: {s['reason']}" for s in skipped[:3]))
    payload = dict(existing or {})
    payload["values"] = rows
    FixedValuesHandler.validate_payload(payload)
    return {"payload": payload, "rows": out_rows, "preview": preview, "skipped": skipped,
            "changed": changed,
            "warnings": [f"Left out ${s['text'][:40]}: {s['reason']}" for s in skipped[:6]]
            + notes}


def _list_key(text: str) -> str:
    return ",".join(sorted(p.strip().lower() for p in text.split(",") if p.strip()))


def dedupe_list(text: str) -> str:
    """A comma list with repeated pieces taken out, first spelling kept
    (bench F1 run 2: "marker, pen, pencil, ink…" over and over until the
    output limit). Text without commas is left as it is."""
    if "," not in (text or ""):
        return text
    parts = [p.strip() for p in text.split(",")]
    seen: set[str] = set()
    out: list[str] = []
    for p in parts:
        key = re.sub(r"\s+", " ", p.lower())
        if p and key not in seen:
            seen.add(key)
            out.append(p)
    return ", ".join(out)


def clean_negative(negative: str, value: str) -> str:
    """A negative without repeats and without words its own value prints
    (bench F1: "watercolor" in a watercolor preset's negative; #35: a
    value's negative repeating the value)."""
    negative = dedupe_list(negative)
    if not negative or not value:
        return negative
    low = value.lower()
    kept = [p.strip() for p in negative.split(",") if p.strip() and not (
        "$" not in p and re.search(rf"(?<![\w-]){re.escape(p.strip().lower())}(?![\w-])", low))]
    return ", ".join(kept)


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


def _unbrace(text: str, warnings: list[str],
             catalog: dict[str, Any] | None = None) -> str:
    """Braces around plain words, which the engine refuses as "not a pick",
    become the words (re-test on d6ac847: one template draft came back 502
    for a "{...}"). ``{character}`` around a variable's name is a read of
    it, ``$character`` (bench T1 run 3, T3 run 1: the braces were dropped
    and the template then read nothing)."""
    def sub(m: re.Match[str]) -> str:
        inner = m.group(1).strip()
        if catalog and _IDENT.match(inner) and inner in catalog:
            warnings.append(f"Read ${inner} for {{{inner}}}: a variable is written $name")
            return f"${inner}"
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


def unasked(text: str, asked: str, reads_: list[str], had: list[str] | None = None) -> str:
    """A warning naming the ``$vars`` the draft reads that the request,
    which spelled out two or more, didn't ask for, or "". Re-test on
    d6ac847 (9B): two template drafts read ~20 library variables for a
    three-variable ask. ``had`` are the variables the item read before an
    edit: keeping them is no surprise (bench K3)."""
    want = list(dict.fromkeys(_ASKED_VAR.findall(asked or "")))
    if len(want) < 2:
        return ""
    extra = [v for v in reads_ if v not in want and v != "negatives" and v not in (had or [])]
    if not extra:
        return ""
    return ("Also reads $" + ", $".join(extra[:12]) + (", …" if len(extra) > 12 else "")
            + ", which you didn't ask for; take out what you don't want")


def answer_tokens(kind: str) -> int:
    """The output limit for a text panel's answer, reasoning off. A template
    or combine of `MAX_TEMPLATE` characters is about 1k tokens, a full value
    list about 2k; a model looping on the same words (the 9B on a portrait
    template, 2026-10-24) is stopped after these instead of after 8k."""
    return 2048 if kind == "fixed_values" else 1536


def unset_asked(raw: Any, asked: str) -> list[str]:
    """The ``$vars`` a fixed values request spelled out that the answer
    doesn't set. A fixed value can't read variables, so every one the
    request names is one to set."""
    values = raw.get("values") if isinstance(raw, dict) else None
    have = {str(v.get("name") or "").lstrip("$") for v in values or [] if isinstance(v, dict)}
    return [v for v in dict.fromkeys(_ASKED_VAR.findall(asked or "")) if v not in have]


def left_out(kind: str, raw: Any, asked: str) -> list[str]:
    """The ``$vars`` the request names that the answer leaves out: not set
    (fixed values) or not read (a combine or template's text)."""
    if kind == "fixed_values":
        return unset_asked(raw, asked)
    text = raw.get("template") if isinstance(raw, dict) else None
    have = set(reads(text if isinstance(text, str) else ""))
    return [v for v in dict.fromkeys(_ASKED_VAR.findall(asked or "")) if v not in have]


def missing_asked(text: str, asked: str) -> str:
    """A warning naming the ``$vars`` the request spelled out that the draft
    doesn't read, or "". Browser test (9B): a portrait template asked to read
    $quality_tags came back without it, quietly."""
    have = set(reads(text))
    gone = [v for v in dict.fromkeys(_ASKED_VAR.findall(asked or "")) if v not in have]
    return ("Doesn't read $" + ", $".join(gone) + ", which you asked for") if gone else ""


def compile_combine(
    raw: Any, *, out_var: str, catalog: dict[str, Any] | None = None,
    existing: dict[str, Any] | None = None, request: str = "",
) -> dict[str, Any]:
    """A combine payload. Returns ``{payload, preview, warnings}``. With
    ``request`` (the panel's typed ask) the text is also held to it, see
    `_tidy_text`."""
    if not isinstance(raw, dict) or not isinstance(raw.get("template"), str):
        raise ValueError("the answer had no template")
    text = ai_refs.compile_text(_flat(raw["template"], MAX_TEMPLATE), surface="combine")
    if not text:
        raise ValueError("the template is empty")
    negative = ai_refs.compile_text(_flat(raw.get("negative"), MAX_TEXT), surface="combine")
    why = adult.blocked(text)
    if why:
        raise ValueError(why)
    warnings: list[str] = []
    text = _fix_axes(text, catalog, warnings)
    if out_var in reads(text):
        # Bench K3: 2 of 3 edits failed on this; the rest of the text is good.
        text = drop_reads(text, {out_var})
        warnings.append(f"Took out ${out_var}: the combine sets it, so it can't read it")
        if not reads(text) and not text.strip(" ,"):
            raise ValueError(f"the template only read ${out_var}, which it sets itself")
    text, negative = _tidy_text(text, negative, request, catalog, warnings, kind="combine")
    if not text:
        raise ValueError("the template is empty")
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


def compile_template(raw: Any, *, catalog: dict[str, Any] | None = None,
                     request: str = "") -> dict[str, Any]:
    """``{payload: {template_string, negative_template}, preview, warnings}``.
    With ``request`` the text is also held to it (see `_tidy_text`), and
    a request that asks the negative to keep youth out ("a negative
    against anything youthful") gets the youth words the model left out
    (bench Z10: the saved negative had none)."""
    if not isinstance(raw, dict) or not isinstance(raw.get("template"), str):
        raise ValueError("the answer had no template")
    warnings: list[str] = []
    text = ai_refs.compile_text(
        _first_pick(_unbrace(_flat(raw["template"], MAX_TEMPLATE), warnings, catalog),
                    warnings),
        surface="template")
    if not text:
        raise ValueError("the template is empty")
    negative = ai_refs.compile_text(
        _first_pick(_unbrace(_flat(raw.get("negative"), MAX_TEMPLATE), warnings, catalog),
                    warnings),
        surface="template")
    why = adult.blocked(text)
    if why:
        raise ValueError(why)
    text = _fix_axes(text, catalog, warnings)
    text, negative = _tidy_text(text, negative, request, catalog, warnings, kind="template")
    if not text:
        raise ValueError("the template is empty")
    unknown = _unknown(text, catalog)
    if unknown:
        warnings.append("Reads $" + ", $".join(unknown) + ", which nothing in the library sets")
    if not reads(text):
        warnings.append("It reads no variables, so it's the same every run")
    if adult.asks_youth_negative(request) and not adult.youth_words(negative):
        style = "tags" if text.count(",") >= 3 else "sentences"
        negative, added = adult.with_youth_negative(negative, style)
        if added:
            warnings.append("Added " + ", ".join(added) + " to the negative: the request "
                            "asks it to keep youth out")
    if re.search(r"\$\w+[^$]{0,40}\s(?:OR|or)\s[^$]{0,40}\$", text):
        warnings.append("It joins picks with \"or\", but the Assembler prints every one; "
                        "read the one pick instead")
    return {"payload": {"template_string": text, "negative_template": negative},
            "preview": [text] + ([f"Negative: {negative}"] if negative else []),
            "warnings": warnings}


# ── holding a combine or template to its request ─────────────────────────

def drop_reads(text: str, names: set[str]) -> str:
    """`text` without its reads of `names` (``$x``, ``$x.0``, ``$x.AXIS``),
    with the commas and spaces around them tidied."""
    out = re.sub(r"\$(" + "|".join(map(re.escape, sorted(names))) + r")(?:\.[A-Za-z0-9_]+)*\b",
                 "", text)
    out = re.sub(r"\s*,\s*(?:,\s*)+", ", ", out)
    out = re.sub(r"[ \t]{2,}", " ", out).strip().strip(",").strip()
    # "$s and $look" without $s: no "and" left hanging at either end.
    out = re.sub(r"^(?:and|with|or|of|in)\b\s*|\s*\b(?:and|with|or|of|in)$", "", out)
    return out.strip().strip(",").strip()


#: Words that only belong in a negative prompt (bench T3 run 2 put "bad
#: anatomy, bad hands" in the positive).
NEGATIVE_ONLY = frozenset({
    "bad anatomy", "bad hands", "bad proportions", "worst quality", "low quality",
    "lowres", "blurry", "watermark", "jpeg artifacts", "extra fingers", "extra digits",
    "fewer digits", "missing fingers", "deformed", "disfigured", "mutated hands",
    "mutation", "signature", "username", "ugly", "poorly drawn hands", "poorly drawn face",
})
#: Quality tags a natural-sentence model (Flux and friends) doesn't use.
_TAG_QUALITY = frozenset({
    "masterpiece", "best quality", "high quality", "8k", "4k", "uhd", "absurdres", "highres",
    "ultra detailed", "highly detailed", "very aesthetic", "score_9", "score_8_up",
    "score_7_up",
})
#: Families that read natural sentences (engine/ai/guide.py FORMATS).
_SENTENCE_FAMILIES = frozenset({"flux", "sd3", "chroma", "qwen_image", "hidream", "lumina2",
                                "wan"})
PONY_SCORE = "score_9, score_8_up, score_7_up"
_SCORE_WORD = re.compile(r"\bscore[ _]tags?\b", re.I)
_SHORT_NEG = re.compile(r"\bshort\b[^.;]{0,30}\bnegative|\bnegative\b[^.;]{0,20}\bshort\b",
                        re.I)
#: A "short" negative keeps this many pieces besides $negatives.
SHORT_NEGATIVE = 8
_SENTENCES = re.compile(r"\b(?:natural[- ]?(?:language|sentences?)|sentences?|prose)\b",
                        re.I)


def wants_sentences(request: str) -> bool:
    """Whether the request asks for natural sentences (by name or model)."""
    from engine.ai import guide

    return bool(_SENTENCES.search(request or "")) or bool(
        set(guide.families_in(request or "")) & _SENTENCE_FAMILIES)


def _pieces(text: str) -> list[str]:
    return [p.strip() for p in (text or "").split(",") if p.strip()]


def _vowel_warning(text: str, catalog: dict[str, Any] | None) -> str:
    """"a $mood" prints "a angry" for an option that starts with a vowel
    (bench K1, #44)."""
    for m in re.finditer(r"(?<![\w])[Aa] \$([a-zA-Z_][a-zA-Z0-9_]*)\b", text):
        entry = (catalog or {}).get(m.group(1)) or {}
        hits = [v for v in entry.get("values") or [] if re.match(r"[aeiouAEIOU]", str(v))]
        if hits:
            return (f"\"a ${m.group(1)}\" reads \"a {hits[0]}\" for options that start with "
                    "a vowel; put the a / an in the options, or leave it out")
    return ""


def _drop_echo(text: str, catalog: dict[str, Any] | None, warnings: list[str]) -> str:
    """"with $hair_color hair" prints "brown hair hair" when the options
    already end in the word: the word after the variable goes."""
    def fix(m: re.Match[str]) -> str:
        entry = (catalog or {}).get(m.group(1)) or {}
        vals = [str(v).strip().lower() for v in entry.get("values") or [] if str(v).strip()]
        word = m.group(2).lower()
        if vals and sum(v.endswith(" " + word) or v == word for v in vals) * 2 > len(vals):
            warnings.append(f"Took \"{m.group(2)}\" out after ${m.group(1)}: its options "
                            f"already end in it, so it printed \"{entry['values'][0]} "
                            f"{m.group(2)}\"")
            return f"${m.group(1)}"
        return m.group(0)
    return re.sub(r"\$([a-zA-Z_][a-zA-Z0-9_]*) ([A-Za-z]+)\b(?!\s*[:(])", fix, text)


def _balance(text: str, warnings: list[str]) -> str:
    """Brackets that don't close (bench Z10: a 100-word template with an
    unbalanced "(") are taken out; escaped ``\\(`` stays."""
    out: list[str] = []
    stack: list[int] = []
    dropped = 0
    for i, ch in enumerate(text):
        escaped = i > 0 and text[i - 1] == "\\"
        if ch == "(" and not escaped:
            stack.append(len(out))
        elif ch == ")" and not escaped:
            if not stack:
                dropped += 1
                continue
            stack.pop()
        out.append(ch)
    for at in reversed(stack):
        out.pop(at)
        dropped += 1
    if dropped:
        warnings.append(f"Took out {dropped} bracket{'s' if dropped != 1 else ''} that "
                        "didn't close")
    return re.sub(r"[ \t]{2,}", " ", "".join(out)).strip()


def _tidy_text(text: str, negative: str, request: str, catalog: dict[str, Any] | None,
               warnings: list[str], *, kind: str) -> tuple[str, str]:
    """A combine's or template's text and negative, cleaned in code:

    - repeated comma pieces go (a looping model's "masterpiece, masterpiece…");
    - brackets that don't close go;
    - negative-only words in the positive move to the negative;
    - a word after a variable whose options already end in it goes;
    and with ``request`` (the panel's ask):
    - loop and model variables the request doesn't name are taken out (they
      are for rules, not prompt text: bench T3, #4);
    - a Pony ask gets the real score tags first ("score_tags" becomes them);
    - a natural-sentence ask (Flux…) loses its quality-tag soup;
    - a "short" negative is cut to its first few pieces."""
    text = _balance(dedupe_list(text), warnings)
    negative = _balance(dedupe_list(negative), warnings) if negative else negative
    moved = [p for p in _pieces(text) if p.lower() in NEGATIVE_ONLY] if "," in text else []
    if moved:
        text = ", ".join(p for p in _pieces(text) if p.lower() not in NEGATIVE_ONLY)
        parts = _pieces(negative)
        have = {p.lower() for p in parts}
        # Up front (after the $negatives slot), so a "short" cut keeps them.
        at = 1 if parts[:1] == ["$negatives"] else 0
        negative = ", ".join([*parts[:at], *(p for p in moved if p.lower() not in have),
                              *parts[at:]])
        warnings.append(f"Moved {', '.join(moved[:4])} to the negative: "
                        f"{'it only belongs' if len(moved) == 1 else 'they only belong'} there")
    text = _drop_echo(text, catalog, warnings)
    vowel = _vowel_warning(text, catalog)
    if vowel:
        warnings.append(vowel)
    if not request:
        return text, negative
    from engine.ai import guide
    from engine.ai.library_vars import RUNTIME_VARS

    named = set(_ASKED_VAR.findall(request))
    runtime = {v for v in reads(text) if v in RUNTIME_VARS and v not in named}
    if runtime:
        text = drop_reads(text, runtime)
        warnings.append("Took out $" + ", $".join(sorted(runtime)) + ": loop and model "
                        "variables are for rules, not for the prompt text")
    families = guide.families_in(request)
    if kind == "template" and "pony" in families:
        if _SCORE_WORD.search(text):
            text = _SCORE_WORD.sub(PONY_SCORE, text, count=1)
            warnings.append(f"Wrote Pony's score tags ({PONY_SCORE}) for \"score tags\"")
        elif "score_9" not in text:
            text = f"{PONY_SCORE}, {text}"
            warnings.append(f"Put Pony's score tags ({PONY_SCORE}) first")
    if wants_sentences(request) and "pony" not in families:
        soup = [p for p in _pieces(text) if p.lower() in _TAG_QUALITY]
        if soup and "," in text:
            text = ", ".join(p for p in _pieces(text) if p.lower() not in _TAG_QUALITY)
            warnings.append(f"Took out {', '.join(soup[:4])}: a natural-sentence model "
                            "doesn't use quality tags")
    if negative and _SHORT_NEG.search(request):
        parts = _pieces(negative)
        slot = [p for p in parts if p == "$negatives"]
        rest = [p for p in parts if p != "$negatives"]
        if len(rest) > SHORT_NEGATIVE:
            negative = ", ".join([*slot, *rest[:SHORT_NEGATIVE]])
            warnings.append(f"Cut the negative to its first {SHORT_NEGATIVE} words: you "
                            "asked for a short one")
    return text.strip(" ,"), negative


#: Request words that say nothing about the words around the variables.
_PLAIN_ASK = frozenset("""a an the and or of to in on at for with from by as using use uses
used my your this that these those it its make write create join prompt template combine
negative negatives standard short long plus also one into each every all them they their
variable variables only just keep it's natural sentence sentences prompts tag tags model
checkpoint against anything put first then last order reorder like""".split())


def recheck_notes(kind: str, raw: Any, request: str) -> list[str]:
    """What a combine or template answer misses of its request, as notes
    for one re-ask (code checks, the model repairs):

    - a natural-sentence ask (Flux, "natural sentences") answered with a
      comma tag list (bench T1: every run);
    - a template that is only variables when the request asks for words
      around them (bench T4: "close-up portrait" came back as
      "$mood $hair_color $accessory")."""
    if kind == "fixed_values" or not isinstance(raw, dict):
        return []
    got = raw.get("template")
    text = got if isinstance(got, str) else ""
    notes: list[str] = []
    if wants_sentences(request) and looks_like_tags(text):
        notes.append("The request asks for natural sentences, but your last answer is a "
                     "comma list of tags. Write the prompt as one or two full sentences "
                     "that read the variables, without quality tags.")
    bare = re.sub(r"\$[\w.]+|[\s,.;:()]+", "", text)
    words = [w for w in re.findall(r"[a-z][a-z-]+", re.sub(r"\$[\w.]+", "", request.lower()))
             if w not in _PLAIN_ASK and len(w) > 2]
    if text.strip() and not bare and words:
        notes.append("Your last answer is only variables. Write the words the request asks "
                     f"for ({', '.join(dict.fromkeys(words[:5]))}) around them.")
    return notes


def looks_like_tags(text: str) -> bool:
    """Whether `text` is a comma tag list rather than sentences: four or
    more pieces and almost none with a sentence word in it."""
    parts = _pieces(re.sub(r"\$[\w.]+", "x", text or ""))
    if len(parts) < 4:
        return False
    worded = sum(1 for p in parts if len(p.split()) >= 4
                 or re.search(r"\b(?:is|are|with|in|on|the|a|an|her|his|their)\b", p, re.I))
    return worded * 3 < len(parts)


def sample_texts(modules: list[dict[str, Any]], skip: str | None = None) -> dict[str, str]:
    """What fixed values and combines print, by variable, so `samples`
    can render them too (`skip` is the item being drafted)."""
    out: dict[str, str] = {}
    for m in modules:
        if not isinstance(m, dict) or m.get("id") == skip:
            continue
        p = m.get("payload") if isinstance(m.get("payload"), dict) else {}
        if m.get("type") == "fixed_values":
            for v in p.get("values") or []:
                if isinstance(v, dict) and isinstance(v.get("name"), str) \
                        and isinstance(v.get("value"), str):
                    out.setdefault(v["name"].strip(), v["value"])
        elif m.get("type") == "combine" and isinstance(p.get("output_var"), str) \
                and isinstance(p.get("template"), str):
            out.setdefault(p["output_var"].strip(), p["template"])
    return out


def samples(text: str, catalog: dict[str, Any] | None, *, seed: str, n: int = 3,
            texts: dict[str, str] | None = None) -> list[str]:
    """``n`` example renders of a combine or template: each ``$var`` read
    takes one of that variable's library options (seeded by `seed`, so
    the examples don't jump between renders), or what the fixed value or
    combine in `texts` prints (read in turn, a few levels deep); a
    variable with neither stays as written. For the panels' "what it
    prints" lines."""
    import random

    if not catalog or not reads(text):
        return []
    rng = random.Random(seed)
    out: list[str] = []
    var = r"\$([a-zA-Z_][a-zA-Z0-9_]*)(?:\.[A-Za-z0-9_]+)*"
    for _ in range(n):
        def sub(m: re.Match[str], depth: int = 0) -> str:
            if texts and m.group(1) in texts and depth < 4:
                return re.sub(var, lambda x: sub(x, depth + 1), texts[m.group(1)])
            entry = (catalog or {}).get(m.group(1)) or {}
            vals = [v for v in entry.get("values") or [] if isinstance(v, str)
                    and "@{" not in v and "{" not in v]
            return rng.choice(vals) if vals else m.group(0)
        line = re.sub(var, sub, text)
        line = re.sub(r"\s*,\s*(?:,\s*)+", ", ", line).strip(" ,")
        if line not in out:
            out.append(line)
    return out
