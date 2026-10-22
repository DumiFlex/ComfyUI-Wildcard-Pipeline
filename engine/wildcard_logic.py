"""Pure helpers for the wildcard pack importer's logic layer.

Everything here is text in, data out, with no import state: PPP
directive rewriting, the PPP condition language, Umi AI tag queries and
model checks. :mod:`engine.wildcard_files` decides what to build from
the results.
"""
from __future__ import annotations

import re
from typing import Any

# --- PPP directives ---------------------------------------------------------

_SET_RE = re.compile(
    r"<ppp:set\s+(?P<name>[A-Za-z_][\w]*)(?P<mods>(?:\s+[a-z]+)*)\s*>(?P<value>.*?)<ppp:/set>",
    re.DOTALL,
)
_ECHO_RE = re.compile(
    r"<ppp:echo\s+(?P<name>[A-Za-z_][\w]*)\s*>(?:(?P<default>.*?)<ppp:/echo>)?",
    re.DOTALL,
)
_EXT_RE = re.compile(
    r"<ppp:ext\s+(?P<kind>[A-Za-z]+)\s+(?P<name>(?:'[^']*'|\"[^\"]*\"|[^\s>]+))"
    r"(?P<params>(?:\s+(?!if\s)[^\s>]+)*)(?:\s+if\s+(?P<cond>[^>]+))?\s*>"
    r"(?:(?P<trigger>.*?)<ppp:/ext>)?",
    re.DOTALL,
)
_STN_RE = re.compile(r"<ppp:stn(?:\s+[^>]*)?>(?P<body>.*?)<ppp:/stn>", re.DOTALL)
_UMI_NEG_RE = re.compile(r"\*\*(?P<body>.+?)\*\*", re.DOTALL)


def normalize_ppp(text: str) -> str:
    """Rewrite PPP variable and extra-network directives into the shared
    dialect the converter already reads.

    ``<ppp:set x>v</ppp:set>`` is ``${x=v}`` (``evaluate`` makes it
    ``${x=!v}``, ``add`` ``${x+=v}``, ``ifundefined`` ``${x?=v}``);
    ``<ppp:echo x>d</ppp:echo>`` is ``${x:d}``; ``<ppp:ext lora n 0.8>``
    is ``<lora:n:0.8>``, inside a ``<ppp:if>`` when it has a condition.
    """
    if "<ppp:" not in text:
        return text

    def set_sub(m: re.Match[str]) -> str:
        mods = set(m.group("mods").split())
        op = "+=" if "add" in mods else "?=" if "ifundefined" in mods else "="
        bang = "!" if "evaluate" in mods else ""
        return "${" + m.group("name") + op + bang + m.group("value") + "}"

    def echo_sub(m: re.Match[str]) -> str:
        d = m.group("default")
        return "${" + m.group("name") + (":" + d if d else "") + "}"

    def ext_sub(m: re.Match[str]) -> str:
        name = m.group("name").strip("'\"")
        params = m.group("params").split()
        kind = m.group("kind").lower()
        tag = f"<{kind}:{name}:{params[0] if params else '1'}>"
        if m.group("trigger"):
            tag = f"{tag} {m.group('trigger').strip()}"
        if m.group("cond"):
            return f"<ppp:if {m.group('cond').strip()}>{tag}<ppp:/if>"
        return tag

    text = _SET_RE.sub(set_sub, text)
    text = _ECHO_RE.sub(echo_sub, text)
    return _EXT_RE.sub(ext_sub, text)


def extract_negatives(text: str, umi: bool = False) -> tuple[str, list[str]]:
    """Pull PPP ``<ppp:stn>…</ppp:stn>`` (and Umi ``**…**``) spans out of
    a value: the text without them, and the negative texts in order."""
    found: list[str] = []

    def take(m: re.Match[str]) -> str:
        body = m.group("body").strip().strip(",").strip()
        if body:
            found.append(body)
        return ""

    text = _STN_RE.sub(take, text)
    if umi:
        text = _UMI_NEG_RE.sub(take, text)
    if found:
        text = re.sub(r"\s+,", ",", text)
        text = re.sub(r",\s*(,\s*)+", ", ", text)
        text = re.sub(r"\s{2,}", " ", text).strip().strip(",").strip()
    return text, found


