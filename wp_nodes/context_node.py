"""WP_Context — runs a module list and emits a PipelineContext payload."""

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine.db.connection import get_connection
from engine.db.migrations import migrate
from engine.db.repositories import ModuleNotFound, ModuleRepository
from engine.modules.snapshot import walk_transitive_refs
from engine.pipeline import PipelineEngine
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

        ctx = PipelineEngine().run(module_list, ctx=ctx, seed=int(seed))

        payload = build_payload(ctx, upstream_debug=upstream_debug, seed=int(seed))
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
        module_seeds: dict[str, int] = {}
        for entry in ctx.get("__wp_trace__", []):
            mid = entry.get("id")
            es = entry.get("seed")
            if isinstance(mid, str) and isinstance(es, int):
                module_seeds[mid] = es
        return io.NodeOutput(
            payload,
            ui={"seed": [int(seed)], "module_seeds": [module_seeds]},
        )
