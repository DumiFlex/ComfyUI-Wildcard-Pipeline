# Cascade-Edit Cross-Language Contract

The wire format, orchestration semantics, and reverse-dep index data structure shared by the TypeScript SPA (`src/manager/cascade/*`) and the Python engine (`engine/cascade/*`). Both sides must agree on every shape described here, from request/response envelopes to diff entries to undo metadata.

**Rule:** any change to the request schema, response envelope, diff entry shape, fixer behavior, reverse-dep index structure, API endpoint, or undo-row layout REQUIRES matching changes on both sides in the same PR. Test coverage on both sides (Python: `tests/engine/cascade/`, TypeScript: `src/manager/cascade/__tests__/`) must verify cross-side contract compliance.

---

## 1. Request schema

`POST /wp/api/cascade/apply` accepts a JSON request body with the following shape:

```json
{
  "kind":          "<entity-kind>",
  "id":            "<entity-id>",
  "action":        "<mutation-action>",
  "cascade_refs":  true,
  "dry_run":       false,
  "new_name":      "<string>",
  "extra":         {}
}
```

### Field descriptions

| Field        | Type     | Required | Default   | Purpose                                                                                                                                                       |
|--------------|----------|----------|-----------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `kind`       | string   | yes      | —         | Entity type: `wildcard`, `fixed_values`, `combine`, `derivation`, `constraint`, `bundle`, `category`, `subcategory`, `combine_output_var`. Case-sensitive.     |
| `id`         | string   | yes      | —         | Entity UUID (8-hex for modules/bundles, slug for categories). For subcategory, the source wildcard id. For combine_output_var, the combine module id.          |
| `action`     | string   | yes      | —         | Mutation type: `delete`, `rename`. Defined per (kind, action) pair supported by fixers; unsupported pairs return error.                                       |
| `cascade_refs` | bool  | no       | `True`    | When `false` + action is `rename`: target is renamed only (no refs updated); returns `broken_refs[]` instead of `diff[]`. Opt-out rename.                    |
| `dry_run`    | bool     | no       | `False`   | When `true`: scan affected entities but don't commit mutations. Response omits `diff` + `undo_entry_id`.                                                     |
| `new_name`   | string   | no*      | —         | Required for all `rename` actions. The new name or identifier to assign the target.                                                                          |
| `extra`      | dict     | no       | `{}`      | Additional parameters per (kind, action). E.g., `subcategory` delete/rename: `{"subcat_name": "<name>"}`. `combine_output_var` rename: `{"old_name": "<old>"}`. |

### Validation

- `kind`, `id`, `action` are mandatory; absence returns 400 `{error: "kind required"}` etc.
- Unsupported (kind, action) pairs return 400 `{error: "unsupported (kind, action) pair: (X, Y)"}`.
- `rename` actions without `new_name` return 400 `{error: "new_name required for rename"}`.
- Malformed JSON or non-dict body returns 400 `{error: "body must be a JSON object"}`.

**Request handler:** `wp_api/cascade.py:cascade_apply` (line 15).
**Orchestrator:** `engine/cascade/orchestrator.py:apply_cascade` (line 67).

---

## 2. Response schemas

Responses always carry an `ok` boolean. On success (`ok: true`), the envelope varies by mode and outcome.

### 2.1 Dry-run response

When `dry_run: true`, the response is a scan-only result (no mutations, no undo entry):

```json
{
  "ok": true,
  "affected_count": 0,
  "affected_entities": [
    {
      "kind": "wildcard",
      "id": "<8-hex>",
      "name": "<string>",
      "ref_path": "<string>"
    }
  ]
}
```

- `affected_count`: integer, number of direct diff entries the fixer would produce.
- `affected_entities`: array of `AffectedEntity` objects — entities that reference the target. Each entry describes one entity and the location where the reference exists (via `ref_path`). Scan is read-only and safe to run outside a transaction.

**AffectedEntity shape:**

