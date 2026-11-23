"""Backward rules: keep a constraint's SOURCE compatible with a NARROWED target.

Constraints run forward (source picks, then the target re-weights). When the
target's pool is narrowed before it rolls (a locked value, Match variable, a
pool filter, the node's option toggles, per-use weights of 0), the source can
pick something no live target option accepts: the target then falls back or
comes out empty, or (a locked value) ignores the rule.

So right before a source wildcard rolls, this module looks DOWNSTREAM in the
same Context node for every constraint from it whose reach covers a later
target instance, works out that target's live pool (its domain), and drops the
source options no live target option accepts (arc consistency, AC-3). The rest
keep their normal odds ("compatible", not exact conditional odds). The factor
comes from the forward maths (`_apply_constraint_to_options`), so backward
and forward never disagree. A target whose pool is not narrowed is left alone,
so chains without locks, filters or toggles roll exactly as before.

Chains (mood → pose → place) work: a target's domain is itself pruned by ITS
narrowed downstream targets (depth-limited).

Research + decisions: /pr-drafts/backward-rules-locked-values-2026-11-17.md
(Dumi, 17/11/2026: seed-locked sources are narrowed like forward constraints
narrow them; value-locked sources are never changed).

Rules between source and target: when a module between them (a derivation,
say) sets a variable the target's filter or Match variable reads FROM the
source's pick, each distinct source value (up to `MAX_ENUM`) is run ahead on a
scratch copy, so every option is tried with what it leads to. The same goes
for a later wildcard no constraint from the source covers, whose filter or
Match variable a rule fills from the source (the WP Parts mirror chain pose →
rule → mirror → place): a source option is dropped when that wildcard would
be left with nothing its own narrowed targets accept.

Limits: targets in the same Context node, top-level instances (a target
reached through a nested ``@{}`` ref is not looked at), and the look-ahead
sets only the source's variable (an axis or pick read by the rule is not).
"""
from __future__ import annotations

from typing import Any

#: The node's module list + the running module's index (set by the pipeline).
CHAIN_KEY = "__wp_chain__"
POS_KEY = "__wp_chain_pos__"
#: Per-run cache of compiled downstream constraint metas, keyed by uid.
CACHE_KEY = "__wp_backward_cache__"
#: How deep a chain of narrowed targets is followed (pose → place → light …).
MAX_DEPTH = 4
#: Set on the scratch copy a look-ahead runs, so it never looks ahead again.
DRY_KEY = "__wp_backward_dry__"
#: Accepts rolls tried per source option (as `pack_tidy._rolls`).
_MAX_ROLLS = 64
#: Distinct source values the look-ahead runs one by one when a variable a
#: target reads depends on the source's own pick (rules between them).
MAX_ENUM = 32
#: Later wildcards a source checks for a rule-made dependency on its pick.
MAX_DEPENDENTS = 8


def _weight(o: dict[str, Any]) -> float:
    try:
        w = o.get("weight", 1)
        return float(1 if w is None else w)
    except (TypeError, ValueError):
        return 1.0


def _entries(ctx: dict[str, Any]) -> list[dict[str, Any]]:
    """The chain as [{index, header, snapshot, on}], built once per run."""
    cache = ctx.setdefault(CACHE_KEY, {})
    got = cache.get("entries")
    if got is not None:
        return got
    from engine.pipeline import _coerce_snapshot, _frame_override, _read_header

    out: list[dict[str, Any]] = []
    modules = ctx.get(CHAIN_KEY) or []
    frame = int(ctx.get("__wp_loop_index__", 0) or 0)
    for i, m in enumerate(modules):
        h = _read_header(m)
        if h.type not in ("wildcard", "constraint"):
            continue
        ov = _frame_override(m, frame)
        on = ov if ov is not None else bool(h.enabled)
        try:
            snap = _coerce_snapshot(m, h.uid, ctx)
        except Exception:
            continue
        if not isinstance(snap, dict):
            continue
        out.append({"index": i, "header": h, "snapshot": snap, "on": on})
    cache["entries"] = out
    return out


