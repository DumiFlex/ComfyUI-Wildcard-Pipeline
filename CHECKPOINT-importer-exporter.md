# Importer / Exporter — Implementation Checkpoint

**Branch:** `feat/importer-exporter-v2` (off `main`)
**Tip commit:** `3f892eb` (Item 3: Tier3ChainViz aria-expanded — all deferred follow-ups resolved)
**Date checkpointed:** 2026-05-23
**Spec:** `docs/superpowers/specs/2026-05-22-importer-exporter-design.md` (gitignored, per-contributor)
**Plan:** `docs/superpowers/plans/2026-05-22-importer-exporter.md` (gitignored, per-contributor)

## Status: 22 of 22 plan tasks complete ✅ + 4 of 4 deferred follow-ups resolved ✅

| # | Task | Status | Key commits |
|---|------|--------|-------------|
| 1 | TS `moduleFingerprint` | ✅ | `a183968` → `b62d4aa` (sep) → `d8b3982` (citation) → `6528fbb` (unified API) → `ab09a5b` (null guard) |
| 2 | Python `module_fingerprint` mirror | ✅ | `6cff064` → `46f250a` (UTF-16+JS-compat) → `7902a9e` (1e21 threshold) → `6528fbb` (unified) |
| 3 | Backfill `snapshot_fingerprint` on `ModuleRepository.create/update` | ✅ | `e7c98ed` → `9021439` (independent expected fp test) |
| 4 | TS migration framework (`migratePayload`) | ✅ | `f38115c` → `b0dd24c` (rename `migratedEntityCount` + tighten) |
| 5 | Python migration mirror (`migrate_payload`) | ✅ | `e6de26c` |
| 6 | TS parse pipeline (`parsePayload`) | ✅ | `34b35fd` → `229bac9` (type tightening + array guard) |
| 7 | TS dep graph (`buildDepGraph` / `transitiveClosure` / `constraintsBothSidesIn`) | ✅ | `e2cd478` → `70c0f8c` (strict 8-hex regex) → `59fd812` (overload accepts pre-built graph) |
| 8 | TS collision detection (`detectCollisions`) | ✅ | `7714906` |
| — | 7-bucket cascade refactor (Tasks 4-8 code) | ✅ | `f5de301` |
| 9 | Python exporter (`build_export_payload`) | ✅ | `571b13f` |
| 10 | Export endpoint `POST /wp/api/export/build` | ✅ | `92a9d65` |
| 11 | `PickerSection.vue` + `PickerRow.vue` + Checkbox indeterminate | ✅ | `0d37362` → `846e624` → `20d5c14` → `adf2c5f` |
| 12 | `ExportTab.vue` + `api.importExport.build` + view wire | ✅ | `3f5430e` → `e4c6622` → `fa6351b` (review fixes) |
| 13 | `engine/importer.py` — atomic commit + snapshot undo | ✅ | `9afdf85` → `eb2dee4` (error envelope tightening) |
| 14 | `/wp/api/import/commit` + `/wp/api/import/undo` endpoints | ✅ | `53bedab` → `1c8bf31` (structural 404 for missing undo) |
| 15 | `commit.ts` — 7-bucket partitioner + api.importExport.commit/undo | ✅ | `af90e28` → `d7ceeee` (rename strips stale timestamps + category guard) |
| 16 | `ImportTab.vue` — file pick + clipboard paste | ✅ | `ea45677` → `b72e60a` (view wire) |
| 17 | `ImportPicker.vue` + entity `uuid`→`id` alignment fix | ✅ | `9cf37c7` (alignment) → `f69a599` → `53ec3f4` (view wire) → `d8aad84` (payload-swap reset) |
| 18 | `ConflictModal.vue` — batch + per-item resolution | ✅ | `c893ca3` → `0d80d43` (a11y + type module split) |
| 19 | `Tier3ChainViz.vue` — non-overridable chain visualization | ✅ | `d923052` |
| 20 | `ImportAsNewRename.vue` — inline rename flow | ✅ | `8760fac` |
| 21 | `broken-refs.ts` — post-commit dangling ref discovery | ✅ | `ba4dff7` (warning-store wire-in deferred — see Outstanding) |
| 22 | `docs/import-export-contract.md` — cross-language contract | ✅ | `2cc388c` |

## Key design decisions (locked)

