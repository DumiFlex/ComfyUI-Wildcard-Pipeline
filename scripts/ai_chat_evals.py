"""Score the chat assistant against a model, offline.

Runs scripted chats through the real chat route (`POST /wp/api/ai/chat`) on
a COPY of a library database, with the model saved under Settings › AI
assistant (also copied, so nothing the run does reaches your settings).
Paused calls get canned answers: page tools say what a page would, web
searches are declined, questions are answered with their first choice.

Each turn is scored on:

- cards: cards in the answer, and repeats (two cards with the same title);
- errors: tool calls that failed;
- tests: run_test calls, and how many ran (not "nothing to run");
- did: whether the turn used what the scenario asks for (``expect``) and
  made no cards where none were asked for;
- claims: the answer says it made or proposed a kind of item whose call
  failed and has no card, or the server had to add "nothing was proposed".

Use it after a chat change, the way `ai_pack_evals.py` is used for the pack
builder; score each scenario by its average over several runs (``--runs``).
It is not part of CI: it needs a running model.

USAGE
-----
    python scripts/ai_chat_evals.py --db PATH [--runs 3] [--only NAME,...]
        [--model NAME] [--out chat-evals.md]

``--db`` is the library to copy (default: the one ComfyUI would open).
Writes the report and a ``.json`` beside it with every turn's answer,
steps and cards. Record the model AND its chat template with each round.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import shutil
import sys
import tempfile
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

#: Scripted chats. ``turns`` are the user's messages, in one chat; ``expect``
#: per turn: tools the turn should call (any one of a tuple), ``[]`` for a
#: turn that should make no cards.
SCENARIOS: list[dict[str, Any]] = [
    {"name": "ideas", "page": {"route": "/library"},
     "turns": ["What could I add to my library?"],
     "expect": [None]},
    {"name": "hair", "page": {"route": "/library"},
     "turns": ["Make a hair colour wildcard with about 8 colours and test it."],
     "expect": [["create_wildcard", "run_test"]]},
    {"name": "season-outfit", "page": {"route": "/library"},
     "turns": ["Make a Season wildcard and an Outfit wildcard, then a constraint so "
               "winter never gets sandals or shorts."],
     "expect": [["create_wildcard", "create_constraint"]]},
    {"name": "explain", "page": {"route": "/library"},
     "turns": ["How do constraints work? Keep it short."],
     "expect": [[]]},
    {"name": "title", "page": {"route": "/library"},
     "turns": ["Make a Class wildcard (mage, warrior, rogue) and a derivation that sets "
               "$title: mages are Archmage, warriors Champion, anyone else Adventurer."],
     "expect": [["create_wildcard", "create_derivation"]]},
    {"name": "weather-followup", "page": {"route": "/library"},
     "turns": ["Make a weather wildcard.",
               "Now add negatives to the stormy options so the sky isn't sunny.",
               "Test it."],
     "expect": [["create_wildcard"], [("edit_options", "create_wildcard")], ["run_test"]]},
    {"name": "loop-cues", "page": {"route": "/library"},
     "turns": ["In a Context Loop, I want the first image to say 'establishing shot' and "
               "every later one 'close-up'. Make that and check it works."],
     "expect": [["create_derivation", "run_test"]]},
    {"name": "test-lighting", "page": {"route": "/library"},
     "turns": ["Test my Lighting wildcard."],
     "expect": [["run_test"]]},
]

#: What a page tool answers in the eval (no browser).
PAGE_ANSWERS = {
    "read_page": "The page shows the library list: wildcards, derivations, constraints, "
                 "bundles. No item is selected.",
    "open": "Opened.",
    "highlight": "Highlighted.",
}

#: Words that say the answer made something ("I've created", "I proposed").
_CLAIM = re.compile(r"\b(I(?:'ve| have)? (?:created|added|made|proposed|set up)|"
                    r"proposed|created)\b", re.I)
_KIND_OF = {"create_constraint": "constraint", "create_derivation": "derivation",
            "create_wildcard": "wildcard", "create_bundle": "bundle",
            "create_template": "template", "create_combine": "combine",
            "create_fixed_values": "fixed values"}


def _answers(pending: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for c in pending:
        tool = c["tool"]
        if tool == "ask":
            qs = (c.get("args") or {}).get("questions") or []
            out.append({"id": c["id"], "answers": [{"q": i, "picked": [0]}
                                                   for i in range(len(qs))]})
        elif tool in ("web_search", "read_result", "danbooru"):
            out.append({"id": c["id"], "denied": True})
        else:
            out.append({"id": c["id"], "text": PAGE_ANSWERS.get(tool, "Done.")})
    return out


def score_turn(out: dict[str, Any], expect: Any) -> dict[str, Any]:
    """One answer's numbers (see the module docstring)."""
    proposals = out.get("proposals") or []
    steps = out.get("steps") or []
    titles = [p.get("title") for p in proposals]
    repeats = len(titles) - len(set(titles))
    errors = [s for s in steps if not s.get("ok")]
    tests = [s for s in steps if s.get("tool") == "run_test"]
    ran = [s for s in tests if s.get("ok") and s.get("card")]
    used = {s.get("tool") for s in steps if s.get("ok")} | {p.get("tool") for p in proposals}
    did = None
    if expect is not None:
        if expect == []:
            did = not proposals
        else:
            did = all(any(t in used for t in (e if isinstance(e, tuple) else (e,)))
                      for e in expect)
    message = str(out.get("message") or "")
    made = {p.get("tool") for p in proposals}
    claims = []
    for s in errors:
        kind = _KIND_OF.get(str(s.get("tool")))
        if kind and s.get("tool") not in made and re.search(
                rf"\b{re.escape(kind)}\b", message, re.I) and _CLAIM.search(message):
            claims.append(f"says a {kind} was made; its call failed")
    if "nothing was proposed" in message.lower() or "no card" in message.lower():
        claims.append("claimed a change with no card")
    if "no test ran in this answer" in message.lower():
        claims.append("talked about a test that never ran")
    return {"cards": len(proposals), "repeats": repeats, "errors": len(errors),
            "tests": len(tests), "tests_ran": len(ran), "did": did,
            "claims": sorted(set(claims)), "steps": len(steps),
            "card_warnings": sum(len(p.get("warnings") or []) for p in proposals)}


