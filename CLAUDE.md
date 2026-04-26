# CLAUDE.md — project conventions

File teach future Claude (and human) contributors load-bearing conventions of codebase. Keep short, honest.

## Stack

- Python ≥ 3.10 (target 3.10/3.11/3.12 in CI; embedded runtime 3.12.10).
- ComfyUI V3 API (`comfy_api.latest`) — no V1 `NODE_CLASS_MAPPINGS`.
- Vue 3 + Vite 5 + pnpm. Strict TypeScript.
- Vitest for frontend, pytest for Python.

## Directory contract

- `engine/` — pure Python, **zero ComfyUI imports**. Testable with vanilla pytest.
- `wp_nodes/` — ComfyUI V3 nodes. Named `wp_nodes` (not `nodes`) because ComfyUI repo-level `nodes.py` shadow any top-level `nodes/` package on `sys.path`.
- `src/` — Vue/TS frontend. Two Vite targets: `extension` (critical path, budget-gated) + `manager` (post-MVP SPA).
- `tests/` — Python tests. Use `conftest.py` sys.path shim.
- `scripts/` — Node helpers (bundle-size gate, size-delta diff, release helpers).
- `docs/widget-context-contract.md` — single canonical engine ↔ widget JSON shape doc. Update both Python (`engine/modules.py`) + TS (`src/widgets/_shared.ts`) sides in one PR when shape change.
- `docs/superpowers/{specs,plans}/` — gitignored per-contributor design docs + impl plans.

## Commands

```bash
pnpm build:extension   # produces js/main.js
pnpm build:manager     # produces web_dist/
pnpm test              # Vitest
pnpm test:coverage     # Vitest + v8 coverage (with thresholds)
pnpm typecheck         # vue-tsc --noEmit
pnpm lint              # ESLint flat config
pnpm size              # bundle-size gate (--json <path> for manifest)
pytest                 # Python unit tests
ruff check .           # Python lint
```

## Load-bearing conventions

- **Engine isolation** — never import from `wp_nodes/`, `comfy_api`, or `torch` in `engine/`. Engine dict-free of ComfyUI globals. Break this break tests.
- **Internal keys** — context keys starting with `__` engine-internal; strip at socket boundaries (see `wp_nodes/types.py:strip_internals`).
- **Module IDs** — 8-hex-char short UUIDs. Match wildcard `@{uuid}` reference syntax planned for next spec.
- **V3 node IDs** — prefix `WP_`, category `wildcard-pipeline`.
- **Custom widget types** — `WP_CONTEXT_MODULES`, `WP_DEBUG_VIEWER`. Registered via `app.registerExtension({ getCustomWidgets })`. Assembler helper widget injected via `beforeRegisterNodeDef → onNodeCreated`, not `getCustomWidgets`, because sit alongside native STRING template widget.
- **Toast singleton** — one Vue app mounted to body-level div renders all toasts pushed via `src/components/shared/toast-store.ts`. Every Context node import same store so toasts surface from anywhere. Position mirror ComfyUI native PrimeVue toast anchor (rect-relative to `.graph-canvas-container`).
- **Subgraph traversal** — `collectUpstreamVariables` / `collectUpstreamValues` / `findDownstreamAssemblers` cross subgraph boundaries via `-10` SubgraphInputNode + `-20` SubgraphOutputNode sentinel ids. Walkers expect `app.graph` (root); per-call `buildSubgraphParents` map handle step-out. Use `walkAllNodes(rootGraph)` for graph-wide scans (e.g. pre-run validation).
- **Subgraph badges** — `extension/subgraph-badge.ts` attach `LGraphBadge` (via `window.LGraphBadge`) to any SubgraphNode containing WP nodes. Badge surface worst inner conflict severity with human label (e.g. `missing $foo`, `2 conflicts`). Wire via `nodeCreated` + `loadedGraphNode` hooks — `beforeRegisterNodeDef` does NOT fire for SubgraphNodes.
- **Conflict scanner** — advisory only; never block execution. Runtime last-write-wins. Three types: `shadows_upstream` (info), `duplicate_variable` (warning), `missing_template_variable` (warning).
- **Bundle-size gate** — entry `main.js` must stay ≤ 30 KB gzipped; total `js/` ≤ 250 KB. Pre-commit run `pnpm build:extension && pnpm size`. Raising budget require explicit PR discussion.
- **Coverage gate** — vitest v8 coverage with thresholds (lines/statements 50%, functions 40%, branches 65%). Anchored to current baseline; ratchet up alongside new tests.
- **Caching** — `WP_Context` + `WP_Debug` set `not_idempotent=True` so seed cycling always re-executes.
- **Conventional Commits** — enforced by commitlint. semantic-release read log to cut versions.

## Frontend overview

- **Entry** `src/main.ts` → `js/main.js` (~1.6 KB gzip). Top-level await preload widget chunks so `getCustomWidgets` factories run sync (Promise return → `{widget: undefined}` and widget never mount). Register extension + lazy-import widget code only when ComfyUI hand matching node.
- **Lazy chunks** `src/widgets/{context,debug,assembler}.ts` — one mount glue per widget. Each `import()` become own asset chunk, plus sibling SFC chunk (`ContextWidget`, `DebugViewer`, `AssemblerHelper`).
- **Shared** `src/widgets/_shared.ts` expose `createDomWidgetHost`, JSON helpers (`parseWidgetJson`, `parseWidgetJsonWithRecovery` for corrupt-workflow recovery path), shared types. Largest shared chunk (`_shared`, ~33 KB gzip) is Vue runtime + plugin-vue helper, pulled in by every widget on first use.
- **Graph + conflicts** `src/extension/{graph,conflicts,subgraph-badge,reactive,graph-events}.ts` — pure logic, no DOM. Imported by widgets, easy to unit-test isolated.
- **Reactivity** `extension/reactive.ts:reactiveFromGraph` — wires `onConnectionsChange` chain + 400ms polling fallback + `afterConfigureGraph` re-sync so widgets recompute on graph edits + workflow loads without flashing stale state.
- **Adding new widget**: (1) write SFC under `src/components/<name>/`, (2) add `src/widgets/<name>.ts` exposing `create(node, inputName)` that return `createDomWidgetHost(...)`, (3) wire in `src/main.ts` — either as `getCustomWidgets` entry (for inputs declared with matching widget-type) or via `beforeRegisterNodeDef → onNodeCreated` (for free-floating helpers). Use `import("./widgets/<name>")` so stay out of entry chunk + size gate keep holding.

## Anti-patterns (inherited from reference project `ComfyUI-Wildcard-Pipeline`)

- Never use V1 `NODE_CLASS_MAPPINGS` / `EXTENSION_WEB_DIRS`.
- Never `console.log` for user warnings — use ComfyUI toast API.
- Never use `getInputNode()` / `findInputSlot()` — walk via `node.inputs[].link → app.graph.links[linkId] → graph.getNodeById(link.origin_id)`.
- Never use `requestAnimationFrame` in `onConnectionsChange`; link already established when callback fires.
- Never register SPA catch-all route before API routes.
- Never suppress types with `as any`, `@ts-ignore`, `@ts-expect-error`.
- `cssInjectedByJsPlugin` required, not optional. Vite library mode emit CSS files but never inject `<link>` tags, and ComfyUI load our `main.js` as bare ES module so `<link rel="modulepreload">`-style auto-loading does not apply. Per-chunk runtime injection (`relativeCSSInjection: true`) keep entry chunk CSS-free — styles only get injected when owning lazy chunk loads. This what every Vue-based ComfyUI extension in wild does (see `ComfyUI-Easy-Use/web_version/v2/easyuse.js`).