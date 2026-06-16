/**
 * Runtime contracts shared with the community web service.
 *
 * The community service is the schema authority — the sister project
 * (this manager) consumes these contracts when importing/installing
 * payloads downloaded from the community side. Keep these in sync
 * with `web/src/api/types.ts` in the Wildcard-Pipeline-Community repo.
 *
 * This module deliberately holds runtime/transport contracts only.
 * Manager-internal types (engine row shapes, UI state) live under
 * `src/manager/api/types.ts`.
 */

/**
 * One row from the community service's schema_catalog table (community
 * spec §3). Returned alongside a download payload so the installer can
 * plan its migration / tolerant-parse strategy without a second
 * round-trip. Mirrors the Pydantic schema in
 * `api/app/schemas/catalog.py` on the community side.
 *
 * Fields:
 *   - `version`: schema version this row describes.
 *   - `is_breaking_from_previous`: true when going from `version - 1`
 *     to `version` introduced a NON-additive change (field removal,
 *     type change, semantics change). Used by `decideInstallPath`'s
 *     AND-fold check.
 *   - `min_consumer_engine_version`: engine semver gate, or null when
 *     no minimum is enforced.
 *   - `notes`: free-form release notes for this schema bump.
 *   - `created_at`: ISO timestamp the row was inserted, or null on
 *     hand-seeded rows.
 */
export interface SchemaCatalogEntry {
  version: number;
  is_breaking_from_previous: boolean;
  min_consumer_engine_version: string | null;
  notes: string;
  created_at: string | null;
}
