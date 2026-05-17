# ruff: noqa: E501
"""Seed the wildcard-pipeline DB with mock data for integration testing.

Idempotent: re-running with the same DB skips entries that already exist
(matched by name + type). Designed so manual exploration of the SPA Manager,
ComfyUI graph, and Test Runner has realistic content to work against —
including nested ``@{8hex}`` references between wildcards, ``$var`` flow
across kinds, and constraint/derivation/pipeline composition.

Usage::

    # Default DB location (~/.comfyui/wildcard-pipeline.db on Linux/macOS,
    # C:\\Users\\<you>\\.comfyui\\wildcard-pipeline.db on Windows):
    python scripts/seed_mock_data.py

    # Override DB path:
    WP_DB_PATH=/tmp/seeded.db python scripts/seed_mock_data.py

The script prints every row it inserts and reports the resolved 8-hex UUIDs
so you can verify ``@{uuid}`` ref insertion in the SPA picker autocomplete
and the catalog walk against your live database.
"""
from __future__ import annotations

import sys
from pathlib import Path

# conftest's sys.path shim only kicks in under pytest; for a standalone
# script we add the repo root manually.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from engine.db.connection import get_connection, resolve_db_path  # noqa: E402
from engine.db.migrations import migrate  # noqa: E402
from engine.db.repositories import (  # noqa: E402
    CategoryRepository,
    ModuleRepository,
)

# ── Categories ──────────────────────────────────────────────────────────


CATEGORIES = [
    {"name": "Subjects", "color": "#a78bfa", "icon": "pi-user", "sort_order": 0},
    {"name": "Style", "color": "#f472b6", "icon": "pi-palette", "sort_order": 1},
    {"name": "Composition", "color": "#34d399", "icon": "pi-objects-column", "sort_order": 2},
    {"name": "Edge cases", "color": "#fb7185", "icon": "pi-exclamation-triangle", "sort_order": 3},
    {"name": "Quality", "color": "#fbbf24", "icon": "pi-sparkles", "sort_order": 4},
]


# ── Wildcards ───────────────────────────────────────────────────────────
#
# Use placeholder uuids in the @{} refs (see PLACEHOLDER_REFS below) — the
# script rewrites them post-create with the actual repository-generated uuids.

PLACEHOLDER_REFS = {
    "<COLOR_UUID>": "color",
    "<MOOD_UUID>": "mood",
    "<HAIR_UUID>": "hair_style",
    "<SHIRT_UUID>": "shirt",
    "<BACKDROP_UUID>": "backdrop",
    # Deep-chain test fixtures — chain_a → chain_b → chain_c → chain_d
    "<CHAIN_A_UUID>": "chain_a",
    "<CHAIN_B_UUID>": "chain_b",
    "<CHAIN_C_UUID>": "chain_c",
    "<CHAIN_D_UUID>": "chain_d",
    # Cycle test fixtures — cycle_a → cycle_b → cycle_a (walker should
    # record `cycle_detected` overflow without infinite-looping)
    "<CYCLE_A_UUID>": "cycle_a",
    "<CYCLE_B_UUID>": "cycle_b",
    # Self-ref edge case — self_ref → @{self_ref} (immediate cycle)
    "<SELF_REF_UUID>": "self_ref",
}


