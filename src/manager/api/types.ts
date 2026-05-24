export type ModuleType =
  | "wildcard"
  | "fixed_values"
  | "combine"
  | "derivation"
  | "constraint";

// ----- Per-type payload shapes (cross-referenced from data.jsx prototype) -----

export interface WildcardOption {
  id: string;
  value: string;
  weight: number;
  sub_category?: string | null;
}

export interface WildcardPayload {
  options: WildcardOption[];
  sub_categories: string[];
  /**
   * The `$varname` other modules use to read this wildcard's resolved value.
   * Optional — defaults to `slug(name)` when missing/blank. User-editable so
   * collisions or renames can be resolved without breaking downstream refs.
   */
  var_binding?: string;
}

export interface CombinePayload {
  template: string;
  output_var: string;
  input_vars: string[];
}

/** Derivation condition operators. The presence-check pair
 *  (`exists`/`not_exists`/`is_set`/`is_unset`) was added in the
 *  2026-05-09 cycle — `exists`/`not_exists` check key presence in
 *  ctx, `is_set`/`is_unset` additionally require non-empty value.
 *  Mirrors `engine/modules/derivation_handler.py:_VALID_OPS`. */
export type DerivationOp =
  | "equals"
  | "not_equals"
  | "contains"
  | "matches"
  | "exists"
  | "not_exists"
  | "is_set"
  | "is_unset";
export type DerivationMode = "replace" | "append" | "prepend";

export interface DerivationCondition {
  var: string;
  op: DerivationOp;
  value: string;
}

export interface DerivationAction {
  target_var: string;
  mode: DerivationMode;
  value: string;
}

export interface DerivationBranch {
  condition: DerivationCondition;
  action: DerivationAction;
}

/**
 * Else clause matches the backend validator shape: an object with an `action`.
 * (See engine/modules/derivation_handler.py::_validate_action.)
 */
export interface DerivationElse {
  action: DerivationAction;
}

export interface DerivationRule {
  id: string;
  branches: DerivationBranch[];
  else?: DerivationElse;
}

export interface DerivationPayload {
  rules: DerivationRule[];
}

export type ConstraintMode = "allow" | "exclude" | "boost" | "reduce";

export interface ConstraintCell {
  mode: ConstraintMode;
  factor: number;
}

/** Map shape: source_value → target_sub_category → cell. */
export type ConstraintMatrix = Record<string, Record<string, ConstraintCell>>;

export interface ConstraintException {
  /**
   * Source option value string. Preserved for backend compatibility —
   * the runtime constraint resolver keys instance-disable / override
   * lookups by (source_value, target_value) pairs. New writes should
   * keep this in sync with the current option value resolved from
   * `source_id`.
   */
  source: string;
  target: string;
  /** Stable per-option id introduced by migration 010. Cascade
   * indexing and chip rendering use these; `source` / `target`
   * strings remain for runtime compat. May be empty on rows
   * created before migration 010 ran. */
  source_id?: string;
  target_id?: string;
  mode: ConstraintMode;
  factor: number;
}

/** Exceptions migration 010 could not resolve. Surfaced as warn-tone
 * chips in ConstraintEditor; user resolves manually. */
export interface BrokenConstraintException extends ConstraintException {
  reason: string;
}

export interface ConstraintPayload {
  source_wildcard_id: string | null;
  target_wildcard_id: string | null;
  matrix: ConstraintMatrix;
  exceptions: ConstraintException[];
  broken_exceptions?: BrokenConstraintException[];
}

export interface ModuleRow {
  /**
   * 8-hex short uuid. Post migration 004 the slug-prefixed form
   * (`wc_outfit_a1b2c3d4`) is gone — `id` IS the canonical uuid the
   * tokenizer's `@{8hex}` ref captures and the engine catalog keys
   * by. There is no separate `uuid` field anymore.
   */
  id: string;
  type: ModuleType;
  name: string;
  description: string;
  category_id: string | null;
  tags: string[];
  is_favorite: boolean;
  payload: Record<string, unknown>;
  payload_hash: string;     // spec §4.2
  version: number;
  created_at: string;
  updated_at: string;
}

/**
 * Per-module version-history entry. Stored as a sidecar inside `payload.history`
 * (max 3 entries). Soft contract — we never add `history` to the typed payload
 * shapes themselves; helpers in `utils/history.ts` access it via runtime checks.
 *
 * `payload` here is the snapshotted module payload **with the `history` key
 * stripped** so saved snapshots never recurse.
 */