# --- PPP inline if ----------------------------------------------------------

_IF_TOKEN_RE = re.compile(r"<ppp:(if\s+[^>]+|elif\s+[^>]+|else|/if)>")
MAX_IF_SPLITS = 16


def split_ppp_if(text: str) -> list[tuple[str, Any]] | None:
    """Split a value at its ``<ppp:if>`` blocks: one ``(text, condition)``
    per way through them (the condition is a parsed AST, ``None`` for
    "always"). ``None`` when the text has no well-formed block or the
    split would pass :data:`MAX_IF_SPLITS`."""
    if "<ppp:if" not in text:
        return None
    out: list[tuple[str, Any]] = [("", None)]
    pos = 0
    while True:
        m = _IF_TOKEN_RE.search(text, pos)
        if m is None:
            break
        if not m.group(1).startswith("if"):
            return None
        block, end = _read_if_block(text, m.start())
        if block is None:
            return None
        pre = text[pos:m.start()]
        nxt: list[tuple[str, Any]] = []
        for acc, cond in out:
            for body, bcond in block:
                nxt.append((acc + pre + body, _and(cond, bcond)))
        out = nxt
        if len(out) > MAX_IF_SPLITS:
            return None
        pos = end
    tail = text[pos:]
    return [(acc + tail, cond) for acc, cond in out]


def _read_if_block(text: str, start: int) -> tuple[list[tuple[str, Any]] | None, int]:
    """Parse one ``<ppp:if>…</ppp:if>`` (no nesting) starting at
    ``start``: the branch bodies with their full conditions (earlier
    branches negated), plus an empty ``else`` when there is none."""
    branches: list[tuple[str, Any]] = []
    taken: list[Any] = []
    current: Any = None  # the open branch's own condition, "else" or None
    body_start = 0
    pos = start
    while True:
        m = _IF_TOKEN_RE.search(text, pos)
        if m is None:
            return None, start
        tok = m.group(1)
        if m.start() != start:
            if tok.startswith("if"):
                return None, start  # nested if: not supported
            body = text[body_start:m.start()]
            negs = [("not", c) for c in taken]
            if current == "else":
                branches.append((body, _and_all(negs)))
            else:
                branches.append((body, _and_all([*negs, current])))
                taken.append(current)
        if tok == "/if":
            if current != "else":
                branches.append(("", _and_all([("not", c) for c in taken])))
            return branches, m.end()
        if tok == "else":
            current = "else"
        else:
            ast = parse_condition(tok.split(None, 1)[1] if " " in tok else "")
            if ast is None:
                return None, start
            current = ast
        body_start = pos = m.end()


def _and(a: Any, b: Any) -> Any:
    if a is None:
        return b
    if b is None:
        return a
    return ("and", [a, b])


def _and_all(items: list[Any]) -> Any:
    out = None
    for item in items:
        out = _and(out, item)
    return out


# --- PPP condition language ------------------------------------------------

_COND_TOKEN_RE = re.compile(
    r"\s*(?:(?P<lp>\()|(?P<rp>\))|(?P<comma>,)|'(?P<sq>[^']*)'|\"(?P<dq>[^\"]*)\"|(?P<word>[^\s(),'\"]+))",
)
_OPS = {"eq", "ne", "gt", "lt", "ge", "le", "contains", "in"}


def parse_condition(text: str) -> Any:
    """Parse a PPP condition into a small AST, or ``None`` when it uses
    something outside the subset:

    ``("cmp", var, op, values)`` (``op`` ``None`` for a truthiness test),
    ``("not", x)``, ``("and", [..])``, ``("or", [..])``. Operators:
    ``eq ne gt lt ge le contains in``, each may be preceded by ``not``.
    """
    tokens: list[tuple[str, str]] = []
    pos = 0
    text = text.strip()
    while pos < len(text):
        m = _COND_TOKEN_RE.match(text, pos)
        if m is None or m.end() == pos:
            return None
        pos = m.end()
        kind = m.lastgroup or ""
        if kind in ("sq", "dq"):
            tokens.append(("str", m.group(kind)))
        elif kind == "word":
            tokens.append(("word", m.group("word")))
        else:
            tokens.append((kind, ""))
    parser = _CondParser(tokens)
    try:
        ast = parser.parse_or()
    except ValueError:
        return None
    if parser.i != len(tokens):
        return None
    return ast


