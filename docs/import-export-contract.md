# Import / Export Contract

The wire format and runtime invariants shared by the TypeScript SPA
(`src/manager/import-export/*`) and the Python engine
(`engine/exporter.py`, `engine/importer.py`, `engine/migrations/`,
`engine/_fingerprint.py`). Both sides must agree on every shape described
here, byte-for-byte.

**Rule:** any change to the payload shape, fingerprint algorithm,
migration chain, dep-graph extraction, collision classifier, API
endpoint, or undo-row layout REQUIRES matching changes on both sides in
the same PR. The cross-language reference value `ba7a57fa` (see §4) is
the canary; if a PR moves either side without the other, that test will
break.

---

## 1. Payload schema (v1)

The top-level wire shape is a JSON object with `schema_version`,
`exported_at`, and seven entity-bucket arrays:

```json
{
  "schema_version": 1,
  "exported_at": "<ISO 8601>",
  "bundles":      [ /* see §1.1 */ ],
  "wildcards":    [ /* see §1.2 */ ],
  "fixed_values": [ /* see §1.3 */ ],
  "combines":     [ /* see §1.4 */ ],
  "derivations":  [ /* see §1.5 */ ],
  "constraints":  [ /* see §1.6 */ ],
  "categories":   [ /* see §1.7 */ ]
}
```

`schema_version` is an integer (currently `1`). `exported_at` is an
ISO-8601 UTC timestamp produced by `engine._utils.now_iso`. Every bucket
is required; an empty bucket is a `[]`, never an omitted field. The
TypeScript guard at `src/manager/import-export/parse.ts:90-94` rejects a
payload missing any of the seven keys.

Authoritative emit site: `engine/exporter.py:142-152`
(`build_export_payload`). Authoritative parse site:
`src/manager/import-export/parse.ts:76`.

### Common module fields

The five module buckets (`wildcards`, `fixed_values`, `combines`,
`derivations`, `constraints`) share the same outer row shape produced by
`engine/db/repositories.py:_row_to_module`:

```json
{
  "id":                   "<8-hex>",
  "type":                 "wildcard | fixed_values | combine | derivation | constraint",
  "name":                 "<string>",
  "description":          "<string>",
  "category_id":          "<slug> | null",
  "tags":                 ["<string>", ...],
  "is_favorite":          false,
  "payload":              { /* type-discriminated, see below */ },
  "payload_hash":         "<sha256-hex>",
  "snapshot_fingerprint": "<8-hex> | null",
  "version":              1,
  "created_at":           "<ISO 8601>",
  "updated_at":           "<ISO 8601>"
}
```

`payload_hash` is the server-computed SHA-256 of canonical JSON of the
inner `payload` (see `engine/modules/snapshot.py:payload_hash`).
`snapshot_fingerprint` is the 8-hex content fingerprint defined in §4;
it may be `null` for pre-006-migration rows.

### 1.1 Bundles

```json
{
  "id":           "<8-hex>",
  "name":         "<string>",
  "description":  "<string>",
  "color":        "<string> | null",
  "category_id":  "<slug> | null",
  "tags":         ["<string>", ...],
  "is_favorite":  false,
  "children":     [ /* mixed: leaf snapshots + inner-bundle refs */ ],
  "payload_hash": "<sha256-hex>",
  "version":      1,
  "created_at":   "<ISO 8601>",
  "updated_at":   "<ISO 8601>"
}
```

Bundle row shape comes from `engine/db/repositories.py:_row_to_bundle`.

`children[]` is heterogeneous. Tier-1 leaves are deep-cloned module
snapshots (same shape as the corresponding module row). Tier-2
inner-bundle entries are **reference-only**:

```json
{ "id": "<8-hex>", "type": "bundle", "name": "<string>", "color": "<string> | null" }
```

The transitive walk at `engine/exporter.py:37-67`
(`_walk_inner_bundles`) follows `children[].id` for entries with
`type === "bundle"`, fetching each referenced bundle's full row and
including it in the export. The walk runs to a fixed point with a
visited set; cycles short-circuit.

Tier-3 bundles (a tier-2 bundle whose inner-bundle entry itself
contains an inner-bundle reference) are **hard-rejected** by the import
picker — non-overridable per the design spec lock. See
`src/manager/import-export/conflict-rows/Tier3ChainViz.vue` for the user
surface.