```typescript
interface AffectedEntity {
  kind: string;           // "wildcard" | "fixed_values" | "combine" | "derivation" | "constraint" | "bundle"
  id: string;             // 8-hex UUID or slug
  name: string;           // display name
  ref_path: string;       // e.g. "options[0].value", "matrix.warm", "children[2]", "payload.template"
}
```

**Note on terminology:** `AffectedEntity` is the wire shape returned by the server's scan. This is distinct from `IncomingRef` (see §7), which is used internally by the client's reverse-dep index builder to track references. Both carry the same semantic information but serve different purposes: `AffectedEntity` is for the confirm dialog, while `IncomingRef` is for the client-side index.

### 2.2 Cascade-on response

When `cascade_refs: true` and `action: "delete"` or `action: "rename"`, mutations are committed atomically:

```json
{
  "ok": true,
  "undo_entry_id": "<16-hex>",
  "affected_count": 3,
  "affected_entities": [
    {
      "kind": "wildcard",
      "id": "<8-hex>",
      "name": "<string>",
      "ref_path": "options[0].value"
    }
  ],
  "diff": [
    {
      "entity_id": "<8-hex>",
      "removed": true
    },
    {
      "entity_id": "<8-hex>",
      "remove_ref": {
        "kind": "wildcard",
        "id": "<8-hex>"
      }
    },
    {
      "entity_id": "<8-hex>",
      "rename_ref": {
        "kind": "var",
        "old": "old_name",
        "new": "new_name"
      }
    }
  ]
}
```

- `undo_entry_id`: 16-hex string, the primary key for the row written to `cascade_undo` table. Clients store this for later undo.
- `affected_count`: number of diff entries (mutations applied by the fixer). `0` for subcategory/combine_output_var renames that produce no removals (only rewrite refs).
- `affected_entities`: same as dry-run — array of `AffectedEntity` objects (informational; not used by the UI, but available for telemetry).
- `diff`: array of `DiffEntry` objects describing mutations. Passed to the client's `useCascadeStore().applyDiff(diff)` for incremental index patching.

**Diff entry shapes** (see §7 for full TypeScript type):

- `{ "entity_id": "<id>", "removed": true }` — entity was deleted.
- `{ "entity_id": "<id>", "remove_ref": {...} }` — entity had a reference removed (wildcard, subcat, category, etc.).
- `{ "entity_id": "<id>", "rename_ref": {...} }` — entity had a reference renamed (var, subcat, etc.).

### 2.3 Opt-out rename response

When `cascade_refs: false` and `action: "rename"`, only the target is mutated; refs are NOT updated, so `broken_refs[]` lists unresolved references:

```json
{
  "ok": true,
  "undo_entry_id": "<16-hex>",
  "affected_count": 0,
  "broken_refs": [
    {
      "kind": "wildcard",
      "id": "<8-hex>",
      "name": "<string>",
      "ref_path": "$old_name"
    }
  ]
}
```

- `affected_count`: always `0` (target rename only, no cascaded updates).
- `broken_refs`: array of `AffectedEntity` objects where each entity still holds a reference to the old name/identifier. Client code (see §11) pushes these into `useResolveWarnings` store with `type: "cascade_broken_ref"` to surface warnings in the UI.

### 2.4 Error response

Any failure returns 400 or 404:

```json
{
  "ok": false,
  "error": "<message>"
}
```

- **400 Bad Request:** validation errors (missing `kind`/`id`/`action`), unsupported (kind, action) pair, invalid `new_name`, database integrity violations, entity not found (except undo).
- **404 Not Found:** specific to `POST /wp/api/cascade/undo` when `undo_entry_id` is not present in the database. Engine error message contains "not found" substring; `wp_api/cascade.py:79` maps to 404.

**Response handlers:** `wp_api/cascade.py:cascade_apply` (line 15) + `cascade_undo` (line 49).

---

## 3. Undo endpoint

`POST /wp/api/cascade/undo` reverses a previous cascade-apply.

### Request

```json
{
  "undo_entry_id": "<16-hex>"
}
```

### Response

