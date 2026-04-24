# CLAUDE.md — project conventions

This file teaches future Claude (and human) contributors the load-bearing conventions of this codebase. Keep it short and honest.

## Stack

- Python ≥ 3.10 (target 3.10/3.11/3.12 in CI; embedded runtime is 3.12.10).
- ComfyUI V3 API (`comfy_api.latest`) — no V1 `NODE_CLASS_MAPPINGS`.
- Vue 3 + Vite 5 + pnpm. Strict TypeScript.
- Vitest for frontend, pytest for Python.

## Directory contract

- `engine/` — pure Python, **zero ComfyUI imports**. Testable with vanilla pytest.
- `nodes/` — ComfyUI V3 nodes. All ComfyUI imports wrapped in `try/except ImportError` so the package remains importable outside ComfyUI for tests.
- `src/` — Vue/TS frontend. Two Vite targets: `extension` (critical path, budget-gated) and `manager` (post-MVP SPA).
- `tests/` — Python tests. Uses `conftest.py` sys.path shim.
- `scripts/` — Node helpers (bundle-size gate, release helpers).
- `docs/superpowers/{specs,plans}/` — design docs and implementation plans.

## Commands

```bash
pnpm build:extension   # produces js/main.js
pnpm build:manager     # produces web_dist/
pnpm test              # Vitest
pnpm typecheck         # vue-tsc --noEmit
pnpm lint              # ESLint flat config
pnpm size              # bundle-size gate
pytest                 # Python unit tests
ruff check .           # Python lint
```

## Load-bearing conventions

- **Engine isolation** — never import anything from `nodes/`, `comfy_api`, or `torch` in `engine/`. Engine is dict-free of ComfyUI globals. Breaking this breaks tests.
- **Internal keys** — context keys starting with `__` are engine-internal; strip them at socket boundaries (see `nodes/types.py:strip_internals`).
- **Module IDs** — 8-hex-char short UUIDs. Matches the wildcard `@{uuid}` reference syntax planned for the next spec.
- **V3 node IDs** — prefix `WP_`, category `wildcard-pipeline`.
- **Custom widget types** — `WP_CONTEXT_MODULES`, `WP_DEBUG_VIEWER`. Registered via `app.registerExtension({ getCustomWidgets })`. The Assembler helper widget is injected via `beforeRegisterNodeDef → onNodeCreated`, not `getCustomWidgets`, because it sits alongside a native STRING template widget.
- **Conflict scanner** — advisory only; never block execution. Runtime is last-write-wins.
- **Bundle-size gate** — entry `main.js` must stay ≤ 30 KB gzipped; total `js/` ≤ 250 KB. Raising the budget requires explicit PR discussion.
- **Caching** — `WP_Context` and `WP_Debug` set `not_idempotent=True` so seed cycling always re-executes.
- **Conventional Commits** — enforced by commitlint. semantic-release reads the log to cut versions.

## Anti-patterns (inherited from reference project `ComfyUI-Wildcard-Pipeline`)

- Never use V1 `NODE_CLASS_MAPPINGS` / `EXTENSION_WEB_DIRS`.
- Never `console.log` for user warnings — use the ComfyUI toast API.
- Never use `getInputNode()` / `findInputSlot()` — walk via `node.inputs[].link → app.graph.links[linkId] → graph.getNodeById(link.origin_id)`.
- Never use `requestAnimationFrame` in `onConnectionsChange`; the link is already established when the callback fires.
- Never register an SPA catch-all route before API routes.
- Never suppress types with `as any`, `@ts-ignore`, `@ts-expect-error`.
- Never `cssInjectedByJsPlugin` on the extension bundle — inflates critical-path load.
