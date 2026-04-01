# PROJECT KNOWLEDGE BASE

**Generated:** 2026-04-01
**Commit:** a807a06
**Branch:** main

## OVERVIEW

ComfyUI custom node pack: weighted wildcards, chained pipelines, context passing. V3 API, Vue DOM widgets, aiohttp manager SPA at `/wp`. Two ComfyUI nodes (`WildcardPipeline`, `PromptAssembler`) with modules rendered as Vue components inside a DOM widget — NOT as separate nodes.

## STRUCTURE

```
comfyui-wildcard-pipeline/
├── __init__.py              # V3 ComfyExtension + comfy_entrypoint() (try/except for testability)
├── pyproject.toml           # Registry: PublisherId=dumiflex, requires-python>=3.10
├── package.json             # Vue 3 + Vite + PrimeVue + Pinia + Axios (ESM)
├── vite.config.mts          # Two build modes: extension→js/main.js, manager→web_dist/
├── tsconfig.json            # Strict TS, alias @→./src
├── conftest.py              # sys.path hack for pytest without ComfyUI
│
├── engine/                  # Pure Python — ZERO ComfyUI imports
│   └── pipeline.py          # PipelineEngine: run(), handlers for wildcard/fixed/combine
│
├── nodes/                   # ComfyUI V3 nodes (import comfy_api)
│   ├── pipeline_node.py     # WildcardPipeline — defines PIPELINE_CONTEXT type
│   └── prompt_assembler.py  # PromptAssembler — resolves $vars in template
│
├── api/                     # aiohttp routes (STUB — not implemented)
│   ├── server.py            # setup_routes() placeholder
│   ├── routes/              # CRUD endpoints (empty)
│   ├── models/              # Data models (empty)
│   └── services/            # Business logic (empty)
│
├── data/                    # Example JSON files
│   ├── wildcards/examples/  # location.json, lighting.json
│   ├── constraints/examples/# lighting_weather.json
│   └── pipelines/examples/  # environment.json
│
├── src/                     # Vue/TS frontend (NOT YET CREATED)
│   ├── main.ts              # Extension entry (planned)
│   ├── manager.ts           # Manager SPA entry (planned)
│   └── ...                  # Components, stores, router (planned)
│
├── tests/
│   └── test_engine.py       # 10 tests — engine only, no ComfyUI deps
│
├── js/                      # Built extension artifact (gitignored)
└── web_dist/                # Built manager SPA (gitignored)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add/modify pipeline module handler | `engine/pipeline.py` `_get_handler()` | Register in handlers dict, keep pure Python |
| Change node schema/inputs/outputs | `nodes/pipeline_node.py` or `nodes/prompt_assembler.py` | `define_schema()` classmethod |
| Custom type definition | `nodes/pipeline_node.py:13` | `PipelineContext = io.Custom("PIPELINE_CONTEXT")` |
| Extension registration | `__init__.py` | `WildcardPipelineExtension.get_node_list()` |
| API route registration | `api/server.py` | Routes MUST be before SPA catch-all |
| Frontend extension entry | `src/main.ts` (planned) | `app.registerExtension()` + `getCustomWidgets()` |
| Frontend manager entry | `src/manager.ts` (planned) | Vue Router base `/wp` |
| Vite build config | `vite.config.mts` | `--mode extension` vs `--mode manager` |
| Test engine behavior | `tests/test_engine.py` | Import via `from engine.pipeline import PipelineEngine` |
| Example data schemas | `data/*/examples/*.json` | Wildcard, constraint, pipeline formats |

## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `PipelineEngine` | Class | `engine/pipeline.py:8` | Core execution — iterates modules, dispatches handlers |
| `PipelineEngine.run` | Method | `engine/pipeline.py:16` | Entry: `run(modules, ctx) → ctx` |
| `PipelineEngine._get_handler` | Method | `engine/pipeline.py:34` | Dispatch: `{"wildcard", "fixed", "combine"} → handler fn` |
| `WildcardPipeline` | Class | `nodes/pipeline_node.py:16` | ComfyUI node — deserializes JSON, runs engine, outputs context |
| `PipelineContext` | Variable | `nodes/pipeline_node.py:13` | `io.Custom("PIPELINE_CONTEXT")` — cross-node type |
| `PromptAssembler` | Class | `nodes/prompt_assembler.py:12` | Terminal node — resolves `$vars` in template string |
| `WildcardPipelineExtension` | Class | `__init__.py` | V3 `ComfyExtension` — registers nodes, mounts routes |
| `comfy_entrypoint` | Function | `__init__.py` | V3 factory — returns extension instance |
| `setup_routes` | Function | `api/server.py` | Mount API + SPA routes on aiohttp app (STUB) |

## CONVENTIONS

- **Engine isolation**: `engine/` has ZERO ComfyUI imports. Keep it that way.
- **Internal keys**: `__` prefix (e.g., `__active_filter__`, `__exports__`) — skipped in template resolution.
- **Capture normalization**: `$location` → stored as `location` (strip leading `$`).
- **Import style**: Relative imports within packages (`from ..engine.pipeline`), absolute in tests (`from engine.pipeline`).
- **Test naming**: `TestPipelineEngine{Feature}` classes, `test_{behavior}` methods, no fixtures.
- **Node IDs**: `WP_WildcardPipeline`, `WP_PromptAssembler` — prefix `WP_`.
- **Category**: `pipeline/wildcards`.
- **Caching**: `not_idempotent=True` + `fingerprint_inputs() → time.time()` — always re-execute.
- **Annotations**: `from __future__ import annotations` in all Python modules.

## ANTI-PATTERNS (THIS PROJECT)

- **Never import ComfyUI in `engine/`** — breaks standalone testing.
- **Never use `force_input=True`** for widget inputs — creates wire socket instead of DOM widget.
- **Never `console.log` for user warnings** — use ComfyUI toast API.
- **Never register SPA catch-all before API routes** — aiohttp matches first registered.
- **Never suppress types** with `as any`, `@ts-ignore`, `@ts-expect-error`.
- **Never use V1 patterns** (`NODE_CLASS_MAPPINGS`, `EXTENSION_WEB_DIRS`) — pure V3 only.

## COMMANDS

```bash
# Tests (no ComfyUI required)
pytest

# Frontend dev (extension watch)
npm run dev

# Build extension → js/main.js
npm run build:extension

# Build manager SPA → web_dist/
npm run build:manager

# Build both
npm run build

# Type check frontend
npm run typecheck
```

## DATA FORMATS

**Wildcard**: `{ name, version, options: [{ value, weight, tags }] }`
**Constraint**: `{ name, rules: [{ when_value, rule_type, values, multiplier? }] }`
**Pipeline**: `{ name, version, modules: [{ type, source?, capture_as, ... }] }`

## NOTES

- `__init__.py` wraps all ComfyUI imports in `try/except ImportError` — enables pytest outside ComfyUI.
- `conftest.py` injects project root into `sys.path` and uses `collect_ignore` to skip ComfyUI-dependent packages.
- Wildcard handler is currently a **stub** (picks first option) — weighted sampling not yet implemented.
- Frontend `src/` directory does not exist yet — only build config is in place.
- API routes are not implemented — `setup_routes()` is a `pass`.
- Username: `DumiFlex` / `dumiflex` for all registry/GitHub references.