**On success (200):**
```json
{
  "ok": true
}
```

**On missing entry (404):**
```json
{
  "error": "undo entry not found: <16-hex>"
}
```

**On other failure (400):**
```json
{
  "error": "<message>"
}
```

### Behavior

1. Query `cascade_undo` table by `undo_entry_id`.
2. If found, restore all entities in `snapshot_before` via repository methods (insert/update as appropriate).
3. Delete the undo entry row.
4. All steps wrapped in a single `with conn:` transaction; any step failure rolls back the entire undo.

**Undo orchestrator:** `engine/cascade/undo.py:undo_cascade` (line 63).
**Dispatcher:** `wp_api/cascade.py:cascade_undo` (line 49).

---

## 3.1 Known v1 limitation: post-undo stale state

When the user triggers undo via a toast Undo button, `useCascadeApply.undo()` (and `registerCascadeUndo().undo()`) call `api.cascade_undo()` server-side and then mark the cascade store stale via `useCascadeStore().invalidate()`. The store does NOT automatically re-fetch library data — the in-memory module / bundle / category arrays and the reverse-dep index remain stale until the user navigates away from the current view and back, at which point `AppLayout.vue`'s `onMounted` rebuild fires again.

**Practical impact:** badge counts shown on entity headers + sub-category pills may display pre-undo values for the rest of the session view. Editor field state is also not refreshed — the user may need to manually reload the current entity.

**v2 improvement:** should add an undo-success hook that re-runs the `AppLayout` fetch + rebuild sequence so the UI reflects post-undo state without manual navigation.

---

## 4. Supported (kind, action) pairs (v1)

| kind                  | action   | fixer                              | notes                                                                                              |
|-----------------------|----------|------------------------------------|----------------------------------------------------------------------------------------------------|
| `wildcard`            | `delete` | `fix_wildcard_delete`              | Strips refs from constraints + bundles; deletes target wildcard row.                              |
| `subcategory`         | `delete` | `fix_subcat_delete`                | Strips subcat from source wildcard options + all constraint matrices + cross-wildcard refs.       |
| `subcategory`         | `rename` | `fix_subcat_rename`                | Rewrites subcat name in source wildcard + constraint matrices + cross-wildcard refs.              |
| `combine_output_var`  | `rename` | `fix_combine_output_var_rename`    | Renames combine's `output_var` + all `$old` refs in wildcards, derivations, other combines.       |
| `category`            | `delete` | `fix_category_delete`              | Nulls out `category_id` on all modules referencing the category; deletes target category row.     |
| `option`              | `delete` | `fix_option_delete`                | Removes option from source wildcard `payload.options[]`; drops every constraint exception that references the option by `source_id` / `target_id`. Requires `extra: {wildcard_id}`. |
| Any other             | Any      | —                                  | Returns `{ok: False, error: "unsupported (kind, action) pair: (X, Y)"}`.                          |

**Fixer implementations:** `engine/cascade/fixers.py` (lines 91–387).
**Dispatcher:** `engine/cascade/orchestrator.py:apply_cascade` (lines 165–187).

---

## 5. Per-fixer behavior

### `fix_wildcard_delete(conn, wildcard_id) -> (touched, diff)`

**Mutations:**
- Deletes all constraints where `payload.source_wildcard_id == wildcard_id` OR `payload.target_wildcard_id == wildcard_id`.
- Removes wildcard entry from bundle `children[]` lists.
- Does NOT delete the wildcard row itself (orchestrator handles it).

**Diff entries produced:**
- `{entity_id: constraint_id, removed: True}` for each deleted constraint.
- `{entity_id: bundle_id, remove_ref: {kind: "wildcard", id: wildcard_id}}` for each bundle with the wildcard removed.

---

### `fix_subcat_delete(conn, wildcard_id, subcat_name) -> (touched, diff)`

**Mutations:**
- Removes `subcat_name` from source wildcard's `options[].sub_categories` arrays.
- Deletes `subcat_name` top-level key from constraint matrix (source-side).
- Deletes `subcat_name` nested keys from constraint matrix values (target-side).
- Removes all `@{wildcard_id:subcat_name}` text refs from other wildcards' option values.

