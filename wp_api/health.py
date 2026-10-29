"""/wp/api/health — the Library health page.

``POST /wp/api/health/scan`` runs `engine.health.scan_library` over the whole
library. The body carries what an open canvas tab told the manager (library
ids it uses, variables it sets and reads); ``canvas`` is null when no canvas
answered, so "not used" says it couldn't look.

``PUT /wp/api/health/ignored`` adds or removes ignored finding keys; the scan
response lists them so the page can hide or show them.

``POST /wp/api/health/variety`` runs one bundle over N random seeds (the Test
Runner's stack runner) and sums up how varied its prompts are.
"""
from __future__ import annotations

import asyncio
import sqlite3
from datetime import datetime, timezone
from typing import Any

from aiohttp import web

from engine import health
from engine.db.repositories import (
    BundleRepository,
    CategoryRepository,
    ModuleRepository,
    TemplateRepository,
)
from engine.scenario import ScenarioError, resolve_seeds, run_scenario
from wp_api._helpers import db_session, json_error, json_ok
from wp_api.test_runner import _build_catalog, _build_stack

#: Seeds the variety check runs when the body doesn't say.
VARIETY_SEEDS = 200
MAX_VARIETY_SEEDS = 1000
#: Most ignored keys one request may add or remove.
MAX_KEYS = 500
MAX_KEY_LEN = 300


def _str_list(value: Any, limit: int = 5000) -> list[str] | None:
    if not isinstance(value, list):
        return None
    return [v for v in value if isinstance(v, str) and v][:limit]


def _ignored(conn: sqlite3.Connection) -> list[str]:
    try:
        rows = conn.execute("SELECT key FROM health_ignored ORDER BY created_at").fetchall()
    except sqlite3.OperationalError:
        return []
    return [r[0] for r in rows]


def _newer_format_ids(conn: sqlite3.Connection) -> list[str]:
    out: list[str] = []
    for table in ("modules", "bundles"):
        try:
            rows = conn.execute(
                f"SELECT id FROM {table} WHERE tolerant_drift_status = 'tolerant'"
            ).fetchall()
        except sqlite3.OperationalError:
            continue  # pre-014 database
        out.extend(r[0] for r in rows)
    return out


async def scan_route(request: web.Request) -> web.Response:
    body: Any = {}
    if request.body_exists:
        try:
            body = await request.json()
        except Exception:
            return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    canvas = body.get("canvas")
    if canvas is not None and not isinstance(canvas, dict):
        return json_error("canvas must be an object or null", status=400)

    with db_session(request) as conn:
        modules = ModuleRepository(conn).list()
        bundles = BundleRepository(conn).list()
        templates = TemplateRepository(conn).list()
        categories = CategoryRepository(conn).list()
        newer = _newer_format_ids(conn)
        ignored = _ignored(conn)

    kwargs: dict[str, Any] = {"newer_format_ids": newer}
    if canvas is not None:
        kwargs["canvas_ids"] = _str_list(canvas.get("ids")) or []
        kwargs["canvas_vars"] = _str_list(canvas.get("vars")) or []
        kwargs["canvas_reads"] = _str_list(canvas.get("reads")) or []
    findings = await asyncio.to_thread(
        health.scan_library, modules, bundles, templates, categories, **kwargs,
    )
    return json_ok({
        "findings": findings,
        "ignored": ignored,
        "counts": health.counts(findings, ignored),
        "checks": [
            {"id": cid, "severity": sev, "title": title}
            for cid, (sev, title) in health.CHECKS.items()
        ],
        "canvas": canvas is not None,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    })


