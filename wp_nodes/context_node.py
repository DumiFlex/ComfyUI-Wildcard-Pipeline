"""WP_Context — runs a module list and emits a PipelineContext payload."""

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine.db.connection import get_connection
from engine.db.migrations import migrate
from engine.db.repositories import ModuleNotFound, ModuleRepository
from engine.modules.snapshot import walk_transitive_refs
from engine.pipeline import PipelineEngine
from engine.seed_derive import effective_chain_seed
from wp_nodes.types import (
    ContextModulesInput,
    PipelineContext,
    build_payload,
    deserialize_node_input,
)


def _expand_catalog_via_live_db(catalog: dict) -> dict:
    """Per-issue-#2: the embed-bundle endpoint no longer walks
    transitive ``@{}`` refs — workflow JSON only carries what the
    user explicitly picked. At graph-run time we fill in any nested
    wildcards by querying the live library on the executing machine.

    Strategy: feed the picked wildcards' uuids into
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
    if not catalog:
        return catalog

    try:
        conn = get_connection()
        migrate(conn)
        repo = ModuleRepository(conn)
    except Exception:
        # No DB access from this graph run (e.g. embedded ComfyUI
        # without the SPA stack) — return what we have.
        return catalog

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

    walk = walk_transitive_refs(list(catalog.keys()), fetch_module=_fetch)
    return walk.snapshots


class WPContext(io.ComfyNode):
    """Context node: runs an ordered list of modules, emits PipelineContext."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_Context",
            display_name="WP Context",
            category="wildcard-pipeline",
            inputs=[
                PipelineContext.Input("upstream", optional=True),
                io.Int.Input(
                    "seed",
                    default=0,
                    min=0,
                    max=0xFFFFFFFFFFFFFFFF,
                    control_after_generate=True,
                ),
                ContextModulesInput.Input("modules", socketless=True),
            ],
            outputs=[PipelineContext.Output("context")],
            not_idempotent=True,
        )

    @classmethod
    def execute(cls, seed, modules, upstream=None):
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
        module_list, catalog, _pick_order = deserialize_node_input(modules)
        catalog = _expand_catalog_via_live_db(catalog)

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
            else:
                ctx[key] = value

        # Compute the actual chain seed for THIS iteration. When no
        # WP_ContextLoop is upstream, `upstream_internals` lacks both
        # keys → helper returns `widget_seed` unchanged (backwards-compat).
        # When ContextLoop is upstream with override_seed=true, the
        # override replaces the widget seed; loop_index>0 XORs in a
        # stable hash shift so each iteration walks a distinct seed.
        chain_seed = effective_chain_seed(
            widget_seed=int(seed),
            seed_override=upstream_internals.get("__wp_seed_override__"),
            loop_index=int(upstream_internals.get("__wp_loop_index__", 0)),
        )
        ctx = PipelineEngine().run(module_list, ctx=ctx, seed=chain_seed)

        payload = build_payload(ctx, upstream_debug=upstream_debug, seed=chain_seed)
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
        return io.NodeOutput(
            payload,
            ui={"seed": [int(seed)], "module_seeds": [module_seeds]},
        )
