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

The ``smoke`` set (``--set smoke``) is ten short asks, one per feature a
small model gets wrong most (refs, tag filters, "only" constraints,
fallback, negatives, AND rules, a renamed variable, four items at once, a
how-to and a "where is"). Its cards are applied between turns (creates
only), so a later turn can build on them, and each turn can carry a
``check`` on the cards' content. Run it before and after each small-model
change (/pr-drafts/request-aware-prompts-plan.md); about fifteen minutes on
a 9B.

USAGE
-----
    python scripts/ai_chat_evals.py --db PATH [--runs 3] [--only NAME,...]
        [--set default|smoke] [--model NAME] [--out chat-evals.md]

``--db`` is the library to copy (default: the one ComfyUI would open).
Every scenario run starts from a fresh copy of it (and of the examples
file), so what one run's cards made can't steer the next.
Writes the report and a ``.json`` beside it with every turn's answer,
steps and cards. Record the model AND its chat template with each round.
"""
from __future__ import annotations

import argparse
import asyncio
import gc
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



def _texts(out: dict[str, Any]) -> str:
    """Everything the answer's cards would write, as one JSON string."""
    return json.dumps([p.get("op") for p in out.get("proposals") or []], ensure_ascii=False)


def _cards(tool: str, n: int) -> Callable[[dict[str, Any]], bool]:
    return lambda out: sum(1 for p in out.get("proposals") or [] if p.get("tool") == tool) >= n


#: Small-model smoke set: one ask per feature. ``check`` per turn: a test of
#: the answer (its cards' ops are in ``_texts``), scored as "content".
SMOKE: list[dict[str, Any]] = [
    {"name": "s-refs", "page": {"route": "/library"},
     "turns": ["Make a Colors wildcard with 6 colours and no variable, so other wildcards "
               "can draw from it.",
               "Make an Outfit wildcard whose options draw their colour from Colors."],
     "expect": [["create_wildcard"], ["create_wildcard"]],
     "check": [None, lambda out: "@{Colors" in _texts(out)]},
    {"name": "s-tag-filter", "page": {"route": "/library"},
     "turns": ["Make a Palette wildcard with no variable: 4 warm colours tagged warm and 4 "
               "cool colours tagged cool.",
               "Make a Sky wildcard whose options use only warm colours from Palette."],
     "expect": [["create_wildcard"], ["create_wildcard"]],
     "check": [None, lambda out: bool(re.search(r"@\{Palette:\s*warm", _texts(out)))]},
    {"name": "s-only", "page": {"route": "/library"},
     "turns": ["Make a Setting wildcard (beach, office, forest) and an Outfit wildcard with "
               "outfits tagged by the setting they suit, then make each setting get only "
               "outfits that suit it."],
     "expect": [["create_wildcard", "create_constraint"]],
     "check": [lambda out: '"only"' in _texts(out)]},
    {"name": "s-fallback", "page": {"route": "/library"},
     "turns": ["Make a Weather wildcard with 5 options where clear sky is the fallback when "
               "rules rule out everything else."],
     "expect": [["create_wildcard"]],
     "check": [lambda out: '"fallback": true' in _texts(out)]},
    {"name": "s-negatives", "page": {"route": "/library"},
     "turns": ["Make a Lighting wildcard with 4 options: two dark, two bright.",
               "Add negatives to the dark options so the image isn't overexposed."],
     "expect": [["create_wildcard"], [("edit_options", "create_wildcard")]],
     "check": [None, lambda out: '"negative": "' in _texts(out)]},
    {"name": "s-and-rule", "page": {"route": "/library"},
     "turns": ["Make a Class wildcard (mage, warrior) and a Season wildcard (winter, summer), "
               "then a derivation that sets $cloak to 'fur cloak' when the class is warrior "
               "AND the season is winter, else nothing."],
     "expect": [["create_wildcard", "create_derivation"]],
     "check": [lambda out: '"match": "all"' in _texts(out)
               and all(w in _texts(out) for w in ("warrior", "winter"))]},
    {"name": "s-rename-var", "page": {"route": "/library"},
     "turns": ["Make a Hair wildcard bound to $hair with 4 options.",
               "Rename its variable to hair_color."],
     "expect": [["create_wildcard"], [("update_info", "edit_options", "variables")]],
     "check": [None, lambda out: "hair_color" in _texts(out)]},
    {"name": "s-four-items", "page": {"route": "/library"},
     "turns": ["Make four wildcards: Eyes, Pose, Expression and Background, each with 5 "
               "options."],
     "expect": [["create_wildcard"]],
     "check": [_cards("create_wildcard", 4)]},
    {"name": "s-how-to", "page": {"route": "/library"},
     "turns": ["How does a constraint's only mode work? Keep it short."],
     "expect": [[]],
     "check": [lambda out: any(s.get("tool") in ("explain", "docs_search", "docs_read")
                               for s in out.get("steps") or [])]},
    {"name": "s-where", "page": {"route": "/library"},
     "turns": ["Where do I turn on deleting for the AI assistant?"],
     "expect": [[]],
     "check": [lambda out: "permission" in str(out.get("message") or "").lower()]},
]

SETS = {"default": SCENARIOS, "smoke": SMOKE}

#: Where each kind of create card is applied (the drawer's Apply, creates only).
_APPLY = {"module": "/wp/api/modules", "bundle": "/wp/api/bundles",
          "template": "/wp/api/templates"}