WILDCARDS = [
    {
        "name": "color",
        "category": "Style",
        "tags": ["palette", "core"],
        "is_favorite": True,
        "var_binding": "color",
        "sub_categories": ["warm", "cool", "neutral"],
        "options": [
            {"value": "red", "weight": 1, "sub_category": "warm"},
            {"value": "burnt orange", "weight": 1, "sub_category": "warm"},
            {"value": "blue", "weight": 1, "sub_category": "cool"},
            {"value": "emerald green", "weight": 2, "sub_category": "cool"},
            {"value": "deep violet", "weight": 1, "sub_category": "cool"},
            {"value": "slate grey", "weight": 1, "sub_category": "neutral"},
            {"value": "ivory", "weight": 1, "sub_category": "neutral"},
        ],
    },
    {
        "name": "mood",
        "category": "Style",
        "tags": ["atmosphere", "core"],
        "is_favorite": True,
        "var_binding": "mood",
        "sub_categories": ["positive", "negative"],
        "options": [
            {"value": "serene", "weight": 1, "sub_category": "positive"},
            {"value": "playful", "weight": 1, "sub_category": "positive"},
            {"value": "joyful", "weight": 1, "sub_category": "positive"},
            {"value": "tense", "weight": 1, "sub_category": "negative"},
            {"value": "melancholic", "weight": 1, "sub_category": "negative"},
        ],
    },
    {
        "name": "hair_style",
        "category": "Subjects",
        "tags": ["body", "appearance"],
        "var_binding": "hair_style",
        "sub_categories": ["long", "short"],
        "options": [
            {"value": "long flowing", "weight": 1, "sub_category": "long"},
            {"value": "wavy shoulder-length", "weight": 1, "sub_category": "long"},
            {"value": "braided down the back", "weight": 1, "sub_category": "long"},
            {"value": "short cropped", "weight": 1, "sub_category": "short"},
            {"value": "buzz cut", "weight": 1, "sub_category": "short"},
            {"value": "pixie cut", "weight": 1, "sub_category": "short"},
        ],
    },
    {
        "name": "shirt",
        "category": "Subjects",
        "tags": ["clothing", "torso"],
        "var_binding": "shirt",
        "sub_categories": ["formal", "casual"],
        "options": [
            # Single-level @-ref into color
            {"value": "@{<COLOR_UUID>} t-shirt", "weight": 2, "sub_category": "casual"},
            {"value": "@{<COLOR_UUID>} hoodie", "weight": 1, "sub_category": "casual"},
            {"value": "white linen shirt", "weight": 1, "sub_category": "formal"},
            {"value": "@{<COLOR_UUID>} silk blouse", "weight": 1, "sub_category": "formal"},
            {"value": "tailored @{<COLOR_UUID>} button-down", "weight": 1, "sub_category": "formal"},
        ],
    },
    {
        "name": "outfit",
        "category": "Subjects",
        "tags": ["clothing", "favorite-test"],
        "is_favorite": True,
        "var_binding": "outfit",
        "sub_categories": [],
        "options": [
            # Nested 2-deep ref: outfit → shirt → color
            {"value": "@{<SHIRT_UUID>} with denim jeans", "weight": 2, "sub_category": None},
            # Inline pick mixed with single ref
            {"value": "{leather|wool} jacket over @{<SHIRT_UUID>}", "weight": 1, "sub_category": None},
            # Multi-pick with separator
            {"value": "{2$$, $$silver|gold|pearl} jewelry", "weight": 1, "sub_category": None},
            # Deep-chain ref into the chain test fixtures (3 levels)
            {"value": "@{<CHAIN_A_UUID>} accessories", "weight": 1, "sub_category": None},
        ],
    },
    {
        "name": "backdrop",
        "category": "Composition",
        "tags": ["scene", "environment"],
        "var_binding": "backdrop",
        "sub_categories": ["indoor", "outdoor"],
        "options": [
            {"value": "studio seamless paper", "weight": 1, "sub_category": "indoor"},
            {"value": "minimal interior with @{<COLOR_UUID>} accents", "weight": 1, "sub_category": "indoor"},
            {"value": "@{<MOOD_UUID>} city street at dusk", "weight": 1, "sub_category": "outdoor"},
            {"value": "forest clearing under @{<COLOR_UUID>} sky", "weight": 1, "sub_category": "outdoor"},
            {"value": "rocky beach at golden hour", "weight": 1, "sub_category": "outdoor"},
        ],
    },
    # ── Deep-chain stress test (4 levels: A → B → C → D → leaf) ────────
    {
        "name": "chain_a",
        "category": "Edge cases",
        "tags": ["walker-test", "depth-test"],
        "var_binding": "chain_a",
        "sub_categories": [],
        "options": [
            {"value": "A-leaf-1", "weight": 1, "sub_category": None},
            {"value": "A→@{<CHAIN_B_UUID>}", "weight": 2, "sub_category": None},
        ],
    },
    {
        "name": "chain_b",
        "category": "Edge cases",
        "tags": ["walker-test", "depth-test"],
        "var_binding": "chain_b",
        "sub_categories": [],
        "options": [
            {"value": "B-leaf", "weight": 1, "sub_category": None},
            {"value": "B→@{<CHAIN_C_UUID>}", "weight": 2, "sub_category": None},
        ],
    },
    {
        "name": "chain_c",
        "category": "Edge cases",
        "tags": ["walker-test", "depth-test"],
        "var_binding": "chain_c",
        "sub_categories": [],
        "options": [
            {"value": "C-leaf", "weight": 1, "sub_category": None},
            {"value": "C→@{<CHAIN_D_UUID>}", "weight": 2, "sub_category": None},
        ],
    },
    {
        "name": "chain_d",
        "category": "Edge cases",
        "tags": ["walker-test", "depth-test"],
        "var_binding": "chain_d",
        "sub_categories": [],
        "options": [
            {"value": "D-deep-leaf", "weight": 1, "sub_category": None},
        ],
    },
    # ── Cycle pair (A → B → A) — walker overflow test ────────────────
    {
        "name": "cycle_a",
        "category": "Edge cases",
        "tags": ["walker-test", "cycle-test"],
        "var_binding": "cycle_a",
        "sub_categories": [],
        "options": [
            {"value": "cyc-a-leaf", "weight": 1, "sub_category": None},
            {"value": "A→@{<CYCLE_B_UUID>}", "weight": 1, "sub_category": None},
        ],
    },
    {
        "name": "cycle_b",
        "category": "Edge cases",
        "tags": ["walker-test", "cycle-test"],
        "var_binding": "cycle_b",
        "sub_categories": [],
        "options": [
            {"value": "cyc-b-leaf", "weight": 1, "sub_category": None},
            {"value": "B→@{<CYCLE_A_UUID>}", "weight": 1, "sub_category": None},
        ],
    },
    # ── Self-ref edge case (immediate cycle on self) ─────────────────
    {
        "name": "self_ref",
        "category": "Edge cases",
        "tags": ["walker-test", "cycle-test"],
        "var_binding": "self_ref",
        "sub_categories": [],
        "options": [
            {"value": "self-leaf", "weight": 1, "sub_category": None},
            {"value": "loop→@{<SELF_REF_UUID>}", "weight": 1, "sub_category": None},
        ],
    },
    # ── Single-option (no randomness) ────────────────────────────────
    {
        "name": "signature",
        "category": "Edge cases",
        "tags": ["edge-case"],
        "var_binding": "signature",
        "sub_categories": [],
        "options": [
            {"value": "©2026 mock", "weight": 1, "sub_category": None},
        ],
    },
    # ── Heavy-weight bias (one option ~10x more likely) ──────────────
    {
        "name": "weighted_demo",
        "category": "Edge cases",
        "tags": ["edge-case", "weights"],
        "var_binding": "weighted_demo",
        "sub_categories": [],
        "options": [
            {"value": "common-result", "weight": 10, "sub_category": None},
            {"value": "rare-result", "weight": 1, "sub_category": None},
        ],
    },
]