export interface ModuleHistoryEntry {
  saved_at: string;
  name: string;
  description?: string;
  category_id?: string | null;
  tags?: string[];
  payload: Record<string, unknown>;
}

export interface ModuleListResponse {
  items: ModuleRow[];
  total: number;
}

export interface ModuleCreateInput {
  type: ModuleType;
  name: string;
  description?: string;
  category_id?: string | null;
  tags?: string[];
  payload: Record<string, unknown>;
  is_favorite?: boolean;
}

export interface ModuleUpdateInput {
  name?: string;
  description?: string;
  category_id?: string | null;
  tags?: string[];
  payload?: Record<string, unknown>;
  is_favorite?: boolean;
}

export interface CategoryRow {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  sort_order: number;
}

/** Library-side bundle row returned from /wp/api/bundles. Mirrors
 *  ModuleRow shape but with `color` (user-picked frame color) instead
 *  of a typed payload, and `children` carrying full deep-cloned module
 *  snapshots. */
export interface BundleRow {
  id: string;
  name: string;
  description: string;
  color: string | null;
  category_id: string | null;
  tags: string[];
  is_favorite: boolean;
  children: Array<Record<string, unknown>>;
  payload_hash: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface BundleListResponse {
  items: BundleRow[];
  total: number;
}

export interface BundleCreateInput {
  name: string;
  description?: string;
  color?: string | null;
  category_id?: string | null;
  tags?: string[];
  children?: Array<Record<string, unknown>>;
  is_favorite?: boolean;
}

export interface BundleUpdateInput {
  name?: string;
  description?: string;
  color?: string | null;
  category_id?: string | null;
  tags?: string[];
  children?: Array<Record<string, unknown>>;
  is_favorite?: boolean;
}

export interface CategoryCreateInput {
  name: string;
  color?: string | null;
  icon?: string | null;
  sort_order?: number;
}

export interface SnapshotShape {
  library_id: string;
  library_snapshot_at: string;
  library_version_at_snapshot: number;
  type: ModuleType;
  name: string;
  category_id: string | null;
  payload: Record<string, unknown>;
  instance: {
    variable_binding: string;
    enabled_options: string[] | null;
    category_filter: string | null;
  };
}

export interface MatchRequest {
  type: ModuleType;
  name: string;
  payload_hash: string;
}

export type MatchResponse =
  | { matched: false }
  | { matched: true; id: string; version: number };

export interface TestRequest {
  type: ModuleType;
  payload: Record<string, unknown>;
  instance: Record<string, unknown>;
  samples: number;
}

export interface TestResponse {
  results: Record<string, string>[];
  histogram: Record<string, number>;
}

/**
 * Spec §2.4 — canonical snapshot entry. Mirrors the Python
 * `engine.modules.snapshot.SnapshotEntry` TypedDict. Stored:
 *   - in `__wp_catalog__` at runtime (memory only)
 *   - in WP_Context workflow JSON (persisted, decoupled from DB)
 *
 * `payload_hash` covers `payload` only (not `name` / `tags` / etc.) so a
 * rename does not flip drift state.
 */
export interface SnapshotEntry {
  snapshot_version: 1;
  uuid: string;             // 8 hex chars
  type: ModuleType;         // wildcards-only in catalog (spec §2.7)
  name: string;
  payload: Record<string, unknown>;
  payload_hash: string;     // SHA-256 hex, 64 chars
  source:
    | { kind: "user" }
    | { kind: "dep"; parent_uuids: string[] };
}

/**
 * Walker-recorded anomaly. Spec §2.8 — extensible discriminator. New
 * reasons can be added without breaking existing consumers; they
 * default-handle unknown variants.
 */
export interface WalkOverflow {
  uuid: string;
  reason: "max_depth" | "cycle_detected" | "missing_target";
}

/**
 * Server response shape from `POST /wp/api/modules/embed-bundle`.
 * Pre-split so the SPA picker doesn't filter wildcards out of a mixed
 * bundle. Spec §4.2.
 *
 * - `modules`: full payloads of explicit picks, in input order. The
 *   pipeline executes these.
 * - `snapshots`: wildcard catalog (picks of type wildcard + transitive
 *   wildcards). Becomes `ctx['__wp_catalog__']` at run time.
 * - `pickOrder`: uuid order for UI display.
 * - `walkOverflow`: cycles / depth caps / missing targets the walker hit.
 */
export interface EmbedBundle {
  modules: Record<string, unknown>[];
  snapshots: Record<string, SnapshotEntry>;
  pickOrder: string[];
  walkOverflow: WalkOverflow[];
}
