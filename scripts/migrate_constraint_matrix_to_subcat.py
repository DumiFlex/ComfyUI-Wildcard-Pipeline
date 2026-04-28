# ruff: noqa: E501
"""One-shot migration: rewrite constraint matrices keyed by source-option
VALUE to be keyed by source SUB_CATEGORY instead.

Why this exists
---------------
Pre-2026-04-28 the SPA constraint editor put OPTION VALUES on the row
axis and SUB_CATEGORIES on the column axis. We flipped to sub-category
on both axes (the matrix expresses category-level rules; per-option
overrides moved to the Exceptions table). Constraints saved under the
old contract have ``payload.matrix`` shaped as::

    { "<source option value>": { "<target sub_category>": cell, ... }, ... }

…which renders zero cells in the new UI because none of the row keys
match a source sub_category. Their data is preserved in the payload but
not editable.

This script walks each `constraint` module, looks up the source
wildcard's options, builds a `value → sub_category` map, and rewrites
the matrix keys::

    { "<source sub_category>": { "<target sub_category>": cell, ... }, ... }

When multiple value rows in the legacy matrix map to the same source
sub_category, the LAST cell wins for any given target column. The
script prints a "merged" warning so you can review.

Already-migrated rows (keys that exist in source.payload.sub_categories)
are skipped — the script is idempotent and safe to re-run.

Usage
-----
::

    # Dry-run first — prints what would change, writes nothing.
    python scripts/migrate_constraint_matrix_to_subcat.py --dry-run

    # Apply for real:
    python scripts/migrate_constraint_matrix_to_subcat.py

    # Override DB path:
    WP_DB_PATH=/tmp/lib.db python scripts/migrate_constraint_matrix_to_subcat.py
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from engine.db.connection import get_connection, resolve_db_path  # noqa: E402
from engine.db.migrations import migrate  # noqa: E402
from engine.db.repositories import ModuleRepository  # noqa: E402


def _build_value_to_subcat(source_payload: dict) -> dict[str, str]:
    """Return a `{option_value: sub_category}` map for the source wildcard.

    Options without a sub_category, or with an empty/None sub_category,
    are skipped — they had no constraint expressible at the sub-category
    level under the new contract."""
    out: dict[str, str] = {}
    for opt in (source_payload.get("options") or []):
        value = opt.get("value")
        sub = opt.get("sub_category")
        if isinstance(value, str) and value and isinstance(sub, str) and sub:
            out[value] = sub
    return out


def _migrate_one(
    constraint: dict,
    repo: ModuleRepository,
    *,
    dry_run: bool,
) -> tuple[bool, list[str]]:
    """Migrate a single constraint's matrix in place.

    Returns ``(changed, log_lines)``. ``changed`` is True if the matrix
    actually needed rewriting (and was rewritten unless `dry_run`).
    `log_lines` describes per-row decisions for the summary."""
    payload = dict(constraint["payload"])
    matrix = payload.get("matrix") or {}
    if not isinstance(matrix, dict) or not matrix:
        return False, [f"  · {constraint['name']}: empty matrix, skip"]

    src_id = payload.get("source_wildcard_id")
    if not isinstance(src_id, str):
        return False, [
            f"  ! {constraint['name']}: missing source_wildcard_id, skip",
        ]

    try:
        source = repo.get(src_id)
    except Exception:
        return False, [
            f"  ! {constraint['name']}: source wildcard {src_id!r} not found, skip",
        ]

    src_subcats = set(
        (source.get("payload") or {}).get("sub_categories") or [],
    )
    value_to_subcat = _build_value_to_subcat(source.get("payload") or {})

    new_matrix: dict[str, dict] = {}
    log: list[str] = []
    rewritten = False

    for row_key, row_cells in matrix.items():
        if not isinstance(row_cells, dict):
            log.append(f"    ! row {row_key!r} not a dict, dropped")
            rewritten = True
            continue
        if row_key in src_subcats:
            # Already a sub-category row — keep as-is. Merge if a value-row
            # remap also resolved to this same sub-category in this loop.
            merged = {**new_matrix.get(row_key, {}), **row_cells}
            if row_key in new_matrix and merged != new_matrix[row_key]:
                log.append(f"    ~ subcat row {row_key!r} merged with prior value-mapped row")
            new_matrix[row_key] = merged
            continue

        target_subcat = value_to_subcat.get(row_key)
        if target_subcat is None:
            log.append(
                f"    ! row {row_key!r} is neither a sub-category nor a "
                f"known option value — dropped",
            )
            rewritten = True
            continue

        if target_subcat in new_matrix:
            log.append(
                f"    ~ value row {row_key!r} → subcat {target_subcat!r} "
                f"(merged with prior cells; last cell wins per target col)",
            )
        else:
            log.append(f"    ~ value row {row_key!r} → subcat {target_subcat!r}")
        new_matrix[target_subcat] = {**new_matrix.get(target_subcat, {}), **row_cells}
        rewritten = True

    if not rewritten:
        return False, [f"  · {constraint['name']}: already subcat-keyed, skip"]

    log.insert(0, f"  ~ {constraint['name']} ({constraint['id']})")
    if not dry_run:
        payload["matrix"] = new_matrix
        repo.update(constraint["id"], payload=payload)

    return True, log


def main() -> int:
    summary = (__doc__ or "").split("\n\n")[0]
    parser = argparse.ArgumentParser(description=summary)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would change without writing to the DB.",
    )
    args = parser.parse_args()

    db_path = resolve_db_path()
    print(f"Migrating constraint matrices in: {db_path}")
    if args.dry_run:
        print("(dry-run — no writes)")

    conn = get_connection()
    migrate(conn)
    repo = ModuleRepository(conn)

    constraints = repo.list(type="constraint")
    print(f"\nFound {len(constraints)} constraint module(s).\n")

    changed = 0
    skipped = 0
    for c in constraints:
        did_change, log_lines = _migrate_one(c, repo, dry_run=args.dry_run)
        for line in log_lines:
            print(line)
        if did_change:
            changed += 1
        else:
            skipped += 1

    print()
    print(f"Done. {changed} migrated, {skipped} skipped.")
    if args.dry_run and changed:
        print("Re-run without --dry-run to apply.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