async def run_scenario(client: Any, sc: dict[str, Any]) -> list[dict[str, Any]]:
    chat_id = None
    turns = []
    for n, text in enumerate(sc["turns"]):
        started = time.perf_counter()
        body: dict[str, Any] = {"message": text, "page": sc.get("page") or {}}
        if chat_id:
            body["chat_id"] = chat_id
        resp = await client.post("/wp/api/ai/chat", json=body)
        out = await resp.json()
        rounds = 0
        while resp.status == 200 and out.get("pending") and rounds < 4:
            rounds += 1
            resp = await client.post("/wp/api/ai/chat", json={
                "chat_id": out["chat_id"], "results": _answers(out["pending"]),
                "page": sc.get("page") or {}})
            nxt = await resp.json()
            if resp.status == 200:
                # Steps and cards before the pause stay part of this turn.
                nxt["steps"] = [*(out.get("steps") or []), *(nxt.get("steps") or [])]
                nxt["proposals"] = [*(out.get("proposals") or []),
                                    *(nxt.get("proposals") or [])]
            out = nxt
        seconds = round(time.perf_counter() - started, 1)
        if resp.status != 200:
            turns.append({"text": text, "error": out.get("error") or resp.status,
                          "seconds": seconds})
            break
        chat_id = out.get("chat_id")
        expect = (sc.get("expect") or [None] * len(sc["turns"]))[n]
        turns.append({
            "text": text, "seconds": seconds, **score_turn(out, expect),
            "message": out.get("message"),
            "step_notes": [(s.get("tool"), s.get("ok"), s.get("note")) for s in
                           out.get("steps") or []],
            "card_titles": [p.get("title") for p in out.get("proposals") or []],
            "warnings": [w for p in out.get("proposals") or [] for w in
                         p.get("warnings") or []][:12],
        })
    return turns


