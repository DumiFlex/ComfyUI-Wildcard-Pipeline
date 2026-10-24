"""Score the Draft with AI panels against a model, offline.

Sends fixed requests to the real panel routes (`/wp/api/ai/wildcard/draft`,
`wildcard/edit`, `derivation/draft`, `text/draft`, `constraint/draft`,
`describe`, `organize`) on a COPY of a library database, with the model
saved under Settings › AI assistant (also copied). Four small wildcards
(hair color, hair style, weather, outfit) are added to the copy first, so
the same requests work on an empty library (``--empty``) and a full one.

Each request is scored on:

- ok: the route answered 200 with something usable;
- check: the answer does what the request asked (count met, tags set, the
  variables named are used, the catch-all is there…);
- dupes: options the route dropped as repeats;
- calls: model requests the route made (a re-ask or repair is a second);
- seconds, prompt / output / thinking tokens (from the server's usage, when
  it reports them).

Requests carry an ``X-WP-Progress`` id the way the browser does, so the
answer streams and the thinking watchdog runs as it would in the editor.

Use it before and after a panel change, the way `ai_chat_evals.py` is used
for the chat; read a change as real only past the run-to-run noise (two
runs, two seeds). It is not part of CI: it needs a running model.

USAGE
-----
    python scripts/ai_panel_evals.py --db PATH [--runs 2] [--only NAME,...]
        [--model NAME] [--seed 42] [--empty] [--thinking auto|on|off]
        [--sampling top_k=20,top_p=0.8] [--note ...] [--out panel-evals.md]

Writes the report and a ``.json`` beside it with every request's answer.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import sys
import tempfile
import time
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

#: The wildcards every run adds to its copy, by key. Ids are fixed so the
#: constraint and organize requests can name them.
FIXTURES: dict[str, dict[str, Any]] = {
    "hair_color": {"id": "e7a10001", "name": "Eval hair color", "payload": {
        "var_binding": "eval_hair_color", "sub_categories": ["warm", "cool"],
        "tag_groups": {"TONE": ["warm", "cool"]},
        "options": [
            {"id": "c0000001", "value": "red hair", "weight": 1, "sub_categories": ["warm"]},
            {"id": "c0000002", "value": "blonde hair", "weight": 1, "sub_categories": ["warm"]},
            {"id": "c0000003", "value": "blue hair", "weight": 1, "sub_categories": ["cool"]},
            {"id": "c0000004", "value": "silver hair", "weight": 1, "sub_categories": ["cool"]},
        ]}},
    "hair_style": {"id": "e7a10002", "name": "Eval hair style", "payload": {
        "var_binding": "eval_hair_style", "sub_categories": [], "tag_groups": {},
        "options": [
            {"id": "s0000001", "value": "ponytail", "weight": 1, "sub_categories": []},
            {"id": "s0000002", "value": "pixie cut", "weight": 1, "sub_categories": []},
            {"id": "s0000003", "value": "long wavy hair", "weight": 1, "sub_categories": []},
            {"id": "s0000004", "value": "bob cut", "weight": 1, "sub_categories": []},
            {"id": "s0000005", "value": "very long straight hair", "weight": 1,
             "sub_categories": []},
            {"id": "s0000006", "value": "buzz cut", "weight": 1, "sub_categories": []},
        ]}},
    "weather": {"id": "e7a10003", "name": "Eval weather", "payload": {
        "var_binding": "eval_weather", "sub_categories": ["wet", "dry"],
        "tag_groups": {"WETNESS": ["wet", "dry"]},
        "options": [
            {"id": "w0000001", "value": "heavy rain", "weight": 1, "sub_categories": ["wet"]},
            {"id": "w0000002", "value": "light drizzle", "weight": 1, "sub_categories": ["wet"]},
            {"id": "w0000003", "value": "clear sunny sky", "weight": 1,
             "sub_categories": ["dry"]},
            {"id": "w0000004", "value": "overcast", "weight": 1, "sub_categories": ["dry"]},
        ]}},
    "outfit": {"id": "e7a10004", "name": "Eval outfit", "payload": {
        "var_binding": "eval_outfit", "sub_categories": ["rainwear", "summer"],
        "tag_groups": {"SEASON": ["rainwear", "summer"]},
        "options": [
            {"id": "o0000001", "value": "yellow raincoat", "weight": 1,
             "sub_categories": ["rainwear"]},
            {"id": "o0000002", "value": "rubber boots and poncho", "weight": 1,
             "sub_categories": ["rainwear"]},
            {"id": "o0000003", "value": "sundress", "weight": 1, "sub_categories": ["summer"]},
            {"id": "o0000004", "value": "tank top and shorts", "weight": 1,
             "sub_categories": ["summer"]},
        ]}},
}


def _wc(key: str, *, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """A fixture as the wildcard editor sends it."""
    f = FIXTURES[key]
    return {"id": f["id"], "name": f["name"], "var_binding": f["payload"]["var_binding"],
            "payload": payload if payload is not None else f["payload"]}


def _values(out: dict[str, Any]) -> list[str]:
    return [o["value"].lower() for o in out.get("options") or []]


def _changed_ids(out: dict[str, Any]) -> set[str]:
    return {c.get("option_id") for c in out.get("changes") or []}


def _rules(out: dict[str, Any]) -> list[dict[str, Any]]:
    return [x["rule"] for x in out.get("rules") or []]


def _rule_text(out: dict[str, Any]) -> str:
    return json.dumps(_rules(out)).lower()


def _template(out: dict[str, Any]) -> str:
    p = out.get("payload") or {}
    return str(p.get("template") or p.get("template_string") or "")


#: One request per entry: ``route`` (after /wp/api/ai/), ``body``, and a
#: ``check`` on the 200 answer that returns "" when it holds, else why not.
REQUESTS: list[dict[str, Any]] = [
    {"name": "add-3", "panel": "Add", "route": "wildcard/draft",
     "body": {"instruction": "3 more hair colors", "count": 3, "wildcard": _wc("hair_color")},
     "check": lambda o: "" if len(o["options"]) == 3 else f"{len(o['options'])} of 3"},
    {"name": "add-tagged", "panel": "Add", "route": "wildcard/draft",
     "body": {"instruction": "4 more cool-toned hair colors, tagged cool", "count": 4,
              "wildcard": _wc("hair_color")},
     "check": lambda o: (f"{len(o['options'])} of 4" if len(o["options"]) != 4 else
                         "" if all("cool" in x["tags"] for x in o["options"])
                         else "not all tagged cool")},
    {"name": "add-new", "panel": "Add", "route": "wildcard/draft",
     "body": {"instruction": "8 kinds of weather for outdoor scenes", "count": 8,
              "wildcard": {"name": "Sky", "var_binding": "sky",
                           "payload": {"options": [], "sub_categories": [],
                                       "tag_groups": {}}}},
     "check": lambda o: "" if len(o["options"]) == 8 else f"{len(o['options'])} of 8"},
    {"name": "add-negative", "panel": "Add", "route": "wildcard/draft",
     "body": {"instruction": "3 rainy weather options, each with a negative prompt that "
                             "keeps sunshine out", "count": 3, "wildcard": _wc("weather")},
     "check": lambda o: (f"{len(o['options'])} of 3" if len(o["options"]) != 3 else
                         "" if all(x["negative"] for x in o["options"]) else "a negative missing")},
    {"name": "add-many", "panel": "Add", "route": "wildcard/draft",
     "body": {"instruction": "20 hair styles, short and long mixed", "count": 20,
              "wildcard": _wc("hair_style")},
     "check": lambda o: "" if len(o["options"]) >= 18 else f"{len(o['options'])} of 20"},
    {"name": "edit-retag", "panel": "Retag", "route": "wildcard/edit",
     "body": {"action": "retag", "instruction": "tag each one short or long by hair length",
              "wildcard": _wc("hair_style")},
     "check": lambda o: ("" if len(o["changes"]) == 6 and all(
         {"short", "long"} & set(c["after"]["tags"]) for c in o["changes"])
         else f"{len(o['changes'])} of 6 tagged")},
    {"name": "edit-remove", "panel": "Remove", "route": "wildcard/edit",
     "body": {"action": "remove", "instruction": "remove the short styles",
              "wildcard": _wc("hair_style")},
     "check": lambda o: ("" if _changed_ids(o) == {"s0000002", "s0000004", "s0000006"}
                         else f"removed {sorted(_changed_ids(o))}")},
    {"name": "edit-reweight", "panel": "Weights", "route": "wildcard/edit",
     "body": {"action": "reweight", "instruction": "make the wet weather twice as likely",
              "wildcard": _wc("weather")},
     "check": lambda o: ("" if _changed_ids(o) == {"w0000001", "w0000002"} and all(
         c["after"]["weight"] == 2 for c in o["changes"])
         else f"changed {sorted(_changed_ids(o))}")},
    {"name": "edit-rewrite", "panel": "Rewrite", "route": "wildcard/edit",
     "body": {"action": "rewrite", "instruction": "rewrite each as short danbooru-style tags",
              "wildcard": _wc("outfit")},
     # "yellow raincoat" and "sundress" are tags already, so only the two
     # phrases with "and" must change.
     "check": lambda o: ("" if {"o0000002", "o0000004"} <= _changed_ids(o)
                         else f"rewrote {sorted(_changed_ids(o))}")},
    {"name": "derive-else", "panel": "Derivation", "route": "derivation/draft",
     "body": {"instruction": "if $eval_weather is heavy rain set $mood to gloomy, "
                             "otherwise set $mood to cheerful",
              "derivation": {"name": "Mood from weather", "rules": []}},
     "check": lambda o: ("no rules" if not _rules(o) else
                         "" if any(isinstance(r.get("else"), dict) or r.get("else_actions")
                                   for r in _rules(o)) else "no catch-all")},
    {"name": "derive-contains", "panel": "Derivation", "route": "derivation/draft",
     "body": {"instruction": "when $eval_weather contains rain, append umbrella to $props",
              "derivation": {"name": "Rain props", "rules": []}},
     "check": lambda o: ("no rules" if not _rules(o) else
                         "" if "umbrella" in _rule_text(o) and "props" in _rule_text(o)
                         else "umbrella or $props missing")},
    {"name": "derive-and", "panel": "Derivation", "route": "derivation/draft",
     "body": {"instruction": "if $eval_weather has the wet tag and $eval_outfit is sundress, "
                             "set $scene_note to soaked dress",
              "derivation": {"name": "Soaked", "rules": []}},
     "check": lambda o: ("no rules" if not _rules(o) else
                         "" if "eval_outfit" in _rule_text(o) and "eval_weather" in _rule_text(o)
                         else "a condition missing")},
    {"name": "text-fixed", "panel": "Fixed values", "route": "text/draft",
     "body": {"kind": "fixed_values", "instruction": "a cozy bedroom: $room is bedroom and "
                                                     "$light is warm lamp light",
              "item": {"name": "Cozy room", "payload": {"values": []}}},
     "check": lambda o: ("" if {"room", "light"} <= {v.get("name") for v in
                                                    o["payload"].get("values") or []}
                         else "a value missing")},
    {"name": "text-combine", "panel": "Combine", "route": "text/draft",
     "body": {"kind": "combine", "instruction": "join $eval_hair_color and $eval_hair_style "
                                                "into one phrase",
              "item": {"name": "Hair", "payload": {"output_var": "hair", "template": ""}}},
     "check": lambda o: ("" if "$eval_hair_color" in _template(o)
                         and "$eval_hair_style" in _template(o) else "a variable missing")},
    {"name": "text-template", "panel": "Template", "route": "text/draft",
     "body": {"kind": "template", "instruction": "a portrait prompt using $eval_hair_color, "
                                                 "$eval_hair_style and $eval_weather",
              "item": {"name": "Portrait", "template_string": ""}},
     "check": lambda o: ("" if all(v in _template(o) for v in
                                   ("$eval_hair_color", "$eval_hair_style", "$eval_weather"))
                         else "a variable missing")},
    {"name": "constraint", "panel": "Constraint", "route": "constraint/draft",
     "body": {"instruction": "when the weather is wet, never pick summer clothes",
              "constraint": {"source_wildcard_id": "e7a10003",
                             "target_wildcard_id": "e7a10004"}},
     "check": lambda o: ("" if o.get("cells") or any(
         e["exception"]["target"] in ("sundress", "tank top and shorts")
         for e in o.get("exceptions") or []) else "no rule")},
    {"name": "describe", "panel": "Describe", "route": "describe",
     "body": {"kind": "wildcard", "name": "Eval weather",
              "payload": FIXTURES["weather"]["payload"]},
     "check": lambda o: "" if (o.get("description") or "").strip() else "no description"},
    {"name": "organize", "panel": "Organize", "route": "organize",
     "body": {"instruction": "put the hair items in a category named Hair",
              "items": [{"kind": "module", "id": FIXTURES[k]["id"]}
                        for k in ("hair_color", "hair_style", "weather")]},
     "check": lambda o: ("" if {c["id"] for c in o.get("changes") or []
                                if (c.get("category") or {}).get("name", "").lower() == "hair"}
                         == {"e7a10001", "e7a10002"} else "hair items not both filed")},
]


def seed_fixtures(db: Path) -> None:
    from engine.db.connection import get_connection
    from engine.db.repositories import ModuleRepository

    conn = get_connection(db)
    repo = ModuleRepository(conn)
    for f in FIXTURES.values():
        repo.create(type="wildcard", name=f["name"], description="", category_id=None,
                    tags=[], payload=f["payload"], id=f["id"])
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()


#: Every model request of the request being served: (seconds, usage).
_CALLS: list[dict[str, Any]] = []


def record_calls() -> None:
    """Wrap `_ai_client._answer` so each model request's time and usage
    are kept in `_CALLS`."""
    from wp_api import _ai_chat, _ai_client

    plain = _ai_client._answer

    async def timed(cfg: dict[str, Any], path: str, body: dict[str, Any], kind: str,
                    meter: Any = None) -> Any:
        started = time.perf_counter()
        entry: dict[str, Any] = {"seconds": 0.0, "usage": {},
                                 "thinking_off": any(k in body for k in (
                                     "reasoning_effort", "chat_template_kwargs", "think"))}
        _CALLS.append(entry)
        try:
            # Builds before the thinking watchdog take no meter.
            data = await (plain(cfg, path, body, kind, meter) if meter is not None
                          else plain(cfg, path, body, kind))
        finally:
            entry["seconds"] = round(time.perf_counter() - started, 1)
        if isinstance(data, dict):
            usage = {"openai": _ai_chat._usage_openai, "ollama": _ai_chat._usage_ollama,
                     "anthropic": _ai_chat._usage_anthropic}.get(kind)
            if usage is not None:
                entry["usage"] = usage(data)
        return data

    _ai_client._answer = timed  # type: ignore[assignment]


async def run_request(client: Any, rq: dict[str, Any]) -> dict[str, Any]:
    _CALLS.clear()
    started = time.perf_counter()
    resp = await client.post(f"/wp/api/ai/{rq['route']}", json=rq["body"],
                             headers={"X-WP-Progress": uuid.uuid4().hex[:16]})
    seconds = round(time.perf_counter() - started, 1)
    try:
        out = await resp.json()
    except Exception:  # noqa: BLE001 - a non-JSON error page
        out = {"error": await resp.text()}
    data = out.get("data", out) if isinstance(out, dict) else {}
    row: dict[str, Any] = {
        "name": rq["name"], "panel": rq["panel"], "status": resp.status,
        "seconds": seconds, "calls": len(_CALLS),
        "prompt": sum(c["usage"].get("prompt", 0) for c in _CALLS),
        "output": sum(c["usage"].get("output", 0) for c in _CALLS),
        "thought": sum(c["usage"].get("thought", 0) for c in _CALLS),
        "thinking_off": all(c["thinking_off"] for c in _CALLS) if _CALLS else None,
        "call_seconds": [c["seconds"] for c in _CALLS],
    }
    if resp.status != 200:
        err = out.get("error") if isinstance(out, dict) else out
        row.update(ok=False, check=str(err.get("message") if isinstance(err, dict) else err)[:120])
        return row
    try:
        why = rq["check"](data)
    except Exception as e:  # noqa: BLE001 - a malformed answer fails its check
        why = f"check failed: {type(e).__name__}: {e}"[:120]
    skipped = data.get("skipped") or []
    row.update(ok=True, check=why, passed=not why,
               dupes=sum(1 for s in skipped if str(s.get("reason", "")).startswith("duplicate")),
               skipped=[f"{s.get('text', '')[:40]}: {s.get('reason')}" for s in skipped][:8],
               warnings=list(data.get("warnings") or [])[:8], answer=data.get("answer"))
    return row


async def evaluate(requests: list[dict[str, Any]], runs: int, *,
                   fresh: Callable[[], None], seed: int | None,
                   partial: Callable[[list[dict[str, Any]]], None]) -> list[dict[str, Any]]:
    from aiohttp import ClientTimeout, web
    from aiohttp.test_utils import TestClient, TestServer

    import wp_api
    from scripts import ai_chat_evals as chat

    wp_api._start_backups = lambda: None  # type: ignore[attr-defined]
    app = web.Application(client_max_size=32 * 1024 * 1024)
    wp_api.register_routes(app)
    rows: list[dict[str, Any]] = []
    async with TestClient(TestServer(app), timeout=ClientTimeout(None)) as client:
        for run in range(1, runs + 1):
            for i, rq in enumerate(requests):
                fresh()
                if seed is not None:
                    chat._SEED[0] = seed + 1000 * run + i
                print(f"run {run} · {rq['name']}", flush=True)
                rows.append({"run": run, **await run_request(client, rq)})
                partial(rows)
    return rows


def report(rows: list[dict[str, Any]], model: str, note: str) -> str:
    done = [r for r in rows if r["ok"]]

    def mean(key: str, of: list[dict[str, Any]]) -> float:
        return sum(r[key] for r in of) / len(of) if of else 0

    lines = [
        f"# Panel evals: {model}", "", note, "",
        f"- Requests: {len(rows)}; answered: {len(done)}; checks passed: "
        f"{sum(1 for r in done if r['passed'])} / {len(rows)}",
        f"- Seconds per request: {mean('seconds', rows):.1f} (max "
        f"{max((r['seconds'] for r in rows), default=0):.0f})",
        f"- Model calls per request: {mean('calls', rows):.2f}",
        f"- Tokens per request: prompt {mean('prompt', rows):.0f}, output "
        f"{mean('output', rows):.0f}, thinking {mean('thought', rows):.0f}",
        f"- Duplicates dropped: {sum(r.get('dupes', 0) for r in done)}", "",
        "| Panel | Request | Run | OK | Check | s | Calls | Prompt | Output | Thought |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in rows:
        check = ("yes" if r.get("passed") else f"NO: {r['check']}") if r["ok"] else ""
        ok = "yes" if r["ok"] else f"{r['status']}: {r['check']}"
        lines.append(f"| {r['panel']} | {r['name']} | {r['run']} | {ok[:70]} | {check[:70]} | "
                     f"{r['seconds']} | {r['calls']} | {r['prompt']} | {r['output']} | "
                     f"{r['thought']} |")
    by_panel: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        by_panel.setdefault(r["panel"], []).append(r)
    lines += ["", "| Panel | Passed | s (mean) | Thinking tokens (mean) |",
              "| --- | --- | --- | --- |"]
    for panel, rs in by_panel.items():
        lines.append(f"| {panel} | {sum(1 for r in rs if r.get('passed'))}/{len(rs)} | "
                     f"{mean('seconds', rs):.1f} | {mean('thought', rs):.0f} |")
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--db", default="", help="library database to copy")
    ap.add_argument("--empty", action="store_true",
                    help="start from an empty library (only the eval's own wildcards)")
    ap.add_argument("--runs", type=int, default=2)
    ap.add_argument("--only", default="", help="request names, comma-separated")
    ap.add_argument("--model", default="")
    ap.add_argument("--thinking", default="", help="Settings › AI › Thinking for the copy")
    ap.add_argument("--sampling", default="", help="name=value,… (Settings › AI › Sampling)")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--note", default="", help="model, chat template, commit")
    ap.add_argument("--out", default="panel-evals.md")
    args = ap.parse_args()

    from engine.ai import config as ai_config
    from engine.db.connection import get_connection, resolve_db_path
    from engine.db.migrations import migrate
    from scripts import ai_chat_evals as chat

    src_db = Path(args.db) if args.db else resolve_db_path()
    src_cfg = ai_config.config_path()
    work = Path(tempfile.mkdtemp(prefix="wp-panel-eval-"))
    if not args.empty and src_db.exists():
        shutil.copy2(src_db, work / "library.db")
    conn = get_connection(work / "library.db")
    migrate(conn)
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    seed_fixtures(work / "library.db")
    if src_cfg.exists():
        shutil.copy2(src_cfg, work / "ai.json")
    os.environ["WP_DB_PATH"] = str(work / "library.db")
    os.environ["WP_AI_CONFIG_PATH"] = str(work / "ai.json")
    os.environ["WP_SETTINGS_PATH"] = str(work / "wp-settings.json")
    patch: dict[str, Any] = {}
    if args.model:
        patch["model"] = args.model
    if args.thinking:
        patch["thinking"] = args.thinking
    if args.sampling:
        patch["sampling"] = chat.parse_sampling(args.sampling)
    if patch:
        ai_config.update(patch)
    cfg = ai_config.load_effective()
    if not cfg.get("enabled") or not cfg.get("model"):
        print("The AI assistant is off or has no model. Set it up under Settings › AI "
              "assistant, or pass --model.")
        return 0
    chat.seed_requests(args.seed if args.seed is not None else 0)
    if args.seed is None:
        chat._SEED[0] = None
    record_calls()
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    requests = [r for r in REQUESTS if not only or r["name"] in only]
    print(f"Library copy and settings in {work}; model {cfg['model']}; thinking "
          f"{cfg.get('thinking', 'auto')}; seed {args.seed}"
          + ("; empty library" if args.empty else ""), flush=True)

    def write(rows: list[dict[str, Any]]) -> None:
        Path(args.out).write_text(report(rows, cfg["model"], args.note), encoding="utf-8")
        Path(args.out).with_suffix(".json").write_text(
            json.dumps(rows, indent=2, ensure_ascii=False, default=str), encoding="utf-8")

    asyncio.run(evaluate(requests, args.runs, fresh=chat.fresh_copy(work), seed=args.seed,
                         partial=write))
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
