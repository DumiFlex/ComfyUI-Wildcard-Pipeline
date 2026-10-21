"""The adult-pack pass over a built item: `adult_check`, shared by the
model-written items (`compile_item`) and the ones the graph wires
(`graph.wired_payload`, which skipped it until the NSFW eval of 2026-10-21
found 0 of 9 nsfw packs with the youth negative)."""
from __future__ import annotations

from typing import Any

from engine.ai import adult as ai_adult
from engine.ai.pack.settings import parse_settings
from engine.modules.derivation_handler import NEGATIVE_MODES, clause_actions
from engine.modules.wildcard_handler import WildcardHandler


def adult_check(kind: str, payload: dict[str, Any],
                 plan: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """An nsfw pack's item, model-written or wired from the graph. The
    pack is a sexual context, so text with a minor word (child, loli, "16
    years old", and here schoolgirl, teen, little girl too) is left out,
    as `adult.sexual_minor` does everywhere (ValueError, so the item is
    rebuilt, when nothing would be left). A costume an adult can wear
    (school uniform) stays, with a warning for the user to judge. The
    template's negative gets the youth block while the youth_negative
    setting is on."""
    why = "an adult pack never names a minor"
    said: list[str] = []

    def keep(rows: list[Any], text: Any, noun: str) -> list[Any]:
        bad = [r for r in rows if ai_adult.minor_words(text(r), sexual=True)]
        kept = [r for r in rows if r not in bad]
        if bad and not kept:
            raise ValueError(f"every {noun} names a minor; {why}")
        if bad:
            words = ", ".join(dict.fromkeys(w for r in bad
                                            for w in ai_adult.minor_words(text(r), sexual=True)))
            more = f" and {len(bad) - 1} more" if len(bad) > 1 else ""
            said.append(f"Left out \"{text(bad[0])[:40]}\"{more}: {why} ({words})")
        return kept

    def writes(rule: dict[str, Any]) -> str:
        clauses = [*(rule.get("branches") or []), rule.get("else")]
        return ", ".join(str(a.get("value") or "") for c in clauses for a in clause_actions(c)
                         if a.get("mode") not in NEGATIVE_MODES)

    texts: list[str] = []
    if kind == "wildcard":
        real = [o for o in payload.get("options") or [] if not o.get("is_null")]
        kept = keep(real, lambda o: str(o.get("value") or ""), "option")
        if len(kept) < len(real):
            payload = {**payload, "options": [o for o in payload["options"]
                                              if o.get("is_null") or o in kept]}
            WildcardHandler.validate_payload(payload)
        texts = [str(o.get("value") or "") for o in kept]
    elif kind == "fixed_values":
        rows = payload.get("values") or []
        kept = keep(rows, lambda v: str(v.get("value") or ""), "value")
        if len(kept) < len(rows):
            payload = {**payload, "values": kept}
        texts = [str(v.get("value") or "") for v in kept]
    elif kind == "derivation":
        rows = payload.get("rules") or []
        kept = keep(rows, writes, "rule")
        if len(kept) < len(rows):
            payload = {**payload, "rules": kept}
        texts = [writes(r) for r in kept]
    elif kind in ("combine", "template"):
        text = str(payload.get("template" if kind == "combine" else "template_string") or "")
        if ai_adult.minor_words(text, sexual=True):
            raise ValueError(f"it names a minor; {why}")
        texts = [text]
    flagged = [t for t in texts if ai_adult.youth_words(t)]
    if flagged:
        words = ", ".join(dict.fromkeys(w for t in flagged for w in ai_adult.youth_words(t)))
        more = f" and {len(flagged) - 1} more" if len(flagged) > 1 else ""
        said.append(f"Check \"{flagged[0][:40]}\"{more}: it says {words} in an adult pack. "
                    "Make sure every character reads as an adult")
    if kind == "template" and parse_settings(plan.get("settings"))["youth_negative"] == "on":
        neg, added = ai_adult.with_youth_negative(str(payload.get("negative_template") or ""),
                                                  plan.get("style") or "tags")
        if added:
            payload = {**payload, "negative_template": neg}
            said.append("Added " + ", ".join(added) + " to the negative: the pack is rated "
                        "nsfw (Settings > Youth negative)")
    return payload, said
