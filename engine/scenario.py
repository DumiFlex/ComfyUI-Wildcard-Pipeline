"""Scenario runs — the Test Runner's engine side.

A scenario is an ordered module stack (the same list shape a WP_Context node
feeds ``PipelineEngine.run``), optional pinned ``$var`` values standing in for
whatever an upstream node would pass in, and a set of seeds. Running it means
one real ``PipelineEngine.run`` per seed and a summary of what came out:

  - per-variable value counts (fully expanded values, so ``{a|b}`` branches
    and ``@{ref}`` expansions are counted separately),
  - per-wildcard option pick counts (by option id, before expansion),
  - per-constraint downstream hit totals,
  - engine warnings grouped by (type, message) with the seeds they fired on,
  - the first ``sample_limit`` samples in full, each with its trace.

Every seed is a real chain seed: the same seed on a canvas Context node holding
the same modules produces the same values. That is the point of running here
instead of in a browser-side mirror of the engine.

Pure Python, no ComfyUI or DB imports — the API layer resolves library rows
into the module list + catalog and hands them in.
"""
from __future__ import annotations

import copy
import random
import time
from collections import Counter
from typing import Any

from engine.context import strip_engine_internals
from engine.pipeline import PipelineEngine
from engine.syntax.types import ListVar

MAX_SEEDS = 10_000
DEFAULT_SAMPLE_LIMIT = 200
DEFAULT_VALUE_LIMIT = 500
# Seeds that survive a round-trip through JavaScript numbers (2**53 - 1).
_MAX_SEED = 2**53 - 1
_WARNING_SEED_LIMIT = 20


class ScenarioError(ValueError):
    """A scenario request that can't run (bad seed spec, too many seeds)."""


def resolve_seeds(spec: Any, *, rng: random.Random | None = None) -> list[int]:
    """Turn a seed spec into the concrete list of chain seeds.

    Accepted shapes:
      - ``{"from": S, "count": N}`` → ``S, S+1, … S+N-1``
      - ``{"random": true, "count": N}`` → N distinct random seeds
      - ``{"list": [s1, s2, …]}`` → exactly those seeds, in order
    """
    if not isinstance(spec, dict):
        raise ScenarioError("seeds must be an object")
    if "list" in spec:
        raw = spec["list"]
        if not isinstance(raw, list) or not raw:
            raise ScenarioError("seeds.list must be a non-empty list")
        try:
            seeds = [int(s) for s in raw]
        except (TypeError, ValueError) as exc:
            raise ScenarioError("seeds.list must hold integers") from exc
    else:
        try:
            count = int(spec.get("count", 0))
        except (TypeError, ValueError) as exc:
            raise ScenarioError("seeds.count must be an integer") from exc
        if count < 1:
            raise ScenarioError("seeds.count must be at least 1")
        if count > MAX_SEEDS:
            raise ScenarioError(f"seeds.count must be at most {MAX_SEEDS}")
        if spec.get("random"):
            r = rng or random.SystemRandom()
            picked: set[int] = set()
            seeds = []
            while len(seeds) < count:
                s = r.randint(0, _MAX_SEED)
                if s not in picked:
                    picked.add(s)
                    seeds.append(s)
        else:
            try:
                start = int(spec.get("from", 0))
            except (TypeError, ValueError) as exc:
                raise ScenarioError("seeds.from must be an integer") from exc
            seeds = list(range(start, start + count))
    if len(seeds) > MAX_SEEDS:
        raise ScenarioError(f"at most {MAX_SEEDS} seeds per run")
    for s in seeds:
        if s < 0 or s > _MAX_SEED:
            raise ScenarioError(f"seed {s} is outside 0..{_MAX_SEED}")
    return seeds


def _render(value: Any) -> str:
    """The string a value renders as in a prompt (a multi-pick joins)."""
    if isinstance(value, ListVar):
        return str(value)
    return value if isinstance(value, str) else str(value)


def _json_value(value: Any) -> Any:
    """JSON-safe form of a resolved value; a multi-pick keeps its items so a
    UI can index it the way ``$name.K`` does."""
    if isinstance(value, ListVar):
        return {"items": list(value.items), "sep": value.sep}
    return value if isinstance(value, (str, int, float, bool)) or value is None else str(value)