# ── Fixed values ────────────────────────────────────────────────────────


FIXED_VALUES = [
    {
        "name": "presets",
        "category": "Quality",
        "tags": ["preset", "quality", "core"],
        "is_favorite": True,
        "values": [
            {"id": "v_quality", "name": "quality", "value": "high detail, sharp focus"},
            {"id": "v_camera", "name": "camera", "value": "85mm portrait lens"},
            {"id": "v_negative", "name": "negative", "value": "blurry, low quality, distorted"},
            {"id": "v_aspect", "name": "aspect_ratio", "value": "3:4 portrait"},
        ],
    },
    {
        "name": "model_settings",
        "category": "Quality",
        "tags": ["preset", "model"],
        "values": [
            {"id": "v_steps", "name": "steps", "value": "30"},
            {"id": "v_cfg", "name": "cfg", "value": "7.5"},
            {"id": "v_sampler", "name": "sampler", "value": "DPM++ 2M Karras"},
        ],
    },
    {
        "name": "negatives_extended",
        "category": "Quality",
        "tags": ["preset", "negative"],
        "values": [
            {"id": "v_neg_anatomy", "name": "neg_anatomy",
             "value": "extra fingers, malformed hands, asymmetrical eyes"},
            {"id": "v_neg_artifacts", "name": "neg_artifacts",
             "value": "jpeg artifacts, watermark, signature, text overlay"},
        ],
    },
]


# ── Combines ────────────────────────────────────────────────────────────