**Diff entries produced:**
- `{entity_id: module_id, remove_ref: {kind: "subcat", wildcard_id: wildcard_id, subcat: subcat_name}}` for each entity mutated.

---

### `fix_subcat_rename(conn, wildcard_id, old_name, new_name) -> (touched, diff)`

**Mutations:**
- Renames `old_name` → `new_name` in source wildcard's `options[].sub_categories`.
- Renames top-level matrix key (source-side constraint).
- Renames nested matrix keys (target-side constraint).
- Rewrites all `@{wildcard_id:old_name}` → `@{wildcard_id:new_name}` in other wildcards' option values.

**Diff entries produced:**
- `{entity_id: module_id, rename_ref: {kind: "subcat", wildcard_id: wildcard_id, old: old_name, new: new_name}}` for each entity mutated.

---

### `fix_combine_output_var_rename(conn, combine_id, old_name, new_name) -> (touched, diff)`

**Mutations:**
- Updates source combine's `payload.output_var` to `new_name`.
- Rewrites source combine's template: `$old_name` → `$new_name` (word-boundary safe).
- Rewrites all `$old_name` → `$new_name` in other wildcards' option values.
- Rewrites all `$old_name` → `$new_name` in other combines' templates.
- Rewrites all `$old_name` → `$new_name` in derivation action strings and `set_var` field names.

**Diff entries produced:**
- `{entity_id: module_id, rename_ref: {kind: "var", old: old_name, new: new_name}}` for each entity mutated.

---

### `fix_category_delete(conn, category_id) -> (touched, diff)`

**Mutations:**
- Nulls out `category_id` on every module (any type) that has `category_id == category_id`.
- Does NOT delete the category row itself (orchestrator handles it).

**Diff entries produced:**
- `{entity_id: module_id, remove_ref: {kind: "category", id: category_id}}` for each module mutated.

---

## 6. DiffEntry shape

TypeScript type definition used by the client to patch the reverse-dep index:

```typescript
export interface DiffEntry {
  entity_id: string;
  removed?: boolean;
  remove_ref?: {
    kind: string;
    id?: string;
    wildcard_id?: string;
    name?: string;
    subcat?: string;
  };
  rename_ref?: {
    kind: string;
    old: string;
    new: string;
  };
}
```

- **`entity_id`**: The entity that was mutated (deleted, ref removed, or ref renamed).
- **`removed`**: If `true`, the entity itself was deleted from the database (not just a reference within it).
- **`remove_ref`**: Object describing a reference that was removed. Fields vary by kind:
  - `kind: "wildcard"`: `{id: wildcard_id}` — wildcard was removed from a bundle or constraint.
  - `kind: "subcat"`: `{wildcard_id: id, subcat: name}` — subcat ref was stripped from constraint/option.
  - `kind: "category"`: `{id: category_id}` — category was unlinked from a module.
- **`rename_ref`**: Object describing a reference that was renamed. Always has `{kind, old, new}`:
  - `kind: "var"`: `{old: old_name, new: new_name}` — variable binding renamed.
  - `kind: "subcat"`: `{wildcard_id: id, old: old_name, new: new_name}` — subcat renamed.

**TypeScript definition:** `src/manager/cascade/reverse-dep-index.ts:27–32`.
**Client patch applier:** `src/manager/cascade/reverse-dep-index.ts:applyDiff` (applies diffs incrementally to the in-memory index).

---

## 7. Reverse-dep index data structure

The `ReverseDepIndex` is an in-memory six-map structure that tracks all incoming references to every entity in the library. Built once at app startup or sidebar load, then patched incrementally after each cascade-apply via `applyDiff`.

### ReverseDepIndex interface