### 1.2 Wildcards (`type: "wildcard"`)

```json
"payload": {
  "options": [
    {
      "id":           "<string>",
      "value":        "<string with $var / @{8hex} / {a|b|c}>",
      "weight":       1,
      "sub_category": "<string> | null"
    },
    ...
  ],
  "var_binding":    "<identifier> | null",
  "sub_categories": ["<string>", ...]
}
```

Validated at `engine/modules/wildcard_handler.py:170-243`. Option ids
must be unique across the pool; `var_binding` must match
`^[a-zA-Z_][a-zA-Z0-9_]*$` and not start with `__`.

### 1.3 Fixed values (`type: "fixed_values"`)

```json
"payload": {
  "values": [
    { "id": "<string>", "name": "<identifier>", "value": "<string>" },
    ...
  ]
}
```

Validated at `engine/modules/fixed_values_handler.py:37-86`. Empty
`name` is allowed but skipped at runtime; non-empty names must be unique
across rows and obey the same identifier rules as `var_binding`.

### 1.4 Combines (`type: "combine"`)

```json
"payload": {
  "template":    "<string, 1..8000 chars>",
  "output_var":  "<identifier>",
  "input_vars":  ["<identifier>", ...]
}
```

Validated at `engine/modules/combine_handler.py:34-74`. `template` is
mandatory and non-empty; `output_var` is the binding produced for
downstream `$var` reads.

### 1.5 Derivations (`type: "derivation"`)

```json
"payload": {
  "rules": [
    {
      "id": "<string>",
      "branches": [
        {
          "condition": {
            "var":   "<identifier>",
            "op":    "equals | not_equals | contains | matches | exists | not_exists | is_set | is_unset",
            "value": "<string>"
          },
          "action": {
            "target_var": "<identifier>",
            "mode":       "replace | append | prepend",
            "value":      "<string>"
          }
        },
        ...
      ],
      "else": { "action": { ... } }
    },
    ...
  ]
}
```

Validated at `engine/modules/derivation_handler.py:158-180+`. Branches
evaluate top-to-bottom; the first matching branch fires (IF/ELIF
semantics), else the `else` action runs if present.

### 1.6 Constraints (`type: "constraint"`)

```json
"payload": {
  "source_wildcard_id": "<8-hex>",
  "target_wildcard_id": "<8-hex>",
  "matrix": {
    "<source_sub_cat>": {
      "<target_sub_cat>": { "mode": "allow | exclude | boost | reduce", "factor": 1.0 }
    },
    ...
  },
  "exceptions": [
    {
      "source": "<value>",
      "target": "<value>",
      "mode":   "allow | exclude | boost | reduce",
      "factor": 1.0
    },
    ...
  ]
}
```

Validated at `engine/modules/constraint_handler.py:122-180`. **The
source/target wildcard ids are nested under `payload`** — there is no
top-level `source_uuid` / `target_uuid` field. The dep-graph extractor
at `src/manager/import-export/dep-graph.ts:65-73` reads
`payload.source_wildcard_id` and `payload.target_wildcard_id` for
constraint edges; the broken-ref walker at
`src/manager/import-export/broken-refs.ts:53-58` declares the same
shape.

### 1.7 Categories

```json
{
  "id":         "<slug>",
  "name":       "<string>",
  "color":      "<string> | null",
  "icon":       "<string> | null",
  "sort_order": 0
}
```

Row shape from `engine/db/repositories.py:_row_to_category` (line 332).
Category ids are human-readable slugs (`subjects`, `style`, ...), not
8-hex. Categories carry no `snapshot_fingerprint` and no
`payload_hash` — merge is name-based on import (see §6).

---

## 2. Entity identifier convention

- Every entity carries its identity under the field name `id`. **Not
  `uuid`.**
- Module and bundle ids are 8 lowercase hex chars matching `[0-9a-f]{8}`
  (4 bytes from `secrets.token_hex(4)`; see
  `engine/db/repositories.py:79-89,478-484`). The 8-hex constraint is
  enforced on the `id=` keyword to `ModuleRepository.create` /
  `BundleRepository.create`.
