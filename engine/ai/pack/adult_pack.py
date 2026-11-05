"""The adult-pack pass over a built item: `adult_check`, shared by the
model-written items (`compile_item`) and the ones the graph wires
(`graph.wired_payload`, which skipped it until the NSFW eval of 2026-10-21
found 0 of 9 nsfw packs with the youth negative)."""
from __future__ import annotations

import re
from typing import Any

from engine.ai import adult as ai_adult
from engine.ai.pack.settings import parse_settings
from engine.modules.derivation_handler import NEGATIVE_MODES, clause_actions
from engine.modules.wildcard_handler import WildcardHandler

#: Words that, in an adult pack's NEGATIVE, push the image away from
#: adults (the Huihui run of 2026-10-21 wrote "mature" into the standing
#: negative of a pack built from an underage request). Whole comma-parts
#: only; "milf" or "old photo" are a taste, not an age.
_ADULT = re.compile(r"^(?:mature|adults?|grown[\s-]?ups?|(?:mature|adult|older|grown)"
                    r"\s+(?:woman|women|female|man|men|male|body|face))$")


def adult_negative(text: str) -> tuple[str, list[str]]:
    """``text`` (a negative) without the parts that push away from
    adults, and the parts taken out."""
    kept: list[str] = []
    gone: list[str] = []
    for part in (text or "").split(","):
        word = re.sub(r"\s+", " ", part.strip().lower().replace("_", " "))
        (gone if word and _ADULT.match(word) else kept).append(part.strip())
    if not gone:
        return text, []
    return ", ".join(x for x in kept if x), gone


def _condition_values(condition: Any) -> list[str]:
    """Every value a condition (or a group of them) looks for."""
    if not isinstance(condition, dict):
        return []
    kids = condition.get("conditions")
    if isinstance(kids, list):
        return [v for k in kids for v in _condition_values(k)]
    value = condition.get("value", "")
    return [value] if isinstance(value, str) and value else []