async def apply_cards(client: Any, out: dict[str, Any]) -> list[dict[str, Any]]:
    """Apply the answer's create cards like the drawer does, so the next turn
    can build on them; the events the next message reports."""
    events = []
    for p in out.get("proposals") or []:
        op = p.get("op") or {}
        path = _APPLY.get(str(op.get("kind")))
        if op.get("op") != "create" or not path or not isinstance(op.get("body"), dict):
            continue
        body = {"category_id": None, "description": "", "tags": [], **op["body"]}
        resp = await client.post(path, json=body)
        if resp.status in (200, 201):
            row = await resp.json()
            events.append({"pid": p.get("pid"), "status": "applied", "id": row.get("id")})
    return events


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


def score_turn(out: dict[str, Any], expect: Any, check: Any = None) -> dict[str, Any]:
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
    content = None
    if callable(check):
        try:
            content = bool(check(out))
        except Exception:  # a check that can't read the answer failed it
            content = False
    return {"content": content, "cards": len(proposals), "repeats": repeats,
            "errors": len(errors),
            "tests": len(tests), "tests_ran": len(ran), "did": did,
            "claims": sorted(set(claims)), "steps": len(steps),
            "card_warnings": sum(len(p.get("warnings") or []) for p in proposals)}


async def run_scenario(client: Any, sc: dict[str, Any]) -> list[dict[str, Any]]:
    chat_id = None
    turns = []
    events: list[dict[str, Any]] = []
    for n, text in enumerate(sc["turns"]):
        started = time.perf_counter()
        body: dict[str, Any] = {"message": text, "page": sc.get("page") or {}}
        if chat_id:
            body["chat_id"] = chat_id
        if events:
            body["events"] = events
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
        check = (sc.get("check") or [None] * len(sc["turns"]))[n]
        events = await apply_cards(client, out) if sc.get("check") else []
        turns.append({
            "text": text, "seconds": seconds, **score_turn(out, expect, check),
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
    checked = [t for t in turns if t.get("content") is not None]
    tests = sum(t["tests"] for t in turns)
    lines = [
        f"# Chat evals: {model}", "", note, "",
        f"- Turns: {len(turns)} ({len(failed)} failed outright)",
        f"- Did what was asked: {sum(1 for t in judged if t['did'])} / {len(judged)}",
        f"- Content checks passed: {sum(1 for t in checked if t['content'])} / {len(checked)}",
        f"- Cards per answer: {mean('cards'):.1f}; repeated cards: "
        f"{sum(t['repeats'] for t in turns)}",
        f"- Tool errors per turn: {mean('errors'):.2f}",
        f"- run_test: {sum(t['tests_ran'] for t in turns)} ran of {tests} calls",
        f"- Answers with a false claim: {sum(1 for t in turns if t['claims'])}",
        f"- Seconds per turn: {mean('seconds'):.0f}", "",
        "| Scenario | Run | Turn | Did | Content | Cards | Repeats | Errors | Tests ran | Claims "
        "| s |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in rows:
        for n, t in enumerate(r["turns"], 1):
            if "error" in t:
                lines.append(f"| {r['name']} | {r['run']} | {n} | error: "
                             f"{str(t['error'])[:60]} | | | | | | | {t['seconds']} |")
                continue
            did = "" if t["did"] is None else ("yes" if t["did"] else "NO")
            ok = "" if t.get("content") is None else ("yes" if t["content"] else "NO")
            lines.append(f"| {r['name']} | {r['run']} | {n} | {did} | {ok} | {t['cards']} | "
                         f"{t['repeats']} | {t['errors']} | {t['tests_ran']}/{t['tests']} | "
                         f"{'; '.join(t['claims'])[:60]} | {t['seconds']} |")
    return "\n".join(lines) + "\n"


def fresh_copy(work: Path) -> Callable[[], None]:
    """What puts `work`'s library and examples back as they are now: the
    smoke set's second run found the first run's Hair and Outfit and edited
    those (2026-10-23). The search index beside the library is dropped, so
    it is rebuilt from the copy."""
    keep = work / "pristine"
    keep.mkdir(exist_ok=True)
    names = ("library.db", "ai-examples.json")
    for n in names:
        if (work / n).exists():
            shutil.copy2(work / n, keep / n)

    def restore() -> None:
        # The chat keeps its search index open; Windows can't delete an
        # open file (WinError 32 on Dumi's PC, 2026-10-23).
        from wp_api import _ai_context

        for idx in _ai_context._INDEXES.values():
            if idx is not None:
                idx.close()
        _ai_context._INDEXES.clear()
        gc.collect()  # and any library connection nobody closed
        for p in work.iterdir():
            if p.is_file() and (p.name.startswith(("library.db", "ai-examples.json"))
                                or ".ai-index.db" in p.name):
                p.unlink()
        for n in names:
            if (keep / n).exists():
                shutil.copy2(keep / n, work / n)

    return restore


async def evaluate(scenarios: list[dict[str, Any]], runs: int,
                   partial: Callable[[list[dict[str, Any]]], None] | None = None,
                   fresh: Callable[[], None] | None = None,
                   ) -> list[dict[str, Any]]:
    """Every scenario ``runs`` times, each from `fresh` (a clean library).
    No client timeout: a slow turn on a shared or wordy model must not lose
    the run. ``partial`` gets the rows so far after each scenario, so a
    killed run still leaves a report."""
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
                if fresh is not None:
                    fresh()
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
    ap.add_argument("--set", default="default", choices=sorted(SETS),
                    help="which scenarios: the default chats or the small-model smoke set")
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
    scenarios = [s for s in SETS[args.set] if not only or s["name"] in only]
    print(f"Library copy and settings in {work}; model {cfg['model']}", flush=True)
    def write(rows: list[dict[str, Any]]) -> None:
        Path(args.out).write_text(report(rows, cfg["model"], args.note), encoding="utf-8")
        Path(args.out).with_suffix(".json").write_text(
            json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")

    write(asyncio.run(evaluate(scenarios, args.runs, partial=write, fresh=fresh_copy(work))))
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
