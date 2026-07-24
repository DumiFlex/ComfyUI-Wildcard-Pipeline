/**
 * Conflict-resolution type definitions shared by `ConflictModal.vue`
 * and its callers/tests.
 *
 * These live in a plain `.ts` module (rather than being re-exported
 * from the SFC) because `vue-tsc` resolves named-type imports from
 * `*.vue` files but plain `tsc` and IDE diagnostic engines reading
 * `src/env.d.ts` only see the default export. Co-locating the types
 * here keeps both worlds happy.
 *
 * `EntityKind` is intentionally NOT redefined here — it already lives
 * in `./commit` as the canonical 7-bucket discriminant and is the
 * single source of truth for the partitioner downstream.
 */
import type { EntityKind } from "./commit";

/**
 * Tag for one per-item integrity issue. Mirrors the upstream
 * verify pipeline (see parse.ts + the importer/exporter spec):
 *
 *   - broken-inner-ref      — bundle/constraint edge references an id
 *                             that isn't in the picker selection.
 *   - broken-uuid-ref       — wildcard option uses `@{id}` syntax
 *                             targeting an unknown id.
 *   - broken-constraint-ref — constraint source/target points at an
 *                             entity not in the import set.
 *   - tier-3                — entity contains a forward-incompatible
 *                             construct the server cannot accept;
 *                             non-overridable.
 *   - lossy-migration       — migration chain ran but dropped fields
 *                             from the original payload.
 *   - fingerprint-mismatch  — payload-stamped `snapshot_fingerprint`
 *                             disagrees with the value recomputed from
 *                             the row contents.
 *   - content-duplicate     — (D3b) the incoming row's uuid is free, but
 *                             byte-identical content already exists in the
 *                             library under a DIFFERENT uuid. Importing it
 *                             would create a duplicate row and split refs
 *                             across two identical entries. `detail` carries
 *                             `{ target_id, target_name }`. Resolvable as
 *                             `link` (point refs at the existing row) or
 *                             `accept` (import the duplicate anyway).
 */
export type PerItemKind =
  | "broken-inner-ref"
  | "broken-uuid-ref"
  | "broken-constraint-ref"
  | "unselected-dep"
  | "tier-3"
  | "lossy-migration"
  | "fingerprint-mismatch"
  | "content-duplicate";

/** `detail` payload carried by a `content-duplicate` per-item issue. */
export interface ContentDuplicateDetail {
  target_id: string;
  target_name?: string;
}

/**
 * One UUID collision against the live DB. `kind` is the 7-bucket
 * `EntityKind` from `./commit` so the same partitioner downstream can
 * route the resolved entity to the correct server-side bucket. The
 * `entity` blob is the full payload row (passed through verbatim).
 *
 * `collisionState` distinguishes the flavors of "needs visibility":
 *   - `"conflict"`       — uuid match + content drift (incoming
 *                          fingerprint differs from library's stored one).
 *                          Surfaces as the orange MODIFIED badge.
 *   - `"exists-unknown"` — library row present but `snapshot_fingerprint`
 *                          is NULL (legacy / pre-backfill). User must
 *                          decide skip/replace, but we cannot claim
 *                          "modified" without proof; modal renders the
 *                          amber EXISTING badge.
 *   - `"silent-skip"`    — uuid + content fingerprint both match exactly.
 *                          Surfaces in the modal as a DUPLICATE badge so
 *                          the user sees these aren't being imported by
 *                          default (default action: skip) but can flip
 *                          to Replace / Import as new to override.
 *
 * Optional for back-compat with code paths constructing conflicts
 * before Phase 8 — absent → modal falls back to the historical
 * "modified" treatment.
 */
export interface BatchConflict {
  kind: EntityKind;
  id: string;
  entity: Record<string, unknown>;
  collisionState?: "conflict" | "exists-unknown" | "silent-skip" | "type-conflict";
}

/**
 * One per-item integrity issue. `entity` MUST carry `id`; `name` is
 * optional for the display fallback (`id` shown if name absent). The
 * generic `detail` slot lets callers stash any diagnostic context the
 * modal doesn't need to interpret (e.g. specific broken-ref target).
 */
export interface PerItemIssue {
  kind: PerItemKind;
  entity: Record<string, unknown> & { id: string; name?: string };
  detail?: unknown;
}

/**
 * Default action applied uniformly to every batch UUID collision.
 *
 *   - `skip`    — drop the incoming row; keep the live-DB version.
 *   - `replace` — overwrite the live-DB row with the incoming content.
 *   - `rename`  — "Import as new (keep both)": mint a fresh id per
 *                 entity client-side, suffix the name with
 *                 `" (imported)"`, and add the resulting row alongside
 *                 the existing live-DB row. The orchestrator
 *                 (`partitionSelection` in `ImportExport.vue`) is
 *                 responsible for minting the id + suffixing the name
 *                 when this default applies, since the batch dropdown
 *                 doesn't surface the inline rename UI (kept compact).
 *                 Per-row overrides + per-item issue rows that need
 *                 user-edited names still route through
 *                 `ImportAsNewRename.vue` and emit explicit
 *                 `{ new_id, new_name }`.
 */
export type BatchAction = "skip" | "replace" | "rename";

/**
 * Per-item resolution. `new_id` + `new_name` are only attached on the
 * rename branch — Task 20 introduces the inline rename UI
 * (`ImportAsNewRename.vue`) which mints a fresh 8-hex-char id
 * client-side and pairs it with a user-edited name. Both fields are
 * optional so the skip/replace/accept branches don't carry them.
 *
 * The field naming mirrors the server-side commit contract exactly
 * (Task 13/14/15): the rename rows in `CommitPayload.renames` carry
 * `new_id` + `new_name`. The plan body talks about `new_uuid` — that's
 * stale; the locked server contract uses `new_id` and the entire TS
 * import-export surface aligned to `id` (NOT `uuid`) in commit
 * `9cf37c7` (Task 17).
 */
export interface PerItemDecision {
  kind: "skip" | "replace" | "rename" | "accept" | "link";
  new_id?: string;
  new_name?: string;
  /** D3b `link` only — the EXISTING library id to point refs at. The
   *  orchestrator maps this to `CollisionDecision { kind: "link", target_id }`,
   *  which drops the incoming entity and remaps its refs onto that row. */
  target_id?: string;
}
