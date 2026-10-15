"""Per-use settings ("use" blocks) the model writes for a stack item.

Multi-pick, a tag filter, Hold across run and the rest are not part of a
module: they live on each USE of it (a Context row, a bundle child, a Test
Runner stack item, as its ``instance``). The model writes them as one short
line of ``;``-separated clauses, which this module turns into instance keys:

    pick 2-3              pick_min 2, pick_max 3 (a list; $var joins them,
                          $var.0 is the first)
    pick 1-3 repeats      … allowing the same option twice
    sep " and "           pick_separator (default ", ")
    filter warm and not wet   category_filter, checked against its tags
    no empty              exclude_null (never the empty option)
    match $model_variant  match_variable (take the option equal to it)
    hold                  seed_scope "hold" (same pick for a whole Loop run)
    internal              hidden from the prompt, still readable by rules
    as $hat               variable_binding (bind it to another variable)
    only options 1,3,"red"  enabled_options (option ids; the rest are off)
    off options 2,4       enabled_options (every option but those)
    weight 3=2.5, 4=0     option_weights (replaces those options' weights)
    weight long_hair=3    … every option carrying that tag
    pin 2                 mode "pinned" + pinned_option_id (always that one)
    seed 1234             locked_seed (the same pick whatever the run seed)
    rules off 2,3         derivation: disabled_rule_ids; constraint:
                          disabled_matrix_cells / disabled_exception_keys
    branches off 2.2, 3.else  disabled_branch_keys ("{rule_id}:{index}")
    reach first|next N|all    target_select (which targets a constraint hits)

Options, rules and branches are named by their number as ``read`` shows
them, by quoted option text, or by ``#id``. Numbers and text need the
module's ``payload``; ``#id`` works without it. A constraint rule can also be
named ``warm>wet`` (a tag cell) or ``"red">"blue"`` (an option pair).

`describe` goes the other way, so `read` can show a bundle child's settings
in the same words (numbers when it gets the payload, ``#id`` otherwise).
"""
from __future__ import annotations

import json
import math
import re
from typing import Any

from engine.ai import refs as ai_refs
from engine.syntax.subcat_filter import ParseError, parse

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
MAX_PICK = 20
MAX_WEIGHT = 1000.0
MAX_REACH = 99
#: Largest seed the browser keeps exact (instances round-trip through JS).
MAX_SEED = 2**53 - 1
#: Which clause works on which module kind.
_KINDS = {
    "pick": ("wildcard",), "sep": ("wildcard",), "filter": ("wildcard",),
    "no empty": ("wildcard",), "match": ("wildcard",),
    "hold": ("wildcard", "combine", "fixed_values"),
    "internal": ("wildcard", "combine", "derivation"),
    "as": ("wildcard", "combine"),
    "only options": ("wildcard",), "off options": ("wildcard",),
    "weight": ("wildcard",), "pin": ("wildcard",),
    "seed": ("wildcard", "combine", "fixed_values", "derivation"),
    "rules off": ("derivation", "constraint"), "branches off": ("derivation",),
    "reach": ("constraint",),
}
#: Other spellings the model reaches for → the clause word.
_ALIASES = {
    "only option": "only options", "options only": "only options",
    "off option": "off options", "options off": "off options",
    "weights": "weight", "pinned": "pin", "seed locked to": "seed",
    "lock seed": "seed", "locked seed": "seed", "rule off": "rules off",
    "branch off": "branches off",
}
#: Other ways a model writes "no empty".
_NO_EMPTY = {"exclude null", "exclude_null", "!null", "never empty", "not empty", "non empty",
             "non-empty", "no null", "filter not empty", "filter non empty",
             "filter not null"}
#: Instance keys `parse_use` writes for these clauses (besides the old ones).
WRITES = (
    "enabled_options", "option_weights", "mode", "pinned_option_id", "locked_seed",
    "disabled_rule_ids", "disabled_branch_keys", "disabled_matrix_cells",
    "disabled_exception_keys", "target_select",
)


