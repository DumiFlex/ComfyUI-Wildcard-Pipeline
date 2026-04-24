# ComfyUI-WildcardPipeline — MVP Walking Skeleton (Design)

- **Date:** 2026-04-24
- **Author:** DumiFlex
- **Status:** Approved — ready for implementation planning
- **Scope class:** MVP (follow-up sub-specs listed in §9)
- **Reference project (not to be copied wholesale):** `E:\AI\ComfyUI\custom_nodes\ComfyUI-Wildcard-Pipeline`

## 1. Vision & MVP Goals

**Project vision.** Modular, procedural prompt generation for ComfyUI — *not* chaotic random wildcards. Users compose reusable logic (wildcards, constraints, derivations, combines, fixed values) inside a `WP_Context` node, chain an unlimited number of context nodes for layered generation, and feed the resulting structured context to a `WP_PromptAssembler` that fills `$var` placeholders in a user-authored template. A separate SPA (post-MVP) makes modules and whole pipelines reusable/shareable. Workflows always remain portable because module data is serialized inline into the workflow JSON.

**MVP goals (this spec).** Prove the walking skeleton end-to-end:

1. Render a Vue-powered custom DOM widget inside a ComfyUI V3 node.
2. Manage an ordered list of modules of a single type — **`fixed_values`** — via that widget.
3. Serialize module list into `node.widgets_values` so workflow save/load round-trips.
4. Custom `PIPELINE_CONTEXT` socket type carries context across an unlimited chain of `WP_Context` nodes.
5. Downstream-overwrite semantics: runtime silently last-write-wins; UI warns via conflict scanner.
6. `WP_PromptAssembler` consumes context, resolves `$var` and `$$` escape.
7. `WP_Debug` node renders context as a readable Vue viewer widget.
8. Engine stays pure Python (`engine/` with zero ComfyUI imports), typed via dataclasses + `TypedDict`.
9. Tests: engine unit tests + conflict scanner tests, no ComfyUI runtime required.
10. Extension frontend bundle cold-loads fast (hard budget, see §6).

**MVP non-goals (deferred to named follow-up specs in §9).** Wildcards, constraints, derivations, combines, `WP_ContextInject` node, sqlite library, SPA manager, pipeline presets, `WP_DEBUG` env socket, instance-override UI, save-to-library context menu, module version history.

## 2. Architecture Overview

