# ruff: noqa: E501
"""Seed a demo bundle into the wildcard-pipeline DB.

Creates one bundle named "demo_bundle" containing snapshots of up to
4 modules already in the user's library. Useful for testing the bundle
picker + insert flow before the SPA bundle editor ships.

Behavior:
  - Runs migrations so the bundles table exists.
  - If the bundles table already contains "demo_bundle", deletes it
    and re-creates from scratch (idempotent rebuild).
  - Picks the first N modules from the library, preferring a mix of
    wildcards + combines if available.
  - Snapshots each picked module's full payload + instance into the
    bundle's `children` JSON array — same shape `buildBundleInsertion`
    consumes at insert time.
  - Stamps a coral color (`#FB7185`) so the frame is visually distinct.

Usage::

    python scripts/seed_demo_bundle.py
    WP_DB_PATH=/tmp/seeded.db python scripts/seed_demo_bundle.py

If the library is empty, runs ``seed_mock_data`` first to populate it.
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
    BundleNotFound,
    BundleRepository,
    ModuleRepository,
)


def _module_to_child_snapshot(row: dict) -> dict:
    """Convert a ModuleRepository row into the child-snapshot shape
    ``buildBundleInsertion`` consumes. Keeps `id` + `type` (uuid will
    get regenerated at insert time) and embeds the full payload so the
    bundle is self-contained."""
    return {
        "id": row["id"],
        "type": row["type"],
        "enabled": True,
        "meta": {
            "name": row["name"],
            "description": row["description"],
            "tags": row["tags"],
        },
        "entries": [],
        "payload": row["payload"],
        "payload_hash": row["payload_hash"],
        "instance": {},
    }


def main() -> None:
    db_path = resolve_db_path()
    print(f"Using DB: {db_path}")

    conn = get_connection()
    try:
        migrate(conn)
        modules_repo = ModuleRepository(conn)
        bundle_repo = BundleRepository(conn)

        # If library is empty, point user at seed_mock_data first.
        all_modules = modules_repo.list(limit=20)
        if not all_modules:
            print("ERROR: library is empty.")
            print("Run `python scripts/seed_mock_data.py` first, then re-run this.")
            sys.exit(1)

        # Idempotency — drop a pre-existing demo bundle so re-running
        # this script is safe.
        for existing in bundle_repo.list():
            if existing["name"] == "demo_bundle":
                try:
                    bundle_repo.delete(existing["id"])
                    print(f"  Removed existing demo_bundle (id={existing['id']})")
                except BundleNotFound:
                    pass

        # Pick a mix: prefer wildcards (most interesting drift demo),
        # plus a combine if one exists. Cap at 4 to keep the bundle
        # compact for testing.
        wildcards = [m for m in all_modules if m["type"] == "wildcard"][:3]
        combines = [m for m in all_modules if m["type"] == "combine"][:1]
        picks = wildcards + combines
        if not picks:
            # Fallback: just take whatever the library has.
            picks = all_modules[:4]
        picks = picks[:4]

        children = [_module_to_child_snapshot(m) for m in picks]

        row = bundle_repo.create(
            name="demo_bundle",
            description="Demo bundle seeded by scripts/seed_demo_bundle.py",
            color="#FB7185",
            tags=["demo"],
            children=children,
            is_favorite=True,
        )

        print()
        print(f"  Created bundle: {row['name']}  id={row['id']}")
        print(f"    color = {row['color']}")
        print(f"    children = {len(row['children'])}")
        for c in row["children"]:
            print(f"      - {c['type']:<12} {c['meta']['name']:<20} id={c['id']}")
        print(f"    payload_hash = {row['payload_hash'][:16]}...")
        print()
        print("Open the WP Context node in ComfyUI → click + Add Bundle to insert.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
