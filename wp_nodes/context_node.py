"""WP_Context — runs a module list and emits a PipelineContext payload."""

import contextlib
import hashlib
import json
import marshal
import threading
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine.db import queries
from engine.db.connection import get_connection, resolve_db_path
from engine.db.migrations import migrate
from engine.modules.snapshot import ref_seed_uuids, walk_transitive_refs
from engine.pipeline import FRAME0_CTX_KEY, PipelineEngine
from engine.seed_derive import effective_chain_seed
from wp_nodes.types import (
    FRAME0_KEY,
    ContextModulesInput,
    PipelineContext,
    build_payload,
    deserialize_node_input,
    frame0_payload,
)

#: DB files this process already migrated from the node path. The API routes
#: migrate at startup; this only covers a graph run that reaches the library
#: before them (or without them), and keeps the sha256 pass over every
#: migration file off each run.
_MIGRATED: set[str] = set()


def _migrate_once(conn) -> None:
    key = str(resolve_db_path())
    if key in _MIGRATED:
        return
    migrate(conn)
    _MIGRATED.add(key)


def _input_ctx(upstream_ctx: dict, upstream_internals: dict, catalog: dict) -> dict:
    """The ctx a run starts from: the upstream variables, the catalog, and
    the upstream cross-node internals."""
    ctx: dict = dict(upstream_ctx)
    # Inject catalog ONCE at the top of execute, before pipeline
    # run. Spec §2.6 — never re-inject mid-run.
    ctx["__wp_catalog__"] = catalog
    # Merge cross-node internals from the upstream payload —
    # `__wp_picks__` so a downstream constraint can read source
    # picks recorded in an earlier Context, `__wp_constraints__`
    # so a constraint registered upstream still applies to a
    # downstream target. Copy in defensively so this node's
    # mutations don't corrupt the upstream payload (frozen
    # dataclass implies the dict references are still shared).
    for key, value in upstream_internals.items():
        if isinstance(value, list):
            ctx[key] = list(value)
        elif isinstance(value, dict):
            ctx[key] = dict(value)
        elif isinstance(value, set):
            # Defensive copy of any set-valued cross-node internal so
            # upstream payload's set isn't mutated by this node's run.
            # (SP3 swapped the constraint bookkeeping from a set to
            # the `__wp_constraint_hits__` dict — handled by the dict
            # branch above — but keep this for any future set keys.)
            ctx[key] = set(value)
        else:
            ctx[key] = value
    return ctx


@dataclass(frozen=True)
class _Walked:
    """One expanded catalog plus every library read that produced it.

    Entries are stored marshalled, so each run gets its own fresh dicts and a
    run can never change what the next one reads. A `node` entry's payload is
    left out (stored as None) and filled in from the run's own widget value,
    which the cache key pins to the same content.
    """

    order: tuple[str, ...]
    entries: dict[str, bytes]
    node: frozenset[str]
    #: uuid -> the raw row the walk read (None: no such row), for every uuid
    #: the walk looked up in the library.
    reads: dict[str, Any]
    #: uuid -> live option count, for every node entry (pool provenance).
    counts: dict[str, int | None]


#: Expanded catalogs this process already walked, newest last. Key: (DB
#: path, digest of the node's widget value). See `_expand_catalog_via_live_db`.
_CATALOG_CACHE: OrderedDict[tuple[str, str], _Walked] = OrderedDict()
_CATALOG_CACHE_MAX = 8
_CATALOG_CACHE_LOCK = threading.Lock()


def _widget_key(raw: Any) -> str | None:
    """A digest of the node's widget value, or None when it can't be keyed.

    The expanded catalog is a pure function of the widget (its wildcards and
    every `@{uuid}` its modules reference) plus the library rows the walk
    reads, so the widget pins everything but the library side.
    """
    try:
        blob = raw if isinstance(raw, str) else json.dumps(
            raw, separators=(",", ":"), ensure_ascii=False,
        )
        return hashlib.sha256(blob.encode("utf-8", "surrogatepass")).hexdigest()
    except Exception:
        return None