COMBINES = [
    {
        "name": "subject_phrase",
        "category": "Subjects",
        "tags": ["combine", "subject", "core"],
        "is_favorite": True,
        # Pulls $hair_style + $outfit (which transitively chains through
        # @{shirt} → @{color}) plus $mood from upstream.
        "template": "a portrait of a person with $hair_style hair, wearing $outfit, $mood expression",
        "output_var": "subject_phrase",
        "input_vars": ["hair_style", "outfit", "mood"],
    },
    {
        "name": "scene_phrase",
        "category": "Composition",
        "tags": ["combine", "scene"],
        "template": "$subject_phrase, set against $backdrop, $camera, $quality",
        "output_var": "scene_phrase",
        "input_vars": ["subject_phrase", "backdrop", "camera", "quality"],
    },
    # Combine with inline brace-pick syntax inside the template (exercises
    # both $var resolution AND inline {a|b|c} expansion).
    {
        "name": "framing",
        "category": "Composition",
        "tags": ["combine", "framing"],
        "template": "{close-up|medium shot|wide angle} on $subject_phrase, $lighting",
        "output_var": "framing",
        "input_vars": ["subject_phrase", "lighting"],
    },
    # Combine that consumes the derivation-produced var (mood_to_lighting → $lighting).
    {
        "name": "final_prompt",
        "category": "Composition",
        "tags": ["combine", "final"],
        "template": "$framing. $aspect_ratio, $sampler, cfg $cfg, steps $steps. avoid: $negative, $neg_anatomy",
        "output_var": "final_prompt",
        "input_vars": ["framing", "aspect_ratio", "sampler", "cfg", "steps", "negative", "neg_anatomy"],
    },
]


# ── Derivations ─────────────────────────────────────────────────────────


DERIVATIONS = [
    {
        "name": "mood_to_lighting",
        "category": "Style",
        "tags": ["derivation", "lighting", "core"],
        "is_favorite": True,
        # IF / ELIF / ELSE chain over `equals` op. Mutates `lighting`.
        "rules": [
            {
                "id": "r_lighting",
                "branches": [
                    {
                        "condition": {"var": "mood", "op": "equals", "value": "tense"},
                        "action": {"target_var": "lighting", "mode": "replace",
                                   "value": "harsh side lighting with deep shadows"},
                    },
                    {
                        "condition": {"var": "mood", "op": "equals", "value": "serene"},
                        "action": {"target_var": "lighting", "mode": "replace",
                                   "value": "soft golden hour glow"},
                    },
                    {
                        "condition": {"var": "mood", "op": "equals", "value": "playful"},
                        "action": {"target_var": "lighting", "mode": "replace",
                                   "value": "bright airy daylight"},
                    },
                ],
                "else": {
                    "action": {"target_var": "lighting", "mode": "replace",
                               "value": "neutral diffused light"},
                },
            }
        ],
    },
    # Exercise all four condition operators (equals, not_equals, contains,
    # matches) plus all three action modes (replace, append, prepend).
    {
        "name": "color_modifiers",
        "category": "Style",
        "tags": ["derivation", "operators-test"],
        "rules": [
            # Rule 1: `not_equals` — anything that isn't a warm color triggers
            # an "ambient" prepend on the negative var.
            {
                "id": "r_op_not_equals",
                "branches": [
                    {
                        "condition": {"var": "color", "op": "not_equals", "value": "red"},
                        "action": {"target_var": "negative", "mode": "prepend",
                                   "value": "no red tint, "},
                    },
                ],
            },
            # Rule 2: `contains` — if outfit mentions "jacket", append a
            # texture cue.
            {
                "id": "r_op_contains",
                "branches": [
                    {
                        "condition": {"var": "outfit", "op": "contains", "value": "jacket"},
                        "action": {"target_var": "quality", "mode": "append",
                                   "value": ", visible fabric texture"},
                    },
                ],
            },
            # Rule 3: `matches` — regex against backdrop. Triggers when the
            # backdrop string starts with "forest".
            {
                "id": "r_op_matches",
                "branches": [
                    {
                        "condition": {"var": "backdrop", "op": "matches", "value": "^forest"},
                        "action": {"target_var": "lighting", "mode": "append",
                                   "value": ", dappled canopy light"},
                    },
                ],
            },
        ],
    },
]


# ── Constraints ────────────────────────────────────────────────────────


