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
import re
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
    """Default per-snapshot instance overrides. Fresh dict per call."""
    return {
        "variable_binding": "",
        "enabled_options": None,
        "category_filter": None,
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
    ``library_id`` and ``instance`` keys.
    """
    if "instance" in raw and "library_id" in raw:
        return raw

    payload: dict[str, Any]
    if raw.get("type") == "fixed_values" and "entries" in raw:
        legacy_entries = raw.get("entries", [])
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
        payload = raw.get("payload", {})

    meta = raw.get("meta") or {}
    return {
        "library_id": raw.get("library_id"),
        "library_snapshot_at": raw.get("library_snapshot_at"),
        "library_version_at_snapshot": raw.get("library_version_at_snapshot"),
        "type": raw.get("type", "fixed_values"),
        "name": raw.get("name") or meta.get("name", ""),
        "category_id": raw.get("category_id"),
        "payload": payload,
        "instance": _fresh_instance(),
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


_AT_UUID_RE = re.compile(r"@\{([^}]+)\}")


def _extract_at_uuid_refs(payload: dict[str, Any]) -> set[str]:
    """Collect all ``@{...}`` identifiers referenced inside a payload's
    string-typed leaves.  Uses ``tokenize_text`` for canonical 8-hex-char
    refs; falls back to a broader pattern for any ``@{...}`` token that the
    strict tokenizer emits as plain TEXT (e.g. during tests or when IDs are
    temporarily non-canonical).  The catalog look-up at call-site is the
    authoritative filter — unknown refs become ``missing_target`` overflow.

    Surface-agnostic: collects from any string in the dict/list tree;
    the caller decides which module types have their payloads walked
    (spec §2.7)."""
    refs: set[str] = set()

    def _scan(value: Any) -> None:
        if isinstance(value, str):
            # First pass: canonical 8-hex refs via tokenizer.
            tokenizer_refs: set[str] = set()
            for tok in tokenize_text(value):
                if tok.kind == TokenKind.REF:
                    uid = (tok.meta or {}).get("uuid")
                    if isinstance(uid, str):
                        refs.add(uid)
                        tokenizer_refs.add(uid)
            # Second pass: broader @{...} scan for any refs the strict
            # tokenizer did not recognise (non-canonical uuid formats).
            for m in _AT_UUID_RE.finditer(value):
                candidate = m.group(1)
                if candidate not in tokenizer_refs:
                    refs.add(candidate)
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
    """Convert a repository row dict to a canonical SnapshotEntry."""
    return {
        "snapshot_version": 1,
        "uuid": row["uuid"],
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
