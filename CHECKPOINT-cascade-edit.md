# Cascade-edit Indicators — Implementation Checkpoint

**Branch:** `feat/cascade-edit-indicators` (off `main`)
**Tip commit:** `0600951` (Task 5 fixes)
**Date checkpointed:** 2026-05-24
**Spec:** `docs/superpowers/specs/2026-05-24-cascade-edit-indicators-design.md` (gitignored)
**Plan:** `docs/superpowers/plans/2026-05-24-cascade-edit-indicators.md` (gitignored)

## Status: 5 of 16 plan tasks complete

Phase 2 (server-side) COMPLETE. Phases 1, 3, 4, 5, 6 remaining (UI + endpoint + contract doc).

| # | Task | Status | Key commits |
|---|------|--------|-------------|
| 1 | `cascade_undo` table migration | ✅ | `502f506` |
| 2 | `engine/cascade/scan.py` — reverse-ref scan | ✅ | `d85ec02` |
| 3 | `engine/cascade/fixers.py` — per-mutation cleanup | ✅ | `81e238d` → `9008826` (review fixes: dead symbols + atomicity doc + diff asserts) |
| 4 | `engine/cascade/undo.py` — snapshot + restore | ✅ | `2ad1de3` → `8125dea` (filter None kwargs) |
| 5 | `engine/cascade/orchestrator.py` — apply_cascade | ✅ | `43757fa` → `0600951` (review fixes: tx boundary + not-found propagation + combine-var opt-out) |

## Tasks remaining (6-16)

### Phase 2 closer
- **Task 6:** `wp_api/cascade.py` — `POST /wp/api/cascade/apply` + `POST /wp/api/cascade/undo` endpoints + `wp_api/__init__.py` register

### Phase 3 — Client reverse-dep index
- **Task 7:** `src/manager/cascade/reverse-dep-index.ts` — build + apply-diff + lookup helpers
- **Task 8:** `src/manager/cascade/cascade-store.ts` — Pinia store wrapping index

### Phase 4 — Composable + dialog + API + pill
- **Task 9:** `src/manager/api/client.ts` add `cascade_apply` + `cascade_undo` + `src/manager/cascade/useCascadeApply.ts`
- **Task 10:** `src/manager/cascade/CascadeConfirmDialog.vue`
- **Task 11:** `src/manager/cascade/PillCountBadge.vue`

### Phase 5 — Wire editors
- **Task 12:** Wire sub-category pills in `WildcardEditor.vue`
- **Task 13:** Wire entity-level deletes in CombineEditor + FixedEditor + DerivationEditor + ConstraintEditor + BundleEditor + Categories
- **Task 14:** `src/manager/cascade/CascadeRenameDialog.vue` + opt-out broken-ref surfacing into `useResolveWarnings`
- **Task 15:** `src/manager/cascade/undo-stack-integration.ts`

### Phase 6 — Contract doc
- **Task 16:** `docs/cascade-edit-contract.md`

## Key design decisions (locked from brainstorm + applied)

1. **Hybrid scan:** Client-side reverse-dep index for inline badges (zero roundtrip), server-side dry-run scan for confirm-dialog accuracy.
2. **Auto-fix cascade:** Server mutates all affected entities atomically. No broken refs left after a confirmed delete.
3. **Single `POST /wp/api/cascade/apply`** endpoint with `dry_run`, `cascade_refs`, `extra` flags. Body: `{kind, id, action, cascade_refs, new_name, dry_run, extra}`.
4. **Rename toggle** in dialog (default checked = cascade). Unchecked → server returns `broken_refs[]` for client to push into existing `useResolveWarnings` store.
5. **5 (kind, action) pairs in v1:** wildcard-delete, subcategory-delete, subcategory-rename, combine_output_var-rename, category-delete. Other leaf-element mutations stub-return empty.
6. **Atomic transaction:** orchestrator wraps fixer + target-delete + undo-write in `with conn:` SQLite transaction. `write_undo_entry` no longer calls `conn.commit()` (Task 5 fix); caller's transaction owns commit.
7. **NULL fingerprint = "no collision"** equivalent here: `_delete_target` raises `XNotFound` on missing — propagated as error envelope (no silent ok-with-no-deletion).
8. **Repository.create id= support:** Module + Bundle accept explicit `id=`. Category does NOT — fall back to raw INSERT in `_restore_category` to preserve slug-based id.

