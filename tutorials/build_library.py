"""Writes tutorials/library.json, the library every tutorial starts from.

    python tutorials/build_library.py

Each list holds one idea, and each option is written so an image model can't misread it.
$subject is a combine of who the person is ($role) and how they look ($hair, $eyes); what
they wear ($outfit) and hold ($held) stay their own variables, so a LoRA can swap one part.
The ids are fixed so the tests can name them.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent / "library.json"
NOW = datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")

ROLES = ("knight", "mage", "ranger", "inventor")


def opt(oid: str, value: str, tags: list[str] | None = None, **extra) -> dict:
    o = {"id": oid, "value": value, "weight": 1, "sub_categories": tags or []}
    o.update(extra)
    return o


def wildcard(mid: str, name: str, var: str, options: list[dict], desc: str, **extra) -> dict:
    tags: list[str] = []
    for o in options:
        for t in o["sub_categories"]:
            if t not in tags:
                tags.append(t)
    payload = {"var_binding": var, "sub_categories": tags, "options": options}
    payload.update(extra)
    return {"id": mid, "type": "wildcard", "name": name, "description": desc, "payload": payload}


def branch(var: str, value: str, target: str, mode: str, text: str, *extra: tuple[str, str, str]):
    b = {
        "condition": {"var": var, "op": "equals", "value": value},
        "action": {"target_var": target, "mode": mode, "value": text},
    }
    if extra:
        b["extra_actions"] = [{"target_var": t, "mode": m, "value": v} for t, m, v in extra]
    return b


def derivation(
    mid: str, name: str, rid: str, branches: list[dict], desc: str, otherwise=None
) -> dict:
    rule: dict = {"branches": branches, "id": rid}
    if otherwise:
        rule["else"] = otherwise
    return {
        "id": mid,
        "type": "derivation",
        "name": name,
        "description": desc,
        "payload": {"rules": [rule]},
    }


def combine(mid: str, name: str, template: str, out: str, inputs: list[str], desc: str) -> dict:
    return {
        "id": mid,
        "type": "combine",
        "name": name,
        "description": desc,
        "payload": {"template": template, "output_var": out, "input_vars": inputs},
    }


def constraint(mid: str, name: str, src: dict, tgt: dict, matrix: dict, desc: str) -> dict:
    return {
        "id": mid,
        "type": "constraint",
        "name": name,
        "description": desc,
        "payload": {
            "source_wildcard_id": src["id"],
            "target_wildcard_id": tgt["id"],
            "source_wildcard_name": src["name"],
            "target_wildcard_name": tgt["name"],
            "exceptions": [],
            "matrix": matrix,
        },
    }


# --- Lists --------------------------------------------------------------------------------

ROLE = wildcard(
    "808878ba",
    "Role",
    "role",
    [
        opt("c8fc80d0", "a knight", ["knight"]),
        opt("c243437e", "a battle mage", ["mage"]),
        opt("784f4138", "a forest ranger", ["ranger"]),
        opt("422b5317", "a clockwork inventor", ["inventor"]),
    ],
    "Who the subject is. Its tags decide the outfit, the item and the place.",
)

COLORS = wildcard(
    "bc15a82d",
    "Hair colors",
    "hair_color",
    [
        opt("7d1e78ef", "auburn"),
        opt("6c3528de", "silver"),
        opt("e6eda3f2", "jet black"),
        opt("1f0c8a31", "copper red"),
        opt("5a77e0c4", "platinum blonde"),
        opt("9b2d6e10", "chestnut brown"),
    ],
    "Switched off: only read through @{} references in Hair.",
)

HAIR = wildcard(
    "4facf8ce",
    "Hair",
    "hair",
    [
        opt("a3ff1986", "short @{bc15a82d#Hair colors} hair"),
        opt("e6d04f1d", "long @{bc15a82d#Hair colors} hair in a loose braid"),
        opt("c71b55d2", "shoulder-length wavy @{bc15a82d#Hair colors} hair"),
        opt("0e3f9a4b", "a shaved head"),
    ],
    "Hair style; the colour comes from Hair colors through an @{} reference.",
)

EYES = wildcard(
    "38c1b584",
    "Eyes",
    "eyes",
    [
        opt("2b8e61a0", "bright green eyes"),
        opt("8c41d7f2", "pale blue eyes"),
        opt("5e0a93bd", "dark brown eyes"),
        opt("d36f2c18", "amber eyes"),
    ],
    "Eye colour only.",
)

OUTFIT = wildcard(
    "195238e2",
    "Outfit",
    "outfit",
    [
        opt(
            "72f8e1d7",
            "polished steel plate armor with a blue surcoat",
            ["knight"],
            negative="rust, broken armor",
        ),
        opt("4c0b7e95", "a chainmail shirt under a red tabard", ["knight"]),
        opt("b5a2c3d1", "a long deep-blue robe embroidered with silver stars", ["mage"]),
        opt("e81f4a6c", "a crimson long coat with brass buttons", ["mage"]),
        opt("0d9c2b57", "a hooded green cloak over a brown leather jerkin", ["ranger"]),
        opt("6a3e18f0", "a fur-trimmed leather hunting coat", ["ranger"]),
        opt("f2c7d905", "a leather work apron over a white linen shirt", ["inventor"]),
        opt("93b0e4a8", "a brown waistcoat with rolled-up shirt sleeves", ["inventor"]),
        opt("5c61f0e2", "a plain grey wool tunic", fallback=True),
    ],
    "Clothes only, tagged by role. The grey tunic is the fallback.",
)

HELD = wildcard(
    "7a41c0de",
    "Held item",
    "held",
    [
        opt("1a7c3e90", "a longsword with a gold hilt", ["knight"]),
        opt("2b8d4fa1", "a round wooden shield painted with a lion", ["knight"]),
        opt("3c9e50b2", "a glowing oak staff", ["mage"]),
        opt("4daf61c3", "an open spellbook with glowing pages", ["mage"]),
        opt("5eb072d4", "a wooden longbow", ["ranger"]),
        opt("6fc183e5", "a brass lantern", ["ranger"]),
        opt("70d294f6", "a large brass wrench", ["inventor"]),
        opt("81e3a507", "a small clockwork bird", ["inventor"]),
    ],
    "What the subject holds, tagged by role.",
)

SETTING = wildcard(
    "aa76ada8",
    "Setting",
    "setting",
    [
        opt("c1a0b2c3", "in a torch-lit stone throne room", ["castle"]),
        opt("d2b1c3d4", "on the battlements of a stone castle", ["castle"]),
        opt("e3c2d4e5", "in a misty pine forest at the edge of a cliff", ["forest"]),
        opt("f4d3e5f6", "in a mossy clearing in an old oak forest", ["forest"]),
        opt("a5e4f607", "on a crowded cobblestone market street", ["city"]),
        opt("b6f50718", "in a cluttered workshop full of brass gears", ["city"]),
    ],
    "Where. Its tags (castle, forest, city) meet Role in Role fits the place.",
)

TIME = wildcard(
    "49cac59c",
    "Time of day",
    "time",
    [
        opt("7c740b5b", "at dawn"),
        opt("7ddc9c86", "at sunset"),
        opt("a681b8ca", "at night"),
    ],
    "When. Lighting reads it.",
)

FRAMING = wildcard(
    "3e5f7a9b",
    "Framing",
    "framing",
    [
        opt("0a1b2c3d", "A full-body shot"),
        opt("1b2c3d4e", "A waist-up portrait"),
        opt("2c3d4e5f", "A close-up portrait"),
    ],
    "How the camera frames the subject. It starts the sentence.",
)

COMPANION = wildcard(
    "8e1f3a5c",
    "Companion",
    "companion",
    [
        opt("9f203b4d", "A black raven sits on their shoulder."),
        opt("a0314c5e", "A grey wolf stands at their side."),
        opt("b1425d6f", "A small red fox sits at their feet."),
        opt("c2536e70", "", is_null=True),
    ],
    "A sentence to end on. The empty option means no companion, a quarter of the time.",
)

GEAR = wildcard(
    "a1b2c3d4",
    "Travel gear",
    "gear",
    [
        opt("5e1a0001", "a hooded leather coat", ["cold", "boots"]),
        opt("5e1a0002", "a fur-lined cloak", ["cold", "boots"]),
        opt("5e1a0003", "a light linen robe", ["warm", "sandals", "slippers"]),
        opt("5e1a0004", "a silk kimono", ["warm", "sandals", "slippers"]),
        opt("5e1a0005", "a ranger's jerkin", ["warm", "boots", "sandals"]),
    ],
    "Tag groups: CLIMATE describes the option, SHOES is an accepts axis read as $gear.SHOES.",
    tag_groups={"CLIMATE": ["cold", "warm"], "SHOES": ["boots", "sandals", "slippers"]},
    tag_group_kinds={"SHOES": "accepts"},
)

QUALITY = wildcard(
    "9a7b5c3d",
    "Quality per model",
    "quality",
    [
        opt("9a7b0001", "score_9, score_8_up, score_7_up", ["pony"]),
        opt("9a7b0002", "masterpiece, best quality, very aesthetic", ["illustrious"]),
        opt("9a7b0003", "Sharp focus, rich detail and soft natural light.", ["klein"]),
    ],
    "Quality words, tagged by model variant; a Pool filtered by $model_variant keeps the model's.",
    tag_groups={"MODEL": ["pony", "illustrious", "klein"]},
)

# --- Rules and lines ------------------------------------------------------------------------

SUBJECT = combine(
    "9d2e4f61",
    "Subject",
    "$role with $hair and $eyes",
    "subject",
    ["role", "hair", "eyes"],
    "The person: role, hair and eyes in one line.",
)

LIGHTING = derivation(
    "5774d2a1",
    "Lighting from time",
    "e751ba3a",
    [
        branch(
            "time",
            "at night",
            "lighting",
            "replace",
            "lit by pale moonlight and warm lantern glow",
            ("lighting", "negative", "overexposed, harsh sunlight"),
        ),
        branch("time", "at sunset", "lighting", "replace", "with warm orange rim light"),
    ],
    "Light that fits the time. At night it also adds negatives.",
    otherwise={
        "action": {"target_var": "lighting", "mode": "replace", "value": "in soft morning light"}
    },
)

SCENE = combine(
    "5d75075f",
    "Scene",
    "$setting $time, $lighting",
    "scene",
    ["setting", "time", "lighting"],
    "Where, when and the light, as one phrase.",
)

STYLE = {
    "id": "c32f16d6",
    "type": "fixed_values",
    "name": "Style",
    "description": "The look of every picture, with its negatives.",
    "payload": {
        "values": [
            {
                "id": "9af7bf95",
                "name": "style",
                "value": "A digital painting, painterly brush strokes, illustration, sharp focus and rich color.",
                "negative": "photo, photorealistic, 3d render, blurry",
            }
        ]
    },
}

ONLY = {r: {r: {"mode": "only", "factor": 1}} for r in ROLES}

OUTFIT_FITS = constraint(
    "6b8c0d2e",
    "Outfit fits the role",
    ROLE,
    OUTFIT,
    ONLY,
    "Only rule: each role wears only outfits with its own tag.",
)

HELD_FITS = constraint(
    "7c9d1e3f",
    "Item fits the role",
    ROLE,
    HELD,
    ONLY,
    "Only rule: each role holds only items with its own tag.",
)

PLACE_FITS = constraint(
    "7ff544c2",
    "Role fits the place",
    ROLE,
    SETTING,
    {
        "knight": {
            "castle": {"mode": "boost", "factor": 4},
            "forest": {"mode": "reduce", "factor": 0.5},
        },
        "mage": {"castle": {"mode": "boost", "factor": 2}},
        "ranger": {
            "forest": {"mode": "boost", "factor": 4},
            "city": {"mode": "reduce", "factor": 0.3},
        },
        "inventor": {
            "city": {"mode": "boost", "factor": 4},
            "castle": {"mode": "exclude", "factor": 0},
            "forest": {"mode": "exclude", "factor": 0},
        },
    },
    "Re-weights Setting by the Role picked upstream: a knight favours the castle,"
    " an inventor stays in town, never in a castle or the forest.",
)

LORA_CHARACTER = derivation(
    "dd2bee53",
    "Character LoRA",
    "0420af2a",
    [branch("lora_character", "true", "subject", "replace", "$lora_character_words")],
    "While $lora_character is true: the LoRA's trigger words replace the whole $subject.",
)

LORA_CLOTHES = derivation(
    "435b5087",
    "Its own clothes",
    "7cf35a83",
    [branch("lora_clothes", "true", "outfit", "replace", "$lora_outfit_words")],
    "While $lora_clothes is true: the LoRA's trigger words replace $outfit.",
)

LORA_STYLE = derivation(
    "804fee67",
    "Style LoRA",
    "ddfcd524",
    [branch("style_lora", "true", "style", "append", " $lora_style_words")],
    "While $style_lora is true: the LoRA's trigger words go after $style.",
)


def settings_branch(family: str, size: str, sampler: str, cfg: str) -> dict:
    return branch(
        "model_family",
        family,
        "size",
        "replace",
        size,
        ("sampler", "replace", sampler),
        ("cfg", "replace", cfg),
    )


SETTINGS = derivation(
    "5b008dc7",
    "Settings per model",
    "e4788601",
    [
        settings_branch("sd15", "512x768", "euler ancestral", "7"),
        settings_branch("sdxl", "832x1216", "dpmpp 2m", "6"),
        settings_branch("flux", "896x1152", "euler", "1"),
    ],
    "Reads $model_family from WP Model Info: $size, $sampler and $cfg.",
    otherwise={
        "action": {"target_var": "size", "mode": "replace", "value": "1024x1024"},
        "extra_actions": [
            {"target_var": "sampler", "mode": "replace", "value": "euler"},
            {"target_var": "cfg", "mode": "replace", "value": "5"},
        ],
    },
)

MODULES = [
    ROLE, COLORS, HAIR, EYES, OUTFIT, HELD, SETTING, TIME, FRAMING, GEAR, COMPANION, QUALITY,
    SUBJECT, LIGHTING, SCENE, STYLE, OUTFIT_FITS, HELD_FITS, PLACE_FITS,
    LORA_CHARACTER, LORA_CLOTHES, LORA_STYLE, SETTINGS,
]  # fmt: skip

# --- Bundles ----------------------------------------------------------------------------------


def child(m: dict, enabled: bool = True) -> dict:
    return {
        "id": m["id"],
        "type": m["type"],
        "enabled": enabled,
        "collapsed": True,
        "meta": {"name": m["name"], "library_name": m["name"], "description": m["description"]},
        "entries": [],
        "payload": m["payload"],
    }


def ref(b: dict) -> dict:
    return {"id": b["id"], "type": "bundle", "name": b["name"], "color": b["color"]}


def bundle(bid: str, name: str, color: str, children: list[dict]) -> dict:
    return {
        "id": bid,
        "name": name,
        "description": "",
        "color": color,
        "category_id": None,
        "tags": [],
        "is_favorite": False,
        "children": children,
    }


SHARED = bundle("805bdfa4", "Shared lists", "#7a7f8a", [child(COLORS, enabled=False)])
LOOK = bundle("37af0127", "Look", "#9b6bff", [child(HAIR), child(EYES)])
WARDROBE = bundle(
    "b748104b",
    "Outfit",
    "#e0a030",
    [child(OUTFIT_FITS), child(HELD_FITS), child(OUTFIT), child(HELD)],
)
CHARACTER = bundle(
    "7e3d3ec2",
    "Character",
    "#4f8cff",
    [child(ROLE), ref(SHARED), ref(LOOK), child(SUBJECT), ref(WARDROBE)],
)
SCENE_B = bundle(
    "86360bc3",
    "Scene",
    "#2fb380",
    [
        child(PLACE_FITS),
        child(SETTING),
        child(TIME),
        child(LIGHTING),
        child(SCENE),
        child(FRAMING),
        child(STYLE),
    ],
)
LORAS = bundle(
    "3faee950",
    "LoRA swaps",
    "#d0508a",
    [child(LORA_CHARACTER), child(LORA_CLOTHES), child(LORA_STYLE)],
)
BUNDLES = [LOOK, LORAS, CHARACTER, SHARED, SCENE_B, WARDROBE]

# --- File -----------------------------------------------------------------------------------

ROW = {
    "category_id": None,
    "tags": [],
    "is_favorite": False,
    "version": 1,
    "created_at": NOW,
    "updated_at": NOW,
    "community_post_slug": None,
    "community_version_number": None,
    "content_rating": "safe",
}

KEYS = {
    "wildcard": "wildcards",
    "fixed_values": "fixed_values",
    "combine": "combines",
    "derivation": "derivations",
    "constraint": "constraints",
}


def main() -> None:
    out: dict = {"schema_version": 9, "exported_at": NOW, "bundles": []}
    for key in KEYS.values():
        out[key] = []
    out["categories"] = []
    out["templates"] = []
    for b in BUNDLES:
        out["bundles"].append({**ROW, **b})
    for m in MODULES:
        out[KEYS[m["type"]]].append({**ROW, **m})
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(MODULES)} modules, {len(BUNDLES)} bundles)")


if __name__ == "__main__":
    main()
