# Cascade-edit Indicators — COMPLETE + Dependency Coverage Expansion

**Branch:** `feat/cascade-edit-indicators` (off `main`)
**Tip commit:** `9b5620e`
**Date completed:** 2026-05-24
**Specs:**
- v1: `docs/superpowers/specs/2026-05-24-cascade-edit-indicators-design.md` (gitignored)
- v2 expansion: `docs/superpowers/specs/2026-05-24-cascade-dependency-coverage-design.md` (gitignored)
**Plans:**
- v1: `docs/superpowers/plans/2026-05-24-cascade-edit-indicators.md` (gitignored)
- v2 expansion: `docs/superpowers/plans/2026-05-24-cascade-dependency-coverage.md` (gitignored)
**Contract doc:** `docs/help/cascade-edit-contract.md` (committed)

## Status

- v1 (cascade-edit indicators): 16/16 plan tasks complete + final review fixes
- v2 (dependency coverage): 22/22 plan tasks complete + 2 post-QA UX fixes

## v2 expansion task table

| # | Task | Status | Commit |
|---|------|--------|--------|
| 1 | Wildcard handler requires `option.id` | ✅ | `71a381d` |
| 2 | ModuleRepository backfills option ids on create/update | ✅ | `1eb6d95` |
| 3 | Migration 010 — option ids + constraint exception schema | ✅ | `a7c96ac` |
| 4 | TypeScript ConstraintException gains `source_id` / `target_id` | ✅ | `dd73a87` |
| 5-8 | Subcat rename/delete schema bug fix (real-shape tests) | ✅ | `6e841c2` |
| 9 | Shared chip resolver (`resolveChip.ts`) | ✅ | `f46ee4a` |
| 10 | ConstraintEditor exception labels resolve `@{uuid}` to wildcard names | ✅ | `75ef4da` |
| 11-13 | `(option, delete)` scan + fixer + orchestrator + undo | ✅ | `92b6a15` |
| 14-15 | `toOptionId` reverse-dep index + cascade-store method | ✅ | `4d461df` |
| 16 | WildcardEditor option Remove routes through cascade | ✅ | `cfbbbe0` |
| 17 | Wildcards list-row delete routes through cascade | ✅ | `c279292` |
| 21 | Contract doc covers option-id + `(option, delete)` | ✅ | `f13608b` |
| — | Rename dialog emits `new_name`; editors sync local state | ✅ | `1a8fe86` |
| — | Re-anchor dirty baseline after cascade ops | ✅ | `e127624` |
| 18-20 | Dialogs adopt Modal.vue + Button; PillCountBadge uses `--wp-warn` token | ✅ | `9b5620e` |

## Live QA verification (chrome-devtools-mcp)

Subcategory rename on `mood` wildcard (id `c14e7527`):
- Server: `payload.sub_categories` updated `positive` → `positive_qa` ✓
- Server: every option's `sub_category` updated `positive` → `positive_qa` ✓
- Server: referring constraints (`hair_x_mood`, `mood_x_color_subcats`) matrix keys updated ✓
- UI: subcategory pill label updates ✓
- UI: option sub-category dropdown labels update ✓
- UI: no spurious "Unsaved" badge after cascade-driven mutations ✓
- UI: Modal.vue chrome (`.wp-modal__head`, `.wp-modal__body`, `.wp-modal__foot`) wraps both dialogs ✓
- UI: confirm dialog uses `.wp-btn--danger` for delete + `.wp-btn--primary` for rename ✓

## Schema additions

**Wildcard payload option:**

```json
{"id": "a1b2c3d4", "value": "buzz", "weight": 1, "sub_category": "short", "probability": 1.0}
```

**Constraint exception (additive — keeps legacy `source`/`target` for runtime resolver compat):**

```json
{"source": "buzz", "target": "serene", "source_id": "a1b2c3d4", "target_id": "e5f6g7h8", "mode": "reduce", "factor": 0.5}
```

**Constraint broken_exceptions[] (new):**

```json
{"source": "missing", "target": "serene", "reason": "source_value not found: 'missing'"}
```

## Locked design decisions

1. **Cascade scope:** five v1 pairs + new `(option, delete)` v2 pair.
2. **Stable identity:** per-option 8-hex `id` is backend-only — UI continues picking by value.
3. **Schema additivity:** legacy `source`/`target` value strings preserved alongside new `source_id`/`target_id` because the runtime constraint resolver keys instance-disable lookups by `(source_value, target_value)`. Dropping legacy keys would break Tier-2 overrides.
4. **Migration 010 orphan handling:** unmatched exceptions → `broken_exceptions[]` with `reason` field. Surfaced to user as warn chips; user resolves manually.
5. **Chip resolver tolerance:** missing refs render as warn chips (with `?` glyph or muted styling) rather than getting stripped by fixers. UI does the heavy lifting; server data stays referentially loose.
6. **Local-state sync contract:** every server-side cascade mutation paired with a local mirror handler + dirty-baseline re-anchor. Editor's "Unsaved" detection never lights up for cascade-driven changes.
7. **Dialog chrome:** dialogs wrap shared `Modal.vue`; buttons via shared `Button.vue`; pill badge tone via `--wp-warn` to match `.wp-chip--warn` elsewhere.

## Commits since fork from main (cascade v2 expansion)

```
9b5620e refactor(cascade): dialogs adopt Modal.vue + Button; PillCountBadge uses --wp-warn token
e127624 fix(wildcards): re-anchor dirty baseline after cascade rename/delete operations
1a8fe86 fix(cascade): rename dialog emits new_name; editors sync local state post-rename
f13608b docs(cascade): contract doc covers option-id + (option, delete) cascade
c279292 feat(wildcards): list-row delete routes through cascade for referenced rows
cfbbbe0 feat(wildcards): option Remove routes through cascade flow
4d461df feat(cascade): reverse-dep index + cascade store track option_id refs
75ef4da feat(constraints): exception value labels resolve @{uuid} to wildcard names
92b6a15 feat(cascade): (option, delete) scan + fixer + orchestrator dispatch + undo
f46ee4a feat(cascade): shared chip resolver for @{uuid} + option_id refs
6e841c2 fix(cascade): subcat rename/delete use real schema (singular sub_category + top-level list)
dd73a87 feat(constraints): add source_id/target_id to ConstraintException type
a7c96ac feat(migrations): 010 backfill option ids and migrate exception schema
1eb6d95 feat(repo): backfill 8-hex ids for wildcard options on create/update
71a381d feat(wildcards): require option.id (8-hex) in payload validation
```

15 commits on top of v1 tip `f6f5e4f`.

## Followups (not landed on this branch)

- Option-value rename auto-sync of constraint exception `source`/`target` strings (id-stable layer is in place; resolver still keys lookups by value). Defer until a user hits an option-value-edit divergence in practice.
- Bulk option delete UX (multi-select). Single-row delete is the v2 surface.
- Bundle rename / category rename cascades. Neither has a fixer yet.
- AllItems.vue and ModuleListView bulk-delete need cascade routing (currently bypass).

## Next step

Per `superpowers:finishing-a-development-branch`: present 4 options (merge to main locally / push + PR / keep as-is / discard).