CONSTRAINTS = [
    {
        "name": "shirt_x_color_compat",
        "category": "Subjects",
        "tags": ["constraint", "subcategory-matrix"],
        # Sub-category × sub-category matrix: rows = source sub_cats,
        # cols = target sub_cats. The "no formal-shirt-with-warm-colors"
        # rule keeps the seeded library's combinations a bit more
        # opinionated. Per-option overrides belong in `exceptions`.
        "source_wildcard": "shirt",
        "target_wildcard": "color",
        "matrix": {
            "formal": {
                "warm": {"mode": "reduce", "factor": 0.4},
            },
        },
        "exceptions": [
            # Carry the original "white linen × red is hard out" intent
            # across as a per-option exception so the test fixture's
            # narrative still matches.
            {"source": "white linen shirt", "target": "red", "mode": "exclude", "factor": 0},
        ],
    },
    # Sub-category-keyed matrix — matrix rows/cols are sub-category names
    # rather than full option strings. Constraint editor's "show by sub-
    # category" toggle should pick these up.
    {
        "name": "mood_x_color_subcats",
        "category": "Style",
        "tags": ["constraint", "subcategory-matrix", "core"],
        "is_favorite": True,
        "source_wildcard": "mood",
        "target_wildcard": "color",
        "matrix": {
            # negative moods boosted with cool colors, reduced with warm ones
            "negative": {
                "cool": {"mode": "boost", "factor": 2.0},
                "warm": {"mode": "reduce", "factor": 0.3},
            },
            # positive moods do the inverse
            "positive": {
                "warm": {"mode": "boost", "factor": 1.8},
                "cool": {"mode": "allow", "factor": 1.0},
                "neutral": {"mode": "reduce", "factor": 0.5},
            },
        },
        # Exception: tense + ivory should be hard-excluded even though the
        # sub-cat matrix says "negative × neutral" is allow.
        "exceptions": [
            {"source": "tense", "target": "ivory", "mode": "exclude", "factor": 0},
        ],
    },
    # Hair-style x mood compatibility — multiple exceptions to test the
    # exception-table editor at scale.
    {
        "name": "hair_x_mood",
        "category": "Subjects",
        "tags": ["constraint", "exceptions-heavy"],
        "source_wildcard": "hair_style",
        "target_wildcard": "mood",
        "matrix": {
            "long": {"positive": {"mode": "allow", "factor": 1.0}},
            "short": {"positive": {"mode": "allow", "factor": 1.0}},
        },
        "exceptions": [
            {"source": "buzz cut", "target": "serene", "mode": "reduce", "factor": 0.3},
            {"source": "buzz cut", "target": "tense", "mode": "boost", "factor": 1.6},
            {"source": "braided down the back", "target": "playful", "mode": "boost", "factor": 1.4},
            {"source": "pixie cut", "target": "joyful", "mode": "boost", "factor": 1.5},
        ],
    },
]


# ── Helpers ────────────────────────────────────────────────────────────


def _category_id_for(repo: CategoryRepository, name: str | None) -> str | None:
    if not name:
        return None
    for row in repo.list():
        if row["name"] == name:
            return row["id"]
    return None


def _ensure_category(repo: CategoryRepository, spec: dict) -> dict:
    for row in repo.list():
        if row["name"] == spec["name"]:
            print(f"  · category '{spec['name']}' already present (id={row['id']})")
            return row
    row = repo.create(
        name=spec["name"],
        color=spec.get("color"),
        icon=spec.get("icon"),
        sort_order=spec.get("sort_order", 0),
    )
    print(f"  + category '{row['name']}' (id={row['id']})")
    return row


def _existing_module_by_name(repo: ModuleRepository, name: str, type_: str) -> dict | None:
    for row in repo.list(type=type_):
        if row["name"] == name:
            return row
    return None