def _compile_constraint(ctx: dict[str, Any], e: dict[str, Any]) -> dict[str, Any] | None:
    """The meta a not-yet-run constraint module will register, built on a
    scratch ctx (its validation errors mean it would not register either)."""
    cache = ctx.setdefault(CACHE_KEY, {}).setdefault("metas", {})
    h = e["header"]
    key = f"{h.bundle_origin}/{h.uid or h.id}"
    if key in cache:
        return cache[key]
    from engine.modules.constraint_handler import ConstraintHandler

    snap = e["snapshot"]
    scratch: dict[str, Any] = {
        "__wp_current_module_id__": h.id,
        "__wp_current_module_uid__": h.uid or h.id,
        "__wp_current_module_name__": h.name,
        "__wp_current_module_bundle_origin__": h.bundle_origin,
    }
    meta: dict[str, Any] | None
    try:
        ConstraintHandler.resolve(
            snap.get("payload") or {}, snap.get("instance") or {}, scratch,
        )
        bucket = scratch.get("__wp_constraints__") or []
        meta = bucket[0] if bucket else None
    except Exception:
        meta = None
    cache[key] = meta
    return meta


def _relevant(c: dict[str, Any], source_id: str, source_origin: str) -> bool:
    """Does constraint ``c`` read THIS source instance's pick? Mirrors
    `_select_source_pick`: a constraint in a bundle copy reads that copy's
    source; one outside any bundle (or a source outside) reads the top pick."""
    if c.get("source_wildcard_id") != source_id:
        return False
    origin = c.get("__constraint_bundle_origin__")
    return not origin or not source_origin or origin == source_origin


def _covered(
    c: dict[str, Any], after: int, entries: list[dict[str, Any]], hits: dict[str, Any],
) -> list[dict[str, Any]]:
    """The later target instances ``c``'s reach covers (forward order)."""
    target = c.get("target_wildcard_id")
    origin = c.get("__constraint_bundle_origin__")
    cands = [
        e for e in entries
        if e["index"] > after and e["on"]
        and e["header"].type == "wildcard" and e["header"].id == target
        and not (origin and e["header"].bundle_origin and e["header"].bundle_origin != origin)
    ]
    sel = c.get("target_select") or {"mode": "all"}
    mode = sel.get("mode", "all")
    used = int(hits.get(str(c.get("__constraint_module_id__")), 0) or 0)
    if mode == "first":
        return cands[:1] if used == 0 else []
    if mode == "next":
        try:
            cnt = int(sel.get("count", 1))
        except (TypeError, ValueError):
            cnt = 1
        return cands[: max(0, cnt - used)]
    if mode == "pick":
        uids = {
            p.get("uid") for p in (sel.get("picks") or [])
            if isinstance(p, dict) and p.get("kind") == "direct"
        }
        return [e for e in cands if (e["header"].uid or e["header"].id) in uids]
    return cands


def _constraints_from(
    ctx: dict[str, Any], source_id: str, source_origin: str, pos: int,
    entries: list[dict[str, Any]],
) -> list[tuple[dict[str, Any], int]]:
    """(meta, index after which its reach counts) for every constraint that
    reads this source and can still fire on a later target: those already
    registered (they ran before the source) and constraint modules further
    down this node's chain."""
    out: list[tuple[dict[str, Any], int]] = []
    for c in ctx.get("__wp_constraints__") or []:
        if isinstance(c, dict) and _relevant(c, source_id, source_origin):
            out.append((c, pos))
    for e in entries:
        if e["index"] <= pos or not e["on"] or e["header"].type != "constraint":
            continue
        payload = e["snapshot"].get("payload") or {}
        if payload.get("source_wildcard_id") != source_id:
            continue
        meta = _compile_constraint(ctx, e)
        if meta and _relevant(meta, source_id, source_origin):
            out.append((meta, e["index"]))
    return out


def _records(option: dict[str, Any], payload: dict[str, Any]) -> list[dict[str, Any]]:
    """What a constraint can see of ``option`` (one record per accepts roll)."""
    from engine.modules.wildcard_handler import _axis_menus, _pick_record_for_constraint

    menus = _axis_menus(payload, list(option.get("sub_categories") or []))
    rolls: list[dict[str, str]] = [{}]
    for axis, members in menus.items():
        rolls = [{**r, axis: m} for r in rolls for m in members][:_MAX_ROLLS]
    return [_pick_record_for_constraint(option, payload, r) for r in rolls]