```typescript
export interface ReverseDepIndex {
  toEntity:         Map<string, IncomingRef[]>;     // entity id → refs
  toSubcat:         Map<string, IncomingRef[]>;     // "wildcard_id:subcat" → refs
  toOptionValue:    Map<string, IncomingRef[]>;     // wildcard option value string → refs
  toFixedValueName: Map<string, IncomingRef[]>;     // fixed_value name (identifier) → refs
  toCombineVar:     Map<string, IncomingRef[]>;     // combine output_var name → refs
  toCategory:       Map<string, IncomingRef[]>;     // category id → refs
}
```

### Map keys and values

| Map                | Key format                     | Value                           | Purpose                                                                         |
|--------------------|--------------------------------|---------------------------------|---------------------------------------------------------------------------------|
| `toEntity`         | `entity_id` (8-hex or slug)    | `IncomingRef[]`                 | All entities (modules, bundles, categories) that reference this entity.         |
| `toSubcat`         | `"wildcard_id:subcat_name"`    | `IncomingRef[]`                 | Wildcards and constraints that reference this subcat.                          |
| `toOptionValue`    | Wildcard option `value` string | `IncomingRef[]`                 | (Informational; not used in v1 UI).                                            |
| `toFixedValueName` | Fixed-value name identifier    | `IncomingRef[]`                 | Derivations that target this fixed-value by name (via `set_var` field).        |
| `toCombineVar`     | Combine module `output_var`    | `IncomingRef[]`                 | Wildcards, derivations, combines that read `$var_name`.                        |
| `toCategory`       | Category slug                  | `IncomingRef[]`                 | Modules that carry this `category_id`.                                         |

### IncomingRef type

```typescript
export interface IncomingRef {
  from_kind: "wildcard" | "fixed_values" | "combine" | "derivation" | "constraint" | "bundle";
  from_id: string;
  from_name: string;
  ref_path: string;  // human-readable breadcrumb, e.g. "$var_name" or "@{uuid:subcat}"
}
```

### Construction

Called once at app startup (after all three catalog fetches resolve) via `useCascadeStore().rebuild(libraryFixture)`:

```typescript
export function buildIndex(lib: LibraryFixture): ReverseDepIndex
```

**Builder:** `src/manager/cascade/reverse-dep-index.ts:82–200+`.

### Incremental patching

After each successful cascade-apply, the server diff is applied via `useCascadeStore().applyDiff(diff)`, which calls:

```typescript
export function applyDiff(idx: ReverseDepIndex, diff: DiffEntry[]): void
```

The function updates all six maps to reflect the mutations described in the diff entries, keeping the index synchronized with the server state.

**Patcher:** `src/manager/cascade/reverse-dep-index.ts:applyDiff`.

---

## 8. Atomicity contract

The orchestrator wraps fixer dispatch + target-delete + undo-write in a single `with conn:` transaction. This ensures:

1. **All-or-nothing mutation:** If any step (fixer, target-delete, undo-write) raises an exception, the entire transaction rolls back and the database is unchanged.
2. **Undo entry durability:** The undo entry is persisted atomically with mutations, so clients can always reverse a successful apply.
3. **No partial state:** A network disconnection or process crash after the response is sent does NOT leave the database in an inconsistent state.

**Critical:** Fixers and `write_undo_entry()` MUST NOT call `conn.commit()` themselves. The orchestrator's outer `with conn:` block is the sole rollback boundary.

**Orchestrator transaction:** `engine/cascade/orchestrator.py:apply_cascade` (line 162, `with conn:`).
**Fixers:** `engine/cascade/fixers.py` (zero `conn.commit()` calls).
**Undo write:** `engine/cascade/undo.py:write_undo_entry` (line 30, zero `conn.commit()` calls).

---

## 9. Broken-ref surfacing (opt-out rename)

When a client calls cascade-apply with `cascade_refs: false` and `action: "rename"`, the target is renamed but refs are left stale. The response includes `broken_refs[]` (array of `IncomingRef` objects).

### Client integration

The TypeScript side imports the `ResolveWarning` shape from `src/manager/utils/resolveTokens.ts` and pushes each broken ref into the `useResolveWarnings` store:

```typescript
for (const brokenRef of applyResult.broken_refs || []) {
  useResolveWarnings().addWarning({
    type: "cascade_broken_ref",
    entity_id: brokenRef.from_id,
    from_kind: brokenRef.from_kind,
    from_name: brokenRef.from_name,
    ref_path: brokenRef.ref_path,
    target_kind: "combine_output_var",  // or subcategory, etc.
    target_id: targetId,
    target_old_name: oldName,
    target_new_name: newName,
  });
}
```

The UI then displays warning chips/badges on affected entities, prompting the user to resolve the broken refs manually or re-apply the cascade with `cascade_refs: true`.

**Client code:** `src/manager/cascade/useCascadeApply.ts` (integration with `useResolveWarnings()`).
**ResolveWarning type:** `src/manager/utils/resolveTokens.ts:16`.

---

## 10. Cascade store bootstrap

The cascade store is lazy-initialized on first use. Typical app lifecycle:

1. **Component mounted** (e.g., `AppLayout.vue:onMounted`): The app fetches the three main catalogs (wildcards, combines, derivations, etc.).
2. **After all three fetches resolve:** Call `useCascadeStore().rebuild(libraryFixture)` with the aggregated library snapshot. This populates the in-memory index.
3. **After each cascade-apply:** Call `useCascadeStore().applyDiff(diff)` with the server-returned diff to keep the index fresh.
4. **After any non-cascade mutation** (legacy CRUD endpoints, save-to-library, etc.): Call `useCascadeStore().invalidate()` to mark the index stale. On next read, it will trigger a lazy rebuild.

**Store:** `src/manager/cascade/cascade-store.ts`.
**Bootstrap site:** `src/manager/AppLayout.vue` (onMounted hook, after catalog fetches).

---

## 11. Out-of-scope (v1)

The following items are intentionally deferred:

1. **Per-ref tiered choice UI** — user picks which incoming refs to cascade vs. leave broken, per-ref.
2. **Cross-module ref mutations** — e.g., cascading a subcategory rename through imports/exports.
3. **"Where is this used?" view** — detailed impact preview before applying a cascade.
4. **Replacement picker UI** — after opt-out rename, GUI to bulk-select & update broken refs.
5. **Backfill scan for existing broken refs** — detect stale refs from past opt-out renames or manual deletions.
6. **Server-side cascade for bundle-internal mutations** — e.g., rename a subcategory inside a bundle snapshot and auto-cascade refs within that snapshot's children.

These are tracked for future phases and will require design review before implementation.

---

## 12. Implementation locations index

| Concept                  | TypeScript                                      | Python                                    |
|--------------------------|--------------------------------------------------|--------------------------------------------|
| Request/response shapes  | `src/manager/api/client.ts`                    | `wp_api/cascade.py`                        |
| Orchestrator             | (consumes API)                                   | `engine/cascade/orchestrator.py`           |
| Fixers                   | (consumes diff output)                           | `engine/cascade/fixers.py`                 |
| Scan (read-only)         | (consumes affected_entities)                     | `engine/cascade/scan.py`                   |
| Undo logic               | (consumes undo API)                              | `engine/cascade/undo.py`                   |
| Reverse-dep index        | `src/manager/cascade/reverse-dep-index.ts`      | (not mirrored — client-only)               |
| Index patching           | `src/manager/cascade/reverse-dep-index.ts`      | (index is server-transparent)              |
| Cascade store (Pinia)    | `src/manager/cascade/cascade-store.ts`          | —                                          |
| Store bootstrap          | `src/manager/AppLayout.vue` (onMounted)         | —                                          |
| Undo metadata schema     | (persists via API response)                      | `engine/db/migrations_sql/009_cascade_undo.sql` |
| DB undo table            | —                                                | `cascade_undo` (SQLite)                    |

---

## 13. Convention enforcement

Drift-prone invariants to watch during review:

1. **Request/response field names match cross-language.** `kind`, `id`, `action`, `cascade_refs`, `dry_run`, `new_name`, `extra` on the wire; snake_case optional in Python internals, but wire must be identical.