async def ignored_route(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    add = _str_list(body.get("add") or [], MAX_KEYS)
    remove = _str_list(body.get("remove") or [], MAX_KEYS)
    if add is None or remove is None:
        return json_error("add and remove must be lists of finding keys", status=400)
    if any(len(k) > MAX_KEY_LEN for k in (*add, *remove)):
        return json_error(f"a finding key is longer than {MAX_KEY_LEN} characters", status=400)
    now = datetime.now(timezone.utc).isoformat()
    with db_session(request) as conn:
        with conn:
            conn.executemany(
                "INSERT OR IGNORE INTO health_ignored (key, created_at) VALUES (?, ?)",
                [(k, now) for k in add],
            )
            conn.executemany("DELETE FROM health_ignored WHERE key = ?", [(k,) for k in remove])
        return json_ok({"ignored": _ignored(conn)})


def summarize_variety(modules: list[dict[str, Any]], result: dict[str, Any]) -> dict[str, Any]:
    """Distinct prompts, stuck variables and never-picked options from a
    `run_scenario` result over a bundle's children."""
    samples = [s for s in result.get("samples") or [] if not s.get("error")]
    internal = {k for k, v in (result.get("variables") or {}).items() if v.get("internal")}
    combos = {
        tuple(sorted((k, str(v)) for k, v in (s.get("vars") or {}).items() if k not in internal))
        for s in samples
    }
    variables = result.get("variables") or {}
    picks = result.get("picks") or {}
    stuck: list[dict[str, Any]] = []
    never: list[dict[str, Any]] = []
    for m in modules:
        if m.get("type") != "wildcard" or not m.get("enabled", True):
            continue
        p = m.get("payload") if isinstance(m.get("payload"), dict) else {}
        live = [o for o in p.get("options") or []
                if isinstance(o, dict) and not o.get("is_null")
                and str(o.get("value") or "").strip() and health._weight(o) > 0]
        name = str((m.get("meta") or {}).get("name") or m.get("name") or "")
        var = str(p.get("var_binding") or "")
        info = variables.get(var)
        if len(live) > 1 and info and info.get("distinct") == 1:
            value = next(iter(info.get("counts") or {}), "")
            stuck.append({"var": var, "name": name, "value": value})
        counts: dict[str, int] = {}
        for key in (m.get("_uid"), m.get("id")):
            if isinstance(key, str) and isinstance(picks.get(key), dict):
                counts = picks[key]
                break
        if not counts:
            continue
        missed = [str(o.get("value")) for o in live if not counts.get(str(o.get("id")))]
        if missed:
            never.append({"id": m.get("id"), "name": name, "options": missed[:20],
                          "count": len(missed), "total": len(live)})
    runs = int(result.get("runs") or 0)
    return {
        "runs": runs,
        "failed": int(result.get("failed") or 0),
        "distinct": len(combos),
        "ratio": round(len(combos) / runs, 3) if runs else 0,
        "stuck": stuck,
        "never_picked": never,
        "warnings": [
            {"type": w.get("type"), "message": w.get("message"), "count": w.get("count")}
            for w in (result.get("warnings") or [])[:8]
        ],
    }


async def variety_route(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict) or not isinstance(body.get("bundle_id"), str):
        return json_error("bundle_id is required", status=400)
    count = body.get("seeds", VARIETY_SEEDS)
    if not isinstance(count, int) or isinstance(count, bool) or not 1 <= count <= MAX_VARIETY_SEEDS:
        return json_error(f"seeds must be 1 to {MAX_VARIETY_SEEDS}", status=400)
    try:
        seeds = resolve_seeds({"random": True, "count": count})
        with db_session(request) as conn:
            modules, _layout, missing = _build_stack(conn, [{"bundle": body["bundle_id"]}])
            catalog = _build_catalog(conn, modules)
    except ScenarioError as exc:
        return json_error(str(exc), status=400)
    if missing:
        return json_error("bundle not found", status=404)
    result = await asyncio.to_thread(
        run_scenario, modules, seeds=seeds, catalog=catalog, sample_limit=count,
    )
    return json_ok(summarize_variety(modules, result))


def register(router) -> None:
    router.add_post("/wp/api/health/scan", scan_route)
    router.add_put("/wp/api/health/ignored", ignored_route)
    router.add_post("/wp/api/health/variety", variety_route)