def _cached_catalog(key: tuple[str, str], catalog: dict, conn) -> dict | None:
    """The cached expansion for `key`, rebuilt as fresh dicts, or None when
    there is none or the library changed under it."""
    with _CATALOG_CACHE_LOCK:
        hit = _CATALOG_CACHE.get(key)
        if hit is not None:
            _CATALOG_CACHE.move_to_end(key)
    if hit is None:
        return None
    try:
        # Exactly what the walk read: any library edit that could change the
        # result (an edited, added or deleted row it looked up, or a node
        # entry's live option count) misses here; nothing else can change it.
        rows = queries.module_rows(conn, hit.reads)
        if any(rows.get(uuid) != raw for uuid, raw in hit.reads.items()):
            return None
        live = queries.option_counts(conn, hit.counts)
        if any(live.get(uuid) != count for uuid, count in hit.counts.items()):
            return None
        out: dict = {}
        for uuid in hit.order:
            entry = marshal.loads(hit.entries[uuid])
            if uuid in hit.node:
                entry["payload"] = catalog[uuid]["payload"]
            out[uuid] = entry
        return out
    except Exception:
        return None


def _store_catalog(
    key: tuple[str, str], snapshots: dict, embedded: dict,
    reads: dict, counts: dict,
) -> None:
    try:
        node = frozenset(u for u in snapshots if u in embedded)
        entries = {
            uuid: marshal.dumps(
                {k: (None if k == "payload" and uuid in node else v) for k, v in entry.items()}
            )
            for uuid, entry in snapshots.items()
        }
    except (TypeError, ValueError):
        return  # not plain JSON data: don't cache
    walked = _Walked(
        order=tuple(snapshots), entries=entries, node=node,
        reads=dict(reads), counts=dict(counts),
    )
    with _CATALOG_CACHE_LOCK:
        _CATALOG_CACHE[key] = walked
        _CATALOG_CACHE.move_to_end(key)
        while len(_CATALOG_CACHE) > _CATALOG_CACHE_MAX:
            _CATALOG_CACHE.popitem(last=False)


def _expand_catalog_via_live_db(
    catalog: dict, modules: list | None = None, *, widget_key: str | None = None,
) -> dict:
    """Per-issue-#2: the embed-bundle endpoint no longer walks
    transitive ``@{}`` refs — workflow JSON only carries what the
    user explicitly picked. At graph-run time we fill in any nested
    wildcards by querying the live library on the executing machine.

    Strategy: feed the picked wildcards' uuids — PLUS every uuid referenced by
    any module on any surface (see ``_ref_seed_uuids``) — into
    ``walk_transitive_refs`` with a fetch callback that returns the
    embedded snapshot when available (so picked entries keep their
    saved payload — drift detection still works) and falls back to
    the live DB when a referenced uuid is NOT embedded.

    Failure modes:
      - DB not reachable / migrations not yet run → return embedded
        catalog as-is. Resolver will emit "Unknown wildcard ref"
        warnings for unresolved nested refs (existing lenient behavior).
      - Referenced uuid not in DB → walker records ``missing_target``;
        resolver still emits the warning at run time.

    The expansion is cached per (DB path, ``widget_key``) when the caller
    passes a key (``WPContext.execute`` does): every frame of a Context Loop
    and every repeat queue runs on the same widget value, so they reuse one
    walk. A hit is checked against the library first — the rows the walk
    read and the live option counts provenance stamped must be unchanged —
    so a library edit that could change the result always re-walks.
    """
    cache_key: tuple[str, str] | None = None
    if widget_key is not None:
        try:
            cache_key = (str(resolve_db_path()), widget_key)
        except Exception:
            cache_key = None
    with _CATALOG_CACHE_LOCK:
        cached = cache_key is not None and cache_key in _CATALOG_CACHE
    seeds: set[str] = set()
    if not cached:
        seeds = ref_seed_uuids(modules)
        if not catalog and not seeds:
            return catalog

    try:
        conn = get_connection()
    except Exception:
        # No DB access from this graph run (e.g. embedded ComfyUI
        # without the SPA stack) — return what we have.
        return catalog
    # One connection per run, closed when the walk is done (it used to stay
    # open: one leaked connection per WP_Context execution).
    with contextlib.closing(conn):
        try:
            _migrate_once(conn)
        except Exception:
            return catalog
        if cached and cache_key is not None:
            hit = _cached_catalog(cache_key, catalog, conn)
            if hit is not None:
                return hit
            seeds = ref_seed_uuids(modules)
        reads: dict = {}
        counts: dict = {}
        snapshots, clean = _walk_live(catalog, seeds, conn, reads, counts)
        if clean and cache_key is not None:
            _store_catalog(cache_key, snapshots, catalog, reads, counts)
        return snapshots


