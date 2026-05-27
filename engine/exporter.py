"""Export payload builder. Transitive ref walk + inner-bundle
auto-include + 8-bucket grouping.

Pure relative to DB — reads via repositories only, no writes.
Stateless: caller passes the requested UUID sets, exporter returns
the full payload including auto-resolved bundle dependencies.

Module rows are routed by type: a UUID passed in `wildcard_uuids` is
looked up and emitted into `wildcards[]` ONLY if the module's type is
'wildcard'. Mis-typed UUIDs are silently skipped (filter, not error)
so the picker UI's loose type tracking can't accidentally cross-pollinate
buckets.

Inner-bundle resolution: bundle ``children[]`` entries with
``type == "bundle"`` are stored as reference objects with ``id``,
``type``, ``name``, ``color`` fields (not full snapshots). The transitive
walk follows these references until a fixed point, then includes every
reachable bundle in the export.
"""
from __future__ import annotations

import sqlite3
from typing import Any

from engine._utils import now_iso
from engine.db.repositories import (
    BundleNotFound,
    BundleRepository,
    CategoryNotFound,
    CategoryRepository,
    ModuleNotFound,
    ModuleRepository,
    TemplateNotFound,
    TemplateRepository,
)
from engine.migrations import CURRENT_SCHEMA_VERSION


def _walk_inner_bundles(repo: BundleRepository, seed: list[str]) -> list[str]:
    """Transitive walk of inner-bundle refs starting from ``seed``.

    For each bundle, its ``children[]`` entries with ``type=='bundle'``
    carry an ``id`` field pointing to the referenced bundle. Walk until
    a fixed point (visited set prevents cycles). Returns sorted list of
    all reachable bundle UUIDs (including seed members that exist).

    Missing UUIDs in seed are silently dropped — the caller may pass
    stale ids; we log no error and return only what exists.
    """
    visited: set[str] = set()
    queue = list(seed)
    while queue:
        uuid = queue.pop()
        if uuid in visited:
            continue
        try:
            b = repo.get(uuid)
        except BundleNotFound:
            continue
        visited.add(uuid)
        children = b.get("children") or []
        for child in children:
            if not isinstance(child, dict):
                continue
            if child.get("type") == "bundle":
                child_id = child.get("id")
                if isinstance(child_id, str) and child_id not in visited:
                    queue.append(child_id)
    return sorted(visited)


def _modules_by_type(
    repo: ModuleRepository,
    uuids: list[str],
    expected_type: str,
) -> list[dict[str, Any]]:
    """Look up modules by UUID, filter to expected type, drop misses.

    Returns rows in input order (mod the type filter), each carrying
    ``snapshot_fingerprint`` already stamped by repository writes.

    A UUID that doesn't exist in the DB or belongs to a different type
    is silently skipped — the picker UI's UUID sets may be imprecise and
    the exporter must never raise on a bad cross-bucket reference.
    """
    out: list[dict[str, Any]] = []
    for uuid in uuids:
        try:
            row = repo.get(uuid)
        except ModuleNotFound:
            continue
        if row.get("type") != expected_type:
            continue
        out.append(row)
    return out


def build_export_payload(
    conn: sqlite3.Connection,
    *,
    bundle_uuids: list[str],
    wildcard_uuids: list[str],
    fixed_values_uuids: list[str],
    combine_uuids: list[str],
    derivation_uuids: list[str],
    constraint_uuids: list[str],
    category_uuids: list[str],
    template_uuids: list[str],
) -> dict[str, Any]:
    """Build the 8-bucket export payload.

    Performs:
    - Transitive inner-bundle walk from ``bundle_uuids`` seed
    - Type-gated module resolution (UUID in wrong bucket → silently skipped)
    - Category lookup by id
    - Template lookup by id (templates have their own repo/table; a
      missing id is silently dropped)

    Returns a dict ready for JSON serialisation.
    """
    bundle_repo = BundleRepository(conn)
    module_repo = ModuleRepository(conn)
    category_repo = CategoryRepository(conn)

    # Bundles: transitive walk, then bulk fetch in walk order (sorted).
    resolved_bundle_uuids = _walk_inner_bundles(bundle_repo, bundle_uuids)
    bundles: list[dict[str, Any]] = []
    for uuid in resolved_bundle_uuids:
        try:
            bundles.append(bundle_repo.get(uuid))
        except BundleNotFound:
            pass  # was reachable during walk but deleted in a race — skip

    wildcards = _modules_by_type(module_repo, wildcard_uuids, "wildcard")
    fixed_values = _modules_by_type(module_repo, fixed_values_uuids, "fixed_values")
    combines = _modules_by_type(module_repo, combine_uuids, "combine")
    derivations = _modules_by_type(module_repo, derivation_uuids, "derivation")
    constraints = _modules_by_type(module_repo, constraint_uuids, "constraint")

    categories: list[dict[str, Any]] = []
    for uuid in category_uuids:
        try:
            categories.append(category_repo.get(uuid))
        except CategoryNotFound:
            pass

    template_repo = TemplateRepository(conn)
    templates: list[dict[str, Any]] = []
    for uuid in template_uuids:
        try:
            templates.append(template_repo.get(uuid))
        except TemplateNotFound:
            pass

    return {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "exported_at": now_iso(),
        "bundles": bundles,
        "wildcards": wildcards,
        "fixed_values": fixed_values,
        "combines": combines,
        "derivations": derivations,
        "constraints": constraints,
        "categories": categories,
        "templates": templates,
    }