- Category ids are URL-safe slugs derived from the name, NOT hex.
- Pre-migration-004 code used a separate `uuid` field; post-004 the id
  IS the uuid. The TS-side rename from `uuid` to `id` landed in Task 17.

### Wildcard reference syntax

Inside wildcard option `value` strings, downstream wildcards are
addressed by `@{8hex}` or `@{8hex:label}` (the optional `:label` suffix
is editor-display only and ignored by the resolver). The regex is twin
between the dep-graph at `src/manager/import-export/dep-graph.ts:21` and
the broken-ref walker at `src/manager/import-export/broken-refs.ts:66`:

```ts
const REF_REGEX = /@\{([0-9a-f]{8})(?::[^}]*)?\}/g;
```

Same grammar as the engine tokenizer (`engine/syntax/tokenize.py`).

---

## 3. Fingerprint compute

Two distinct algorithms live in this codebase. Both produce 8 lowercase
hex characters; they are NOT interchangeable.

### 3.1 Module fingerprint

Implemented at:
- TS: `src/manager/import-export/fingerprint.ts:37`
  (`moduleFingerprint`).
- Python: `engine/_fingerprint.py:35` (`module_fingerprint`).

Algorithm:

1. Build the parts array `[type, name, description, sorted_tags_csv, payload_hash]`
   where `sorted_tags_csv` is `[...tags].sort().join(",")`.
2. Join with `\n` (single newline).
3. Hash via djb2 over **UTF-16 code units** (matching JavaScript
   `String.prototype.charCodeAt`):

```ts
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
```

Python iterates UTF-16-LE byte pairs so non-BMP characters (emoji)
hash identically across languages — see `engine/_fingerprint.py:19-32`.

**Reference value (cross-language invariant).** Both sides MUST produce
`"ba7a57fa"` for this input (locked by
`tests/engine/test_fingerprint.py:86-100` and
`src/manager/import-export/__tests__/fingerprint.test.ts:73`):

```python
m = {
    "type":         "wildcard",
    "name":         "color",
    "description":  "Basic colors",
    "tags":         ["palette", "demo"],
    "payload_hash": "a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd",
}
assert module_fingerprint(m) == "ba7a57fa"
```

If either side breaks this test, the algorithms have drifted and round-
trip equality is broken.

### 3.2 Bundle fingerprint (separate)

Bundles use a structural fingerprint at
`src/components/context/bundles/bundle-fingerprint.ts:68`
(`computeBundleFingerprint`). The leaf signature is
`uid|bundle_origin|payload_hash` joined by `\n`; the algorithm walks
`children[]` in order. Order-sensitive. Empty bundle hashes to `"0"` as
a sentinel.

This algorithm is **not mirrored on the Python side** — bundle drift
detection is a client-only concern; the server stores `payload_hash` on
the bundle row and the SPA computes the structural fingerprint at
display time.

### 3.3 Categories

Categories carry **no fingerprint**. Merge is by case-insensitive name
match (see §6).

---

## 4. Schema migration chain

Both sides ship a versioned migration chain:

- TS: `src/manager/import-export/migrations.ts`.
- Python: `engine/migrations/__init__.py` (+ `engine/migrations/v0_to_v1.py`).

`CURRENT_SCHEMA_VERSION = 1` on both sides.

### Dispatcher contract

TS returns:

```ts
{ ok: true,  migrated: RawPayload, migratedEntityCount: number }
| { ok: false, reason: string, affected?: string[] }
```

Python returns the same shape with snake_case keys (`migrated_entity_count`).
See `engine/migrations/__init__.py:21-63`.

`migratedEntityCount` is the **cumulative** count of entities that
passed through ANY step (a 5-entity payload migrated v0 → v1 → v2 would
report `10`, not `5`). Used for telemetry/UX, not for distinct-entity
counting.

### v0 → v1 (current head)

A no-op stub: every entity gets a `migrated_from: 0` tag. Lossless.
TS: `migrateV0ToV1` at `migrations.ts:49`. Python: `migrate_v0_to_v1` at
`engine/migrations/v0_to_v1.py`.

### Lossy vs lossless

Lossy migrations short-circuit the dispatcher with
`{ ok: false, reason }`. Lossless migrations append their delta and
continue walking the chain until `schema_version === CURRENT_SCHEMA_VERSION`.