def _walk_live(
    catalog: dict, seeds, conn, reads: dict | None = None, counts: dict | None = None,
) -> tuple[dict, bool]:
    """The walk itself, on the caller's open connection.

    Returns ``(snapshots, clean)``. ``reads`` / ``counts`` (when given)
    collect every library row the walk looked up and every live option count
    provenance read; ``clean`` is False when a read failed, so the result
    must not be cached.
    """
    state = {"clean": True}

    def _fetch(uuid: str) -> dict | None:
        embedded = catalog.get(uuid)
        if embedded is not None:
            # Re-shape embedded SnapshotEntry → repo row shape so
            # walk_transitive_refs's downstream logic sees a
            # consistent dict.
            return {
                "id": uuid,
                "type": embedded["type"],
                "name": embedded.get("name", ""),
                "payload": embedded["payload"],
                "payload_hash": embedded.get("payload_hash", ""),
            }
        try:
            raw = queries.module_row(conn, uuid)
        except Exception:
            state["clean"] = False
            return None
        if reads is not None:
            reads[uuid] = raw
        if raw is None:
            return None
        try:
            payload = json.loads(raw[2])
        except Exception:
            return None
        # No `payload_hash`: the snapshot entry computes it from the payload.
        return {"id": uuid, "type": raw[0], "name": raw[1], "payload": payload}

    # Picked wildcards first so they keep `source: user`; ref-only targets
    # follow and land as deps. `walk_transitive_refs` skips a uuid it has
    # already snapshotted, so the overlap between the two is harmless.
    roots = list(catalog.keys()) + [u for u in sorted(seeds) if u not in catalog]
    walk = walk_transitive_refs(roots, fetch_module=_fetch)
    if not _stamp_pool_provenance(walk.snapshots, catalog, conn, counts):
        state["clean"] = False
    return walk.snapshots, state["clean"]


def _stamp_pool_provenance(
    snapshots: dict, embedded: dict, conn, counts: dict | None = None,
) -> bool:
    """Record, per catalog entry, WHERE its option pool came from.

    Runtime-only bookkeeping consumed by ``ref_option_pool`` when a filtered
    nested ref matches nothing. Without it that warning can only say "matched
    no options", which is true and useless: the user cannot tell whether the
    filter is wrong, or whether it is right but this node is holding a stale
    copy of a pool the library has since changed. That ambiguity is what made
    the nested-ref bug so hard to read from the Debug panel.

    Two fields:
      * ``pool_origin`` — ``"node"`` when the entry came from THIS node's
        embedded snapshot (which shadows the library), ``"library"`` when it
        was fetched because no module here holds that uuid.
      * ``library_option_count`` — only for ``node`` entries whose live
        library row now has a DIFFERENT number of options. Absent when they
        agree, so its presence alone means "this node's copy has drifted".

    Mutates in place. Never raises: this is diagnostic garnish, and a DB
    hiccup here must not take a graph run down with it (returns False when
    the library could not be read). The live counts come from one query that
    counts in SQL (`engine/db/queries.py`), not a decode of each row; they
    land in ``counts`` when given.

    The keys ride on the runtime catalog only — `__wp_catalog__` is stripped at
    the socket boundary and the workflow-embedded snapshot is built elsewhere,
    so neither reaches saved JSON.
    """
    node = [
        uuid for uuid, entry in snapshots.items()
        if isinstance(entry, dict) and uuid in embedded
    ]
    try:
        live = queries.option_counts(conn, node) if node else {}
    except Exception:
        live = None
    for uuid, entry in snapshots.items():
        if not isinstance(entry, dict):
            continue
        entry["pool_origin"] = "node" if uuid in embedded else "library"
    if live is None:
        return False
    for uuid in node:
        count = live.get(uuid)
        if counts is not None:
            counts[uuid] = count
        own_options = (snapshots[uuid].get("payload") or {}).get("options")
        if count is None or not isinstance(own_options, list):
            continue
        if count != len(own_options):
            snapshots[uuid]["library_option_count"] = count
    return True


