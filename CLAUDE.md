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
pnpm check:css-isolation  # flag non-wp-prefixed top-level CSS selectors
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
- **Conflict scanner** — advisory only; never block execution. Runtime last-write-wins. Rule types: `shadows_upstream` (info), `duplicate_variable` (warning), `missing_template_variable` (warning), `constraint_source_missing` / `constraint_target_missing` (warning — uuid not in catalog), `constraint_orphan_source` (warning — no source instance UPSTREAM), `constraint_orphan_target` (warning — the constraint's reach selector covers ZERO reachable downstream instances; per-selector, NOT count-aware — overlapping constraints may freely share an instance). Engine emits runtime warnings `constraint_never_applied` (the reach matched nothing at runtime) and `constraint_partial_reach` (a `next N` / `pick` reach matched fewer instances than requested).
- **Constraint reach (SP3)** — each constraint carries a `target_select` reach selector: `{mode: "first"|"next"|"all"|"pick", count?, picks?}`, default `all`. Every constraint whose reach covers a firing downstream target instance applies, COMBINED — per-pick × per-tag × per-constraint multiply, with `exclude` (factor 0) absorbing. No more one-shot/consumed-set: the engine counts per-constraint downstream hits in `ctx["__wp_constraint_hits__"]`. Reach is downstream-relative (counts from the constraint's own chain position) and cross-node + transitive (resolves `@{uuid}` at any depth). `pick` selects specific instances by `_uid` (direct top-level) or carrier `_uid` + option id (nested). The re-weight math is the pure `engine/modules/_constraint_math.py::combine_constraint_factor`, mirrored in TS at `src/manager/utils/constraint-math.ts` via the shared `tests/fixtures/constraint-corpus.json`. Published payloads using a non-default `target_select` stamp `schema_version = 4` (additive; community catalog v4).
- **Bundle-size gate** — entry `main.js` must stay ≤ 30 KB gzipped; total `js/` ≤ 250 KB. Pre-commit run `pnpm build:extension && pnpm size`. Raising budget require explicit PR discussion.
- **Coverage gate** — vitest v8 coverage with thresholds (lines/statements 50%, functions 40%, branches 65%). Anchored to current baseline; ratchet up alongside new tests.
- **Caching** — `WP_Context` + `WP_Debug` set `not_idempotent=True` so seed cycling always re-executes.
- **Conventional Commits** — enforced by commitlint. semantic-release read log to cut versions.
- **Extension isolation — four layers**:
  1. **CSS class namespace**: every class selector starts with `.wp-*` (or `.var-1..8`). Never write a top-level rule with an unprefixed class — it could collide with ComfyUI core or another custom node. New top-level non-`wp-*` selectors are blocked by `pnpm check:css-isolation`.
  2. **`@layer wp-extension` wrap**: standalone extension CSS (`a11y.css`, `display-prefs.css`, `ContextWidget.vue` unscoped block, etc.) sits in `@layer wp-extension { ... }` so host CSS (unlayered) beats us on any selector collision. Layered author rules are subservient to unlayered ones in the same origin. NOT applicable to CSS that gets `@imported` into Vue `<style scoped>` blocks — the scoper can't parse `@layer` atrules; rely on namespace prefix there.
  3. **WeakMap stashes for litegraph object metadata**: never attach state to nodes/slots via string keys (`node._wpFoo = ...`). Use the WeakMaps in `src/extension/_stashes.ts` — module-private, no collision risk with other extensions, invisible to workflow serialization. Method overrides (`getInputPos`, `onConnectionsChange`, etc.) must keep their standard names because litegraph reads them; isolation there is via wrap-and-call-original chaining.
  4. **Persistent state on `node.properties` only**: anything that must survive workflow save lives on `node.properties[key]` with a `wp_*` / `collapse_connections`-style string key (workflow JSON is the serialization root). Transient session state belongs in WeakMaps.

## Frontend overview

- **Entry** `src/main.ts` → `js/main.js` (~1.6 KB gzip). Top-level await preload widget chunks so `getCustomWidgets` factories run sync (Promise return → `{widget: undefined}` and widget never mount). Register extension + lazy-import widget code only when ComfyUI hand matching node.
- **Lazy chunks** `src/widgets/{context,debug,assembler}.ts` — one mount glue per widget. Each `import()` become own asset chunk, plus sibling SFC chunk (`ContextWidget`, `DebugViewer`, `AssemblerHelper`).
- **Shared** `src/widgets/_shared.ts` expose `createDomWidgetHost`, JSON helpers (`parseWidgetJson`, `parseWidgetJsonWithRecovery` for corrupt-workflow recovery path), shared types. Largest shared chunk (`_shared`, ~33 KB gzip) is Vue runtime + plugin-vue helper, pulled in by every widget on first use.
- **Graph + conflicts** `src/extension/{graph,conflicts,subgraph-badge,reactive,graph-events}.ts` — pure logic, no DOM. Imported by widgets, easy to unit-test isolated.
- **Reactivity** `extension/reactive.ts:reactiveFromGraph` — wires `onConnectionsChange` chain + 400ms polling fallback + `afterConfigureGraph` re-sync so widgets recompute on graph edits + workflow loads without flashing stale state.
- **Adding new widget**: (1) write SFC under `src/components/<name>/`, (2) add `src/widgets/<name>.ts` exposing `create(node, inputName)` that return `createDomWidgetHost(...)`, (3) wire in `src/main.ts` — either as `getCustomWidgets` entry (for inputs declared with matching widget-type) or via `beforeRegisterNodeDef → onNodeCreated` (for free-floating helpers). Use `import("./widgets/<name>")` so stay out of entry chunk + size gate keep holding.

## Schema versioning + lazy migration machine

Spec: `D:\Desktop\Wildcard-Pipeline-Community\docs\superpowers\specs\2026-06-05-schema-versioning-migration-design.md` (cross-repo lock; read before bumping).

**Three axes** every payload + library row carries:

1. **`schema_version`** (per row, engine column added in migration 014): which payload shape this row's `payload` is in. Single version per payload root — bundles' children inherit the bundle's `schema_version`.
2. **`producer_engine_version`** (per published community version, server-side only): diagnostic. Never load-bearing.
3. **`version_number`** (per community post, server-side): the user-facing 1/2/3 publish revision. Unrelated to schema_version.

**Engine row columns** (migration 014):
- `schema_version INTEGER NOT NULL DEFAULT 1` — current shape this row targets.
- `original_payload_json TEXT` — verbatim local mirror of the payload as it arrived from community (or import). Lazy migrator reads from here, never from the live `payload` field. Lets us re-project from the original if a migrator chain gets fixed retroactively.
- `tolerant_drift_status TEXT` — `none` | `tolerant` | `strict`. Set by parseTolerantAsCurrentShape during install.
- `schema_migrated_at TEXT` — wall-clock stamp of last lazy migration step.

**The machine**:

- **Validator registry** (`src/manager/import-export/validators/`): one Zod validator per known `schema_version`. Strict at `≤ CURRENT_SCHEMA_VERSION`; future versions go through `parseTolerantAsCurrentShape` (additive-strip).
- **`parseTolerantAsCurrentShape(raw, currentVersion)`** (`src/manager/import-export/tolerant-parse.ts`): strips fields the current shape doesn't know, returns the projection that matches `currentVersion`. Used at install when source `schema_version > CURRENT`.
- **`migratePayload(payload, from, to)`** (`src/manager/import-export/migration-machine.ts`): forward-only chain. Each step is a registered function in the migrators map. `from > to` is illegal — no downgrades.
- **`lazy_migrate_row(row, currentVersion, migrators, validators)`** (`engine/db/lazy_migrate.py`): reads `original_payload_json` (or `payload` if absent), walks the migrator chain to `currentVersion`, validates, writes back. Bulk-at-boot runner is eager iteration of this routine.
- **Install decision tree** (`src/manager/import-export/install.ts`): branches on `source_schema_version` vs `CURRENT_SCHEMA_VERSION`:
  - `=`: strict validate + insert.
  - `<`: migratePayload then strict validate + insert.
  - `>` and tolerant-only diff: parseTolerantAsCurrentShape, mark `tolerant_drift_status='tolerant'`, insert.
  - `>` and breaking-future diff (per catalog `is_breaking_from_previous` AND-fold across the interval): refuse install with a clear error.

**Server probe**: `engine-export-wrap.ts:ENGINE_SCHEMA_VERSION` is the sister's pinned CURRENT — it ships in the sister bundle, not fetched from server. The host bridge install path reads it from `window.__wpcRuntime.schemaVersion`. Server-first deploy ordering (see community CLAUDE.md) means the community catalog always reflects shapes ≥ sister's CURRENT.

### Bumping `schema_version` (the proper way)

When a payload shape change lands (not a row-column change — those don't bump schema):

1. **Add the new shape's validator.** New file under `src/manager/import-export/validators/v<N>.ts` exporting a Zod schema. Register in `validators/index.ts`.
2. **Add the migrator step.** In `src/manager/import-export/migration-machine.ts`, register `migrators[N-1 → N]: (payload) => ...`. Forward-only. The function is pure — no side effects.
3. **Add fixtures.** `src/manager/__tests__/import-export/fixtures/v<N>/` — at minimum: a `valid-strict.json`, a `from-v<N-1>-migrated.json` round-trip case, and one `breaking-shape.json` if the bump is breaking.
4. **Bump the constant.** `CURRENT_SCHEMA_VERSION` lives in the validator registry. Bump it to `N`. Also bump `ENGINE_SCHEMA_VERSION` in `src/manager/components/engine-export-wrap.ts`.
5. **Write the migration test.** `tests/engine/db/test_lazy_migrate.py` should cover v<N-1>→v<N> round-trip + the breaking-future path if applicable.
6. **Run `pytest tests/engine/ -q && pnpm test` until green.** Sister pre-commit hook (~2 min) also runs lint + typecheck + build + size; expect that wait.
7. **Coordinate the community-side catalog row.** Community web's `schema_catalog` table gets the matching `(version, is_breaking_from_previous, notes)` row + a deploy that lands BEFORE sister's PR merges. See community CLAUDE.md "Bumping the schema" for the server side.
8. **Sister deploys after server.** Once catalog HEAD ≥ sister's CURRENT, sister can safely refuse breaking-future shapes.

### Validator ↔ engine parity (DON'T skip)

The community TS validators in `src/validators/` are a hand-authored
re-implementation of the engine's payload shapes, and re-implementations
drift — fixed_values shipped for weeks as `entries/{variable_name}` when
the engine has always used `values/{id,name,value}`. The guard against
this:

- `scripts/dump_engine_shapes.py` builds one sample payload per subtype,
  validates each against that subtype's **own engine `Handler.validate_payload`**
  (the authority — raises if not engine-valid), and writes the engine-row
  shape to `src/validators/fixtures/engine-parity/*.json`.
- `src/validators/__tests__/engine-parity.test.ts` asserts the **strict**
  community validator accepts every one of those fixtures.

**Any time you change an engine module payload shape** (a `*_handler.py`
`validate_payload`, or what the editor stores), run
`python scripts/dump_engine_shapes.py` and commit the regenerated
fixtures. If the sample no longer validates against the handler, the
script fails — update the sample. If the TS validator then rejects the
new shape, the parity test fails — update the validator. Either failure
means the two have diverged; fix it before publish breaks for a user.

### Row-level column changes (no schema_version bump needed)

The most recent example is **migration 015 (`content_rating` column)**. Adding a column to `modules` or `bundles` is just an Alembic-style SQLite migration — no payload-shape change, no validator update, no migrator chain. Procedure:

1. **New file** `engine/db/migrations_sql/<NNN>_<name>.py` mirroring 013/015 shape: `_has_column` gate + `with conn: conn.execute("ALTER TABLE … ADD COLUMN …")` for both `modules` and `bundles` if the field applies to both.
2. **Update `_row_to_module` / `_row_to_bundle`** in `engine/db/repositories.py` — wrap the new column read in `try/except (IndexError, KeyError)` so pre-migration fixtures don't blow up.
3. **Update `ModuleRepository.create/update` + `BundleRepository.create/update`** to accept the new field as a kwarg.
4. **Update `_insert_module` / `_insert_bundle` (+ `_update_module` / `_update_bundle` if needed)** in `engine/importer.py` to pass the field through from the entity dict. Use `COALESCE(?, col)` on the UPDATE side when you want missing-in-content to preserve existing value (NOT overwrite to NULL).
5. **Update `wp_api/modules.py` + `wp_api/bundles.py`**: add the field to `_UPDATABLE_FIELDS` + plumb into the create handlers.
6. **TS types**: extend `ModuleRow` / `BundleRow` + `*CreateInput` / `*UpdateInput` in `src/manager/api/types.ts`.
7. **Bump the head-migration test**: `tests/engine/db/test_migrations.py:test_migrate_records_version` asserts the head version — update to `<NNN>`. Same for the expected-columns set tests.
8. **Write a migration test** at `tests/engine/db/test_migration_<NNN>.py` — column exists, default backfill correct, idempotent rerun, accepts the new values.

If the column also flows through the host-bridge install seam (community origin metadata), extend `InstallOrigin` in `src/manager/import-export/install.ts` AND the embed's `HostInstallOpts.origin` in `web/src/embed/EmbedDetail.vue` (community web repo). Map community-side naming → engine-side naming at the seam if they differ (e.g. `'sfw'` → `'safe'`).

## Anti-patterns (inherited from reference project `ComfyUI-Wildcard-Pipeline`)

- Never use V1 `NODE_CLASS_MAPPINGS` / `EXTENSION_WEB_DIRS`.
- Never `console.log` for user warnings — use ComfyUI toast API.
- Never use `getInputNode()` / `findInputSlot()` — walk via `node.inputs[].link → app.graph.links[linkId] → graph.getNodeById(link.origin_id)`.
- Never use `requestAnimationFrame` in `onConnectionsChange`; link already established when callback fires.
- Never register SPA catch-all route before API routes.
- Never suppress types with `as any`, `@ts-ignore`, `@ts-expect-error`.
- `cssInjectedByJsPlugin` required, not optional. Vite library mode emit CSS files but never inject `<link>` tags, and ComfyUI load our `main.js` as bare ES module so `<link rel="modulepreload">`-style auto-loading does not apply. Per-chunk runtime injection (`relativeCSSInjection: true`) keep entry chunk CSS-free — styles only get injected when owning lazy chunk loads. This what every Vue-based ComfyUI extension in wild does (see `ComfyUI-Easy-Use/web_version/v2/easyuse.js`).