class _CondParser:
    def __init__(self, tokens: list[tuple[str, str]]) -> None:
        self.t = tokens
        self.i = 0

    def peek(self) -> tuple[str, str] | None:
        return self.t[self.i] if self.i < len(self.t) else None

    def word(self, w: str) -> bool:
        p = self.peek()
        if p is not None and p[0] == "word" and p[1].lower() == w:
            self.i += 1
            return True
        return False

    def parse_or(self) -> Any:
        items = [self.parse_and()]
        while self.word("or"):
            items.append(self.parse_and())
        return items[0] if len(items) == 1 else ("or", items)

    def parse_and(self) -> Any:
        items = [self.parse_not()]
        while self.word("and"):
            items.append(self.parse_not())
        return items[0] if len(items) == 1 else ("and", items)

    def parse_not(self) -> Any:
        if self.word("not"):
            return ("not", self.parse_not())
        return self.parse_atom()

    def parse_atom(self) -> Any:
        p = self.peek()
        if p is None:
            raise ValueError("end")
        if p[0] == "lp":
            self.i += 1
            inner = self.parse_or()
            if self.peek() != ("rp", ""):
                raise ValueError("paren")
            self.i += 1
            return inner
        if p[0] != "word" or p[1].lower() in {"and", "or", "not"} | _OPS:
            raise ValueError("var")
        self.i += 1
        var = p[1]
        negate = False
        save = self.i
        if self.word("not"):
            negate = True
        q = self.peek()
        if q is None or q[0] != "word" or q[1].lower() not in _OPS:
            self.i = save
            return ("cmp", var, None, [])
        self.i += 1
        op = q[1].lower()
        values = self.parse_values()
        node = ("cmp", var, op, values)
        return ("not", node) if negate else node

    def parse_values(self) -> list[str]:
        p = self.peek()
        if p is None:
            raise ValueError("value")
        if p[0] == "lp":
            self.i += 1
            out: list[str] = []
            while True:
                q = self.peek()
                if q is None:
                    raise ValueError("list")
                if q[0] in ("str", "word"):
                    out.append(q[1])
                    self.i += 1
                elif q[0] == "comma":
                    self.i += 1
                elif q[0] == "rp":
                    self.i += 1
                    return out
                else:
                    raise ValueError("list")
        if p[0] in ("str", "word"):
            self.i += 1
            return [p[1]]
        raise ValueError("value")


def cond_vars(ast: Any) -> set[str]:
    if ast is None:
        return set()
    if ast[0] == "cmp":
        return {ast[1]}
    if ast[0] == "not":
        return cond_vars(ast[1])
    out: set[str] = set()
    for item in ast[1]:
        out |= cond_vars(item)
    return out


def eval_condition(ast: Any, env: dict[str, Any]) -> bool:
    """Evaluate against ``env`` (variable → value; a missing variable is
    unset, which PPP treats as empty / false). Comparisons are
    case-insensitive and trim spaces."""
    if ast is None:
        return True
    kind = ast[0]
    if kind == "not":
        return not eval_condition(ast[1], env)
    if kind == "and":
        return all(eval_condition(x, env) for x in ast[1])
    if kind == "or":
        return any(eval_condition(x, env) for x in ast[1])
    _, var, op, values = ast
    raw = env.get(var)
    if isinstance(raw, bool):
        value = "true" if raw else ""
    else:
        value = "" if raw is None else str(raw)
    v = value.strip().lower()
    vals = [str(x).strip().lower() for x in values]
    if op is None:
        return v not in ("", "false", "0", "no")
    if op == "eq":
        return v == vals[0]
    if op == "ne":
        return v != vals[0]
    if op == "contains":
        return any(x in v for x in vals)
    if op == "in":
        return v in vals
    try:
        a, b = float(v), float(vals[0])
    except ValueError:
        return False
    return {"gt": a > b, "lt": a < b, "ge": a >= b, "le": a <= b}[op]