1. **Unified `moduleFingerprint(module)`** hashes `[type, name, description, sorted_tags_csv, payload_hash]` joined by `\n`. Works for all 5 module types via the opaque `payload_hash`. Bundles use existing `bundleFingerprint` (separate algorithm).
2. **7-bucket entity coverage:** bundles, wildcards, fixed_values, combines, derivations, constraints, categories. Categories use name-based merge-or-create (no fingerprint, no UUID-collision detection).
3. **Cross-language hash parity:** djb2 over UTF-16 code units, `\n` separator, JS-compat number formatting. Reference test value: `moduleFingerprint(<canonical wildcard>) === "ba7a57fa"` on both TS and Python.
4. **NULL fingerprint = "no collision"** — defensively classified as `conflict` in `detectCollisions` (surface to user; safer than silent skip).
5. **Atomic commit + snapshot-based undo.** Replaces preserve UUID + swap content. Undo restores replaced snapshots + deletes added/renamed UUIDs.
6. **Picker-first flow.** Smart default selection: single root entity → all selected, multi-entity → none selected.
7. **`Select with dependencies`:** outgoing transitive closure + auto-include constraints where source AND target both selected. Reverse deps NEVER auto-pulled.
8. **Schema migration:** versioned chain via `migratePayload` (TS) / `migrate_payload` (Python). `CURRENT_SCHEMA_VERSION = 1`. v0→v1 stub tags entities with `migrated_from: 0`.
9. **Tier-3 bundles** (nested too deep) are hard-rejected with chain visualization. Non-overridable per design.
10. **Broken refs** post-commit surface via existing `RichTextInput`/`RichTextPreview` warning marker infrastructure (reuse `ResolveWarning` shape from `src/manager/utils/resolveTokens.ts:16`).

## Schema reality references (DO NOT re-discover)

- `engine/db/repositories.py`: `ModuleRepository`, `BundleRepository`, `CategoryRepository`
- `ModuleRepository.create/update` (NOT `upsert`) — already stamps `snapshot_fingerprint` per Task 3
- Repositories raise `ModuleNotFound` / `BundleNotFound` / `CategoryNotFound` on miss (NOT return `None`)
- Bundle child ref field is `child["id"]`, not `child["uuid"]`. Tier-2 inner-bundle children have `type: "bundle"`.
- Test fixture for in-memory DB connection is named `wp_db` (root conftest), NOT `db_conn`
- Module payload shapes per type:
  - `wildcard`: `{ options: [{ id, value, weight, ... }] }`
  - `fixed_values`: `{ values: [{ name, value, ... }] }`
  - `combine`: `{ template, output_var }`
  - `derivation`: `{ rules: [{ id, branches: [...] }] }`
  - `constraint`: `{ source_wildcard_id, target_wildcard_id, matrix, exceptions }`

## API endpoint contract (locked)

- `POST /wp/api/export/build` (Task 10) — body: `{ bundle_uuids, wildcard_uuids, fixed_values_uuids, combine_uuids, derivation_uuids, constraint_uuids, category_uuids }`. Response: full 7-bucket payload via `engine.exporter.build_export_payload`.
- `POST /wp/api/import/commit` (Task 14) — body: `{ adds, replaces, renames }`. Response: `{ ok, undo_entry_id }`. Atomic transaction.
- `POST /wp/api/import/undo` (Task 14) — body: `{ undo_entry_id }`. Response: `{ ok }`. Reverses commit.

## Outstanding concerns (deferred to follow-up work)

- **Task 5 mutation hazard:** Python `migrate_payload` doesn't deep-copy normalized arrays. Future v1→v2 migrations that mutate list items in-place would corrupt caller's payload. Current v0→v1 uses dict-spread and is safe. Fix when adding any new migration that touches list items.
- **Task 8 LibraryRow shape narrow:** only exposes `snapshot_fingerprint`. ImportPicker (Task 17) already consumes full payload entities; revisit if a future caller needs an intermediate LibraryRow type.

## Post-feature follow-ups (RESOLVED 2026-05-23)

All four originally-deferred items completed in a follow-up pass after the 22-task plan landed:

- **Item 1 — "Select with dependencies" in ExportTab:** RESOLVED `9bf7e46`. Added `liveLibraryToRawPayload` adapter (`src/manager/import-export/live-library-adapter.ts`) that flattens wildcard `payload.options` to top-level so dep-graph helpers can walk live library rows. Button wired with `transitiveClosure` + `constraintsBothSidesIn` closure walk.
- **Item 2 — ConflictModal per-item batch override:** RESOLVED `2b600eb`. Expandable per-row override list under the batch dropdown. `setBatchOverride(id, value)` writes/deletes from `perItemDecisions` (cleanly absent on "default", no sentinel). Existing emit shape unchanged.
- **Item 3 — Tier3ChainViz aria-expanded:** RESOLVED `3f892eb`. Vue 3.5 `useId()`-based stable id linking toggle button (`aria-expanded` + `aria-controls`) to chain body div (`id`).
- **Item 4 — Commit orchestrator + warning store + broken-refs wire-in:** RESOLVED `d587e23` → `75ba12b` → `7d951c9` → `01ea73d` (4 commits). Built `useResolveWarnings` singleton composable, extended `RichTextInput`/`RichTextPreview` with `moduleId` prop merging prop + store warnings, replaced `onImportV2SelectionReady` placeholder with full pipeline: collision scan → ConflictModal (conditional) → `buildCommitPayload` → `api.importExport.commit` → library reload → `discoverBrokenRefsForImport` → store push → success toast with Undo action. Empty-payload short-circuit. Stale broken-ref clear per committed id. `console.warn` at silent-drop sites in `partitionSelection`.

## How to resume

In a fresh session:

1. Open this checkpoint doc + the plan doc (`docs/superpowers/plans/2026-05-22-importer-exporter.md`).
2. Confirm git branch is `feat/importer-exporter-v2`, tip at `571b13f`.
3. Use `superpowers:subagent-driven-development` skill.
4. Start at Task 10 (export endpoint). Plan body for Tasks 10-22 still uses the 4-bucket shape — **always override with the 7-bucket reality** when dispatching implementers (see Task 9 dispatch prompt for the canonical example).
5. For each task: implementer (haiku/sonnet by complexity) → spec compliance review (haiku) → code-quality review (sonnet, via `superpowers:code-reviewer`). Apply two-stage review pattern established in Tasks 1-9.

## Test suite status at checkpoint

- Vitest: 2031 passed, 3 skipped (all pre-existing skips) — 2031 reflects post-deferred-items follow-up
- Pre-deferred-items baseline (2026-05-22, all 22 plan tasks): 1989 passed
- Pytest: ~509 passed (engine 323 + wp_api 206)
- Typecheck (`pnpm typecheck` via vue-tsc): clean
- Pre-commit hooks (lint + typecheck + test + build + size + pytest): green on every commit landed on this branch
- Bundle size: within budget (entry ≤ 30 KB, total ≤ 316 KB) — manager build holds the new picker/importer UI; extension entry untouched

## Commits since fork from main (count: 42 + 1 refactor + 1 checkpoint)

```
2cc388c docs(import-export): canonical cross-language contract reference
ba4dff7 feat(import-export): broken-ref discovery function + tests
8760fac feat(import-export): inline rename for import-as-new flow
d923052 feat(import-export): tier-3 chain visualization in conflict modal
0d80d43 fix(import-export): conflict modal accessibility + type module split + dead ternary
c893ca3 feat(import-export): conflict modal with batch + per-item resolution
d8aad84 fix(import-export): reset picker state on payload swap + guard non-string opt values
53ec3f4 feat(import-export): wire import picker into ImportExport view
f69a599 feat(import-export): import picker with smart-default + dep indicators
9cf37c7 fix(import-export): align entity key reads to 'id' across dep-graph/collision/parse
b72e60a feat(import-export): wire import-tab into ImportExport view
ea45677 feat(import-export): import-tab component with file pick + clipboard paste entry
d7ceeee fix(import-export): strip stale timestamps on rename + fail loudly on smuggled category decisions
af90e28 feat(import-export): commit + undo client helpers with 7-bucket partitioner
1c8bf31 refactor(wp_api): structural 404 for missing undo entry
53bedab feat(wp_api): /wp/api/import/commit + /wp/api/import/undo endpoints
eb2dee4 fix(engine): tighten importer error envelope + missing-field guards
9afdf85 feat(engine): atomic import commit + snapshot undo with 7-bucket dispatch
fa6351b fix(import-export): address task 12 code review feedback
e4c6622 feat(import-export): export tab component + v2 tab wiring
3f5430e feat(api): exportBuild client method calling /wp/api/export/build
adf2c5f refactor(import-export): use typed emit binding in PickerRow
20d5c14 fix(ui): make checkbox indeterminate state visually distinct
846e624 feat(import-export): shared PickerSection + PickerRow components
0d37362 feat(ui): add indeterminate prop to shared Checkbox component
92a9d65 feat(wp_api): post /wp/api/export/build endpoint
571b13f feat(engine): export payload builder with 7-bucket grouping + transitive bundle walk
f5de301 refactor(import-export): expand RawPayload to 7 buckets matching actual schema
7714906 feat(import-export): uuid + fingerprint collision detector for modules
59fd812 perf(import-export): transitiveClosure accepts pre-built graph
70c0f8c fix(import-export): restore strict 8-hex-char ref regex
e2cd478 feat(import-export): outgoing-direction dependency graph
229bac9 refactor(import-export): tighten parse types + json-array guard
34b35fd feat(import-export): parse pipeline with migration + fingerprint verify
e6de26c feat(engine): versioned payload migration chain (python mirror)
b0dd24c refactor(import-export): clarify migratedEntityCount semantics + tighten tests
f38115c feat(import-export): versioned migration chain (typescript)
9021439 test(engine): independent expected fp + name-only update guard
e7c98ed feat(engine): backfill snapshot_fingerprint on module create/update
ab09a5b fix(import-export): moduleFingerprint tolerates null tags from raw db rows
6528fbb refactor(import-export): unified moduleFingerprint replaces per-type helpers
7902a9e fix(engine): raise int-coercion threshold to 1e21 matching js number tostring
46f250a fix(engine): utf-16 djb2 + js-compat number formatting for cross-lang parity
6cff064 feat(engine): python fingerprint helpers mirroring typescript
d8b3982 docs(import-export): use full path in fingerprint test citation
b62d4aa fix(import-export): newline separator in fingerprints to prevent prefix collisions
a183968 feat(import-export): typescript fingerprint helpers for wildcard/variable/constraint
```

(Pre-fork commits include the RichTextInput surgical fix `85cb5dc` and earlier `feat/spa-polish-pass` work that was fast-forwarded into `main` before this branch was created.)
