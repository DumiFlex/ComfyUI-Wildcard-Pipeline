"""Generate engine-parity fixtures for the community validator suite.

WHY THIS EXISTS
---------------
The community-web TS validators (`src/validators/`) are a hand-authored
re-implementation of the engine's payload shapes. Re-implementations
drift: fixed_values was published for weeks as `entries/{variable_name}`
when the engine has always used `values/{id,name,value}`; wildcard
options omitted the real `is_null` field; etc. Every drift surfaced as a
publish failure in front of a user.

This script makes the ENGINE the single source of truth. For each module
subtype it builds a sample payload, runs it through that subtype's own
`Handler.validate_payload` (the engine authority -- raises if the sample
is not engine-valid), and dumps the engine-row shape to a committed
fixture. The companion test `src/validators/__tests__/engine-parity.test.ts`
asserts the STRICT community validator accepts every fixture.

Result: if the engine shape changes (a handler gains/renames a field) the
sample stops validating here and this script fails; if the TS validator
drifts from the engine, the parity test fails. Drift is caught at CI time
instead of in front of a publisher.

USAGE
-----
    python scripts/dump_engine_shapes.py

Run it whenever an engine module shape changes, then commit the updated
fixtures. Exit 0 = all samples engine-valid + written; exit 1 = a sample
is no longer engine-valid (fix the sample to match the new shape).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# Make `engine` importable when run as a bare script (mirrors the
# tests/conftest.py sys.path shim).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.modules.combine_handler import CombineHandler  # noqa: E402
from engine.modules.constraint_handler import ConstraintHandler  # noqa: E402
from engine.modules.derivation_handler import DerivationHandler  # noqa: E402
from engine.modules.fixed_values_handler import FixedValuesHandler  # noqa: E402
from engine.modules.wildcard_handler import WildcardHandler  # noqa: E402

# Output dir, relative to repo root (this file lives in scripts/).
_OUT_DIR = (
    Path(__file__).resolve().parent.parent
    / "src" / "validators" / "fixtures" / "engine-parity"
)

# Each entry: (handler, type-specific payload). The payload must pass the
# handler's validate_payload -- keep these as the MINIMAL real shape per
# subtype, including fields that the strip-tolerant validator must
# preserve (e.g. wildcard `is_null`).
_SAMPLES: dict[str, tuple[type, dict]] = {
    "wildcard": (
        WildcardHandler,
        {
            "var_binding": "mood",
            "sub_categories": ["soft", "bold"],
            "options": [
                {"id": "opt00001", "value": "serene", "weight": 1, "sub_category": "soft"},
                # Null option: the is_null contract. Must round-trip
                # through the validator or install rebuilds it as an
                # invalid empty-value option.
                {"id": "opt00002", "value": "", "weight": 1, "sub_category": None, "is_null": True},
            ],
        },
    ),
    "fixed_values": (
        FixedValuesHandler,
        {"values": [{"id": "val00001", "name": "style", "value": "oil painting"}]},
    ),
    "combine": (
        CombineHandler,
        {"template": "$mood $subject", "output_var": "scene", "input_vars": ["mood", "subject"]},
    ),
    "derivation": (
        DerivationHandler,
        {
            "rules": [
                {
                    "id": "rule0001",
                    "branches": [
                        {
                            "condition": {
                                "var": "mood", "op": "equals", "value": "dramatic",
                            },
                            "action": {
                                "target_var": "accent", "mode": "replace",
                                "value": "cinematic lighting",
                            },
                        },
                    ],
                    "else": {
                        "action": {
                            "target_var": "accent", "mode": "replace",
                            "value": "soft lighting",
                        },
                    },
                },
            ],
        },
    ),
    "constraint": (
        ConstraintHandler,
        {
            "source_wildcard_id": "src00001",
            "target_wildcard_id": "tgt00001",
            "exceptions": [],
            "matrix": {"soft": {"bold": {"mode": "boost", "factor": 3}}},
        },
    ),
}


def _engine_row(type_id: str, payload: dict) -> dict:
    """Wrap a type-specific payload in the canonical engine-row shape
    the publisher ships (see manager/import-export/single-row-publish.ts:
    buildModulePublishable)."""
    return {
        "id": f"parity{type_id[:2]}",
        "type": type_id,
        "name": f"parity-{type_id}",
        "description": "",
        "category_id": None,
        "tags": [],
        "is_favorite": False,
        "payload": payload,
    }


def main() -> int:
    _OUT_DIR.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []
    for type_id, (handler, payload) in _SAMPLES.items():
        try:
            # Engine authority: this raises if the sample is not a valid
            # payload for the CURRENT engine handler.
            handler.validate_payload(payload)
        except Exception as exc:  # noqa: BLE001 -- report any validation failure
            failures.append(f"{type_id}: sample is no longer engine-valid: {exc}")
            continue
        row = _engine_row(type_id, payload)
        out = _OUT_DIR / f"{type_id}.json"
        out.write_text(json.dumps(row, indent=2) + "\n", encoding="utf-8")
        print(f"[parity] wrote {out.relative_to(_OUT_DIR.parent.parent.parent)}")

    if failures:
        print("\n[parity] FAILED -- update the sample(s) to match the engine:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        return 1
    print(f"[parity] {len(_SAMPLES)} engine-valid fixtures written to {_OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