def _domain(
    ctx: dict[str, Any], e: dict[str, Any], depth: int,
    lookup: Any = None,
) -> list[dict[str, Any]] | None:
    """The live pool of target instance ``e`` as far as it is known now, or
    None when nothing narrows it (then it never pushes back).

    Narrowing counted: a pinned option (locked value / sweep pin), Match
    variable (when the variable is already set), the pool filter (its `$`
    terms read the variables set so far; an unset one is left out, which only
    widens), the node's option toggles, a per-use weight of 0, and, down a
    chain, the target's own narrowed targets. The target's other forward
    constraints are not counted (a wider domain only prunes less).

    ``lookup`` reads the variables the filter and Match variable use; by
    default the ones set so far, or, from `prune`, what the modules between
    the source and the target will have set (`_lookahead`).
    """
    get = lookup if callable(lookup) else ctx.get
    from engine.modules.wildcard_handler import WildcardHandler, _match_variable_option

    snap = e["snapshot"]
    payload = snap.get("payload") or {}
    inst = snap.get("instance") or {}
    options: list[dict[str, Any]] = [o for o in payload.get("options") or [] if isinstance(o, dict)]
    if not options:
        return None
    if inst.get("seed_scope") == "hold" and int(ctx.get("__wp_loop_index__", 0) or 0) != 0:
        # Held: its value is the frame-0 one, decided already.
        return None
    narrowed = False
    for on, key in ((inst.get("mode") == "pinned", "pinned_option_id"), (True, "locked_option_id")):
        want = inst.get(key)
        if on and want:
            pinned = next((o for o in options if o.get("id") == want), None)
            if pinned is not None:
                return [pinned]
    pool = options
    expr = inst.get("category_filter")
    exclude_null = bool(inst.get("exclude_null", False))
    if (isinstance(expr, str) and expr.strip()) or exclude_null:
        from engine.syntax.subcat_filter import bind_for_wildcard

        bound, _notes = bind_for_wildcard(
            expr if isinstance(expr, str) else "", lambda n: get(n), payload,
        )
        pool = WildcardHandler._apply_pool_filter(
            pool, expr if isinstance(expr, str) else "",
            exclude_null=exclude_null, bound=(bound,),
        )
    enabled = inst.get("enabled_options")
    if enabled is not None:
        allowed = set(enabled)
        pool = [o for o in pool if o.get("id") in allowed]
    match_var = inst.get("match_variable")
    if isinstance(match_var, str) and match_var.strip():
        name = match_var.strip().lstrip("$")
        if get(name) is not None:
            hit, _how = _match_variable_option({name: get(name)}, pool, match_var.strip())
            if hit is not None:
                return [hit]
    overrides = inst.get("option_weights")
    live: list[dict[str, Any]] = []
    for o in pool:
        w = _weight(o)
        if isinstance(overrides, dict) and o.get("id") in overrides:
            try:
                w = float(overrides[o.get("id")])
            except (TypeError, ValueError):
                pass
        if w > 0:
            live.append({**o, "weight": w})
    all_live = [o for o in options if _weight(o) > 0]
    if len(live) < len(all_live):
        narrowed = True
    if depth < MAX_DEPTH and live:
        h = e["header"]
        kept, _removed, _targets = prune(
            ctx, payload, live, h.id, h.bundle_origin, e["index"], depth + 1,
        )
        if len([o for o in kept if _weight(o) > 0]) < len(live):
            live = [o for o in kept if _weight(o) > 0]
            narrowed = True
    if not narrowed or not live:
        return None
    return live


def _supported(
    option: dict[str, Any], payload: dict[str, Any],
    constraints: list[dict[str, Any]], domain: list[dict[str, Any]],
    target_axes: dict[str, list[str]] | None,
) -> bool:
    """True when some live target option keeps a weight > 0 under every one
    of ``constraints`` (all from this source, all covering that target) for
    at least one roll of ``option``."""
    from engine.modules.wildcard_handler import _apply_constraint_to_options

    for rec in _records(option, payload):
        src = {"value": rec.get("value", ""), "sub_categories": rec.get("tags", []), "picks": [rec]}
        opts = domain
        for c in constraints:
            opts = _apply_constraint_to_options(opts, c, src, None, target_axes)
        if any(_weight(o) > 0 for o in opts):
            return True
    return False