def adult_check(kind: str, payload: dict[str, Any],
                 plan: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """An nsfw pack's item, model-written or wired from the graph. The
    pack is a sexual context, so text with a minor word (child, loli, "16
    years old", and here schoolgirl, teen, little girl too) or with sex
    without consent (rape, against her will, violation) is left out, as
    `adult.blocked` does everywhere (ValueError, so the item is rebuilt,
    when nothing would be left). Negated words ("no minors") don't count.
    A costume an adult can wear (school uniform) stays, with a warning for the user to judge. The
    template's negative gets the youth block while the youth_negative
    setting is on, and no negative (template, option, value or rule) keeps
    a word that pushes the image away from adults ("mature")."""
    why = "an adult pack never names a minor"
    why_consent = "an adult pack never shows sex without consent"
    said: list[str] = []

    def minor(t: str) -> list[str]:
        return ai_adult.minor_words(t, sexual=True)

    def keep(rows: list[Any], text: Any, noun: str) -> list[Any]:
        bad = [r for r in rows if ai_adult.blocked(text(r), sexual=True)]
        kept = [r for r in rows if r not in bad]
        if bad and not kept:
            raise ValueError(f"every {noun} names a minor or sex without consent; "
                             "an adult pack never does")
        for test, reason in ((minor, why), (ai_adult.noncon_words, why_consent)):
            hit = [r for r in bad if test(text(r))]
            if not hit:
                continue
            words = ", ".join(dict.fromkeys(w for r in hit for w in test(text(r))))
            more = f" and {len(hit) - 1} more" if len(hit) > 1 else ""
            said.append(f"Left out \"{text(hit[0])[:40]}\"{more}: {reason} ({words})")
            bad = [r for r in bad if r not in hit]
        return kept

    def negatives(text: str, what: str) -> str:
        text, gone = adult_negative(text)
        if gone:
            said.append(f"Took \"{', '.join(gone)}\" out of {what}: an adult pack's negative "
                        "never pushes the image away from adults")
        return text

    def writes(rule: dict[str, Any]) -> str:
        """What a rule writes, and what it looks for: a branch keyed on
        "preteen" is as much a minor as one that writes it."""
        clauses = [*(rule.get("branches") or []), rule.get("else")]
        wrote = [str(a.get("value") or "") for c in clauses for a in clause_actions(c)
                 if a.get("mode") not in NEGATIVE_MODES]
        looked = [v for b in rule.get("branches") or [] if isinstance(b, dict)
                  for v in _condition_values(b.get("condition"))]
        return ", ".join([*wrote, *looked])

    def clean_rule(rule: dict[str, Any]) -> dict[str, Any]:
        out = {**rule}
        for key in ("branches", "else"):
            clauses = out.get(key)
            items = clauses if isinstance(clauses, list) else [clauses]
            fixed = []
            for c in items:
                if not isinstance(c, dict):
                    fixed.append(c)
                    continue
                c = {**c}
                for akey in ("action", "extra_actions"):
                    acts = c.get(akey)
                    many = isinstance(acts, list)
                    rows = acts if many else [acts]
                    rows = [{**a, "value": negatives(str(a.get("value") or ""),
                                                     "a rule's negative")}
                            if isinstance(a, dict) and a.get("mode") in NEGATIVE_MODES else a
                            for a in rows]
                    if acts is not None:
                        c[akey] = rows if many else rows[0]
                fixed.append(c)
            if clauses is not None:
                out[key] = fixed if isinstance(clauses, list) else fixed[0]
        return out

    texts: list[str] = []
    if kind == "wildcard":
        real = [o for o in payload.get("options") or [] if not o.get("is_null")]
        kept = keep(real, lambda o: str(o.get("value") or ""), "option")
        if len(kept) < len(real):
            # A dropped option takes its tags with it: "preteen" has no
            # place in the tag list or an accepts group either.
            options = [o for o in payload["options"] if o.get("is_null") or o in kept]
            used = {t for o in options for t in o.get("sub_categories") or []}
            payload = {**payload, "options": options}
            if isinstance(payload.get("sub_categories"), list):
                payload["sub_categories"] = [t for t in payload["sub_categories"] if t in used]
            groups = payload.get("tag_groups")
            if isinstance(groups, dict):
                groups = {g: [t for t in ts if t in used] for g, ts in groups.items()}
                payload["tag_groups"] = {g: ts for g, ts in groups.items() if ts}
                kinds = payload.get("tag_group_kinds")
                if isinstance(kinds, dict):
                    payload["tag_group_kinds"] = {g: k for g, k in kinds.items()
                                                  if g in payload["tag_groups"]}
            WildcardHandler.validate_payload(payload)
        if any(o.get("negative") for o in payload.get("options") or []):
            payload = {**payload, "options": [
                {**o, "negative": negatives(str(o["negative"]),
                                            f"the negative of \"{o.get('value', '')[:30]}\"")}
                if o.get("negative") else o for o in payload["options"]]}
            payload["options"] = [{k: v for k, v in o.items() if k != "negative" or v}
                                  for o in payload["options"]]
        texts = [str(o.get("value") or "") for o in kept]
    elif kind == "fixed_values":
        rows = payload.get("values") or []
        kept = keep(rows, lambda v: str(v.get("value") or ""), "value")
        if len(kept) < len(rows):
            payload = {**payload, "values": kept}
        if any(v.get("negative") for v in payload.get("values") or []):
            payload = {**payload, "values": [
                {**v, "negative": negatives(str(v["negative"]),
                                            f"the negative of \"{v.get('name', '')[:30]}\"")}
                if v.get("negative") else v for v in payload["values"]]}
            payload["values"] = [{k: x for k, x in v.items() if k != "negative" or x}
                                 for v in payload["values"]]
        texts = [str(v.get("value") or "") for v in kept]
    elif kind == "derivation":
        rows = payload.get("rules") or []
        kept = keep(rows, writes, "rule")
        cleaned = [clean_rule(r) for r in kept]
        if cleaned != rows:
            payload = {**payload, "rules": cleaned}
        texts = [writes(r) for r in kept]
    elif kind in ("combine", "template"):
        text = str(payload.get("template" if kind == "combine" else "template_string") or "")
        if minor(text):
            raise ValueError(f"it names a minor; {why}")
        if ai_adult.noncon_words(text):
            raise ValueError(f"it shows sex without consent; {why_consent}")
        texts = [text]
    flagged = [t for t in texts if ai_adult.youth_words(t)]
    if flagged:
        words = ", ".join(dict.fromkeys(w for t in flagged for w in ai_adult.youth_words(t)))
        more = f" and {len(flagged) - 1} more" if len(flagged) > 1 else ""
        said.append(f"Check \"{flagged[0][:40]}\"{more}: it says {words} in an adult pack. "
                    "Make sure every character reads as an adult")
    if kind == "template":
        neg = negatives(str(payload.get("negative_template") or ""), "the negative")
        if neg != (payload.get("negative_template") or ""):
            payload = {**payload, "negative_template": neg}
    if kind == "template" and parse_settings(plan.get("settings"))["youth_negative"] == "on":
        neg, added = ai_adult.with_youth_negative(str(payload.get("negative_template") or ""),
                                                  plan.get("style") or "tags")
        if added:
            payload = {**payload, "negative_template": neg}
            said.append("Added " + ", ".join(added) + " to the negative: the pack is rated "
                        "nsfw (Settings > Youth negative)")
    return payload, said