def report(rows: list[dict[str, Any]], model: str, note: str) -> str:
    turns = [t for r in rows for t in r["turns"] if "error" not in t]
    failed = [t for r in rows for t in r["turns"] if "error" in t]

    def mean(key: str) -> float:
        return sum(t[key] for t in turns) / len(turns) if turns else 0

    judged = [t for t in turns if t["did"] is not None]
    tests = sum(t["tests"] for t in turns)
    lines = [
        f"# Chat evals: {model}", "", note, "",
        f"- Turns: {len(turns)} ({len(failed)} failed outright)",
        f"- Did what was asked: {sum(1 for t in judged if t['did'])} / {len(judged)}",
        f"- Cards per answer: {mean('cards'):.1f}; repeated cards: "
        f"{sum(t['repeats'] for t in turns)}",
        f"- Tool errors per turn: {mean('errors'):.2f}",
        f"- run_test: {sum(t['tests_ran'] for t in turns)} ran of {tests} calls",
        f"- Answers with a false claim: {sum(1 for t in turns if t['claims'])}",
        f"- Seconds per turn: {mean('seconds'):.0f}", "",
        "| Scenario | Run | Turn | Did | Cards | Repeats | Errors | Tests ran | Claims | s |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in rows:
        for n, t in enumerate(r["turns"], 1):
            if "error" in t:
                lines.append(f"| {r['name']} | {r['run']} | {n} | error: "
                             f"{str(t['error'])[:60]} | | | | | | {t['seconds']} |")
                continue
            did = "" if t["did"] is None else ("yes" if t["did"] else "NO")
            lines.append(f"| {r['name']} | {r['run']} | {n} | {did} | {t['cards']} | "
                         f"{t['repeats']} | {t['errors']} | {t['tests_ran']}/{t['tests']} | "
                         f"{'; '.join(t['claims'])[:60]} | {t['seconds']} |")
    return "\n".join(lines) + "\n"


async def evaluate(scenarios: list[dict[str, Any]], runs: int,
                   partial: Callable[[list[dict[str, Any]]], None] | None = None,
                   ) -> list[dict[str, Any]]:
    """Every scenario ``runs`` times. No client timeout: a slow turn on a
    shared or wordy model must not lose the run. ``partial`` gets the rows
    so far after each scenario, so a killed run still leaves a report."""
    from aiohttp import ClientTimeout, web
    from aiohttp.test_utils import TestClient, TestServer

    import wp_api

    wp_api._start_backups = lambda: None  # type: ignore[attr-defined]
    app = web.Application(client_max_size=32 * 1024 * 1024)
    wp_api.register_routes(app)
    rows: list[dict[str, Any]] = []
    async with TestClient(TestServer(app), timeout=ClientTimeout(None)) as client:
        for run in range(1, runs + 1):
            for sc in scenarios:
                print(f"run {run} · {sc['name']}", flush=True)
                rows.append({"name": sc["name"], "run": run,
                             "turns": await run_scenario(client, sc)})
                if partial is not None:
                    partial(rows)
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--db", default="", help="library database to copy")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--only", default="", help="scenario names, comma-separated")
    ap.add_argument("--model", default="")
    ap.add_argument("--note", default="", help="model, chat template, commit")
    ap.add_argument("--out", default="chat-evals.md")
    args = ap.parse_args()

    from engine.ai import config as ai_config
    from engine.db.connection import resolve_db_path

    src_db = Path(args.db) if args.db else resolve_db_path()
    src_cfg = ai_config.config_path()
    work = Path(tempfile.mkdtemp(prefix="wp-chat-eval-"))
    if src_db.exists():
        shutil.copy2(src_db, work / "library.db")
    if src_cfg.exists():
        shutil.copy2(src_cfg, work / "ai.json")
    os.environ["WP_DB_PATH"] = str(work / "library.db")
    os.environ["WP_AI_CONFIG_PATH"] = str(work / "ai.json")
    os.environ["WP_SETTINGS_PATH"] = str(work / "wp-settings.json")
    cfg = ai_config.load_effective()
    if args.model:
        ai_config.update({"model": args.model})
        cfg = ai_config.load_effective()
    if not cfg.get("enabled") or not cfg.get("model"):
        print("The AI assistant is off or has no model. Set it up under Settings › AI "
              "assistant, or pass --model.")
        return 0
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    scenarios = [s for s in SCENARIOS if not only or s["name"] in only]
    print(f"Library copy and settings in {work}; model {cfg['model']}", flush=True)
    def write(rows: list[dict[str, Any]]) -> None:
        Path(args.out).write_text(report(rows, cfg["model"], args.note), encoding="utf-8")
        Path(args.out).with_suffix(".json").write_text(
            json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")

    write(asyncio.run(evaluate(scenarios, args.runs, partial=write)))
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
