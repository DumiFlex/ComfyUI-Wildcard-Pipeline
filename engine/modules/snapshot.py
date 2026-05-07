"""Snapshot freezing, content hashing, legacy-shape coercion, and transitive
ref walking.

A *snapshot* is the JSON shape embedded in a ComfyUI workflow's WP_Context
node when a user picks a library row. The snapshot is decoupled from the
library: graph execution reads only the snapshot, never the live DB.

Backward-compat: pre-SPA fixed_values modules in saved workflows lack the
``library_*`` and ``instance`` keys. ``coerce_legacy_module`` upgrades them
in-place to the canonical shape (still detached, ``library_id is None``).
"""
from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict

from engine._utils import now_iso as _now_iso
from engine.syntax.tokenize import tokenize_text
from engine.syntax.types import TokenKind


class _SourceUser(TypedDict):
    kind: Literal["user"]


class _SourceDep(TypedDict):
    kind: Literal["dep"]
    parent_uuids: list[str]


SnapshotSource = _SourceUser | _SourceDep


class SnapshotEntry(TypedDict):
    """Canonical shape stored in `__wp_catalog__` and embedded in
    WP_Context workflow JSON. Spec §2.4 — pinned, do not rename fields.

    `payload_hash` covers `payload` only (not name/description/tags) so
    a rename does not flip drift state. `source` records why the entry
    is in the embed: explicit user pick vs. transitive dep of one or
    more picks (multi-parent supported)."""
    snapshot_version: Literal[1]
    uuid: str            # 8 hex chars
    type: str            # ModuleType — wildcards-only in catalog (spec §2.7)
    name: str            # display label
    payload: dict[str, Any]
    payload_hash: str    # SHA-256 of payload
    source: SnapshotSource


def _fresh_instance() -> dict[str, Any]:
    """Default per-snapshot instance overrides. Fresh dict per call.

    Invariant: every field defaults to ``None``. The frontend
    "modified-state" predicate is ``value != null``, so any non-None
    sentinel (e.g. ``""`` for a string field, ``False`` for a bool)
    would falsely light up the orange dot, force the modal to default
    to the Instance tab, and tag the section as modified — even on a
    pristine snapshot. Engine readers already tolerate ``None`` (see
    ``wildcard_handler.py:216`` for the binding fallback chain and
    ``pipeline.py:160`` for the internal-flag coercion), so we keep a
    single contract: ``None`` everywhere = "no override, use library
    default".
    """
    return {
        "variable_binding": None,
        "enabled_options": None,
        "category_filter": None,
        "option_weights": None,
        # Pick mode — `None`/missing → `random` (legacy behavior:
        # weighted RNG over enabled options). `pinned` short-circuits
        # the RNG and always picks `pinned_option_id`. `subcategory`
        # is currently identical to `random` engine-side; the modal
        # uses it as a UX framing for "manual subset via enabled_options".
        "mode": None,
        "pinned_option_id": None,
        # Lock — when set, derives a stable per-instance RNG seed
        # independent of the chain's `__wp_node_seed__`. Means the
        # wildcard's pick stays the same value across runs even when
        # the user cycles the Context node's seed. `None` = roll with
        # the chain seed (default).
        "locked_seed": None,
        # Internal — when True, every binding this module produces is
        # marked engine-only by `PipelineEngine.run` (via
        # `__wp_internal_flags__`). Downstream modules still see the
        # value; the public socket payload doesn't. ``None`` is coerced
        # to ``False`` at the read site, so the default stays "off".
        "internal": None,
        "disabled_rule_ids": None,
        "disabled_exception_keys": None,
        "disabled_matrix_cells": None,
    }


def payload_hash(payload: dict[str, Any]) -> str:
    """SHA-256 of canonical JSON. Stable across key order + whitespace."""
    canonical = json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def freeze_snapshot(library_row: dict[str, Any]) -> dict[str, Any]:
    """Build the JSON shape that gets embedded in a node's modules array."""
    return {
        "library_id": library_row["id"],
        "library_snapshot_at": _now_iso(),
        "library_version_at_snapshot": library_row["version"],
        "type": library_row["type"],
        "name": library_row["name"],
        "category_id": library_row.get("category_id"),
        "payload": library_row["payload"],
        "instance": _fresh_instance(),
    }