# --- Model checks ------------------------------------------------------------

#: PPP system variables that test the loaded model, as ``(source, value)``:
#: the Model Info variable that answers them and the value that makes
#: them true. ``_is_sdxl`` is true for any SDXL file, so it also covers
#: the variant rows.
MODEL_FLAGS: dict[str, tuple[str, str]] = {
    "_is_sd1": ("model_family", "sd15"),
    "_is_sd2": ("model_family", "sd2"),
    "_is_sdxl": ("model_family", "sdxl"),
    "_is_sdxl_no_ssd": ("model_family", "sdxl"),
    "_is_ssd": ("model_family", "sdxl"),
    "_is_sd3": ("model_family", "sd3"),
    "_is_flux": ("model_family", "flux"),
    "_is_auraflow": ("model_family", "auraflow"),
    "_is_pixart": ("model_family", "pixart"),
    "_is_lumina2": ("model_family", "lumina2"),
    "_is_hunyuandit": ("model_family", "hunyuan_dit"),
    "_is_pony": ("model_variant", "pony"),
    "_is_illustrious": ("model_variant", "illustrious"),
    "_is_noobai": ("model_variant", "noobai"),
    "_is_animagine": ("model_variant", "animagine"),
}
#: PPP's ``_sd`` names → Model Info family ids.
SD_NAMES = {"sd1": "sd15", "sd2": "sd2", "sdxl": "sdxl", "sd3": "sd3", "flux": "flux",
            "auraflow": "auraflow", "pixart": "pixart"}
MODEL_FAMILIES = ("sd15", "sd2", "sdxl", "sd3", "flux", "auraflow", "pixart", "lumina2",
                  "hunyuan_dit", "chroma", "qwen_image", "hidream", "zimage")
MODEL_VARIANTS = ("pony", "illustrious", "noobai", "animagine")


def model_source(ast: Any) -> str | None:
    """Which Model Info variable answers every model check in ``ast``
    (``model_family`` or ``model_variant``), or None when it tests
    something else or mixes the two."""
    sources: set[str] = set()
    for var in cond_vars(ast):
        if var in MODEL_FLAGS:
            sources.add(MODEL_FLAGS[var][0])
        elif var == "_sd":
            sources.add("model_family")
        else:
            return None
    return sources.pop() if len(sources) == 1 else None


def model_env(source: str, value: str) -> dict[str, Any]:
    """The PPP system variables as they read when ``source`` is
    ``value``."""
    env: dict[str, Any] = {}
    for flag, (src, want) in MODEL_FLAGS.items():
        if src == source:
            env[flag] = value == want
    if source == "model_family":
        back = {v: k for k, v in SD_NAMES.items()}
        env["_sd"] = back.get(value, value)
    return env


# --- Umi AI tag queries ------------------------------------------------------

UMI_QUERY_RE = re.compile(r"<(?:(?P<file>[^<>\[\]:]+):)?(?P<body>(?:\[[^\[\]<>]*\])+)>")


def parse_umi_query(body: str) -> list[list[tuple[bool, str]]]:
    """``[a][b|--c]`` → ``[[(False, 'a')], [(False, 'b'), (True, 'c')]]``:
    every group must match (AND), any term in a group (OR), ``--`` negates.
    Tags are case-folded."""
    groups: list[list[tuple[bool, str]]] = []
    for grp in re.findall(r"\[([^\[\]]*)\]", body):
        terms: list[tuple[bool, str]] = []
        for term in grp.split("|"):
            t = term.strip()
            neg = t.startswith("--")
            t = t[2:].strip() if neg else t
            if t:
                terms.append((neg, t.casefold()))
        if terms:
            groups.append(terms)
    return groups


def umi_matches(query: list[list[tuple[bool, str]]], tags: set[str]) -> bool:
    return all(any((t in tags) != neg for neg, t in grp) for grp in query)