def _ensure_wildcard(
    mod_repo: ModuleRepository, cat_repo: CategoryRepository, spec: dict,
) -> dict:
    payload = {
        "options": [{"id": f"opt_{i}", **opt} for i, opt in enumerate(spec["options"])],
        "var_binding": spec["var_binding"],
        "sub_categories": list(spec.get("sub_categories", [])),
    }
    existing = _existing_module_by_name(mod_repo, spec["name"], "wildcard")
    if existing is not None:
        # In-place update so re-runs of the seed picker pick up new fields
        # (sub_categories, is_favorite, expanded options, additional tags)
        # WITHOUT changing the uuid — every constraint / pipeline payload
        # that references this wildcard by `id` keeps working.
        updated = mod_repo.update(
            existing["id"],
            name=spec["name"],
            category_id=_category_id_for(cat_repo, spec.get("category")),
            tags=spec.get("tags", []),
            payload=payload,
            is_favorite=bool(spec.get("is_favorite", False)),
        )
        print(f"  ~ wildcard '{spec['name']}' updated (uuid={updated['id']})")
        return updated
    row = mod_repo.create(
        type="wildcard",
        name=spec["name"],
        description="",
        category_id=_category_id_for(cat_repo, spec.get("category")),
        tags=spec.get("tags", []),
        payload=payload,
        is_favorite=bool(spec.get("is_favorite", False)),
    )
    print(f"  + wildcard '{row['name']}' (uuid={row['id']})")
    return row


def _rewrite_refs(
    mod_repo: ModuleRepository, wildcards: dict[str, dict],
) -> None:
    """Second pass — replace placeholder ``@{<NAME_UUID>}`` tokens in every
    wildcard option value with the real ``@{8hex}`` from `wildcards`."""
    name_to_uuid = {wc["name"]: wc["id"] for wc in wildcards.values()}
    print("  · rewriting @{<NAME>_UUID} placeholders → real uuids …")
    for wc in wildcards.values():
        payload = dict(wc["payload"])
        options = payload.get("options", [])
        changed = False
        new_options: list[dict] = []
        for opt in options:
            value = opt.get("value", "")
            new_value = value
            for placeholder, target_name in PLACEHOLDER_REFS.items():
                if target_name in name_to_uuid:
                    new_value = new_value.replace(
                        placeholder, name_to_uuid[target_name],
                    )
            if new_value != value:
                changed = True
            new_options.append({**opt, "value": new_value})
        if changed:
            payload["options"] = new_options
            updated = mod_repo.update(wc["id"], payload=payload)
            print(f"    · {wc['name']} (uuid={updated['id']}): rewrote refs")


def _ensure_fixed(
    mod_repo: ModuleRepository, cat_repo: CategoryRepository, spec: dict,
) -> dict:
    payload = {"values": spec["values"]}
    existing = _existing_module_by_name(mod_repo, spec["name"], "fixed_values")
    if existing is not None:
        updated = mod_repo.update(
            existing["id"],
            name=spec["name"],
            category_id=_category_id_for(cat_repo, spec.get("category")),
            tags=spec.get("tags", []),
            payload=payload,
            is_favorite=bool(spec.get("is_favorite", False)),
        )
        print(f"  ~ fixed_values '{spec['name']}' updated (uuid={updated['id']})")
        return updated
    row = mod_repo.create(
        type="fixed_values",
        name=spec["name"],
        description="",
        category_id=_category_id_for(cat_repo, spec.get("category")),
        tags=spec.get("tags", []),
        payload=payload,
        is_favorite=bool(spec.get("is_favorite", False)),
    )
    print(f"  + fixed_values '{row['name']}' (uuid={row['id']})")
    return row


def _ensure_combine(
    mod_repo: ModuleRepository, cat_repo: CategoryRepository, spec: dict,
) -> dict:
    payload = {
        "template": spec["template"],
        "output_var": spec["output_var"],
        "input_vars": spec.get("input_vars", []),
    }
    existing = _existing_module_by_name(mod_repo, spec["name"], "combine")
    if existing is not None:
        updated = mod_repo.update(
            existing["id"],
            name=spec["name"],
            category_id=_category_id_for(cat_repo, spec.get("category")),
            tags=spec.get("tags", []),
            payload=payload,
            is_favorite=bool(spec.get("is_favorite", False)),
        )
        print(f"  ~ combine '{spec['name']}' updated (uuid={updated['id']})")
        return updated
    row = mod_repo.create(
        type="combine",
        name=spec["name"],
        description="",
        category_id=_category_id_for(cat_repo, spec.get("category")),
        tags=spec.get("tags", []),
        payload=payload,
        is_favorite=bool(spec.get("is_favorite", False)),
    )
    print(f"  + combine '{row['name']}' (uuid={row['id']})")
    return row