def prune(
    ctx: dict[str, Any],
    payload: dict[str, Any],
    options: list[dict[str, Any]],
    source_id: str,
    source_origin: str,
    pos: int,
    depth: int = 0,
    binding: str = "",
) -> tuple[list[dict[str, Any]], list[Any], list[str]]:
    """``options`` with weight 0 on every option no live option of a narrowed
    downstream target accepts. Returns (options, removed ids, target names).
    Options already at weight 0 are left as they are. ``binding`` is the
    source's variable, which the look-ahead sets to test whether a module
    between source and target reads it."""
    if not isinstance(ctx, dict) or not source_id or ctx.get(CHAIN_KEY) is None:
        return options, [], []
    entries = _entries(ctx)
    hits = ctx.get("__wp_constraint_hits__") or {}
    pairs = _constraints_from(ctx, source_id, source_origin, pos, entries)
    if not pairs and (depth or ctx.get(DRY_KEY) or not _dependents(entries, pos, set())):
        return options, [], []
    from engine.modules.wildcard_handler import _accepts_axes

    # Group the constraints by the target instance they cover.
    by_target: dict[int, tuple[dict[str, Any], list[dict[str, Any]]]] = {}
    for c, after in pairs:
        for t in _covered(c, after, entries, hits):
            by_target.setdefault(t["index"], (t, []))[1].append(c)
    removed: list[Any] = []
    names: list[str] = []
    out = options

    def drop(keep: Any, t: dict[str, Any]) -> None:
        nonlocal out
        nxt: list[dict[str, Any]] = []
        changed = False
        for o in out:
            if _weight(o) > 0 and not keep(o):
                nxt.append({**o, "weight": 0})
                removed.append(o.get("id"))
                changed = True
            else:
                nxt.append(o)
        if changed:
            out = nxt
            t_payload = t["snapshot"].get("payload") or {}
            name = t["header"].name or str(t_payload.get("var_binding") or t["header"].id)
            if name not in names:
                names.append(name)

    for _idx, (t, cons) in sorted(by_target.items()):
        shared: Any = None
        by_value: dict[str, Any] | None = None
        if depth == 0:
            shared, by_value = _lookahead(ctx, pos, t, binding, payload, out)
        t_payload = t["snapshot"].get("payload") or {}
        axes = _accepts_axes(t_payload)
        if by_value is not None:
            # A rule between them makes what the target reads depend on the
            # source's pick: each option is tried with what it leads to.
            doms = {v: _domain(ctx, t, depth, get) for v, get in by_value.items()}

            def keep_each(o: dict[str, Any], doms=doms, cons=cons, axes=axes) -> bool:
                dom = doms.get(_value(o))
                return dom is None or _supported(o, payload, cons, dom, axes)

            drop(keep_each, t)
            continue
        domain = _domain(ctx, t, depth, shared)
        if domain is None:
            continue
        drop(lambda o, d=domain, c=cons, a=axes: _supported(o, payload, c, d, a), t)
    if depth == 0 and not ctx.get(DRY_KEY):
        for d in _dependents(entries, pos, set(by_target)):
            if not _mentions(ctx, pos, d["index"], binding):
                continue
            _shared, by_value = _lookahead(ctx, pos, d, binding, payload, out)
            if by_value is None:
                continue
            fits = {v: _fits_downstream(ctx, d, get) for v, get in by_value.items()}
            if not any(fits.values()):
                # Nothing the source picks helps: it is not the source's to fix.
                continue
            drop(lambda o, f=fits: f.get(_value(o), True), d)
    return out, list(dict.fromkeys(removed)), names


def _value(o: dict[str, Any]) -> str:
    return str(o.get("value", ""))


def _dependents(
    entries: list[dict[str, Any]], pos: int, done: set[int],
) -> list[dict[str, Any]]:
    """Later wildcards (no constraint from the source covers them) whose pool
    filter or Match variable reads a variable: a rule between may set it from
    the source's pick (the WP Parts mirror: pose → rule → mirror → place)."""
    out = []
    for e in entries:
        if e["index"] <= pos + 1 or e["index"] in done or not e["on"]:
            continue
        if e["header"].type != "wildcard":
            continue
        if _names_read(e["snapshot"].get("instance") or {}):
            out.append(e)
        if len(out) >= MAX_DEPENDENTS:
            break
    return out


