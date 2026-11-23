"""WP_Context — runs a module list and emits a PipelineContext payload."""

import contextlib
import json
from typing import Any

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine import chain_ahead
from engine.db.connection import get_connection, resolve_db_path
from engine.db.migrations import migrate
from engine.db.repositories import ModuleNotFound, ModuleRepository
from engine.modules import _backward as backward
from engine.modules.snapshot import ref_seed_uuids, walk_transitive_refs
from engine.modules.wildcard_handler import OPTION_PICKS_KEY
from engine.pipeline import FRAME0_CTX_KEY, PipelineEngine
from engine.seed_derive import SEED_FROM_AUTO, resolve_context_seed
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


def _expand_catalog_via_live_db(catalog: dict, modules: list | None = None) -> dict:
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
    """
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
        return _walk_live(catalog, seeds, ModuleRepository(conn))


def _walk_live(catalog: dict, seeds, repo: ModuleRepository) -> dict:
    """The walk itself, on the caller's open repository."""

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
            return repo.get(uuid)
        except ModuleNotFound:
            return None
        except Exception:
            return None

    # Picked wildcards first so they keep `source: user`; ref-only targets
    # follow and land as deps. `walk_transitive_refs` skips a uuid it has
    # already snapshotted, so the overlap between the two is harmless.
    roots = list(catalog.keys()) + [u for u in sorted(seeds) if u not in catalog]
    walk = walk_transitive_refs(roots, fetch_module=_fetch)
    _stamp_pool_provenance(walk.snapshots, catalog, repo)
    return walk.snapshots


def _stamp_pool_provenance(
    snapshots: dict, embedded: dict, repo: ModuleRepository,
) -> None:
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
    hiccup here must not take a graph run down with it. The extra reads are
    one per embedded wildcard, at graph-run time, on a connection already open.

    The keys ride on the runtime catalog only — `__wp_catalog__` is stripped at
    the socket boundary and the workflow-embedded snapshot is built elsewhere,
    so neither reaches saved JSON.
    """
    for uuid, entry in snapshots.items():
        if not isinstance(entry, dict):
            continue
        from_node = uuid in embedded
        entry["pool_origin"] = "node" if from_node else "library"
        if not from_node:
            continue
        try:
            live = repo.get(uuid)
        except Exception:
            continue
        live_options = (live.get("payload") or {}).get("options")
        own_options = (entry.get("payload") or {}).get("options")
        if not isinstance(live_options, list) or not isinstance(own_options, list):
            continue
        if len(live_options) != len(own_options):
            entry["library_option_count"] = len(live_options)


def _seed_from(raw: Any) -> str:
    """The Context widget's ``seed_from`` ("auto" when absent or malformed)."""
    data = raw
    if isinstance(raw, str):
        try:
            data = json.loads(raw)
        except (TypeError, ValueError):
            return SEED_FROM_AUTO
    value = data.get("seed_from") if isinstance(data, dict) else None
    return value.strip() if isinstance(value, str) and value.strip() else SEED_FROM_AUTO


def _warn_seed_source_missing(ctx: dict, seed_from: str) -> None:
    """The picked seed source isn't upstream: the node ran on Auto."""
    warnings = ctx.get("__wp_warnings__")
    if not isinstance(warnings, list):
        return
    row = seed_from[len("row:"):] if seed_from.startswith("row:") else ""
    what = f"WP Seeds row {row!r}" if row else "a Context Loop"
    warnings.append({
        "type": "seed_source_missing",
        "severity": "warn",
        "module_id": "",
        "source_field": "",
        "position": 0,
        "token_index": None,
        "detail": {"seed_from": seed_from},
        "message": f"Seed from {what}, but none is upstream; used Auto",
    })


def _modules_ahead(cls: type) -> list[list[dict[str, Any]]]:
    """The module lists of the WP Context nodes after this one (backward
    rules look at their targets too). Empty in tests and without a prompt."""
    hidden = getattr(cls, "hidden", None)
    prompt = getattr(hidden, "prompt", None) if hidden is not None else None
    uid = getattr(hidden, "unique_id", None) if hidden is not None else None
    out: list[list[dict[str, Any]]] = []
    for raw in chain_ahead.downstream_modules(prompt, uid):
        try:
            mods, _catalog, _order = deserialize_node_input(raw)
        except Exception:  # noqa: BLE001 - a broken later node only ends the line
            break
        out.append(mods)
    return out


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
            # The prompt, so backward rules can see the WP Context nodes after
            # this one (`engine/chain_ahead.py`).
            hidden=[io.Hidden.unique_id, io.Hidden.prompt],
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
        catalog = _expand_catalog_via_live_db(catalog, module_list)

        ctx = _input_ctx(upstream_ctx, upstream_internals, catalog)

        # The chain seed for THIS iteration and the constant frame-0 hold
        # seed, from the source this node's "Seed from" picks (auto = the
        # Loop's seed when it overrides, else the widget shifted per frame;
        # loop / own / a WP Seeds row). A wired seed is only the widget's
        # value: it never wins by itself. See `resolve_context_seed`.
        loop_index = int(upstream_internals.get("__wp_loop_index__", 0))
        seed_from = _seed_from(wp_modules)
        chain_seed, hold_seed, seed_source = resolve_context_seed(
            widget_seed=int(seed),
            seed_from=seed_from,
            internals=upstream_internals,
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
        ahead = _modules_ahead(cls)
        if ahead:
            ctx[backward.AHEAD_KEY] = ahead
        ctx = PipelineEngine().run(
            module_list,
            ctx=ctx,
            seed=chain_seed,
            hold_seed=hold_seed,
            loop_index=loop_index,
        )

        if seed_from != SEED_FROM_AUTO and seed_source == SEED_FROM_AUTO:
            _warn_seed_source_missing(ctx, seed_from)

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
        # The option each wildcard use of THIS node picked,
        # by `_uid`, so the row lock's second state can pin it (lock value).
        own_uids = {
            e.get("_uid") for e in ctx.get("__wp_trace__", []) if isinstance(e, dict)
        }
        raw_picks = ctx.get(OPTION_PICKS_KEY)
        # A multi-pick use lists every option it picked.
        module_picks: dict[str, str | list[str]] = {
            str(uid): oid for uid, oid in (raw_picks.items() if isinstance(raw_picks, dict) else [])
            if uid in own_uids and (isinstance(oid, str) or isinstance(oid, list))
        }
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
                # The seed the chain actually ran with and where it came from
                # (auto / loop / own / row:<name>), for the Seed from chip.
                "seed_used": [int(chain_seed)],
                "seed_source": [seed_source],
                # One entry per frame run (ComfyUI joins a list run's UI
                # outputs), so the per-frame module lock pins the seed each
                # frame actually used, whatever the source.
                "frame_seeds": [{"frame": loop_index, "seed": int(chain_seed)}],
                # Same for the picks: one entry per frame run.
                "module_picks": [module_picks],
                "frame_picks": [{"frame": loop_index, "picks": module_picks}],
            },
        )
