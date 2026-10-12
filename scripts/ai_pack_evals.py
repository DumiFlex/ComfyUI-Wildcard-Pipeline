"""Score the pack builder against a model, offline.

Runs each request below through the same plan → build → check → repair
steps the manager uses (`engine/ai/pack.py:run_pack`), on the model saved
under Settings › AI assistant, and scores it:

- plan: the plan compiled (a dict the checker could use);
- built: share of planned items that built and passed their engine
  validator;
- clean: the test run on the engine ended with no problems;
- prompts: the template rendered sample prompts.

Use it before listing a model as a suggestion. It is not part of CI: it
needs a running model and takes minutes per request.

USAGE
-----
    python scripts/ai_pack_evals.py [--limit N] [--model NAME] [--out report.md]

Exit 0 always; the report is the result. Reads the AI settings file the
same way ComfyUI does (`WP_AI_CONFIG_PATH` overrides it).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engine.ai import config as ai_config  # noqa: E402
from engine.ai import pack  # noqa: E402

REQUESTS = [
    "A fantasy character pack: race, class, an outfit and a weapon that fit the class. "
    "Elves never use guns. Give each character a title like 'Elven Archmage'.",
    "Everyday outfits by season. Never sandals or shorts in winter, never a parka in summer.",
    "A weather wildcard and a time of day; night scenes get moody lighting.",
    "Cyberpunk street portraits: implants, neon colours, a district, and a mood.",
    "Food photography: a dish, plating style, a table surface and a light setup that suits "
    "the dish.",
    "Animals in habitats: the animal decides which habitats are possible.",
    "Hairstyles and hair colours, with long styles more common than short ones.",
    "A sci-fi ship interior pack: room type, lighting, crew role that fits the room.",
    "Landscape pack: biome, time of day, weather; snow only in cold biomes.",
    "Anime character sheet: archetype, hair, eyes, outfit, expression matching the archetype.",
    "Architectural renders: building style, material, era; glass and steel only after 1900.",
    "A horror pack: location, monster, lighting; daylight scenes are rare.",
    "Car photography: car type, setting, camera angle; off-road cars get dirt roads.",
    "Fashion editorial: garment, fabric, pose, backdrop colour that contrasts the garment.",
    "Medieval town scenes: building, trade, crowd density, market day or not.",
    "Underwater scenes: depth zone, creatures that live at that depth, light level.",
    "Space art: celestial body, colour palette, viewpoint; no atmosphere glow on moons.",
    "Portrait lighting pack: lighting style, background, lens; rim light needs a dark "
    "background.",
    "Fantasy creatures: creature, size, element; fire creatures never live in water.",
    "Steampunk inventors: invention, workshop, outfit, a title from the invention.",
    "Interior design: room, style, colour scheme; minimalist rooms get muted colours.",
    "Sports action shots: sport, venue that fits the sport, moment, crowd.",
    "Mythology pack: pantheon, deity, symbol that belongs to the deity, setting.",
    "Post-apocalyptic survivors: role, gear that fits the role, ruin type, weather.",
    "Cozy cafe scenes: drink, pastry, seating, time of day; hot drinks in winter.",
    "Pixel art game sprites: character class, palette, pose; mages get staffs.",
    "Botanical illustrations: plant, part shown, art style; cacti never get leaves.",
    "Superhero pack: power, costume colours, city, a hero name built from the power.",
    "Wedding photography: venue, season, dress style, flowers in season.",
    "A simple pack: just a colour wildcard and a shape wildcard and a template.",
]


def _score(result: dict[str, Any]) -> dict[str, Any]:
    plan = result["plan"]
    total = len(plan["items"])
    built = len(result["built"])
    check = result["check"] or {}
    problems = sum(len(v) for v in (check.get("problems") or {}).values()) \
        + len(check.get("notes") or [])
    return {
        "items": total, "built": built, "built_share": round(built / total, 2) if total else 0,
        "problems": problems if check else None, "clean": bool(check) and problems == 0,
        "prompts": [p["text"] for p in check.get("prompts") or []],
    }


async def evaluate(complete: Any, requests: list[str], *, seeds: int = 100) -> list[dict]:
    rows = []
    for req in requests:
        started = time.perf_counter()
        try:
            result = await pack.run_pack(complete, req, seeds=seeds)
        except Exception as e:  # noqa: BLE001 - every request is scored
            rows.append({"request": req, "plan": False, "error": f"{type(e).__name__}: {e}",
                         "seconds": round(time.perf_counter() - started, 1)})
            continue
        rows.append({"request": req, "plan": True, **_score(result),
                     "log": result["log"][-12:],
                     "seconds": round(time.perf_counter() - started, 1)})
    return rows


def report(rows: list[dict], model: str) -> str:
    planned = [r for r in rows if r["plan"]]
    clean = [r for r in planned if r.get("clean")]
    share = sum(r["built_share"] for r in planned) / len(planned) if planned else 0
    lines = [
        f"# Pack builder evals: {model}", "",
        f"- Requests: {len(rows)}",
        f"- Plans that compiled: {len(planned)} / {len(rows)}",
        f"- Items built (mean share): {share:.0%}",
        f"- Packs with a clean test run: {len(clean)} / {len(rows)}", "",
        "| # | Request | Plan | Built | Problems | Seconds |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for n, r in enumerate(rows, 1):
        req = r["request"][:70].replace("|", "/")
        if not r["plan"]:
            lines.append(f"| {n} | {req} | no: {r['error'][:60]} | | | {r['seconds']} |")
            continue
        lines.append(f"| {n} | {req} | yes | {r['built']}/{r['items']} | "
                     f"{r['problems']} | {r['seconds']} |")
    lines += ["", "## Sample prompts", ""]
    for r in planned:
        if r["prompts"]:
            lines.append(f"- {r['request'][:60]}: `{r['prompts'][0][:200]}`")
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--limit", type=int, default=len(REQUESTS))
    ap.add_argument("--model", default="")
    ap.add_argument("--seeds", type=int, default=100)
    ap.add_argument("--out", default="pack-evals.md")
    args = ap.parse_args()
    from wp_api import _ai_client

    cfg = ai_config.load_effective()
    if args.model:
        cfg = {**cfg, "model": args.model}
    if not cfg.get("model"):
        print("No model set. Pick one under Settings › AI assistant, or pass --model.")
        return 0

    async def complete(**kwargs: Any) -> Any:
        return await _ai_client.complete_json(cfg, **kwargs)

    rows = asyncio.run(evaluate(complete, REQUESTS[: args.limit], seeds=args.seeds))
    Path(args.out).write_text(report(rows, cfg["model"]), encoding="utf-8")
    Path(args.out).with_suffix(".json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