Three-layer split, same isolation principle as the reference project.

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend (Vue 3 + Vite + PrimeVue + Pinia)                  │
│  src/main.ts                 — ComfyUI extension entry      │
│  src/extension/widgets.ts    — Vue-in-DOMWidget factory     │
│  src/extension/graph.ts      — upstream/downstream walkers  │
│  src/extension/conflicts.ts  — conflict scanner             │
│  src/components/context/*    — Context widget + module list │
│  src/components/assembler/*  — Assembler helper widget      │
│  src/components/debug/*      — Debug viewer widget          │
└─────────────────────────────────────────────────────────────┘
                        ↕ serialize JSON string
┌─────────────────────────────────────────────────────────────┐
│ Nodes (ComfyUI V3 — comfy_api.latest)                       │
│  nodes/context_node.py       — WP_Context                   │
│  nodes/assembler_node.py     — WP_PromptAssembler           │
│  nodes/debug_node.py         — WP_Debug                     │
│  nodes/types.py              — PipelineContext custom type  │
└─────────────────────────────────────────────────────────────┘
                        ↕ dataclass from_dict / to_dict
┌─────────────────────────────────────────────────────────────┐
│ Engine (pure Python, zero ComfyUI imports)                  │
│  engine/context.py           — Context TypedDict + helpers  │
│  engine/modules.py           — Module dataclasses + union   │
│  engine/pipeline.py          — PipelineEngine.run()         │
│  engine/handlers.py          — fixed_values handler         │
│  engine/template.py          — resolve_variables ($var,$$)  │
└─────────────────────────────────────────────────────────────┘
```

**Boundary contracts.**

- Frontend ⇄ Nodes: only via ComfyUI widget serialization (a single JSON string per node stored in `widgets_values`).
- Nodes ⇄ Engine: nodes deserialize the widget JSON into engine dataclasses, call `PipelineEngine.run()`, then wrap the returned context into a `ContextPayload` and emit it on the `PIPELINE_CONTEXT` socket.
- Engine ⇄ anything else: pure. Imports stdlib only. Testable with plain `pytest`, no ComfyUI required.

**Execution dataflow per workflow run.**

```
upstream WP_Context output ──▶ PIPELINE_CONTEXT socket ──┐
                                                         ▼
                                            WP_Context.execute()
                                            ├── inherit upstream ctx
                                            ├── deserialize modules widget
                                            ├── engine.run(modules, ctx, seed)
                                            └── emit ContextPayload(ctx, debug)
                                                         │
                                                         ▼
                                  WP_PromptAssembler.execute()
                                  └── resolve $vars in template
                                                         │
                                                         ▼
                                                   STRING output
```

No cross-cutting side channels. Every boundary is a single serialized payload.

## 3. Data Model

### 3.1 Context (engine-side)

Flat dict of string-keyed vars plus `__`-prefixed internal keys. A `TypedDict` documents the reserved internals; user vars remain open.

```python
# engine/context.py
from typing import TypedDict, Any

class ContextInternals(TypedDict, total=False):
    __wp_node_seed__: int                    # current node's seed
    __wp_internal_flags__: dict[str, bool]   # varname → internal?
    __wp_trace__: list[dict[str, Any]]       # per-module execution log

Context = dict[str, Any]  # union of user vars + ContextInternals keys
```

### 3.2 Modules (engine-side)

Dataclass per type + discriminated union via `type: Literal[...]`. MVP ships one type plus a shared metadata block.

```python
# engine/modules.py
from dataclasses import dataclass, field
from typing import Literal, Union

@dataclass
class ModuleMeta:
    name: str = ""                    # free-form display label, duplicates allowed
    description: str = ""
    category: str = ""                # user-chosen grouping
    tags: list[str] = field(default_factory=list)

@dataclass
class FixedValueEntry:
    variable_name: str
    value: str

@dataclass
class FixedValueModule:
    id: str                           # 8-hex-char short UUID (~4.3B space)
    type: Literal["fixed_values"] = "fixed_values"
    enabled: bool = True
    meta: ModuleMeta = field(default_factory=ModuleMeta)
    entries: list[FixedValueEntry] = field(default_factory=list)

Module = Union[FixedValueModule]      # widens as new types land

def module_from_dict(d: dict) -> Module: ...   # dispatch on d["type"]
def module_to_dict(m: Module) -> dict: ...     # stdlib asdict
```

Short UUID format matches the reference project's `@{uuid}` nested-wildcard reference syntax — forward-compatible when the Wildcards spec lands.

### 3.3 Widget payload (frontend ↔ node)

One DOM widget per `WP_Context` node holds the ordered module list as a JSON string in `widgets_values`.

```jsonc
// widget value (JSON string)
{
  "version": 1,
  "modules": [
    {
      "id": "…",
      "type": "fixed_values",
      "enabled": true,
      "meta": { "name": "style defaults", "tags": ["character"] },
      "entries": [{ "variable_name": "style", "value": "photorealistic" }]
    }
  ]
}
```

`version` enables forward-compatible migrations when new module types land.

### 3.4 `PIPELINE_CONTEXT` socket payload

```python
# nodes/types.py
from dataclasses import dataclass, field
from typing import Any
from comfy_api.latest._io import comfytype, ComfyTypeIO

@dataclass(frozen=True)
class ContextPayload:
    context: dict[str, Any] = field(default_factory=dict)   # user vars only
    debug: dict[str, Any] = field(default_factory=dict)     # trace + meta

@comfytype(io_type="PIPELINE_CONTEXT")
class PipelineContext(ComfyTypeIO):
    Type = ContextPayload
```

Internals (`__…`) are stripped at the socket boundary so downstream nodes can't accidentally depend on private state.

### 3.5 Seed model

`WP_Context` has a standard `io.Int` seed widget (with `control_after_generate`). Engine stores it as `ctx["__wp_node_seed__"]` and passes through. `fixed_values` doesn't consume it. The Wildcards follow-up spec will hash `(node_seed, capture_name)` via SHA-256 as the reference project does.

### 3.6 Debug JSON shape (MVP)

```jsonc
{
  "node_seed": 12345,
  "modules": [
    {
      "id": "…",
      "type": "fixed_values",
      "enabled": true,
      "writes": [
        { "variable": "style", "value": "photorealistic", "source": "fixed_values" }
      ]
    }
  ],
  "conflicts": []
}
```

## 4. Engine Internals

Pure Python, stdlib only. One file per concern.

### 4.1 `engine/template.py`

```python
def resolve_variables(template: str, ctx: dict[str, Any]) -> str:
    """Replace $var with ctx[var]. $$ escapes literal $. __-keys skipped."""
```

Rules: `$var` → `str(ctx[var])` when present, otherwise left as-is; `$$` → literal `$`; `$__internal` never substituted.

### 4.2 `engine/handlers.py`

```python
ModuleHandler = Callable[[Module, Context, random.Random], Context]

def handle_fixed_values(module: FixedValueModule, ctx: Context, rng: random.Random) -> Context:
    for entry in module.entries:
        name = entry.variable_name.lstrip("$")
        if not name:
            continue
        ctx[name] = entry.value
    return ctx
```

`fixed_values` ignores `rng`. Signature keeps parity with future seed-consuming handlers (wildcard, derivation).

### 4.3 `engine/pipeline.py`

```python
class PipelineEngine:
    HANDLERS: dict[str, ModuleHandler] = {
        "fixed_values": handle_fixed_values,
    }

    def run(self, modules: list[Module], ctx: Context | None = None,
            seed: int = 0) -> Context:
        ctx = ctx if ctx is not None else {}
        ctx["__wp_node_seed__"] = seed
        ctx.setdefault("__wp_trace__", [])
        rng = random.Random(seed)

        for index, module in enumerate(modules):
            if not module.enabled:
                continue
            handler = self.HANDLERS.get(module.type)
            if handler is None:
                logger.warning("Unknown module type '%s' at index %s", module.type, index)
                continue
            before = dict(ctx)
            ctx = handler(module, ctx, rng)
            ctx["__wp_trace__"].append(self._trace_entry(module, before, ctx))

        return ctx
```

### 4.4 Tracing

`_trace_entry(module, before, after)` yields one dict per handled module:

```python
{
    "id": module.id,
    "type": module.type,
    "enabled": module.enabled,
    "writes": (
        [
            {"variable": k, "value": after[k], "source": module.type}
            for k in after.keys() - before.keys()
            if not k.startswith("__")
        ]
        + [
            {"variable": k, "value": after[k], "source": module.type, "overwrite": True}
            for k in after.keys() & before.keys()
            if not k.startswith("__") and after[k] != before[k]
        ]
    ),
}
```

### 4.5 Chain behaviour

`WP_Context.execute(upstream, seed, modules_json)`:

1. `ctx = dict(upstream.context) if upstream else {}` — seed from upstream user vars.
2. `PipelineEngine().run(deserialize(modules_json), ctx, seed=seed)` — mutate with this node's modules.
3. Emit `ContextPayload(context=strip_internals(ctx), debug={…})`.

Runtime silently last-write-wins. Conflict scanner (§7) warns in UI pre-execution.

### 4.6 Isolation invariants

- `engine/` imports stdlib only — no `torch`, no ComfyUI, no frontend.
- No `print`; only `logging.getLogger(__name__)`.
- No global mutable state. `PipelineEngine.HANDLERS` is a class attribute; extending requires subclass or a future registration API.
- Pure functions where possible; handlers mutate context in place (performance over immutability — chains get long).

## 5. ComfyUI V3 Nodes

All three under category `wildcard-pipeline`; node IDs prefixed `WP_`.

### 5.1 Registration

```python
# __init__.py
from comfy_api.latest import ComfyExtension, io
from .nodes.context_node import WPContext
from .nodes.assembler_node import WPPromptAssembler
from .nodes.debug_node import WPDebug

class WildcardPipelineExtension(ComfyExtension):
    async def get_node_list(self):
        return [WPContext, WPPromptAssembler, WPDebug]

async def comfy_entrypoint():
    return WildcardPipelineExtension()
```

All ComfyUI imports are wrapped in `try/except ImportError` so `pytest` can import the package outside ComfyUI (ref. project pattern).

### 5.2 `WP_Context`

```python
ContextModulesInput = io.Custom("WP_CONTEXT_MODULES")  # widget-only custom type

class WPContext(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_Context",
            display_name="WP Context",
            category="wildcard-pipeline",
            inputs=[
                PipelineContext.Input("upstream", optional=True),
                io.Int.Input("seed", default=0, min=0,
                             max=0xFFFFFFFFFFFFFFFF, control_after_generate=True),
                ContextModulesInput.Input("modules", socketless=True),
            ],
            outputs=[PipelineContext.Output("context")],
            not_idempotent=True,
        )

    @classmethod
    def execute(cls, seed, modules, upstream=None):
        # `modules` arrives as the serialized JSON string produced by the DOM widget
        upstream_ctx = upstream.context if upstream else {}
        upstream_dbg = upstream.debug if upstream else {}
        module_list = deserialize_modules(modules)
        ctx = dict(upstream_ctx)
        ctx = PipelineEngine().run(module_list, ctx, seed=seed)
        payload = ContextPayload(
            context=strip_internals(ctx),
            debug={"upstream": upstream_dbg, "node_seed": seed,
                   "trace": ctx.get("__wp_trace__", [])},
        )
        return io.NodeOutput(payload)
```

- `upstream` is optional — root context nodes work without an input connection.
- `modules` is a **custom-typed, `socketless=True` input** named `WP_CONTEXT_MODULES`. The frontend registers a widget factory under that exact type key via `app.registerExtension({ getCustomWidgets() })`. The factory creates the DOM element, mounts Vue, and manages JSON serialization into `widgets_values` via `node.addDOMWidget(inputName, "custom", container, { serialize: true, getValue, setValue })`.
- `not_idempotent=True` prevents ComfyUI caching so seed cycling always re-executes.
- Internals stripped at the socket boundary (§3.4).

### 5.3 `WP_PromptAssembler`

```python
class WPPromptAssembler(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_PromptAssembler",
            display_name="WP Prompt Assembler",
            category="wildcard-pipeline",
            inputs=[
                PipelineContext.Input("context"),
                io.String.Input("template", multiline=True,
                                default="A $style portrait of $subject"),
            ],
            outputs=[io.String.Output("prompt")],
        )

    @classmethod
    def execute(cls, context, template):
        return io.NodeOutput(resolve_variables(template, context.context))
```

**DOM helper widget.** Template stays a native multiline STRING widget — *explicitly kept* so users can right-click → *Convert to Input* and wire a string-producing node into it. A separate read-only Vue helper widget is injected *after* the template widget via the `beforeRegisterNodeDef` lifecycle hook (matches reference project's assembler pattern — `getCustomWidgets` can't add widgets to existing typed inputs, but `onNodeCreated` can call `node.addDOMWidget(...)` directly after the node's default widgets are built):

```ts
// simplified — full code in src/extension/widgets.ts
app.registerExtension({
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "WP_PromptAssembler") return;
    const origOnCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function (...args) {
      origOnCreated?.apply(this, args);
      import("./widgets/assembler").then(m => m.mountHelper(this));
    };
  },
});
```

The helper widget contains:

- **Variable chips row.** Pills for each variable captured by upstream chain (collected via `collectUpstreamVariables`). Click → inserts `$var` into the textarea at cursor position. Hover shows origin node name. When template is converted-to-input (no textarea in DOM), chip-insert handler feature-detects and disables; chips remain visible in read-only mode.
- **Preview pane.** Static analysis only: renders template text with each `$var` tagged ✅ *defined* if found in upstream captured set, ⚠️ *unresolved* otherwise. No actual value substitution in MVP (that requires running the engine client-side or an API call — deferred to Wildcards spec via a dedicated preview endpoint).

Helper widget calls `addDOMWidget(..., { serialize: false })` — template value is owned exclusively by the native template widget, preventing double-source-of-truth.

### 5.4 `WP_Debug`

```python
DebugViewerInput = io.Custom("WP_DEBUG_VIEWER")  # widget-only custom type

class WPDebug(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_Debug",
            display_name="WP Debug",
            category="wildcard-pipeline",
            inputs=[
                PipelineContext.Input("context"),
                DebugViewerInput.Input("viewer", socketless=True),
            ],
            outputs=[],
            is_output_node=True,
            not_idempotent=True,
        )

    @classmethod
    def execute(cls, context, viewer):
        import json
        dumped = json.dumps(
            {"context": context.context, "debug": context.debug},
            default=str, indent=2,
        )
        return io.NodeOutput(ui={"wp_debug_snapshot": [dumped]})
```

**DOM viewer widget (`WP_DEBUG_VIEWER`).** Registered via `getCustomWidgets` keyed by the custom input type name. Two tabs:

1. **Context tab.** Tree / key-value viewer of user vars. Collapsible, type badges (string/number/bool/object). Copy-value button per row.
2. **Trace tab.** Ordered list of module executions with per-module writes (variable, value, overwrite flag), node seed. Filter/search bar. Colour-coded by source module type.

Data source: the `ui.wp_debug_snapshot` payload. Widget subscribes to the ComfyUI `executed` event bus, filters by its own node id, parses the snapshot, re-renders. Serialises nothing into `widgets_values` — debug output is transient per run (widget uses `addDOMWidget(..., { serialize: false })`).

## 6. DOM Widgets, Vue Mount Pattern, Bundle Strategy

Frontend cold-load is a first-class constraint: the reference project takes ~30–60 s to load on first canvas open. MVP hard budget: **entry bundle ≤ 30 KB gzipped; widget chunks lazy-loaded; total extension assets ≤ 250 KB gzipped**.

### 6.1 Bundle targets

| Target | Entry | Output | Loaded when | Budget |
|---|---|---|---|---|
| **Extension** | `src/main.ts` | `js/main.js` + `js/assets/*.js` | ComfyUI graph opens (critical path) | ≤ 30 KB gzipped entry; widget chunks lazy |
| **Manager SPA** | `src/manager.ts` | `web_dist/` | User visits `/wildcard-pipeline/` | Route-split; no hard cap (MVP ships empty stub) |

### 6.2 Reference-project cold-load diagnosis

- `minify: false` shipped un-minified JS.
- `cssInjectedByJsPlugin` forced CSS through JS parser.
- No manual chunking — one monolithic `main.js` carried Vue + Pinia + every widget + PrimeVue even when no WP nodes were on canvas.
- `sourcemap: true` inline inflated download.
- Pinia + PrimeVue imported eagerly for widgets that didn't need them.

### 6.3 Extension bundle rules (hard requirements)

1. **Tiny eager entry.** `src/main.ts` only calls `app.registerExtension({name, getCustomWidgets})`. No Vue imports at top level. No widget component imports at top level.
2. **Lazy-load widget modules.** Two injection paths, both dynamic-imported so first use pulls the chunk:
   ```ts
   app.registerExtension({
     name: "wildcard-pipeline",

     // Custom-typed inputs → widget factory keyed by type name
     async getCustomWidgets() {
       return {
         WP_CONTEXT_MODULES: (node, inputName) =>
           import("./widgets/context").then(m => m.create(node, inputName)),
         WP_DEBUG_VIEWER: (node, inputName) =>
           import("./widgets/debug").then(m => m.create(node, inputName)),
       };
     },

     // Native-typed inputs on a specific node → mount helper after default widgets
     async beforeRegisterNodeDef(nodeType, nodeData) {
       if (nodeData.name !== "WP_PromptAssembler") return;
       const origOnCreated = nodeType.prototype.onNodeCreated;
       nodeType.prototype.onNodeCreated = function (...args) {
         origOnCreated?.apply(this, args);
         import("./widgets/assembler").then(m => m.mountHelper(this));
       };
     },
   });
   ```
3. **No PrimeVue in extension bundle.** Widgets use plain HTML + scoped CSS. PrimeVue + its Aria/theme peers are reserved for the manager SPA.
4. **No Pinia in extension bundle.** Widget state is local (`ref` / `reactive`). Cross-widget coordination via graph walking.
5. **Vue runtime-only.** Vite alias `vue → vue/dist/vue.runtime.esm-bundler.js`. Templates pre-compiled from `.vue` files.
6. **`minify: "esbuild"` + `sourcemap: "hidden"`.** Production ships minified JS with an out-of-band sourcemap file.
7. **`cssCodeSplit: true`.** Per-chunk CSS loaded via dynamic-import auto `<link>`, not inlined in JS.
8. **Externalise where possible.** Check `/scripts/app.js` interop. If ComfyUI exposes a global Vue, add to `rollupOptions.external`; otherwise bundle Vue exactly once.
9. **Tree-shakeable imports.** No barrel files. Named imports only.

### 6.4 Shared utility chunk

`src/widgets/_shared.ts` holds the Vue-in-DOMWidget factory, JSON serialiser, and conflict-scanner glue. Imported by each widget module → Vite de-duplicates into one shared chunk, so Vue exists exactly once in memory.

### 6.5 Manager SPA (stub now, budgeted from day one)

- Separate HTML entry (`src/manager.html` + `src/manager.ts`).
- Route-based code splitting via dynamic `import()`.
- PrimeVue + Pinia permitted; `unplugin-vue-components` with `PrimeVueResolver` for tree-shaking.
- Served via aiohttp static handler with gzip response.
- MVP ships an empty stub to validate the build target; fully implemented in the **Manager SPA** sub-spec.

### 6.6 CI-enforced performance gate

`scripts/check-bundle-size.mjs` runs in CI after `pnpm build:extension`. Fails the build if:

- entry gzip > 30 KB, **or**
- total `js/` gzip > 250 KB.

Hard gate prevents regression. Numbers reviewable per PR.

## 7. Conflict Scanner (MVP scope)

Pure static analysis in the browser, recomputed on widget change. Three conflict types apply while only `fixed_values` exists:

| Type | Severity | Trigger | Scope |
|---|---|---|---|
| `context_overwrite` | error | New entry writes a var that an **upstream node** already exported | cross-node (chain) |
| `duplicate_variable` | warning | Entry writes a var that an **earlier module in the same node** already wrote | intra-node |
| `missing_template_variable` | warning | Assembler template uses `$var` with no writer in its upstream chain | template resolution |

Mutually exclusive per capture (upstream check → same-node check → else clean), matching the reference project's `conflicts.ts` `if/else if` pattern.

**Examples.**

```
[Context A: style=photo] → [Context B: style=cinematic]
  → B raises context_overwrite on its entry.

[Context A with 2 fixed_values modules both writing $style]
  → 2nd module raises duplicate_variable.

[Context A: style=photo] → [Assembler: "a $stle image"]
  → Assembler raises missing_template_variable on $stle.
```

**Severity rationale.** `context_overwrite` is an *error* because silently stomping upstream is almost never intentional. `duplicate_variable` is a *warning* because intra-node overrides are sometimes deliberate. `missing_template_variable` is a *warning* because it's common during editing.

All advisory. No runtime enforcement — matches the last-write-wins runtime behaviour approved for the chain.

**Implementation notes.** Graph walkers live in `src/extension/graph.ts` under the same API names as the reference project (`collectUpstreamVariables`, `findDownstreamAssemblers`) but reimplemented avoiding reference-project anti-patterns: walk via `node.inputs[].link → app.graph.links[linkId] → graph.getNodeById(link.origin_id)`; never via `getInputNode` / `findInputSlot`. Deferred conflict types: `unresolved_constraint_target`, `unresolved_constraint_when_variable`, wildcard-specific rules.

Scanner output (`Conflict[]`) feeds widget UI as per-module-card badges + hover tooltips. Optional "Jump to module" click scrolls the offending module into view.

## 8. Repo Layout, Build, Tooling, Tests

### 8.1 Repo layout

```
ComfyUI-WildcardPipeline/
├── __init__.py                     # V3 comfy_entrypoint + extension
├── pyproject.toml                  # package metadata + ruff + pytest
├── package.json                    # pnpm, Vue deps, scripts
├── pnpm-workspace.yaml             # single-package workspace (future-proof)
├── vite.config.mts                 # --mode extension | manager
├── tsconfig.json                   # strict, alias @→./src
├── conftest.py                     # sys.path shim for test-without-ComfyUI
├── .releaserc.js                   # semantic-release config
├── commitlint.config.js            # conventional commits
├── .husky/                         # pre-commit + commit-msg hooks
├── .github/workflows/
│   ├── ci.yml                      # pytest matrix + frontend typecheck/build + size gate
│   └── release.yml                 # semantic-release on main push
├── .gitignore                      # js/, web_dist/, node_modules/, .pytest_cache/, __pycache__/, .superpowers/
│
├── engine/
│   ├── __init__.py
│   ├── context.py
│   ├── modules.py
│   ├── handlers.py
│   ├── pipeline.py
│   └── template.py
│
├── nodes/
│   ├── __init__.py
│   ├── types.py
│   ├── context_node.py
│   ├── assembler_node.py
│   └── debug_node.py
│
├── src/
│   ├── main.ts
│   ├── manager.ts                  # stub for post-MVP
│   ├── env.d.ts
│   ├── typings/comfyui.d.ts
│   ├── widgets/
│   │   ├── _shared.ts
│   │   ├── context.ts
│   │   ├── assembler.ts
│   │   └── debug.ts
│   ├── extension/
│   │   ├── graph.ts
│   │   └── conflicts.ts
│   └── components/
│       ├── context/ContextWidget.vue
│       ├── assembler/AssemblerHelper.vue
│       └── debug/DebugViewer.vue
│
├── tests/
│   ├── test_template.py
│   ├── test_modules.py
│   ├── test_engine.py
│   └── test_nodes.py
│
├── docs/
│   └── superpowers/specs/
│
├── js/                             # built extension (gitignored)
└── web_dist/                       # built manager (gitignored, empty in MVP)
```

### 8.2 Package manager & scripts

**pnpm** is the package manager. `packageManager` field pinned in `package.json`. `pnpm-workspace.yaml` declares the root package.

```jsonc
{
  "scripts": {
    "dev": "vite build --watch --mode extension",
    "build:extension": "vite build --mode extension",
    "build:manager": "vite build --mode manager",
    "build": "pnpm build:extension && pnpm build:manager",
    "typecheck": "vue-tsc --noEmit",
    "lint": "eslint src --ext .ts,.vue",
    "size": "node scripts/check-bundle-size.mjs",
    "test": "vitest run",
    "test:py": "pytest",
    "prepare": "husky"
  }
}
```

### 8.3 Python tooling

- Python ≥ 3.10 (floor). Runtime target on this machine: embedded 3.12.10 at `E:\ComfyUIDev\ComfyUI-Easy-Install\python_embeded\python.exe`.
- `pyproject.toml` with `[project]` metadata, `[tool.ruff]` (line-length 100, select `E/F/I/UP/B`), `[tool.pytest.ini_options]`.
- No runtime deps beyond stdlib in `engine/`. Nodes depend on `comfy_api` (provided by ComfyUI host, not a pip install).
- Dev deps (extras group `dev`): `pytest`, `pytest-asyncio`, `ruff`.

### 8.4 Dev-runtime environment separation

| Context | Python used | Purpose |
|---|---|---|
| **Runtime** (ComfyUI loads package) | embedded `python_embeded\python.exe` 3.12.10 | Runs nodes |
| **Dev / tests** | `.venv` with system Python OR embedded | `pytest`, `ruff`, tooling |
| **CI** (GitHub Actions) | `setup-python` matrix 3.10/3.11/3.12 | Cross-version pytest + typecheck + build |

Engine's stdlib-only constraint means embedded Python loads the package without any `pip install`. CI's lowest matrix row (3.10) is authoritative for what ships.

Two dev paths documented in `CONTRIBUTING.md`:

- **Recommended:** `python -m venv .venv` with system Python ≥ 3.10, then `.venv\Scripts\pip install -e ".[dev]"`.
- **Zero-install:** `"$EMBED\python.exe" -m pip install pytest ruff` into embedded. Works, but mixes dev deps into ComfyUI's interpreter.

Husky pre-commit resolves Python via `PATH`; if missing, fails fast with a helpful message. Helper batch script `scripts/run-tests.cmd` auto-detects `.venv` then falls back to embedded.

### 8.5 Open-source tooling

**`.releaserc.js` — semantic-release.** Branches: `main`. Plugins: `@semantic-release/commit-analyzer`, `release-notes-generator`, `changelog`, `github`, `git`. Versioning via Conventional Commits → SemVer bump. Artifacts published to GitHub Releases; ComfyUI Registry publish via `comfy-cli` in `release.yml` after tag.

**`commitlint.config.js`.** `extends: ["@commitlint/config-conventional"]`. Enforced on `commit-msg` hook.

**Husky hooks (`.husky/`).**
- `pre-commit`: `pnpm typecheck && pnpm lint && pnpm test` (frontend) + `ruff check` + `pytest -q` (backend).
- `commit-msg`: `commitlint --edit $1`.

**GitHub Actions.**
- `ci.yml` — pytest on Py 3.10/3.11/3.12, frontend typecheck + build + bundle-size gate.
- `release.yml` — on `main` push, semantic-release → tag + changelog + Registry publish.

**Repo hygiene.** `CODEOWNERS → @DumiFlex`. `LICENSE` (to confirm; reference project used GPL-3.0). `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md` ported and adapted.

### 8.6 Tests (MVP coverage)

- **engine/** — unit tests for `resolve_variables`, `module_from_dict`, `PipelineEngine.run` with `fixed_values`, chain merge behaviour, trace shape.
- **nodes/** — mock `comfy_api` stubs in `conftest.py`; verify `execute()` wires upstream → engine → `ContextPayload` correctly.
- **src/extension/conflicts.ts** — Vitest unit tests for the 3 conflict types.
- **src/widgets/** — no UI tests in MVP; manual QA + later Playwright sub-spec.

CI badge + coverage badge added to `README.md`.

### 8.7 CLAUDE.md

Written at the **start of implementation** (not now). Captures: build/test commands, conventions, anti-patterns inherited from the reference project, engine isolation invariant, bundle-size gate, custom type name, embedded-vs-dev Python split. Writing earlier risks encoding decisions that haven't survived first contact with code.

## 9. Out of Scope / Future Sub-Specs

Every item below is a distinct follow-up brainstorming session → spec → plan → implementation cycle. Ordering is by dependency; items marked *flexible* can swap with neighbours based on demand.

1. **Wildcards module + seed propagation.** `wildcard` module type with weighted options + categories. Nested `@{uuid}` refs with cycle detection + depth limit. Per-capture seed via `sha256(node_seed, capture_name)`. Pick-mode (pin a specific value).
2. **Combine module.** *(flexible with #3)* `combine` handler: `template + capture_as`. Adds `missing_combine_variable` to scanner.
3. **Constraints module.** *(flexible with #2)* Category rule matrix + exceptions. Applied to wildcard options pre-sampling. Adds `unresolved_constraint_target` + `unresolved_constraint_when_variable` to scanner.
4. **Derivations module.** Conditional mutations after wildcards. To brainstorm: any/all conditions, priority/rounds, output templates, `sample_from`.
5. **`WP_ContextInject` node.** 3 optional socket inputs + autogrow-style slot-to-variable mapping. Widget: connected-slot detector + variable-name editor.
6. **Library — sqlite backend + REST API.** Schema (alembic migrations): modules, pipelines, history (≤3 versions). aiohttp routes under `/wildcard-pipeline/api/*`. Inline serialised module remains authoritative in workflows; library `id` is a weak link; UI warns on missing. Context menu: *Save module to library*, *Link instance to library entry*, *Edit instance overrides*.
7. **Manager SPA.** Vue 3 + PrimeVue + Pinia at `/wildcard-pipeline/`. Routes: modules list (per type), module editor, pipelines list, pipeline editor, test playground, import/export. Route-based code splitting. Playwright e2e.
8. **Pipeline presets.** Node right-click menu *Save as pipeline* / *Import pipeline* (append/replace). Sharable JSON + library storage. Rename node on import.
9. **`WP_DEBUG` env socket + advanced debug UX.** `os.environ["WP_DEBUG"]` toggles an extra DEBUG_JSON socket output on every node. `WP_Debug` gains a second input accepting debug JSON directly. Viewer: timeline view, diff view between runs.
10. **Instance overrides UI.** Per-instance overrides on library-linked modules (weight tweaks, enable/disable values). Diff indicator in widget. Revert-to-library button.

### Explicitly not planned

- Workflow migration from `ComfyUI-Wildcard-Pipeline` (users re-author).
- Multi-user / collaboration features.
- Cloud sync for library.
- Non-Vue widgets (React/Svelte).

### Governance

Each spec starts with its own brainstorming → spec doc in `docs/superpowers/specs/` → implementation plan → PR. No implementation of #1 begins until MVP lands and has surfaced real constraints from use.