def _refs_by_owner(log: Any) -> dict[str, list[dict[str, Any]]]:
    """Group the engine's nested-ref log by the stack uid whose resolve made
    each pick, keeping pre-order so `depth` draws the tree."""
    grouped: dict[str, list[dict[str, Any]]] = {}
    if not isinstance(log, list):
        return grouped
    for row in log:
        if not isinstance(row, dict):
            continue
        grouped.setdefault(str(row.get("owner") or ""), []).append({
            "uuid": row.get("uuid", ""),
            "name": row.get("name", ""),
            "option_id": row.get("option_id"),
            "depth": int(row.get("depth") or 0),
            "value": _json_value(row.get("value", row.get("raw", ""))),
        })
    return grouped


def _slim_trace(
    trace: Any, names: dict[str, str], refs: dict[str, list[dict[str, Any]]] | None = None,
) -> list[dict[str, Any]]:
    """The engine trace, trimmed to what a per-seed view needs. The engine
    doesn't carry display names on trace rows, so they come from the stack
    (keyed by `_uid`, falling back to the library id). ``refs`` adds the
    nested `@{ref}` picks each row's resolve made, as a pre-order list."""
    refs = refs or {}
    out: list[dict[str, Any]] = []
    if not isinstance(trace, list):
        return out
    for row in trace:
        if not isinstance(row, dict):
            continue
        writes = []
        for w in row.get("writes") or []:
            if isinstance(w, dict):
                writes.append({
                    "variable": w.get("variable"),
                    "value": _json_value(w.get("value")),
                    "overwrite": bool(w.get("overwrite", False)),
                })
        out.append({
            "id": row.get("id", ""),
            "_uid": row.get("_uid", ""),
            "type": row.get("type", ""),
            "name": names.get(row.get("_uid") or "") or names.get(row.get("id") or "", ""),
            "binding": row.get("binding") or "",
            "status": row.get("status", ""),
            "seed": row.get("seed"),
            "error": row.get("error"),
            "writes": writes,
            "refs": refs.get(str(row.get("_uid") or ""), []),
        })
    return out


def _slim_warning(w: Any) -> dict[str, Any]:
    if not isinstance(w, dict):
        return {"type": "unknown", "message": str(w)}
    return {k: _json_value(v) for k, v in w.items()}


