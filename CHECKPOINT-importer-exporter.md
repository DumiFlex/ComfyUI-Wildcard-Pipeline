# Importer / Exporter — Implementation Checkpoint

**Branch:** `feat/importer-exporter-v2` (off `main`)
**Tip commit:** `571b13f` (Task 9: Python exporter)
**Date checkpointed:** 2026-05-22
**Spec:** `docs/superpowers/specs/2026-05-22-importer-exporter-design.md` (gitignored, per-contributor)
**Plan:** `docs/superpowers/plans/2026-05-22-importer-exporter.md` (gitignored, per-contributor)

## Status: 9 of 22 plan tasks complete

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

## Tasks remaining (10-22)

### Phase 4 — Export side
- **Task 10:** Export endpoint `POST /wp/api/export/build` in `wp_api/import_export.py`
- **Task 11:** Shared `PickerSection.vue` + `PickerRow.vue` Vue components
- **Task 12:** `ExportTab.vue` wiring picker + `/wp/api/export/build` + file download

### Phase 5 — Import side
- **Task 13:** Python importer (`engine/importer.py`) — atomic commit transaction + undo metadata
- **Task 14:** Import + Undo endpoints in `wp_api/import_export.py`
- **Task 15:** TS `commit.ts` — build commit payload + POST + integrate with manager undo stack
- **Task 16:** `ImportTab.vue` — file pick + clipboard paste entry
- **Task 17:** `ImportPicker.vue` — smart-default selection + inline dep indicators
- **Task 18:** `ConflictModal.vue` — batch dropdowns + per-item expandable list
- **Task 19:** `conflict-rows/Tier3ChainViz.vue` — tier-3 chain visualization
- **Task 20:** `ImportAsNewRename.vue` — inline rename for Import-as-new flow

### Phase 6 — Post-commit + docs
- **Task 21:** Broken-ref discovery + `RichTextInput` warning surfacing (`broken-refs.ts`)
- **Task 22:** `docs/import-export-contract.md` — shared TS+Python contract doc

**IMPORTANT:** Task 10+ plan body in `docs/superpowers/plans/2026-05-22-importer-exporter.md` was written with the original 4-bucket assumption (bundles/wildcards/variables/constraints). The actual schema is 7-bucket (bundles/wildcards/fixed_values/combines/derivations/constraints/categories) — `RawPayload` and all helper code reflect this corrected shape. **Each Task 10+ implementer dispatch must override the plan body's 4-bucket shape with the 7-bucket reality.** The exporter (Task 9) already follows this pattern.

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

## Outstanding concerns (deferred to fix when relevant task lands)

- **Task 5 mutation hazard:** Python `migrate_payload` doesn't deep-copy normalized arrays. Future v1→v2 migrations that mutate list items in-place would corrupt caller's payload. Current v0→v1 uses dict-spread and is safe. Fix when adding any new migration that touches list items.
- **Task 6 non-string uuid fallback:** `verifyOne` falls back to `""` for `IntegrityWarning.uuid` when entity has non-string uuid. TODO marker at the call site; address when Task 17 picker needs entity-routing for warnings.
- **Task 8 LibraryRow shape narrow:** only exposes `snapshot_fingerprint`. Task 17 picker will need full entity content for diff display — caller responsibility to wrap/extend `LibraryRow`.

## How to resume

In a fresh session:

1. Open this checkpoint doc + the plan doc (`docs/superpowers/plans/2026-05-22-importer-exporter.md`).
2. Confirm git branch is `feat/importer-exporter-v2`, tip at `571b13f`.
3. Use `superpowers:subagent-driven-development` skill.
4. Start at Task 10 (export endpoint). Plan body for Tasks 10-22 still uses the 4-bucket shape — **always override with the 7-bucket reality** when dispatching implementers (see Task 9 dispatch prompt for the canonical example).
5. For each task: implementer (haiku/sonnet by complexity) → spec compliance review (haiku) → code-quality review (sonnet, via `superpowers:code-reviewer`). Apply two-stage review pattern established in Tasks 1-9.

## Test suite status at checkpoint

- Vitest: 1896 passed, 3 skipped (all pre-existing skips)
- Pytest: 476 passed
- Typecheck (`pnpm typecheck` via vue-tsc): clean
- Pre-commit hooks (lint + typecheck + test + build + size + pytest): green on every commit landed on this branch
- Bundle size: within budget (entry ≤ 30 KB, total ≤ 316 KB)

## Commits since fork from main (count: 14 + 1 refactor + 1 checkpoint pending)

```
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