## Schema reality references

- `engine/db/repositories.py`: `ModuleRepository`, `BundleRepository`, `CategoryRepository`. Each has `get`, `delete`, `update`, `list`.
- `ModuleRepository.update` uses `_Unset` sentinel — pass via filtered-kwargs dict to avoid Pyright `Any | None` complaints.
- Exception classes: `ModuleNotFound`, `BundleNotFound`, `CategoryNotFound` — all importable from `engine.db.repositories`.
- `BundleRepository.create` accepts `id=`; `CategoryRepository.create` does not.
- Bundle child ref field is `child["id"]` (NOT `child["uuid"]`). Inner-bundle children have `type: "bundle"`.
- Test fixture: `wp_db` (root conftest).

## API contract (locked)

**`POST /wp/api/cascade/apply` request:**
```json
{
  "kind": "wildcard|subcategory|combine_output_var|category|...",
  "id": "<target id>",
  "action": "delete|rename",
  "cascade_refs": true,
  "new_name": "<for rename>",
  "dry_run": false,
  "extra": {"subcat_name": "warm", "old_name": "mood"}
}
```

**Response shapes:**
- Dry-run: `{ok: true, affected_count, affected_entities}`
- Commit (cascade-on): `{ok: true, undo_entry_id, affected_count, affected_entities, diff}`
- Opt-out rename: `{ok: true, undo_entry_id, affected_count: 0, broken_refs}`
- Error: `{ok: false, error: str}`

**`POST /wp/api/cascade/undo` request:** `{undo_entry_id: str}`. Response: `{ok: bool, error?: str}`.

## Outstanding concerns (deferred to relevant task)

- **Task 2 dead-code reservation:** `_REF_REGEX`, `_VAR_REGEX`, `_strip_var_in_string` were removed in Task 3 review pass. If future leaf-element fixers (option_value, fixed_value_entry, derivation_rule) land, they may need to be re-imported from `scan.py` or re-added.
- **Task 2 O(N²) scan:** Each fixer call re-runs `_list_all_modules()`. For typical DB sizes acceptable; v2 could pre-fetch + share via the orchestrator.
- **Task 3 test coverage gaps:** `_scan_wildcard_delete` derivation branch + broader diff-shape assertions exist for some fixers but not all. Cover when integration tests for orchestrator surface gaps.

## How to resume

In a fresh session:

1. Open this checkpoint + `docs/superpowers/plans/2026-05-24-cascade-edit-indicators.md`.
2. Confirm branch `feat/cascade-edit-indicators` at tip `0600951`.
3. Use `superpowers:subagent-driven-development` skill.
4. Start at **Task 6** (`wp_api/cascade.py` endpoints). Plan body still references the design as-written; locked decisions in this checkpoint override where the plan and reality diverge.
5. For each task: implementer (haiku/sonnet by complexity) → spec compliance review (haiku) → code-quality review (sonnet, via `superpowers:code-reviewer`). Apply two-stage review pattern.

## Test suite status at checkpoint

- Cascade suite (5 task modules): 28/28 pass.
- Full pytest run not re-validated at this exact tip — should be green (Task 5 fix only touched cascade files + tests).
- Vitest: no TS files touched yet in this branch.
- Pre-commit hooks: green on every landed commit.

## Commits since fork from main

```
0600951 fix(cascade): restore transaction boundary + propagate not-found + handle combine var rename opt-out
43757fa feat(cascade): apply_cascade transactional orchestrator
8125dea fix(cascade): filter None kwargs from restore repo.update calls
2ad1de3 feat(cascade): undo persistence + atomic restore
9008826 refactor(cascade): doc atomicity contract + drop dead symbols + diff-shape assertions
81e238d feat(cascade): per-mutation cleanup fixers
d85ec02 feat(cascade): reverse-ref scan for wildcard/subcat/combine-var/category
502f506 feat(engine): cascade_undo table migration
```

8 commits + this checkpoint pending.