Future schema bumps must update both sides in the same PR. Forgetting
the Python mirror does not break export (server emits the current
version) but breaks defense-in-depth on commit re-parse.

---

## 5. Dependency graph + collision contract

### 5.1 Dependency graph

`src/manager/import-export/dep-graph.ts:33` (`buildDepGraph`) builds an
outgoing-direction graph keyed by entity `id`:

| Entity         | Outgoing edges                                                          |
|----------------|-------------------------------------------------------------------------|
| `wildcards`    | every `@{8hex}` ref extracted from each `options[].value` string        |
| `bundles`      | every `children[i].id` where `children[i].type === "bundle"` (tier-2)   |
| `constraints`  | `payload.source_wildcard_id` AND `payload.target_wildcard_id` (nested)  |
| `fixed_values` | none                                                                    |
| `combines`     | none                                                                    |
| `derivations`  | none                                                                    |
| `categories`   | none                                                                    |

`transitiveClosure(graph, seed)` walks the graph to a fixed point;
overloads accept either a pre-built `DepGraph` or a `RawPayload`
(`dep-graph.ts:83-107`). `constraintsBothSidesIn(payload, selection)`
returns constraint ids whose source AND target are both in the user's
selection — used by the picker's "Select with dependencies" action to
auto-include constraints without auto-pulling reverse deps.

### 5.2 Collision detection

`src/manager/import-export/collision.ts:24` (`detectCollisions`)
classifies each incoming module against the receiver library:

| Result          | Condition                                                                       |
|-----------------|---------------------------------------------------------------------------------|
| `no-collision`  | `id` absent from receiver library                                               |
| `silent-skip`   | `id` matches AND `moduleFingerprint(incoming) === library.snapshot_fingerprint` |
| `conflict`      | `id` matches AND fingerprints differ, OR library row's fingerprint is `null`    |

A `null` library fingerprint is defensively classified as `conflict`
(safer to surface to the user than silently skip). The conflict modal at
`src/manager/import-export/ConflictModal.vue` then offers Skip /
Replace / Import-as-new.

Bundles do **not** run through `detectCollisions`. Bundle MOD detection
uses `computeBundleFingerprint` (§3.2) via the existing tier-2
infrastructure. Categories use **name-only merge** — no id collision
check, no fingerprint compare; case-insensitive name match means "skip,
already present" (see `engine/importer.py:362-380`).

---

## 6. API endpoint contract

All endpoints are registered in `wp_api/import_export.py:register`
(line 328). Bodies are JSON; the 5 MB body cap from
`wp_api/_validators.validate_body_size` applies to writes.

### `POST /wp/api/export/build`

Assembles a 7-bucket export payload from user-selected UUID lists.

Request body — every key optional, default `[]`:

```json
{
  "bundle_uuids":       ["<8-hex>", ...],
  "wildcard_uuids":     ["<8-hex>", ...],
  "fixed_values_uuids": ["<8-hex>", ...],
  "combine_uuids":      ["<8-hex>", ...],
  "derivation_uuids":   ["<8-hex>", ...],
  "constraint_uuids":   ["<8-hex>", ...],
  "category_uuids":     ["<slug>", ...]
}
```

Response (200): the full 7-bucket payload (see §1). Mis-typed UUIDs
(e.g. a wildcard id under `combine_uuids`) are silently dropped by the
exporter — the picker UI's loose type tracking is allowed to be
imprecise.

Handler: `wp_api/import_export.py:179-224` (`export_build`).
Engine: `engine/exporter.py:96-152` (`build_export_payload`).
Client: `api.importExport.build()` at `src/manager/api/client.ts:190`.

### `POST /wp/api/import/commit`

Applies a classified commit payload atomically.

Request body (produced by `buildCommitPayload` in
`src/manager/import-export/commit.ts:206`):

```json
{
  "adds": [
    { "kind": "<entity-kind>", "entity": { /* full row */ } }
  ],
  "replaces": [
    { "kind": "<entity-kind>", "id": "<8-hex>", "new_content": { /* full row */ } }
  ],
  "renames": [
    {
      "kind":    "<entity-kind>",
      "old_id":  "<8-hex>",
      "new_id":  "<8-hex>",
      "content": { /* full row, id == new_id, lifecycle fields stripped */ }
    }
  ]
}
```

