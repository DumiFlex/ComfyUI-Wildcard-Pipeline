# PROJECT KNOWLEDGE BASE

**Generated:** 2026-04-01
**Commit:** 9cd2ac4
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
├── tsconfig.json            # Strict TS, alias @→./src, #comfyui/app→typings
├── conftest.py              # sys.path hack for pytest without ComfyUI
├── README.md                # Project documentation
│
├── engine/                  # Pure Python — ZERO ComfyUI imports
│   └── pipeline.py          # PipelineEngine: run(), 6 handlers, resolve_variables(), apply_constraints()
│
├── nodes/                   # ComfyUI V3 nodes (import comfy_api)
│   ├── pipeline_node.py     # WildcardPipeline — defines PIPELINE_CONTEXT type
│   ├── prompt_assembler.py  # PromptAssembler — resolves $vars in template
│   └── sources.py           # resolve_sources() — loads wildcard/constraint JSON files
│
├── api/                     # aiohttp routes — fully implemented
│   ├── server.py            # setup_routes() — API + static + SPA catch-all
│   ├── routes/
│   │   └── crud.py          # _make_crud_routes() factory for wildcards/constraints/pipelines
│   ├── models/
│   │   └── schemas.py       # validate_wildcard(), validate_constraint(), validate_pipeline()
│   └── services/
│       └── file_store.py    # FileStore class — JSON file CRUD with slugify
│
├── data/                    # Example JSON files
│   ├── wildcards/examples/  # location.json, lighting.json
│   ├── constraints/examples/# lighting_weather.json
│   └── pipelines/examples/  # environment.json
│
├── src/                     # Vue/TS frontend — fully implemented
│   ├── main.ts              # ComfyUI extension entry — registers custom widgets
│   ├── manager.ts           # Manager SPA entry — Vue + PrimeVue + Pinia + Router
│   ├── manager.html         # Manager SPA HTML shell
│   ├── types.ts             # PipelineModule union type + all 6 module interfaces
│   ├── env.d.ts             # Vue .vue shim
│   ├── typings/
│   │   └── comfyui.d.ts     # Local ComfyUI type declarations
│   ├── extension/
│   │   └── widgets.ts       # Vue widget mounting into DOM widgets
│   ├── api/
│   │   └── client.ts        # Axios API client for /wp/api/*
│   ├── assets/
│   │   └── main.css         # Industrial dark theme design system
│   ├── router/
│   │   └── index.ts         # Vue Router — /wp/ base, 3 routes
│   ├── stores/
│   │   ├── wildcards.ts     # Pinia store — CRUD + loading/error state
│   │   ├── constraints.ts   # Pinia store — CRUD + loading/error state
│   │   └── pipelines.ts     # Pinia store — CRUD + loading/error state
│   ├── components/
│   │   ├── manager/
│   │   │   └── AppLayout.vue        # Sidebar + toolbar + router-view
│   │   ├── pipeline/
│   │   │   ├── PipelineWidget.vue   # Drag-to-reorder module list
│   │   │   └── modules/
│   │   │       ├── WildcardModule.vue
│   │   │       ├── FixedModule.vue
│   │   │       ├── CombineModule.vue
│   │   │       ├── ConstrainModule.vue
│   │   │       ├── ConditionModule.vue
│   │   │       └── ExportModule.vue
│   │   └── assembler/
│   │       └── AssemblerWidget.vue  # Template textarea + variable chips
│   └── views/
│       ├── WildcardListView.vue     # DataTable + Dialog CRUD
│       ├── ConstraintListView.vue   # DataTable + Dialog CRUD
│       └── PipelineListView.vue     # DataTable + OrderList CRUD
│
├── tests/                   # 117 tests — all passing, no ComfyUI deps
│   ├── test_engine.py       # 59 tests — engine handlers, validation, variables
│   ├── test_sources.py      # 16 tests — wildcard + constraint source resolution
│   ├── test_file_store.py   # 24 tests — FileStore CRUD + slugify
│   └── test_api.py          # 21 tests — API route integration
│
├── .github/workflows/
│   └── ci.yml               # GitHub Actions — pytest matrix + frontend typecheck/build
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
| Source resolution (file loading) | `nodes/sources.py` | `resolve_sources()` searches data_dir + examples/ |
| API route registration | `api/server.py` | Routes MUST be before SPA catch-all |
| API CRUD factory | `api/routes/crud.py` | `_make_crud_routes()` generates routes per resource |
| Schema validation | `api/models/schemas.py` | `validate_wildcard()`, `validate_constraint()`, `validate_pipeline()` |
| File persistence | `api/services/file_store.py` | `FileStore` class — JSON CRUD with slugified filenames |
| Frontend extension entry | `src/main.ts` | `app.registerExtension()` + `getCustomWidgets()` |
| Frontend manager entry | `src/manager.ts` | Vue app with PrimeVue, Pinia, Router |
| API client | `src/api/client.ts` | Axios client at `/wp/api` |
| Pinia stores | `src/stores/*.ts` | CRUD operations + loading/error state |
| Vue module components | `src/components/pipeline/modules/*.vue` | One component per module type |
| Manager views | `src/views/*.vue` | DataTable + Dialog CRUD for each resource |
| Vite build config | `vite.config.mts` | `--mode extension` vs `--mode manager` |
| Test engine behavior | `tests/test_engine.py` | Import via `from engine.pipeline import PipelineEngine` |
| Test API routes | `tests/test_api.py` | Uses `aiohttp.test_utils.TestClient` |
| Example data schemas | `data/*/examples/*.json` | Wildcard, constraint, pipeline formats |

## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `PipelineEngine` | Class | `engine/pipeline.py` | Core execution — iterates modules, dispatches handlers |
| `PipelineEngine.run` | Method | `engine/pipeline.py` | Entry: `run(modules, ctx) → ctx` |
| `PipelineEngine._get_handler` | Method | `engine/pipeline.py` | Dispatch: 6 module types → handler functions |
| `resolve_variables` | Function | `engine/pipeline.py` | `$var` substitution, `$$` escape, `__` key skipping |
| `apply_constraints` | Function | `engine/pipeline.py` | Weight modification via exclusion/weight_bias rules |
| `WildcardPipeline` | Class | `nodes/pipeline_node.py` | ComfyUI node — deserializes JSON, runs engine, outputs context |
| `PipelineContext` | Variable | `nodes/pipeline_node.py` | `io.Custom("PIPELINE_CONTEXT")` — cross-node type |
| `PromptAssembler` | Class | `nodes/prompt_assembler.py` | Terminal node — resolves `$vars` in template string |
| `resolve_sources` | Function | `nodes/sources.py` | Loads wildcard/constraint JSON from data directories |
| `WildcardPipelineExtension` | Class | `__init__.py` | V3 `ComfyExtension` — registers nodes, mounts routes |
| `comfy_entrypoint` | Function | `__init__.py` | V3 factory — returns extension instance |
| `setup_routes` | Function | `api/server.py` | Mount API + static + SPA routes on aiohttp app |
| `FileStore` | Class | `api/services/file_store.py` | Generic JSON file CRUD with slugified names |
| `_make_crud_routes` | Function | `api/routes/crud.py` | Route factory — generates GET/POST/PUT/DELETE per resource |

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
- **API routes**: Registered BEFORE SPA catch-all in aiohttp. Route factory pattern via `_make_crud_routes()`.
- **File slugification**: `FileStore._slugify()` converts names to filesystem-safe slugs.
- **Frontend stores**: Composition API pattern with `defineStore()`, ref-based state, async CRUD methods.

## ANTI-PATTERNS (THIS PROJECT)

- **Never import ComfyUI in `engine/`** — breaks standalone testing.
- **Never use `force_input=True`** for widget inputs — creates wire socket instead of DOM widget.
- **Never `console.log` for user warnings** — use ComfyUI toast API.
- **Never register SPA catch-all before API routes** — aiohttp matches first registered.
- **Never suppress types** with `as any`, `@ts-ignore`, `@ts-expect-error`.
- **Never use V1 patterns** (`NODE_CLASS_MAPPINGS`, `EXTENSION_WEB_DIRS`) — pure V3 only.

## COMMANDS

```bash
# Tests (no ComfyUI required) — 117 tests
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

## MODULE SCHEMAS

```python
_MODULE_SCHEMAS = {
    "wildcard": {"capture_as"},
    "fixed": {"value", "capture_as"},
    "combine": {"template", "capture_as"},
    "constrain": {"target"},
    "condition": {"variable"},
    "export": {"variables"},
}
```

## API ROUTES

```
GET/POST       /wp/api/wildcards
GET/PUT/DELETE  /wp/api/wildcards/{name}
GET/POST       /wp/api/constraints
GET/PUT/DELETE  /wp/api/constraints/{name}
GET/POST       /wp/api/pipelines
GET/PUT/DELETE  /wp/api/pipelines/{name}
```

## NOTES

- `__init__.py` wraps all ComfyUI imports in `try/except ImportError` — enables pytest outside ComfyUI.
- `conftest.py` injects project root into `sys.path` and uses `collect_ignore` to skip ComfyUI-dependent packages.
- Weighted sampling uses `random.choices()` with all-zero weight fallback to uniform.
- Missing weights default to 1.0.
- Manager SPA builds to `web_dist/` and is served by aiohttp static handler.
- CI runs pytest on Python 3.10/3.11/3.12 and frontend typecheck + build on Node 20.
- Username: `DumiFlex` / `dumiflex` for all registry/GitHub references.