def _fits_downstream(ctx: dict[str, Any], d: dict[str, Any], get: Any) -> bool:
    """Does wildcard ``d``, reading its variables through ``get``, keep an
    option its own narrowed targets accept? True when nothing narrows it."""
    dom = _domain(ctx, d, 1, get)
    if dom is None:
        return True
    if not dom:
        return False
    h = d["header"]
    kept, _r, _t = prune(
        ctx, d["snapshot"].get("payload") or {}, dom, h.id, h.bundle_origin, d["index"], 2,
    )
    return any(_weight(o) > 0 for o in kept)


def _names_read(inst: dict[str, Any]) -> list[str]:
    """The variables a target's filter and Match variable read."""
    from engine.syntax.subcat_filter import parse, variables

    names: list[str] = []
    expr = inst.get("category_filter")
    if isinstance(expr, str) and "$" in expr:
        names += variables(parse(expr))
    mv = inst.get("match_variable")
    if isinstance(mv, str) and mv.strip():
        names.append(mv.strip().lstrip("$"))
    return list(dict.fromkeys(names))


def _dry(
    ctx: dict[str, Any], pos: int, end: int, binding: str, value: Any,
) -> dict[str, Any]:
    """Run modules ``pos+1 .. end-1`` (between source and target) on a copy of
    ``ctx`` with the source's variable set to ``value``.

    It is the real run's own step loop on the same node seed, hold seed, loop
    frame and frame-0 values, so every module rolls with exactly the seed it
    will roll with for real (its locked seed, the node's seed or its WP Seeds
    row): rolls are keyed by seed + instance, never by position. Modules in
    other Context nodes are not run: what they set is already in ``ctx``."""
    import copy

    from engine.modules._detail import DETAIL_KEY, EXPLAIN_KEY
    from engine.pipeline import PipelineEngine

    skip = {CHAIN_KEY, POS_KEY, CACHE_KEY, EXPLAIN_KEY, DETAIL_KEY,
            "__wp_trace__", "__wp_hold_base_ctx__", "__wp_rng__"}
    base = copy.deepcopy({k: v for k, v in ctx.items() if k not in skip})
    if "__wp_hold_base_ctx__" in ctx:
        base["__wp_hold_base_ctx__"] = ctx["__wp_hold_base_ctx__"]  # read only
    base["__wp_warnings__"] = []
    base[DRY_KEY] = True
    if binding:
        base[binding] = value
    modules = ctx.get(CHAIN_KEY) or []
    eng = PipelineEngine()
    eng._init_run_state(
        base,
        int(ctx.get("__wp_node_seed__", 0) or 0),
        int(ctx.get("__wp_node_seed_hold__", 0) or 0),
        int(ctx.get("__wp_loop_index__", 0) or 0),
    )
    base[CHAIN_KEY] = modules
    for i in range(pos + 1, min(end, len(modules))):
        base[POS_KEY] = i
        eng._run_module(i, modules[i], base, False)
    return base


def _lookahead(
    ctx: dict[str, Any], pos: int, t: dict[str, Any], binding: str,
    payload: dict[str, Any], options: list[dict[str, Any]],
) -> tuple[Any, dict[str, Any] | None]:
    """What target ``t``'s filter / Match variables will hold when it rolls.

    A module between the source and the target may set one (a rule, an
    injector-like fixed value, …). Those modules run ahead on a scratch copy,
    once per distinct source value. Returns ``(getter, None)`` when what they
    set doesn't depend on the source's pick, or ``(None, {value: getter})``
    when it does, so each source option can be tried with what it leads to.
    Past `MAX_ENUM` values a dependent variable counts as unset (it narrows
    nothing) and a `backward_late_variable` warning says to move the module
    above the source."""
    if ctx.get(DRY_KEY):
        return None, None
    inst = t["snapshot"].get("instance") or {}
    names = _names_read(inst)
    if not names or t["index"] <= pos + 1:
        return None, None
    cache = ctx.setdefault(CACHE_KEY, {}).setdefault("ahead", {})
    key = (pos, t["index"])
    if key in cache:
        return cache[key]
    distinct = list(dict.fromkeys(_value(o) for o in options if _weight(o) > 0))
    # Only a module between that names the source's variable can make what
    # the target reads depend on it; otherwise one run says it all.
    tried = distinct[: MAX_ENUM + 1] if _mentions(ctx, pos, t["index"], binding) else distinct[:1]
    try:
        runs = {v: _dry_cached(ctx, pos, t["index"], binding, v) for v in (tried or [""])}
    except Exception:
        cache[key] = (None, None)
        return cache[key]
    first = next(iter(runs.values()))
    late = [n for n in names if any(str(r.get(n)) != str(first.get(n)) for r in runs.values())]

    def getter(found: dict[str, Any], blank: list[str]) -> Any:
        def get(name: str) -> Any:
            if name in blank:
                return None
            return found.get(name) if name in names else ctx.get(name)
        return get

    if not late:
        cache[key] = (getter(first, []), None)
    elif len(distinct) <= MAX_ENUM:
        cache[key] = (None, {v: getter(r, []) for v, r in runs.items()})
    else:
        if isinstance(ctx.get("__wp_warnings__"), list):
            ctx["__wp_warnings__"].append(late_variable_warning(
                str(ctx.get("__wp_current_module_id__") or ""), late, binding,
            ))
        cache[key] = (getter(first, late), None)
    return cache[key]