2. **Diff entries are lightweight.** Each entry carries only `entity_id` + one of `{removed, remove_ref, rename_ref}`. Avoid including full entity snapshots in diff — the server persists snapshots in undo metadata, not in the diff.

3. **Fixers produce touched + diff tuples.** Touched is BEFORE-state snapshots for undo; diff is lightweight patch entries. Both returned as tuples, never merged.

4. **Atomicity boundary is `with conn:` in orchestrator.** No nested transactions, no manual commits inside fixers, no `conn.commit()` in `write_undo_entry`.

5. **Undo snapshots are complete entity rows.** The `snapshot_before` JSON array in `cascade_undo` must contain entire entity dicts (with all fields: id, type, name, payload, etc.) so restore can both update existing rows AND recreate deleted ones.

---

## 14. Stable per-option identity (added 2026-05-24)

### Schema additions

Wildcard payload now carries a stable 8-hex `id` field on every option:

```json
{
  "options": [
    {"id": "a1b2c3d4", "value": "buzz", "weight": 1, "sub_category": "short", "probability": 1.0}
  ]
}
```

* `ModuleRepository.create` and `update` backfill missing ids automatically (`engine/db/repositories.py:_backfill_option_ids`).
* Migration `010_option_ids.py` backfilled every existing wildcard row at upgrade time.
* `WildcardHandler.validate_payload` rejects payloads with missing or non-string `id` (`engine/modules/wildcard_handler.py`).

Constraint exceptions carry both legacy value strings AND stable ids:

```json
{
  "exceptions": [
    {
      "source": "buzz",
      "target": "serene",
      "source_id": "a1b2c3d4",
      "target_id": "e5f6g7h8",
      "mode": "reduce",
      "factor": 0.5
    }
  ],
  "broken_exceptions": [
    {"source": "missing", "target": "serene", "reason": "source_value not found: 'missing'"}
  ]
}
```

* `source` / `target` value strings are retained — the runtime constraint resolver keys instance-disable / override lookups by encoded `(source_value, target_value)` pairs.
* `source_id` / `target_id` are the cascade-stable refs. Reverse-dep index walks exception `source_id` / `target_id` into `toOptionId`.
* `broken_exceptions[]` collects exceptions that migration 010 could not resolve (value not found, wildcard missing, ambiguous match). Surfaced as warn-tone chips in the constraint editor; user resolves manually.

### Display: `@{uuid}` chip resolution

Constraint exception dropdown labels resolve `@{uuid}` tokens in option-value strings to the referenced wildcard's name via the shared chip resolver (`src/manager/cascade/resolveChip.ts`):

* `resolveWildcardChip(uuid, lib)` → `{name, missing: false}` or `{raw, missing: true}`.
* `resolveOptionChip(wildcard_id, option_id, lib)` → same union.
* `tokenizeRefString(s)` → `Array<{type: "text" | "ref", ...}>`.

Missing refs render as warn-tone chips with `?` glyph + raw uuid; broken-ref-tolerant rendering means cascade fixers never need to strip dangling refs.

### Reverse-dep index addition

`ReverseDepIndex.toOptionId: Map<string, IncomingRef[]>` tracks constraint exception refs by stable option id. Used by `WildcardEditor.removeOption` to gate the cascade dialog: refs > 0 opens the modal; otherwise silent splice.

6. **Index maps are keyed consistently.** `toEntity` uses entity id; `toSubcat` uses `"wildcard_id:subcat_name"` (colon-delimited); `toCombineVar` uses the variable name string. No variation across builds.

7. **Broken refs are `IncomingRef` objects, not dicts.** The opt-out rename response carries `broken_refs: IncomingRef[]`; client code destructures `from_kind`, `from_id`, `from_name`, `ref_path` without transformation.

8. **(kind, action) pair routing is exhaustive.** If a new pair is added, both orchestrator (Python) and any TS-side validation must be updated in the same PR. Unsupported pairs must error with consistent message format.
