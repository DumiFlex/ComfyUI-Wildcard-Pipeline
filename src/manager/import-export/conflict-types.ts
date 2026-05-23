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
 */
export type PerItemKind =
  | "broken-inner-ref"
  | "broken-uuid-ref"
  | "broken-constraint-ref"
  | "tier-3"
  | "lossy-migration"
  | "fingerprint-mismatch";

/**
 * One UUID collision against the live DB. `kind` is the 7-bucket
 * `EntityKind` from `./commit` so the same partitioner downstream can
 * route the resolved entity to the correct server-side bucket. The
 * `entity` blob is the full payload row (passed through verbatim).
 */
export interface BatchConflict {
  kind: EntityKind;
  id: string;
  entity: Record<string, unknown>;
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
  kind: "skip" | "replace" | "rename" | "accept";
  new_id?: string;
  new_name?: string;
}