def _mentions(ctx: dict[str, Any], pos: int, end: int, binding: str) -> bool:
    """Does a module between ``pos`` and ``end`` name ``$binding`` (or the
    bare name, as a derivation condition does)? A cheap text check: a false
    yes only costs look-ahead runs."""
    if not binding:
        return False
    import json
    import re

    cache = ctx.setdefault(CACHE_KEY, {}).setdefault("mentions", {})
    key = (pos, end, binding)
    if key not in cache:
        pat = re.compile(rf"(?<![A-Za-z0-9_]){re.escape(binding)}(?![A-Za-z0-9_])")
        modules = ctx.get(CHAIN_KEY) or []
        hit = False
        for m in modules[pos + 1: end]:
            try:
                text = json.dumps(m, default=str)
            except (TypeError, ValueError):
                hit = True
                break
            if pat.search(text):
                hit = True
                break
        cache[key] = hit
    return bool(cache[key])


def _dry_cached(
    ctx: dict[str, Any], pos: int, end: int, binding: str, value: Any,
) -> dict[str, Any]:
    """`_dry`, once per (source, target, value) in a run."""
    cache = ctx.setdefault(CACHE_KEY, {}).setdefault("dry", {})
    key = (pos, end, binding, str(value))
    if key not in cache:
        cache[key] = _dry(ctx, pos, end, binding, value)
    return cache[key]


def late_variable_warning(module_id: str, names: list[str], binding: str) -> dict[str, Any]:
    """A filter / Match variable set between source and target from the
    source's own pick: the source can't look ahead at it."""
    shown = ", ".join(f"${n}" for n in names)
    return {
        "type": "backward_late_variable",
        "severity": "warn",
        "module_id": module_id,
        "source_field": "",
        "position": 0,
        "token_index": None,
        "detail": {"variables": names, "source": binding},
        "message": (
            f"{shown} is set after ${binding} rolls and depends on it, so ${binding} "
            "can't keep to what it allows; set it above, or from something else"
        ),
    }


def no_fit_warning(module_id: str, targets: list[str], *, fallback: bool) -> dict[str, Any]:
    """Nothing this source can pick fits its narrowed targets."""
    what = ", ".join(targets)
    return {
        "type": "backward_no_fit",
        "severity": "info" if fallback else "warn",
        "module_id": module_id,
        "source_field": "",
        "position": 0,
        "token_index": None,
        "detail": {"targets": targets, "fallback": fallback},
        "message": (
            f"no option fits what is left of {what}; "
            + ("took the fallback" if fallback else "rolled normally")
        ),
    }


def locked_conflict_warning(module_id: str, option_id: Any) -> dict[str, Any]:
    """A locked (pinned) option that the constraints on it rule out."""
    return {
        "type": "locked_value_conflict",
        "severity": "warn",
        "module_id": module_id,
        "source_field": "",
        "position": 0,
        "token_index": None,
        "detail": {"option_id": "" if option_id is None else str(option_id)},
        "message": (
            "the locked option is ruled out by a constraint whose source is "
            "locked too (or came from another node); the lock was kept"
        ),
    }