def _var(raw: str) -> str:
    v = raw.strip().lstrip("$").strip()
    if not _IDENT.match(v) or v.startswith("__"):
        raise ValueError(f"{raw.strip()!r} isn't a variable name")
    return v


def parse_use(
    raw: Any, *, kind: str, tags: list[str] | None = None,
    payload: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """``(instance, notes)`` for a module of ``kind``. ``raw`` is the clause
    line, or an object of clause → value. Clauses that don't apply to the
    kind or don't parse are left out and named in ``notes``. ``payload`` (the
    module's) lets options, rules and branches be named by number or text."""
    if isinstance(raw, dict):
        parts = []
        for k, v in raw.items():
            if v is True:
                parts.append(str(k))
            elif v not in (None, False, ""):
                parts.append(f"{k} {v}")
        raw = "; ".join(parts)
    if not isinstance(raw, str) or not raw.strip():
        return {}, []
    out: dict[str, Any] = {}
    notes: list[str] = []
    for clause in (c.strip() for c in raw.split(";")):
        if not clause:
            continue
        low = clause.lower()
        for alias in sorted(_ALIASES, key=len, reverse=True):
            if low == alias or low.startswith(alias + " "):
                clause = _ALIASES[alias] + clause[len(alias):]
                low = clause.lower()
                break
        if low in _NO_EMPTY:
            clause = low = "no empty"
        word = next((w for w in sorted(_KINDS, key=len, reverse=True)
                     if low == w or low.startswith(w + " ")), None)
        if word is None:
            notes.append(f"{clause!r} isn't a setting")
            continue
        if kind not in _KINDS[word]:
            notes.append(f"{word} doesn't apply to a {kind.replace('_', ' ')}")
            continue
        rest = clause[len(word):].strip()
        try:
            if word in _NEW:
                _NEW[word](rest, out, kind, payload if isinstance(payload, dict) else None)
            else:
                _apply(word, rest, out, tags)
        except ValueError as e:
            notes.append(f"{clause}: {e}")
    return out, notes


def _apply(word: str, rest: str, out: dict[str, Any], tags: list[str] | None) -> None:
    if word == "pick":
        m = re.fullmatch(r"(\d+)(?:\s*(?:-|to)\s*(\d+))?(\s+repeats?)?", rest.lower())
        if not m:
            raise ValueError("write pick N or pick N-M")
        lo = int(m.group(1))
        hi = int(m.group(2)) if m.group(2) else lo
        lo, hi = min(lo, hi), max(lo, hi)
        if hi < 1 or hi > MAX_PICK:
            raise ValueError(f"pick between 1 and {MAX_PICK}")
        out["pick_min"], out["pick_max"] = max(0, lo), hi
        if m.group(3):
            out["pick_independent"] = True
    elif word == "sep":
        m = re.fullmatch(r"\"(.*)\"|'(.*)'", rest)
        out["pick_separator"] = (m.group(1) if m.group(1) is not None else m.group(2)) \
            if m else rest
    elif word == "filter":
        expr = " ".join(ai_refs.bang_not(rest).split())
        try:
            ast = parse(expr)
        except ParseError as e:
            raise ValueError(str(e)) from None
        if ast is None:
            raise ValueError("the filter is empty")
        if tags is not None:
            known = set(tags)
            terms = re.findall(r"[^\s()!,]+", expr)
            bad = [t for t in terms if t.lower() not in ("and", "or", "not") and t not in known]
            if bad:
                raise ValueError(f"no tag {bad[0]!r} on this wildcard"
                                 + (f" (its tags: {', '.join(tags[:15])})" if tags else ""))
        out["category_filter"] = expr
    elif word == "no empty":
        out["exclude_null"] = True
    elif word == "match":
        out["match_variable"] = _var(rest)
    elif word == "hold":
        out["seed_scope"] = "hold"
    elif word == "internal":
        out["internal"] = True
    elif word == "as":
        out["variable_binding"] = _var(rest)


# ── option / rule references ────────────────────────────────────────────

_QUOTED = re.compile(r'^"(.*)"$|^\'(.*)\'$', re.S)
_ARROW = re.compile(r"\s*(?:→|->|>)\s*")
_PAIR = re.compile(r"""\s*(?:"([^"]*)"|'([^']*)')\s*(?:→|->|>)\s*(?:"([^"]*)"|'([^']*)')\s*""")


def _items(rest: str) -> list[str]:
    """``rest`` split on commas outside quotes, each item stripped."""
    out: list[str] = []
    buf: list[str] = []
    quote = ""
    for ch in rest:
        if quote:
            buf.append(ch)
            if ch == quote:
                quote = ""
        elif ch in "\"'":
            quote = ch
            buf.append(ch)
        elif ch == ",":
            out.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
    if quote:
        raise ValueError("a quote isn't closed")
    out.append("".join(buf).strip())
    if any(not x for x in out):
        raise ValueError("an item in the list is empty")
    return out


def _unquote(raw: str) -> str | None:
    m = _QUOTED.match(raw.strip())
    if not m:
        return None
    return m.group(1) if m.group(1) is not None else m.group(2)


def _options(payload: dict[str, Any] | None) -> list[dict[str, Any]] | None:
    if payload is None:
        return None
    return [o for o in payload.get("options") or [] if isinstance(o, dict)]


def _option_id(ref: str, payload: dict[str, Any] | None) -> str:
    """An option's id from its number, quoted text or ``#id``."""
    ref = ref.strip()
    opts = _options(payload)
    if ref.startswith("#") and len(ref) > 1:
        oid = ref[1:]
        if opts is not None and not any(o.get("id") == oid for o in opts):
            raise ValueError(f"no option with id {oid!r}")
        return oid
    if opts is None:
        raise ValueError(f"can't find option {ref} here; name it by #id")
    if ref.isdigit():
        n = int(ref)
        if not 1 <= n <= len(opts):
            raise ValueError(f"no option {n} (it has {len(opts)})")
        return str(opts[n - 1].get("id"))
    text = _unquote(ref)
    if text is None:
        if re.fullmatch(r"[-+]?\d*\.\d+|[-+]\d+", ref):
            raise ValueError(f"{ref} isn't an option number")
        text = ref
    want = " ".join(text.split()).lower()
    hits = [o for o in opts if " ".join(str(o.get("value", "")).split()).lower() == want]
    if not hits:
        raise ValueError(f"no option reads {text!r}; use its number")
    if len(hits) > 1:
        raise ValueError(f"{len(hits)} options read {text!r}; use its number")
    return str(hits[0].get("id"))


def _option_refs(rest: str, payload: dict[str, Any] | None) -> list[str]:
    ids: list[str] = []
    for item in _items(rest):
        oid = _option_id(item, payload)
        if oid not in ids:
            ids.append(oid)
    return ids


def _number(raw: str, what: str) -> float:
    try:
        v = float(raw)
    except ValueError:
        raise ValueError(f"{raw!r} isn't a number for {what}") from None
    if not math.isfinite(v):
        raise ValueError(f"{raw!r} isn't a number for {what}")
    return v


def _rules(payload: dict[str, Any] | None) -> list[dict[str, Any]] | None:
    if payload is None:
        return None
    return [r for r in payload.get("rules") or [] if isinstance(r, dict)]


def _rule(ref: str, payload: dict[str, Any] | None) -> dict[str, Any] | str:
    """A derivation rule (the dict) from its number or ``#id``; just the id
    when there's no payload to check it against."""
    rules = _rules(payload)
    if ref.startswith("#") and len(ref) > 1:
        rid = ref[1:]
        if rules is None:
            return rid
        hit = next((r for r in rules if r.get("id") == rid), None)
        if hit is None:
            raise ValueError(f"no rule with id {rid!r}")
        return hit
    if not ref.isdigit():
        raise ValueError(f"{ref!r} isn't a rule number")
    if rules is None:
        raise ValueError(f"can't find rule {ref} here; name it by #id")
    n = int(ref)
    if not 1 <= n <= len(rules):
        raise ValueError(f"no rule {n} (it has {len(rules)})")
    return rules[n - 1]


def constraint_rule_keys(p: dict[str, Any]) -> list[tuple[str, str, str]]:
    """A constraint's rules in the order `read` numbers them, as
    ``(instance key, source, target)``: the matrix cells that do something
    (``disabled_matrix_cells``), then the option pairs
    (``disabled_exception_keys``)."""
    rows: list[tuple[str, str, str]] = []
    matrix = p.get("matrix") if isinstance(p.get("matrix"), dict) else {}
    for src, row in matrix.items():
        if isinstance(row, dict):
            for tgt, cell in row.items():
                if isinstance(cell, dict) and cell.get("mode") not in (None, "allow"):
                    rows.append(("disabled_matrix_cells", str(src), str(tgt)))
    for e in p.get("exceptions") or []:
        if isinstance(e, dict):
            rows.append(("disabled_exception_keys",
                         str(e.get("source_value") or e.get("source", "")),
                         str(e.get("target_value") or e.get("target", ""))))
    return rows


def _key(a: str, b: str) -> str:
    # Same as engine/modules/_keys.py:encode_key (kept local: engine.ai only
    # reads plain JSON here).
    return json.dumps([a, b], separators=(",", ":"), ensure_ascii=False)


# ── clauses ─────────────────────────────────────────────────────────────

def _only_options(rest: str, out: dict[str, Any], kind: str,
                  payload: dict[str, Any] | None) -> None:
    if not rest:
        raise ValueError("name the options to keep, e.g. only options 1,3")
    out["enabled_options"] = _option_refs(rest, payload)


def _off_options(rest: str, out: dict[str, Any], kind: str,
                 payload: dict[str, Any] | None) -> None:
    if not rest:
        raise ValueError("name the options to switch off, e.g. off options 2,4")
    off = set(_option_refs(rest, payload))
    opts = _options(payload)
    if opts is None:
        raise ValueError("can't tell which options are left here; "
                         "write only options #id,… instead")
    keep = [str(o.get("id")) for o in opts if str(o.get("id")) not in off]
    if not keep:
        raise ValueError("that switches every option off")
    out["enabled_options"] = keep


def _weight(rest: str, out: dict[str, Any], kind: str,
            payload: dict[str, Any] | None) -> None:
    if not rest:
        raise ValueError("write weight N=W, e.g. weight 3=2.5")
    # Several "weight" clauses add up ("weight long_hair=3; weight short_hair=1").
    weights: dict[str, float] = dict(out.get("option_weights") or {})
    rest_w: float | None = None
    for item in _items(rest):
        m = re.fullmatch(r"(.+?)\s*=\s*(\S+)", item, re.S)
        if not m:
            raise ValueError(f"write {item} as option=weight, e.g. 3=2.5")
        w = _number(m.group(2), "a weight")
        if w < 0 or w > MAX_WEIGHT:
            raise ValueError(f"a weight is between 0 and {MAX_WEIGHT:g}, not {m.group(2)}")
        w = int(w) if w.is_integer() else w
        if _OTHERS.fullmatch(m.group(1).strip().lower()):
            # "others=1": every option the clause doesn't weigh itself.
            rest_w = w
            continue
        tagged = _tagged(m.group(1), payload)
        if tagged:
            # "long_hair=3": every option carrying the tag.
            for oid in tagged:
                weights[oid] = w
            continue
        weights[_option_id(m.group(1), payload)] = w
    if rest_w is not None:
        for o in _options(payload) or []:
            weights.setdefault(str(o.get("id")), rest_w)
    out["option_weights"] = weights


_OTHERS = re.compile(r"(?:all\s+)?(?:the\s+)?(?:others?|rest|everything\s+else|"
                     r"other\s+options|else|\*)")


def _tagged(ref: str, payload: dict[str, Any] | None) -> list[str]:
    """The ids of the options carrying tag ``ref`` (``long_hair`` or
    ``#long_hair``), when it names a tag and not an option."""
    opts = _options(payload)
    word = ref.strip().lstrip("#").strip().lower().replace(" ", "_")
    if opts is None or not word or ref.strip().isdigit() or any(
            str(o.get("id")) == word or " ".join(str(o.get("value", "")).split()).lower()
            == word for o in opts):
        return []
    return [str(o.get("id")) for o in opts if word in {
        str(t).lower().replace(" ", "_") for t in o.get("sub_categories") or []}]


def _pin(rest: str, out: dict[str, Any], kind: str,
         payload: dict[str, Any] | None) -> None:
    items = _items(rest) if rest else []
    if len(items) != 1:
        raise ValueError("pin one option, e.g. pin 2")
    out["mode"] = "pinned"
    out["pinned_option_id"] = _option_id(items[0], payload)


def _seed(rest: str, out: dict[str, Any], kind: str,
          payload: dict[str, Any] | None) -> None:
    if not re.fullmatch(r"\d+", rest):
        raise ValueError("write seed N with a whole number, e.g. seed 1234")
    n = int(rest)
    if n > MAX_SEED:
        raise ValueError(f"a seed is at most {MAX_SEED}")
    out["locked_seed"] = n


def _rules_off(rest: str, out: dict[str, Any], kind: str,
               payload: dict[str, Any] | None) -> None:
    if not rest:
        raise ValueError("name the rules to switch off, e.g. rules off 2,3")
    if kind == "derivation":
        ids: list[str] = []
        for item in _items(rest):
            r = _rule(item, payload)
            rid = r if isinstance(r, str) else str(r.get("id", ""))
            if rid not in ids:
                ids.append(rid)
        out["disabled_rule_ids"] = ids
        return
    rows = constraint_rule_keys(payload) if payload is not None else None
    cells: list[str] = []
    excs: list[str] = []
    for item in _items(rest):
        if item.isdigit():
            if rows is None:
                raise ValueError(f"can't find rule {item} here; write it as tag>tag "
                                 'or "option">"option"')
            n = int(item)
            if not 1 <= n <= len(rows):
                raise ValueError(f"no rule {n} (it has {len(rows)})")
            where, a, b = rows[n - 1]
        else:
            pair = _PAIR.fullmatch(item)
            if pair:
                where = "disabled_exception_keys"
                a = pair.group(1) if pair.group(1) is not None else pair.group(2)
                b = pair.group(3) if pair.group(3) is not None else pair.group(4)
            else:
                if "\"" in item or "'" in item:
                    raise ValueError(f'quote both sides of {item!r} ("a">"b") or neither')
                parts = _ARROW.split(item, maxsplit=1)
                if len(parts) != 2 or not parts[0].strip() or not parts[1].strip():
                    raise ValueError(f"{item!r} isn't a rule; use its number, tag>tag "
                                     'or "option">"option"')
                where = "disabled_matrix_cells"
                a, b = parts[0].strip().lstrip("#"), parts[1].strip().lstrip("#")
            if rows is not None and (where, a, b) not in rows:
                what = "tag cell" if where == "disabled_matrix_cells" else "option pair"
                raise ValueError(f"no {what} {item} in this constraint")
        bucket = cells if where == "disabled_matrix_cells" else excs
        key = _key(a, b)
        if key not in bucket:
            bucket.append(key)
    if cells:
        out["disabled_matrix_cells"] = cells
    if excs:
        out["disabled_exception_keys"] = excs


def _branches_off(rest: str, out: dict[str, Any], kind: str,
                  payload: dict[str, Any] | None) -> None:
    if not rest:
        raise ValueError("name the branches, e.g. branches off 2.2, 3.else")
    keys: list[str] = []
    for item in _items(rest):
        m = re.fullmatch(r"(#[^\s.]+|\d+)\.(\d+|else)", item.strip(), re.I)
        if not m:
            raise ValueError(f"write {item!r} as rule.branch, e.g. 2.2 or 2.else")
        r = _rule(m.group(1), payload)
        rid = r if isinstance(r, str) else str(r.get("id", ""))
        b = m.group(2).lower()
        if b == "else":
            if isinstance(r, dict) and not isinstance(r.get("else"), dict):
                raise ValueError(f"rule {m.group(1)} has no ELSE")
            key = f"{rid}:else"
        else:
            n = int(b)
            if n < 2:
                raise ValueError(f"{item}: branch 1 is the IF; switch the rule off instead "
                                 "(rules off …)")
            if isinstance(r, dict):
                count = len([x for x in r.get("branches") or [] if isinstance(x, dict)])
                if n > count:
                    raise ValueError(f"rule {m.group(1)} has {count} branches, not {n}")
            key = f"{rid}:{n - 1}"
        if key not in keys:
            keys.append(key)
    out["disabled_branch_keys"] = keys


def _reach(rest: str, out: dict[str, Any], kind: str,
           payload: dict[str, Any] | None) -> None:
    low = " ".join(rest.lower().split())
    if low.startswith("pick"):
        raise ValueError("picked targets can only be chosen in the editor; "
                         "write reach first, next N or all")
    m = re.fullmatch(r"(all|first|next)(?:\s+(\d+))?", low)
    if not m or (m.group(2) and m.group(1) != "next"):
        raise ValueError("write reach first, reach next N or reach all")
    if m.group(1) == "next":
        n = int(m.group(2) or 1)
        if not 1 <= n <= MAX_REACH:
            raise ValueError(f"reach next N is between 1 and {MAX_REACH}")
        out["target_select"] = {"mode": "next", "count": n}
    else:
        out["target_select"] = {"mode": m.group(1)}


_NEW = {
    "only options": _only_options, "off options": _off_options, "weight": _weight,
    "pin": _pin, "seed": _seed, "rules off": _rules_off,
    "branches off": _branches_off, "reach": _reach,
}


# ── describe ────────────────────────────────────────────────────────────

def _opt_ref(oid: Any, payload: dict[str, Any] | None) -> str:
    opts = _options(payload)
    if opts is not None:
        for n, o in enumerate(opts, 1):
            if o.get("id") == oid:
                return str(n)
    return f"#{oid}"


def _rule_ref(rid: str, payload: dict[str, Any] | None) -> str:
    rules = _rules(payload)
    if rules is not None:
        for n, r in enumerate(rules, 1):
            if r.get("id") == rid:
                return str(n)
    return f"#{rid}"


def _num_text(v: Any) -> str:
    return f"{v:g}" if isinstance(v, float) else str(v)


def _describe_more(instance: dict[str, Any], payload: dict[str, Any] | None) -> list[str]:
    bits: list[str] = []
    enabled = instance.get("enabled_options")
    if isinstance(enabled, list):
        refs = [_opt_ref(o, payload) for o in enabled]
        bits.append("only options " + ",".join(refs) if refs else "only options (none)")
    weights = instance.get("option_weights")
    if isinstance(weights, dict) and weights:
        bits.append("weight " + ", ".join(
            f"{_opt_ref(k, payload)}={_num_text(v)}" for k, v in weights.items()))
    if instance.get("mode") == "pinned" and instance.get("pinned_option_id") is not None:
        bits.append(f"pin {_opt_ref(instance['pinned_option_id'], payload)}")
    seed = instance.get("locked_seed")
    if isinstance(seed, (int, float)) and not isinstance(seed, bool):
        bits.append(f"seed {int(seed)}")
    rules_off = [_rule_ref(str(r), payload) for r in instance.get("disabled_rule_ids") or []]
    branches: list[str] = []
    for k in instance.get("disabled_branch_keys") or []:
        rid, _, b = str(k).rpartition(":")
        if rid and (b == "else" or b.isdigit()):
            branches.append(f"{_rule_ref(rid, payload)}.{b if b == 'else' else int(b) + 1}")
    rows = constraint_rule_keys(payload) if payload is not None else None
    for where in ("disabled_matrix_cells", "disabled_exception_keys"):
        for k in instance.get(where) or []:
            try:
                parts = json.loads(k)
            except (TypeError, ValueError):
                continue
            if not (isinstance(parts, list) and len(parts) == 2):
                continue
            a, b = str(parts[0]), str(parts[1])
            if rows is not None and (where, a, b) in rows:
                rules_off.append(str(rows.index((where, a, b)) + 1))
            elif where == "disabled_matrix_cells":
                rules_off.append(f"{a}>{b}")
            else:
                rules_off.append(f'"{a}">"{b}"')
    if rules_off:
        bits.append("rules off " + ",".join(rules_off))
    if branches:
        bits.append("branches off " + ", ".join(branches))
    ts = instance.get("target_select")
    if isinstance(ts, dict) and ts.get("mode") in ("all", "first", "next", "pick"):
        bits.append({"all": "reach all", "first": "reach first",
                     "pick": "reach picked targets (set in the editor)"}.get(
            ts["mode"], f"reach next {ts.get('count', 1)}"))
    return bits


def describe(instance: Any, payload: dict[str, Any] | None = None) -> str:
    """An instance's settings as the clause line ``parse_use`` reads.
    ``payload`` (the module's) shows options and rules by their numbers."""
    if not isinstance(instance, dict):
        return ""
    bits: list[str] = []
    lo, hi = instance.get("pick_min"), instance.get("pick_max")
    if isinstance(hi, int) and (hi != 1 or (isinstance(lo, int) and lo != 1)):
        lo = lo if isinstance(lo, int) else hi
        bits.append(f"pick {lo}" + (f"-{hi}" if hi != lo else "")
                    + (" repeats" if instance.get("pick_independent") else ""))
        if isinstance(instance.get("pick_separator"), str):
            bits.append(f'sep "{instance["pick_separator"]}"')
    if isinstance(instance.get("category_filter"), str) and instance["category_filter"].strip():
        bits.append(f"filter {instance['category_filter'].strip()}")
    if instance.get("exclude_null"):
        bits.append("no empty")
    if isinstance(instance.get("match_variable"), str) and instance["match_variable"]:
        bits.append(f"match ${instance['match_variable']}")
    if instance.get("seed_scope") == "hold":
        bits.append("hold")
    if instance.get("internal"):
        bits.append("internal")
    if isinstance(instance.get("variable_binding"), str) and instance["variable_binding"]:
        bits.append(f"as ${instance['variable_binding']}")
    bits += _describe_more(instance, payload if isinstance(payload, dict) else None)
    if instance.get("template_override"):
        bits.append("own template")
    return "; ".join(bits)


GUIDE = """\
Per-use settings ("use", for a module in a bundle or \
stack), written as clauses separated by ";": "pick 2-3" (several options; \
$var joins them with ", ", $var.0 is the first; "pick 1-3 repeats" allows the \
same one twice; sep " and " changes the joiner), "filter warm and not wet" \
(only options with those tags), "no empty" (never the empty option), "match \
$model_variant" (take the option whose text equals that variable), "hold" \
(the same pick for a whole WP Context Loop run, like a character that \
stays), "internal" (rules can read it, the prompt doesn't show it), "as \
$other" (bind it to another variable). Wildcard options, by their number in \
read (or "quoted text", or #id): "only options 1,3" (the rest off here), \
"off options 2,4", "weight 3=2.5, 4=0" (this use's weights; a tag in place \
of a number weights every option carrying it), "pin 2" (always \
that option). "seed 1234" (wildcard, combine, fixed values, derivation: the \
same result whatever the run seed). Derivation: "rules off 2", "branches \
off 2.2, 2.else" (rule 2's second branch and its ELSE; branch 1 is the IF, \
turn the rule off instead). Constraint: "rules off 1,2" (its rules as read \
numbers them; or warm>wet for a tag cell, "red">"blue" for an option pair), \
"reach first" / "reach next 2" / "reach all" (which targets after it). A use \
line replaces the old one, so repeat the settings to keep. "" for none.\
"""