def _option_id_by_value(modules: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    """module id → {option value → option id}, for counting multi-pick
    records (which carry values, not ids) against their options."""
    table: dict[str, dict[str, str]] = {}
    for m in modules:
        if not isinstance(m, dict) or m.get("type") != "wildcard":
            continue
        payload = m.get("payload")
        options = payload.get("options") if isinstance(payload, dict) else None
        if not isinstance(options, list):
            continue
        by_value: dict[str, str] = {}
        for opt in options:
            if isinstance(opt, dict) and isinstance(opt.get("id"), str):
                by_value.setdefault(str(opt.get("value", "")), opt["id"])
        table[str(m.get("id", ""))] = by_value
    return table


def run_scenario(
    modules: list[dict[str, Any]],
    *,
    seeds: list[int],
    catalog: dict[str, Any] | None = None,
    pins: dict[str, str] | None = None,
    sample_limit: int = DEFAULT_SAMPLE_LIMIT,
    value_limit: int = DEFAULT_VALUE_LIMIT,
) -> dict[str, Any]:
    """Run ``modules`` once per seed and summarise the results.

    ``pins`` are written into the context before each run, exactly like
    values arriving from an upstream Context node; a module in the stack that
    writes the same variable replaces the pin, as it would at run time.

    A seed whose run raises is recorded as a failed sample (and counted in
    ``failed``) rather than aborting the whole scenario.
    """
    catalog = catalog or {}
    pins = {str(k): str(v) for k, v in (pins or {}).items()}
    option_ids = _option_id_by_value(modules)
    names: dict[str, str] = {}
    for m in modules:
        if isinstance(m, dict):
            meta = m.get("meta") if isinstance(m.get("meta"), dict) else {}
            name = str(m.get("name") or meta.get("name") or "")
            for key in (m.get("_uid"), m.get("id")):
                if isinstance(key, str) and key:
                    names.setdefault(key, name)

    var_counts: dict[str, Counter[str]] = {}
    pick_counts: dict[str, Counter[str]] = {}
    constraint_hits: Counter[str] = Counter()
    warnings: dict[tuple[str, str], dict[str, Any]] = {}
    internal_vars: set[str] = set()
    samples: list[dict[str, Any]] = []
    failed = 0

    started = time.perf_counter()
    for seed in seeds:
        ctx: dict[str, Any] = dict(pins)
        ctx["__wp_catalog__"] = catalog
        # Ask the resolver to record nested @{ref} picks for the trace.
        ctx["__wp_ref_log__"] = []
        try:
            # The engine mutates module dicts in places (coercion, per-run
            # stamps); a deep copy keeps every seed starting from the same
            # stack.
            ctx = PipelineEngine().run(copy.deepcopy(modules), ctx=ctx, seed=seed)
        except Exception as exc:  # noqa: BLE001 - one bad seed must not sink the run
            failed += 1
            if len(samples) < sample_limit:
                samples.append({
                    "seed": seed, "vars": {}, "trace": [], "warnings": [],
                    "error": f"{type(exc).__name__}: {exc}",
                })
            continue

        resolved = strip_engine_internals(ctx)
        flags = ctx.get("__wp_internal_flags__")
        if isinstance(flags, dict):
            internal_vars.update(k for k, v in flags.items() if v)
        for name, value in resolved.items():
            var_counts.setdefault(name, Counter())[_render(value)] += 1

        picks = ctx.get("__wp_picks__")
        if isinstance(picks, dict):
            for mid, entry in picks.items():
                if not isinstance(entry, dict):
                    continue
                bucket = pick_counts.setdefault(str(mid), Counter())
                if isinstance(entry.get("values"), list):
                    lookup = option_ids.get(str(mid), {})
                    for v in entry["values"]:
                        bucket[lookup.get(str(v), str(v))] += 1
                elif entry.get("id") is not None:
                    bucket[str(entry["id"])] += 1

        # Nested @{ref} picks count toward their wildcard's option counts
        # too, so a wildcard reached only through refs still shows up.
        ref_log = ctx.get("__wp_ref_log__")
        if isinstance(ref_log, list):
            for row in ref_log:
                if isinstance(row, dict) and row.get("uuid"):
                    oid = row.get("option_id")
                    key = str(oid) if oid is not None else str(row.get("raw", ""))
                    pick_counts.setdefault(str(row["uuid"]), Counter())[key] += 1

        hits = ctx.get("__wp_constraint_hits__")
        if isinstance(hits, dict):
            for cid, n in hits.items():
                constraint_hits[str(cid)] += int(n or 0)

        sample_warnings = [_slim_warning(w) for w in ctx.get("__wp_warnings__") or []]
        for w in sample_warnings:
            key = (str(w.get("type", "")), str(w.get("message", "")))
            group = warnings.get(key)
            if group is None:
                group = warnings[key] = {**w, "count": 0, "seeds": []}
            group["count"] += 1
            if seed not in group["seeds"] and len(group["seeds"]) < _WARNING_SEED_LIMIT:
                group["seeds"].append(seed)

        if len(samples) < sample_limit:
            samples.append({
                "seed": seed,
                "vars": {k: _json_value(v) for k, v in resolved.items()},
                "trace": _slim_trace(
                    ctx.get("__wp_trace__"), names, _refs_by_owner(ctx.get("__wp_ref_log__")),
                ),
                "warnings": sample_warnings,
                "error": None,
            })
    elapsed_ms = round((time.perf_counter() - started) * 1000, 1)

    variables: dict[str, Any] = {}
    for name, counts in var_counts.items():
        ranked = counts.most_common()
        kept = ranked[:value_limit]
        variables[name] = {
            "counts": dict(kept),
            "distinct": len(ranked),
            "other": sum(n for _, n in ranked[value_limit:]),
            "internal": name in internal_vars,
        }

    return {
        "runs": len(seeds),
        "failed": failed,
        "elapsed_ms": elapsed_ms,
        "seeds": {"first": seeds[0] if seeds else None, "count": len(seeds)},
        "variables": variables,
        "picks": {mid: dict(c) for mid, c in pick_counts.items()},
        "constraint_hits": dict(constraint_hits),
        "warnings": sorted(warnings.values(), key=lambda g: -g["count"]),
        "samples": samples,
    }