`kind` is one of: `wildcard`, `fixed_values`, `combine`, `derivation`,
`constraint`, `bundle`, `category`. The first five route to the
`modules` table (discriminated by the row's `type` column); `bundle`
routes to `bundles`; `category` routes to `module_categories`. Anything
else is rejected as a contract violation.

**Categories never appear in `replaces` or `renames`** — merge is
name-based, so the SPA's `CategoryDecision` type narrows to
`{ kind: "add" }` only. See `commit.ts:63`.

**Rename content rules** (`commit.ts:158-194`): the partitioner clones
`entity`, stamps `id = new_id` and `name = new_name`, then deletes
`created_at`, `updated_at`, `version`, `snapshot_fingerprint`, and
`payload_hash` so the server's `now()` defaults and fingerprint /
payload-hash recomputation take effect. Leaving stale values in would
mis-sort the imported row by `created_at` and cache a stale fingerprint
keyed against the wrong id.

Response on success (200):

```json
{
  "ok": true,
  "undo_entry_id": "<16-hex>",
  "summary": { "added": <n>, "replaced": <n>, "renamed": <n> }
}
```

Response on failure (400): `{ "error": "<message>" }`. The engine wraps
raw SQLite errors as `"database integrity violation"` so column /
constraint internals never leak.

Handler: `wp_api/import_export.py:227-278` (`import_commit`).
Engine: `engine/importer.py:330-540` (`commit_import`).

### `POST /wp/api/import/undo`

Reverses a previous commit.

Request body: `{ "undo_entry_id": "<16-hex>" }`.

Response on success (200): `{ "ok": true }`.
Response on missing entry (404): `{ "error": "undo entry '...' not found" }`.
Response on other failure (400): `{ "error": "<message>" }`.

Handler: `wp_api/import_export.py:281-325` (`import_undo`).
Engine: `engine/importer.py:565-677` (`undo_import`).

### Legacy endpoints

`GET /wp/api/export` and `POST /wp/api/import` remain at
`wp_api/import_export.py:37,51` as the V1 full-library bundle dump /
restore. They are deprecated and out of scope for this contract; new
clients must use `/wp/api/export/build` + `/wp/api/import/commit`.

---

## 7. Undo metadata

Persisted in the `import_undo` SQLite table. Each successful commit
writes one row; each successful undo deletes the matching row.

Row shape (returned from `engine/importer.py:543-562` (`get_undo_entry`)
with JSON columns deserialized):

```python
{
    "id":                 "<16-hex>",
    "created_at":         "<ISO 8601>",
    "imported_records":   [{"kind": "<entity-kind>", "id": "<8-hex>"}, ...],
    "replaced_snapshots": {"<id>": {"kind": "<entity-kind>", "row": { /* full pre-replace row */ }}, ...},
    "rename_map":         {"<old_id>": "<new_id>", ...}
}
```

- `imported_records` lists every row added OR inserted under a renamed
  `new_id`. Undo deletes each.
- `replaced_snapshots` is keyed by the **id that was overwritten**
  (which is the same id post-replace). Each value carries the kind and
  the full pre-replace row as a plain dict. Undo restores the row
  bit-for-bit (literal `version`, `created_at`, `updated_at`,
  `snapshot_fingerprint` / `payload_hash`) — this is the only place
  `_update_module` / `_update_bundle` is bypassed, because those helpers
  always bump `version` and recompute the fingerprint, which is wrong
  for an undo.
- `rename_map` is informational: the `new_id` already appears in
  `imported_records` for the actual delete; the map is kept so the SPA
  can resolve telemetry / progress messages back to the original id.

Undo transaction order (`engine/importer.py:582-662`):
1. Restore replaced rows from `replaced_snapshots`.
2. Delete inserted rows from `imported_records`.
3. Delete the `import_undo` row itself.

The entire undo runs inside a single `with conn:` block; any failure
rolls back.

---

## 8. Implementation locations index

| Concept              | TypeScript                                              | Python                                              |
|----------------------|---------------------------------------------------------|-----------------------------------------------------|
| Module fingerprint   | `src/manager/import-export/fingerprint.ts`              | `engine/_fingerprint.py`                            |
| Bundle fingerprint   | `src/components/context/bundles/bundle-fingerprint.ts`  | (not mirrored — client-only drift detection)        |
| Migration chain      | `src/manager/import-export/migrations.ts`               | `engine/migrations/__init__.py`                     |
| v0 → v1 step         | `migrations.ts:migrateV0ToV1`                           | `engine/migrations/v0_to_v1.py`                     |
| Parse / verify       | `src/manager/import-export/parse.ts`                    | (re-runs migrations in `engine/importer.py`)        |
| Dep graph            | `src/manager/import-export/dep-graph.ts`                | `engine/exporter.py:_walk_inner_bundles`            |
| Collision classifier | `src/manager/import-export/collision.ts`                | `engine/importer.py:commit_import` (per-op checks)  |
| Broken-ref discovery | `src/manager/import-export/broken-refs.ts`              | (client-side post-commit walk)                      |
| Commit payload build | `src/manager/import-export/commit.ts:buildCommitPayload`| —                                                   |
| Exporter             | (consumes API)                                          | `engine/exporter.py:build_export_payload`           |
| Importer             | (consumes API)                                          | `engine/importer.py:commit_import` / `undo_import`  |
| API client           | `src/manager/api/client.ts:api.importExport`            | `wp_api/import_export.py:register`                  |
| Module row shape     | (consumed via `RawPayload`)                             | `engine/db/repositories.py:_row_to_module`          |
| Bundle row shape     | (consumed via `RawPayload`)                             | `engine/db/repositories.py:_row_to_bundle`          |
| Category row shape   | (consumed via `RawPayload`)                             | `engine/db/repositories.py:_row_to_category`        |

---

## 9. Convention enforcement

Drift-prone invariants worth special attention during review:

1. **Field name is `id`, never `uuid`.** Post-migration-004 and post-
   Task-17 alignment, every entity in transit on the wire carries its
   identity as `id`. The string `uuid` survives only inside the `@{id}`
   ref-syntax callouts and in legacy method names like
   `ModuleRepository.get_by_uuid` (kept as a thin alias for back-compat).
   New code MUST use `id`.

2. **Constraint refs are nested under `payload`.** The dep-graph and
   broken-ref walker both read `payload.source_wildcard_id` /
   `payload.target_wildcard_id`. There is no top-level
   `source_uuid` / `target_uuid` field. The engine's validation at
   `engine/modules/constraint_handler.py:126` enforces this on save.

3. **Categories are merge-by-name.** No fingerprint, no id-collision
   detection, no replace, no rename. The TS type `CategoryDecision`
   narrows to `{ kind: "add" }` so wiring a category through the
   replace/rename UI is a compile-time error. Server-side, categories
   match against `name COLLATE NOCASE`; an existing match means
   "skip, already present" (`engine/importer.py:373-380`).

4. **Tier-3 bundles are non-overridable.** Bundles whose inner-bundle
   entry recursively contains another inner-bundle reference are
   hard-rejected by the import picker with a chain visualization. The
   user cannot force-import them; the design spec locks this to keep
   bundle layout one level deep.

5. **Rename strips lifecycle fields.** A `renames[i].content` must NOT
   carry `created_at`, `updated_at`, `version`, `snapshot_fingerprint`,
   or `payload_hash` — the server stamps `now()` and recomputes
   fingerprint / payload-hash against the new id. The partitioner at
   `src/manager/import-export/commit.ts:172-189` enforces this
   client-side; the server insert paths in `engine/importer.py` would
   otherwise copy stale client-supplied values verbatim.

6. **Module ids stay 8-hex.** Both `ModuleRepository.create` and
   `BundleRepository.create` validate any caller-supplied `id` against
   `[0-9a-f]{8}` and reject anything else. The `@{}` ref-grammar regex
   captures the same shape.

7. **Module fingerprint stays djb2-over-UTF-16.** Cross-language parity
   depends on UTF-16 code units (matching JS `charCodeAt`), `\n`
   separator, and JS-compatible decimal formatting of the 32-bit
   integer hash. The reference value `ba7a57fa` (§3.1) is the canary.
