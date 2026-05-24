# Cascade-edit Indicators — COMPLETE

**Branch:** `feat/cascade-edit-indicators` (off `main`)
**Tip commit:** `f6f5e4f` (final review fixes)
**Date completed:** 2026-05-24
**Spec:** `docs/superpowers/specs/2026-05-24-cascade-edit-indicators-design.md` (gitignored)
**Plan:** `docs/superpowers/plans/2026-05-24-cascade-edit-indicators.md` (gitignored)
**Contract doc:** `docs/help/cascade-edit-contract.md` (committed)

## Status: 16 of 16 plan tasks complete ✅ + final review fixes applied ✅

| # | Task | Status | Key commits |
|---|------|--------|-------------|
| 1 | `cascade_undo` table migration | ✅ | `502f506` |
| 2 | `engine/cascade/scan.py` — reverse-ref scan | ✅ | `d85ec02` |
| 3 | `engine/cascade/fixers.py` — per-mutation cleanup | ✅ | `81e238d` → `9008826` |
| 4 | `engine/cascade/undo.py` — snapshot + restore | ✅ | `2ad1de3` → `8125dea` |
| 5 | `engine/cascade/orchestrator.py` — apply_cascade | ✅ | `43757fa` → `0600951` |
| 6 | `wp_api/cascade.py` HTTP routes | ✅ | `747362a` |
| 7 | `reverse-dep-index.ts` | ✅ | `5785911` |
| 8 | `cascade-store.ts` Pinia store | ✅ | `c2d7403` |
| 9 | `useCascadeApply.ts` + api methods | ✅ | `7dd387f` |
| 10 | `CascadeConfirmDialog.vue` | ✅ | `25086ad` |
| 11 | `PillCountBadge.vue` | ✅ | `ba2fa16` |
| 12 | WildcardEditor sub-category pill wire | ✅ | `c584f2f` |
| 13 + 14 | 6 editors entity-delete + CascadeRenameDialog | ✅ | `d09ae8f` (bundled) |
| 15 | Undo-stack helper + editor rename wires + bootstrap | ✅ | `ce5ca18` |
| 16 | Cross-language contract doc | ✅ | `d98346a` |
| — | Final review fixes (type alignment + post-undo doc) | ✅ | `f6f5e4f` |

## Final review summary

Cross-cutting review approved with 2 Important + 4 Minor issues. Important issues fixed in `f6f5e4f`:
- TS `affected_entities` type aligned with Python server shape `{kind, id, name, ref_path}`.
- Contract doc updated with Known v1 limitation: post-undo stale state requires user navigation to refresh.

Minor issues deferred to follow-up (non-blocking):
- Duplicate undo dispatch paths (`registerCascadeUndo` vs `useCascadeApply.undo`) — consolidate later.
- Dry-run fires with empty name on dialog open — benign roundtrip.
- `_dispatch_restore` heuristic could grow brittle if a module type adds `children` field.
- No end-to-end integration test covering apply→toast→undo cycle (per-layer coverage solid).

## Key design decisions (locked)

1. **Hybrid scan:** client-side reverse-dep index for inline badges (zero roundtrip), server-side dry-run for confirm-dialog accuracy.
2. **Auto-fix cascade:** server mutates affected entities atomically. No broken refs after confirmed delete.
3. **Single `POST /wp/api/cascade/apply`** endpoint with `dry_run` + `cascade_refs` flags.
4. **Rename toggle** (default checked = cascade). Unchecked → server returns `broken_refs[]` → client pushes into `useResolveWarnings`.
5. **5 (kind, action) pairs in v1:** wildcard-delete, subcategory-delete, subcategory-rename, combine_output_var-rename, category-delete.
6. **Atomic transaction:** orchestrator wraps fixer + target-delete + undo-write in `with conn:`. Inner helpers do NOT commit.
7. **`AffectedEntity` wire shape:** `{kind, id, name, ref_path}`. Distinct from client-side `IncomingRef` (used inside reverse-dep-index only).
8. **Cascade store bootstrap:** `AppLayout.vue` `onMounted` calls `rebuild(libraryFixture)` after the 3 catalog fetches resolve.

## Test suite status

- Cascade Python suite: 28/28 pass
- Cascade TS suite: 37/37 pass (7 test files)
- Full pytest: green
- Full Vitest: 186 test files / 2157 tests pass + 3 skipped (pre-existing)
- Typecheck: clean
- Pre-commit hooks: green on every landed commit

## Commits since fork from main

```
f6f5e4f fix(cascade): align affected_entities type with server shape + document post-undo stale-state limitation
d98346a docs: cascade-edit cross-language contract reference
ce5ca18 feat(cascade): undo handle + editor rename wires + bootstrap
d09ae8f feat(cascade): wire entity delete through cascade flow in all editors
c584f2f feat(cascade): wire subcategory pills to cascade flow in WildcardEditor
ba2fa16 feat(cascade): pill count badge component
25086ad feat(cascade): confirm dialog with dry-run-fetched impact list
7dd387f feat(cascade): apply/undo composable + api client methods
c2d7403 feat(cascade): pinia store wrapping reverse-dep index
5785911 feat(cascade): reverse-dep index with diff-patch helpers
747362a feat(wp_api): POST /wp/api/cascade/apply + /wp/api/cascade/undo endpoints
0600951 fix(cascade): restore transaction boundary + propagate not-found + handle combine var rename opt-out
43757fa feat(cascade): apply_cascade transactional orchestrator
8125dea fix(cascade): filter None kwargs from restore repo.update calls
2ad1de3 feat(cascade): undo persistence + atomic restore
9008826 refactor(cascade): doc atomicity contract + drop dead symbols + diff-shape assertions
81e238d feat(cascade): per-mutation cleanup fixers
d85ec02 feat(cascade): reverse-ref scan for wildcard/subcat/combine-var/category
502f506 feat(engine): cascade_undo table migration
2973623 docs: cascade-edit checkpoint at 5 of 16 tasks
```

20 commits (16 feature + 4 fix/refactor + 1 checkpoint).

## Next step

Per `superpowers:finishing-a-development-branch`: present 4 options (merge to main locally / push + PR / keep as-is / discard).
