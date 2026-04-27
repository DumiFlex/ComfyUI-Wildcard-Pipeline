export type ModuleType =
  | "wildcard"
  | "fixed_values"
  | "combine"
  | "derivation"
  | "constraint"
  | "pipeline";

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

export type DerivationOp = "equals" | "not_equals" | "contains" | "matches";
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
  source: string;
  target: string;
  mode: ConstraintMode;
  factor: number;
}

export interface ConstraintPayload {
  source_wildcard_id: string | null;
  target_wildcard_id: string | null;
  matrix: ConstraintMatrix;
  exceptions: ConstraintException[];
}

export interface PipelineStep {
  id: string;
  module_id: string;
  enabled: boolean;
  instance?: Record<string, unknown>;
}

export interface PipelinePayload {
  steps: PipelineStep[];
}

export interface ModuleRow {
  id: string;
  type: ModuleType;
  name: string;
  description: string;
  category_id: string | null;
  tags: string[];
  is_favorite: boolean;
  payload: Record<string, unknown>;
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

export interface ImportBundle {
  version: 1;
  exported_at?: string;
  modules: ModuleRow[];
  categories: CategoryRow[];
}

export interface ImportResult {
  modules_imported: number;
  categories_imported: number;
  skipped: string[];
}