def _node_id(cls: type) -> str:
    """This node's graph id when ComfyUI supplied it (tests call `execute`
    directly and get "")."""
    hidden = getattr(cls, "hidden", None)
    uid = getattr(hidden, "unique_id", None) if hidden is not None else None
    return str(uid) if uid is not None else ""


class WPContext(io.ComfyNode):
    """Context node: runs an ordered list of modules, emits PipelineContext."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_Context",
            display_name="WP Context",
            category="wildcard-pipeline",
            inputs=[
                PipelineContext.Input(
                    "upstream",
                    optional=True,
                    tooltip=(
                        "Optional upstream Context to extend. Variables pass "
                        "through; this node's modules add or override bindings "
                        "on top. Leave unconnected to start fresh."
                    ),
                ),
                io.Int.Input(
                    "seed",
                    default=0,
                    min=0,
                    max=0xFFFFFFFFFFFFFFFF,
                    control_after_generate=True,
                    tooltip=(
                        "Starting point for randomisation. Change for a "
                        "different roll; keep the same to reproduce. "
                        "Right-click → Convert widget to input to drive from "
                        "another seed node."
                    ),
                ),
                ContextModulesInput.Input("wp_modules", socketless=True),
            ],
            outputs=[PipelineContext.Output("context")],
            # The node's graph id, so WP Debug can say which Context ran what.
            hidden=[io.Hidden.unique_id],
            not_idempotent=True,
        )

    @classmethod
    def execute(cls, seed, wp_modules, upstream=None):
        upstream_ctx: dict = upstream.context if upstream is not None else {}
        upstream_debug: dict = upstream.debug if upstream is not None else {}
        upstream_internals: dict = (
            upstream.internals if upstream is not None else {}
        )

        # Unified-list model: one `modules` array holds every kind.
        # The catalog for `@{}` ref resolution is the wildcard subset,
        # synthesised on the fly. Then we expand that catalog with
        # any transitive nested wildcards by hitting the live library
        # — picker no longer auto-walks at pick time (issue #2).
        module_list, catalog, _pick_order = deserialize_node_input(wp_modules)
        # `module_list` (not just the wildcard catalog) so a `@{}` ref written
        # on a derivation action — or in its per-instance override — pulls its
        # target in too. See `ref_seed_uuids`.
        catalog = _expand_catalog_via_live_db(
            catalog, module_list, widget_key=_widget_key(wp_modules),
        )

        ctx = _input_ctx(upstream_ctx, upstream_internals, catalog)

        # Compute the actual chain seed for THIS iteration. When no
        # WP_ContextLoop is upstream, `upstream_internals` lacks both
        # keys → helper returns `widget_seed` unchanged (backwards-compat).
        # When ContextLoop is upstream with override_seed=true, the
        # override replaces the widget seed; loop_index>0 XORs in a
        # stable hash shift so each iteration walks a distinct seed.
        loop_index = int(upstream_internals.get("__wp_loop_index__", 0))
        chain_seed = effective_chain_seed(
            widget_seed=int(seed),
            seed_override=upstream_internals.get("__wp_seed_override__"),
            loop_index=loop_index,
        )
        # Hold base seed: the CONSTANT frame-0 seed so a held module resolves
        # the SAME base-frame value on every iteration. When the loop drives
        # seeds the per-iteration override varies, and effective_chain_seed
        # returns an override verbatim (ignoring loop_index), so loop_index=0
        # alone can't make it constant — read the loop's derived series head
        # (frame 0's seed) instead. Falls back to the widget seed when no loop
        # drives seeds (override off).
        _loop_seeds = upstream_internals.get("__wp_loop_seeds__")
        if isinstance(_loop_seeds, list) and _loop_seeds:
            hold_seed = int(_loop_seeds[0])
        else:
            hold_seed = effective_chain_seed(
                widget_seed=int(seed),
                seed_override=None,
                loop_index=0,
            )
        # Sweep mode with "hold other picks": every frame rolls the
        # non-swept modules on the frame-0 seed, so only the swept
        # wildcards (pinned per frame) change across the grid.
        if upstream_internals.get("__wp_sweep_hold__") is True:
            chain_seed = hold_seed
        # WP Debug detail: per-module explanations and the nested @{} picks.
        # Both are `__`-prefixed, so neither reaches the public context.
        ctx["__wp_explain__"] = True
        ctx["__wp_ref_log__"] = []
        # Inside a loop, frame 0's upstream payload rides along as
        # `__wp_frame0__`. The engine's hold base pass runs on it, so a held
        # module resolves against frame 0's inputs ($iteration and anything
        # upstream derived from it), not this frame's.
        frame0 = upstream_internals.get(FRAME0_KEY)
        if loop_index != 0 and isinstance(frame0, dict):
            frame0_ctx = _input_ctx(
                frame0.get("context") or {}, frame0.get("internals") or {}, catalog,
            )
            frame0_ctx["__wp_explain__"] = True
            frame0_ctx["__wp_ref_log__"] = []
            ctx[FRAME0_CTX_KEY] = frame0_ctx
        ctx = PipelineEngine().run(
            module_list,
            ctx=ctx,
            seed=chain_seed,
            hold_seed=hold_seed,
            loop_index=loop_index,
        )

        # Hand downstream nodes THIS node's frame-0 output, from the base pass.
        base_ctx = ctx.get("__wp_hold_base_ctx__")
        if loop_index != 0 and isinstance(base_ctx, dict):
            ctx[FRAME0_KEY] = frame0_payload(base_ctx)
        payload = build_payload(
            ctx,
            upstream_debug=upstream_debug,
            seed=chain_seed,
            node_id=_node_id(cls),
        )
        # Emit two seed-tracking values via the UI payload so the
        # frontend `executed` listener (widgets/context.ts) gets
        # authoritative state — works whether the seed was supplied
        # by this node's local widget OR by an upstream node feeding
        # the socket (the local widget value would be stale in that
        # case, but the engine always sees the real value here).
        #
        #   - `seed`: the chain seed actually used this run.
        #   - `module_seeds`: { module_id → effective_seed_used }
        #     for every module that ran. Effective = `locked_seed`
        #     when locked, chain seed otherwise. Wrapped in a list
        #     because ComfyUI's UI payload convention is value-as-array.
        # Key by per-instance `_uid` when present, falling back to the
        # library `id`. Without this, sibling rows (same library entry
        # instantiated twice in one Context) collapsed into a single
        # map entry — last sibling overwrote the others — and the
        # lock-toggle defaulted every sibling's locked_seed to the
        # last-executed sibling's roll, not its own. Pre-`_uid`
        # entries still get keyed by `id`, matching the old behaviour
        # for unmigrated workflows.
        module_seeds: dict[str, int] = {}
        for entry in ctx.get("__wp_trace__", []):
            uid = entry.get("_uid")
            mid = entry.get("id")
            key = uid if isinstance(uid, str) and uid else mid
            es = entry.get("seed")
            if isinstance(key, str) and key and isinstance(es, int):
                module_seeds[key] = es
        # The Loop's full derived per-iteration series (present only when the
        # Loop drives seeds via override). Captured by the frontend so the
        # per-frame seed lock pins the seed each frame ACTUALLY rolled THIS
        # run — robust to control_after_generate=randomize, where the live
        # seed widget has already rotated to the NEXT run's seed.
        _loop_seeds = upstream_internals.get("__wp_loop_seeds__")
        loop_seeds = [int(s) for s in _loop_seeds] if isinstance(_loop_seeds, list) else []
        return io.NodeOutput(
            payload,
            ui={
                "seed": [int(seed)],
                "module_seeds": [module_seeds],
                "loop_seeds": [loop_seeds],
            },
        )
