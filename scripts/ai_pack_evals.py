"""Score the pack builder against a model, offline.

Runs each request below through the same plan → build → check → repair
steps the manager uses (`engine/ai/pack.py:run_pack`), on the model saved
under Settings › AI assistant, and scores it:

- plan: the plan compiled (a dict the checker could use);
- built: share of planned items that built and passed their engine
  validator;
- clean: the test run on the engine ended with no problems;
- prompts: the template rendered sample prompts;
- feature: for the requests at the end, whether the pack used the feature
  the request calls for (a reference with a tag filter, an accepts axis, an
  empty option, a multi-pick, a fallback, an input, a model rule, a preset
  with negatives, hold).

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
    # Each of these needs one feature; `feature` scores whether the pack used it.
    ("Winter clothes: a scarf, a hat and mittens, each in a warm colour drawn from one shared "
     "colour list.", "ref_filter"),
    ("Outfits and shoes: the shoes must match the outfit (sneakers with casual, heels with "
     "formal, boots with either).", "accepts"),
    ("Portraits where the person wears a hat about 30% of the time.", "null"),
    ("Fantasy adventurers carrying 2 to 3 accessories each.", "multi_pick"),
    ("Pets with a collar colour; rules narrow the colours a lot, but it must never come out "
     "empty.", "fallback"),
    ("Portraits of a subject I type in myself, with a background and lighting that suit "
     "a portrait.", "input"),
    ("A character pack that works on both Pony and Flux checkpoints, with tags for Pony and "
     "sentences for Flux.", "model"),
    ("An anime style preset with quality tags and its own negatives.", "preset_negatives"),
    ("A comic batch: the same hero in every image of a loop, with a different scene each "
     "time.", "hold"),
]


def _wildcards(result: dict[str, Any]) -> list[dict[str, Any]]:
    kinds = {i["key"]: i["kind"] for i in result["plan"]["items"]}
    return [b["payload"] for k, b in result["built"].items() if kinds.get(k) == "wildcard"]


def _uses(result: dict[str, Any]) -> str:
    return " ; ".join(i.get("use") or "" for i in result["plan"]["items"])


#: Whether a built pack used the feature its request calls for.
FEATURES: dict[str, Any] = {
    "ref_filter": lambda r: any(":" in o.get("value", "") and "@{" in o.get("value", "")
                                for w in _wildcards(r) for o in w.get("options") or []),
    "accepts": lambda r: any("accepts" in (w.get("tag_group_kinds") or {}).values()
                             for w in _wildcards(r)),
    "null": lambda r: any(o.get("is_null") for w in _wildcards(r)
                          for o in w.get("options") or []),
    "multi_pick": lambda r: "pick" in _uses(r),
    "fallback": lambda r: any(o.get("fallback") for w in _wildcards(r)
                              for o in w.get("options") or []),
    "input": lambda r: bool(r["plan"].get("inputs")),
    "model": lambda r: "$model_" in json.dumps(r["built"]) or "model_variant" in json.dumps(
        r["built"]),
    "preset_negatives": lambda r: any(
        i["kind"] == "fixed_values" and any(v.get("negative") for v in
                                            r["built"].get(i["key"], {}).get("payload", {})
                                            .get("values") or [])
        for i in r["plan"]["items"]),
    "hold": lambda r: "hold" in _uses(r),
}


def _score(result: dict[str, Any]) -> dict[str, Any]:
    plan = result["plan"]
    total = len(plan["items"])
    built = len(result["built"])
    check = result["check"] or {}
    problems = sum(len(v) for v in (check.get("problems") or {}).values()) \
        + len(check.get("notes") or [])
    checked = [r for r in check.get("relations") or [] if r.get("checked")]
    return {
        "items": total, "built": built, "built_share": round(built / total, 2) if total else 0,
        "problems": problems if check else None, "clean": bool(check) and problems == 0,
        "prompts": [p["text"] for p in check.get("prompts") or []],
        # wired: relations that held on the engine runs (graph plans only).
        "relations": len(checked), "held": sum(1 for r in checked if r.get("holds")),
        "distinct": check.get("distinct") if check else None,
    }


async def evaluate(complete: Any, requests: list[Any], *, seeds: int = 100,
                   settings: dict | None = None) -> list[dict]:
    """``requests``: text, or ``(text, feature)`` to also score a feature.
    ``settings`` are the pack settings (``planner`` picks the graph or the
    item-list planner)."""
    rows = []
    for entry in requests:
        req, feature = entry if isinstance(entry, tuple) else (entry, "")
        started = time.perf_counter()
        try:
            result = await pack.run_pack(complete, req, seeds=seeds, settings=settings)
        except Exception as e:  # noqa: BLE001 - every request is scored
            rows.append({"request": req, "plan": False, "feature": feature,
                         "error": f"{type(e).__name__}: {e}",
                         "seconds": round(time.perf_counter() - started, 1)})
            continue
        rows.append({"request": req, "plan": True, **_score(result),
                     **({"feature": feature, "feature_used": bool(FEATURES[feature](result))}
                        if feature else {}),
                     "log": result["log"][-12:],
                     "seconds": round(time.perf_counter() - started, 1)})
    return rows


def report(rows: list[dict], model: str) -> str:
    planned = [r for r in rows if r["plan"]]
    clean = [r for r in planned if r.get("clean")]
    share = sum(r["built_share"] for r in planned) / len(planned) if planned else 0
    checked = [r for r in planned if r.get("check") is not False and r.get("distinct") is not None]
    distinct = sum(r["distinct"] for r in checked) / len(checked) if checked else 0
    held = sum(r.get("held") or 0 for r in planned)
    relations = sum(r.get("relations") or 0 for r in planned)
    lines = [
        f"# Pack builder evals: {model}", "",
        f"- Requests: {len(rows)}",
        f"- Plans that compiled: {len(planned)} / {len(rows)}",
        f"- Items built (mean share): {share:.0%}",
        f"- Packs with a clean test run: {len(clean)} / {len(rows)}",
        f"- Feature requests that used the feature: "
        f"{sum(1 for r in planned if r.get('feature_used'))} / "
        f"{sum(1 for r in rows if r.get('feature'))}",
        f"- Relations that held on the test runs (wired): {held} / {relations}",
        f"- Distinct prompts per run (mean): {distinct:.2f}", "",
        "| # | Request | Plan | Built | Problems | Wired | Distinct | Seconds |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for n, r in enumerate(rows, 1):
        req = r["request"][:70].replace("|", "/")
        if not r["plan"]:
            lines.append(f"| {n} | {req} | no: {r['error'][:60]} | | | | | {r['seconds']} |")
            continue
        feat = f" ({r['feature']}: {'used' if r['feature_used'] else 'missing'})" \
            if r.get("feature") else ""
        wired = f"{r['held']}/{r['relations']}" if r.get("relations") else "-"
        distinct_s = f"{r['distinct']:.2f}" if r.get("distinct") is not None else "-"
        lines.append(f"| {n} | {req}{feat} | yes | {r['built']}/{r['items']} | "
                     f"{r['problems']} | {wired} | {distinct_s} | {r['seconds']} |")
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
    ap.add_argument("--planner", choices=("graph", "items"), default="graph",
                    help="graph: the model writes slots, axes and relations and the code "
                         "wires the pack; items: the model writes every item and payload")
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

    rows = asyncio.run(evaluate(complete, REQUESTS[: args.limit], seeds=args.seeds,
                                settings={"planner": args.planner}))
    Path(args.out).write_text(report(rows, f"{cfg['model']} ({args.planner} planner)"),
                              encoding="utf-8")
    Path(args.out).with_suffix(".json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