def coerce_legacy_module(raw: dict[str, Any]) -> dict[str, Any]:
    """Upgrade a legacy module dict to canonical snapshot shape.

    Idempotent: returns ``raw`` unchanged if it already has both
    ``library_id`` and ``instance`` keys (the legacy "frozen" shape).

    SPA-picked modules don't carry ``library_id`` (the picked uuid IS
    the library id, stored as ``id``), but they may carry an
    ``instance`` dict with user overrides (option enable/disable,
    weight overrides). Merge those onto the fresh-instance defaults
    instead of stomping them with ``_fresh_instance()`` below.
    """
    if "instance" in raw and "library_id" in raw:
        return raw

    # Capture caller-supplied instance early so we can merge it with
    # defaults once the rest of the snapshot is built. Missing → empty.
    raw_instance = raw.get("instance")
    user_instance = raw_instance if isinstance(raw_instance, dict) else {}

    payload: dict[str, Any]
    if raw.get("type") == "fixed_values":
        # Two shapes can land here:
        #
        #   1. Inline-created (legacy): `entries: [{variable_name, value}]`
        #      with no `payload.values`. Translate entries → values.
        #   2. Library-picked (post-5.5.4): `payload: {values: [...]}` with
        #      an empty `entries: []` (the field is always present so the
        #      ContextWidget conflict-scanner doesn't have to null-check).
        #      Use `payload` directly — translating its empty entries
        #      would zero out a perfectly good values list.
        raw_payload = raw.get("payload") or {}
        legacy_entries = raw.get("entries") or []
        if legacy_entries and not raw_payload.get("values"):
            payload = {
                "values": [
                    {
                        "id": f"val_{i:04x}",
                        "name": e.get("variable_name", ""),
                        "value": e.get("value", ""),
                    }
                    for i, e in enumerate(legacy_entries)
                ],
            }
        else:
            payload = raw_payload
    else:
        payload = raw.get("payload", {})

    meta = raw.get("meta") or {}
    instance = _fresh_instance()
    instance.update(user_instance)
    return {
        "library_id": raw.get("library_id"),
        "library_snapshot_at": raw.get("library_snapshot_at"),
        "library_version_at_snapshot": raw.get("library_version_at_snapshot"),
        "type": raw.get("type", "fixed_values"),
        "name": raw.get("name") or meta.get("name", ""),
        "category_id": raw.get("category_id"),
        "payload": payload,
        "instance": instance,
    }


# ---------------------------------------------------------------------------
# Transitive-ref walker (spec §2.7, §2.8, §2.10, §6)
# ---------------------------------------------------------------------------


class WalkOverflow(TypedDict):
    """Walker-recorded anomaly. Returned alongside the partial snapshot
    bundle; never aborts the walk. Spec §2.8."""
    uuid: str
    reason: Literal["max_depth", "cycle_detected", "missing_target"]


@dataclass
class WalkResult:
    """Return value of `walk_transitive_refs`. Two fields, two concerns:
    `snapshots` is the materialised catalog dict; `walk_overflow` lists
    every uuid the walker could not include (cycle, depth, miss)."""
    snapshots: dict[str, SnapshotEntry] = field(default_factory=dict)
    walk_overflow: list[WalkOverflow] = field(default_factory=list)


def _extract_at_uuid_refs(payload: dict[str, Any]) -> set[str]:
    """Collect all ``@{8hex}`` refs referenced inside a payload's
    string-typed leaves.  Uses ``tokenize_text`` exclusively — only
    canonical 8-hex-char refs (spec §2.4) are followed.

    Surface-agnostic: collects from any string in the dict/list tree;
    the caller decides which module types have their payloads walked
    (spec §2.7)."""
    refs: set[str] = set()

    def _scan(value: Any) -> None:
        if isinstance(value, str):
            for tok in tokenize_text(value):
                if tok.kind == TokenKind.REF:
                    uid = (tok.meta or {}).get("uuid")
                    if isinstance(uid, str):
                        refs.add(uid)
        elif isinstance(value, dict):
            for v in value.values():
                _scan(v)
        elif isinstance(value, list):
            for item in value:
                _scan(item)

    _scan(payload)
    return refs