def _ensure_derivation(
    mod_repo: ModuleRepository, cat_repo: CategoryRepository, spec: dict,
) -> dict:
    payload = {"rules": spec["rules"]}
    existing = _existing_module_by_name(mod_repo, spec["name"], "derivation")
    if existing is not None:
        updated = mod_repo.update(
            existing["id"],
            name=spec["name"],
            category_id=_category_id_for(cat_repo, spec.get("category")),
            tags=spec.get("tags", []),
            payload=payload,
            is_favorite=bool(spec.get("is_favorite", False)),
        )
        print(f"  ~ derivation '{spec['name']}' updated (uuid={updated['id']})")
        return updated
    row = mod_repo.create(
        type="derivation",
        name=spec["name"],
        description="",
        category_id=_category_id_for(cat_repo, spec.get("category")),
        tags=spec.get("tags", []),
        payload=payload,
        is_favorite=bool(spec.get("is_favorite", False)),
    )
    print(f"  + derivation '{row['name']}' (uuid={row['id']})")
    return row


def _ensure_constraint(
    mod_repo: ModuleRepository, cat_repo: CategoryRepository,
    wildcards: dict[str, dict], spec: dict,
) -> dict:
    src = wildcards[spec["source_wildcard"]]
    tgt = wildcards[spec["target_wildcard"]]
    payload = {
        "source_wildcard_id": src["id"],
        "target_wildcard_id": tgt["id"],
        "matrix": spec["matrix"],
        "exceptions": spec["exceptions"],
    }
    existing = _existing_module_by_name(mod_repo, spec["name"], "constraint")
    if existing is not None:
        updated = mod_repo.update(
            existing["id"],
            name=spec["name"],
            category_id=_category_id_for(cat_repo, spec.get("category")),
            tags=spec.get("tags", []),
            payload=payload,
            is_favorite=bool(spec.get("is_favorite", False)),
        )
        print(f"  ~ constraint '{spec['name']}' updated (uuid={updated['id']})")
        return updated
    row = mod_repo.create(
        type="constraint",
        name=spec["name"],
        description="",
        category_id=_category_id_for(cat_repo, spec.get("category")),
        tags=spec.get("tags", []),
        payload=payload,
        is_favorite=bool(spec.get("is_favorite", False)),
    )
    print(f"  + constraint '{row['name']}' (uuid={row['id']})")
    return row


def main() -> int:
    db_path = resolve_db_path()
    print(f"Seeding mock data into: {db_path}")
    conn = get_connection()
    migrate(conn)

    cat_repo = CategoryRepository(conn)
    mod_repo = ModuleRepository(conn)

    print("\n[Categories]")
    for spec in CATEGORIES:
        _ensure_category(cat_repo, spec)

    print("\n[Wildcards]")
    wildcards: dict[str, dict] = {}
    for spec in WILDCARDS:
        row = _ensure_wildcard(mod_repo, cat_repo, spec)
        wildcards[row["name"]] = row

    # Second pass: rewrite placeholder refs to real uuids
    _rewrite_refs(mod_repo, wildcards)
    # Refresh cache so downstream sees the updated payloads
    for name in list(wildcards.keys()):
        wildcards[name] = mod_repo.get(wildcards[name]["id"])

    print("\n[Fixed values]")
    fixed: dict[str, dict] = {}
    for spec in FIXED_VALUES:
        row = _ensure_fixed(mod_repo, cat_repo, spec)
        fixed[row["name"]] = row

    print("\n[Combines]")
    combines: dict[str, dict] = {}
    for spec in COMBINES:
        row = _ensure_combine(mod_repo, cat_repo, spec)
        combines[row["name"]] = row

    print("\n[Derivations]")
    derivations: dict[str, dict] = {}
    for spec in DERIVATIONS:
        row = _ensure_derivation(mod_repo, cat_repo, spec)
        derivations[row["name"]] = row

    print("\n[Constraints]")
    for spec in CONSTRAINTS:
        _ensure_constraint(mod_repo, cat_repo, wildcards, spec)

    print("\nDone. Seeded uuids worth poking at:")
    for name, row in wildcards.items():
        print(f"  wildcard '{name}': @{{{row['id']}}}")

    print("\nQuick sanity checks you can run from the SPA:")
    print("  · Test Runner on 'outfit' → samples should resolve nested refs")
    print("    (outfit → shirt → color, max chain depth 2)")
    print("  · Test Runner on 'scene_phrase' (combine) → uses upstream $vars")

    return 0


if __name__ == "__main__":
    sys.exit(main())
