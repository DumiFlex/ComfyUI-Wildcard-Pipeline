"""Sum up what the chat assistant offered its model and what the model did,
over every saved chat in a library (research note "Request-aware prompts",
Phase 0).

Each answer stores a trace (`engine/ai/trace.py`): the tools each step's
grammar offered, the tools called, the notes and nudges sent, repeats,
refusals and token counts. This prints the totals that tell whether a
small-model change helped:

- shortlist misses: ``more_tools`` calls (a tool the shortlist left out);
- docs lookups: ``explain`` / ``docs_search`` calls;
- re-reads: steps whose prompt came back mostly uncached (the start of the
  prompt changed, or the server lost its cache);
- nudges and refusals by kind; which tail notes messages carried.

Read-only: it opens the database for reading and never writes.

USAGE
-----
    python scripts/ai_trace_report.py [--db PATH] [--since 2026-10-23]
        [--model NAME] [--json]
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def load_traces(db: Path, since: str = "", model: str = "") -> list[dict[str, Any]]:
    """Every stored answer trace, oldest first."""
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT m.body, c.updated_at FROM ai_chat_messages m JOIN ai_chats c "
            "ON c.id = m.chat_id ORDER BY m.chat_id, m.seq;").fetchall()
    finally:
        conn.close()
    out = []
    for r in rows:
        if since and str(r["updated_at"] or "") < since:
            continue
        try:
            body = json.loads(r["body"])
        except ValueError:
            continue
        trace = body.get("trace") if isinstance(body, dict) and body.get("kind") == "shown" \
            else None
        if isinstance(trace, dict) and (not model or trace.get("model") == model):
            out.append(trace)
    return out


def render(total: dict[str, Any]) -> str:
    n = total["answers"] or 1
    prompt = total["prompt_tokens"] or 1

    def table(head: str, counts: dict[str, int]) -> list[str]:
        if not counts:
            return []
        return ["", f"| {head} | Count |", "| --- | --- |",
                *(f"| {k} | {v} |" for k, v in counts.items())]

    lines = [
        "# Chat traces", "",
        f"- Answers: {total['answers']}, model steps: {total['steps']} "
        f"({total['steps'] / n:.1f} per answer)",
        f"- Answers with a tool shortlist: {total['shortlisted']}; widened by more_tools: "
        f"{total['widened']} (more_tools calls: {total['more_tools']})",
        f"- Most tools a first step offered: {total['first_offered']}",
        f"- Questions or chat: {total['questions']}; of them with a change call: "
        f"{total['question_changes']}",
        f"- Docs lookups (explain, docs_search): {total['docs']}",
        f"- Re-reads (a later step's prompt mostly uncached): {total['rereads']}",
        f"- Prompt tokens: {total['prompt_tokens']}, cached: {total['cached_tokens']} "
        f"({100 * total['cached_tokens'] / prompt:.0f}%)",
        f"- Thinking tokens (where the server reports them): {total['thought_tokens']}",
        f"- Model time: {total['seconds']:.0f} s "
        f"({total['seconds'] / max(total['steps'], 1):.0f} s per step, slowest "
        f"{total['slowest']:.0f} s); steps that hit the time limit: "
        f"{total['timed_out']}",
    ]
    lines += table("Tool called", total["called"])
    lines += table("Note or nudge sent", total["notes"])
    lines += table("Message tail block", total["tail"])
    lines += table("Refusal", total["refused"])
    lines += table("Missing from the cards (request check)", total["gaps"])
    lines += table("Closed for looping", total["closed"])
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--db", action="append", default=[],
                    help="library database, or a folder of them such as an eval run's "
                         "runs/ (repeatable; default: ComfyUI's)")
    ap.add_argument("--since", default="", help="only chats updated on or after this date")
    ap.add_argument("--model", default="", help="only answers from this model")
    ap.add_argument("--json", action="store_true", help="print the totals as JSON")
    args = ap.parse_args()

    from engine.ai import trace as ai_trace
    from engine.db.connection import resolve_db_path

    dbs: list[Path] = []
    for given in args.db or [str(resolve_db_path())]:
        path = Path(given)
        dbs += sorted(path.glob("*.db")) if path.is_dir() else [path]
    missing = [d for d in dbs if not d.exists()]
    if missing or not dbs:
        print(f"No library database at {missing[0] if missing else args.db}")
        return 1
    traces = [t for d in dbs for t in load_traces(d, args.since, args.model)]
    total = ai_trace.summarize(traces)
    print(json.dumps(total, indent=2) if args.json else render(total))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