def _row_to_snapshot_entry(
    row: dict[str, Any], source: SnapshotSource,
) -> SnapshotEntry:
    """Convert a repository row dict to a canonical SnapshotEntry.

    Post migration 004 the row's `id` IS the canonical 8-hex uuid;
    there is no separate `uuid` field. The snapshot schema still
    names the field `uuid` because that's the published wire format
    embedded in workflow JSON — we just source it from `row["id"]`.
    """
    return {
        "snapshot_version": 1,
        "uuid": row["id"],
        "type": row["type"],
        "name": row["name"],
        "payload": row["payload"],
        "payload_hash": row.get("payload_hash") or payload_hash(row["payload"]),
        "source": source,
    }


def walk_transitive_refs(
    root_uuids: Iterable[str],
    *,
    fetch_module: Callable[[str], dict[str, Any] | None],
    max_depth: int = 8,
) -> WalkResult:
    """Lazy transitive walker. Spec §2.10.

    Starts from ``root_uuids``, follows ``@{8hex}`` refs in wildcard payloads
    only (spec §2.7), and returns a ``WalkResult`` containing every reachable
    SnapshotEntry plus a list of overflow records (cycle, depth, missing).

    Cycle detection uses a per-path ancestor frozenset carried with each BFS
    queue entry. When we pop ``(uuid, depth, parent, ancestors)`` and find
    ``uuid`` already in ``ancestors``, we record ``cycle_detected`` and skip
    without emitting the node. This means the node that *caused* the cycle
    reference is already snapshotted (it was emitted when we first reached it
    on a shorter path), so both sides of a two-node cycle appear in snapshots.

    Engine isolation invariant: this function does NOT import from ``engine.db``
    or ``wp_api``; the caller injects a ``fetch_module(uuid) -> row | None``
    callable. WP_Context graph nodes never call this — they receive a
    pre-walked dict embedded in workflow JSON.
    """
    result = WalkResult()
    # parent_map: uuid -> list of direct parent uuids (accumulated across BFS)
    parent_map: dict[str, list[str]] = {}
    seen_overflow: set[tuple[str, str]] = set()

    def _record_overflow(uuid: str, reason: str) -> None:
        key = (uuid, reason)
        if key in seen_overflow:
            return
        seen_overflow.add(key)
        result.walk_overflow.append(
            {"uuid": uuid, "reason": reason},  # type: ignore[arg-type]
        )

    # Queue items: (uuid, depth, parent_uuid_or_None, ancestor_frozenset)
    # ancestor_frozenset contains all uuids on the path from a root to *before*
    # this node — used to detect back-edges (cycles).
    queue: list[tuple[str, int, str | None, frozenset[str]]] = []

    for u in root_uuids:
        queue.append((u, 0, None, frozenset()))

    while queue:
        uuid, depth, parent, ancestors = queue.pop(0)

        # Track parentage before any short-circuit so multi-parent deps
        # accumulate even if we have already snapshotted the child.
        if parent is not None:
            parent_map.setdefault(uuid, [])
            if parent not in parent_map[uuid]:
                parent_map[uuid].append(parent)

        # Cycle: this uuid appears on the path from a root to here.
        if uuid in ancestors:
            _record_overflow(uuid, "cycle_detected")
            continue

        # Already snapshotted on a shorter BFS path — skip emission but
        # parent tracking above already ran, so multi-parent deps accumulate.
        if uuid in result.snapshots:
            continue

        if depth > max_depth:
            _record_overflow(uuid, "max_depth")
            continue

        row = fetch_module(uuid)
        if row is None:
            _record_overflow(uuid, "missing_target")
            continue

        # Determine source based on whether this uuid has a parent.
        if parent is None:
            source: SnapshotSource = {"kind": "user"}
        else:
            source = {"kind": "dep", "parent_uuids": list(parent_map[uuid])}
        result.snapshots[uuid] = _row_to_snapshot_entry(row, source)

        # Only walk wildcard payloads — spec §2.7.
        if row.get("type") != "wildcard":
            continue

        new_ancestors = ancestors | {uuid}
        for child_uuid in _extract_at_uuid_refs(row["payload"]):
            queue.append((child_uuid, depth + 1, uuid, new_ancestors))

    # After walk: re-stamp every dep's parent list (BFS may have accumulated
    # additional parents after first emission).
    for uuid, parents in parent_map.items():
        if uuid not in result.snapshots:
            continue
        existing = result.snapshots[uuid]
        if existing["source"]["kind"] == "dep":
            existing["source"]["parent_uuids"] = list(parents)

    return result
