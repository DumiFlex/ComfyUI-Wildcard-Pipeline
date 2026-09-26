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
  /** Multi-tag membership (SP1). Which registry sub-categories this
   * option belongs to — a subset of `WildcardPayload.sub_categories`.
   * Replaces the pre-SP1 singular `sub_category?: string | null`.
   * Defaults to `[]` (untagged: bypasses every tag filter). The null
   * option always carries `[]`. The boolean filter expression
   * (`@{uuid:expr}` + instance `category_filter`) is matched against
   * this set; the constraint matrix uses the PRIMARY tag
   * (`sub_categories[0]`) as an SP1 stopgap (SP3 multiplies). Mirrors
   * engine `engine/modules/wildcard_handler.py:validate_payload`. */
  sub_categories: string[];
  /** Exactly one option per wildcard may be flagged `is_null: true`.
   * The null option carries `value: ""` and `sub_categories: []`. When
   * picked, the wildcard resolves to the empty string — a
   * probabilistic "no output" slot that bypasses the constraint matrix
   * (which is keyed by the primary tag) but can still be targeted by
   * constraint exceptions (keyed by the empty-string value). Validated
   * server-side in `engine/modules/wildcard_handler.py:validate_payload`.
   * See `docs/superpowers/specs/2026-05-24-null-wildcard-option-design.md`. */
  is_null?: boolean;
}

export interface WildcardPayload {
  options: WildcardOption[];
  sub_categories: string[];
  /**
   * Optional UI-only grouping of registry `sub_categories` into named
   * axes (SP1). Axis name → member tags; each member must be in
   * `sub_categories`, and a tag may appear in at most one axis.
   * **The engine ignores it** — only the editors use it to render
   * grouped chips/pills and to colour tags per axis. Travels in the
   * payload so grouping survives sharing. Ungrouped tags render in a
   * default "ungrouped/other" box. See design §2.2 / §4.3.
   */
  tag_groups?: Record<string, string[]>;
  /**
   * Per-group meaning. Absent (and `classify`) is today's behaviour: tags
   * describe what an option IS and fold with AND in the constraint matrix.
   * `accepts` marks the group's tags as alternatives the option offers — an
   * OR-set the fold reads with max, and which `$var.AXIS` rolls one winner
   * from. Only `accepts` entries are ever stored, so an untouched payload
   * stays byte-identical. An `accepts` group name must be a valid identifier
   * so `$var.AXIS` parses.
   */
  tag_group_kinds?: Record<string, "accepts">;
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
 *  The 2026-05-24 cycle added `is_empty`/`is_not_empty` to support
 *  the null wildcard option — `is_empty` fires when the var resolves
 *  to "" (which a null-option pick produces).
 *  Mirrors `engine/modules/derivation_handler.py:_VALID_OPS`. */
export type DerivationOp =
  | "equals"
  | "not_equals"
  | "contains"
  | "matches"
  | "exists"
  | "not_exists"
  | "is_set"
  | "is_unset"
  | "is_empty"
  | "is_not_empty";
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
  /**
   * Cached source/target wildcard DISPLAY names, stamped on write (when
   * the live wildcard is in hand). Display-only — the engine resolves by
   * `source_wildcard_id` / `target_wildcard_id` and never reads these, so
   * they're additive + non-load-bearing (diagnostic, like
   * `producer_engine_version`). They let the broken-reference banner show
   * `Source wildcard 'Starter subject' (54693e08)` after the wildcard is
   * deleted (the name is otherwise unrecoverable from the library).
   * Absent on legacy constraints → banner falls back to uuid-only.
   */
  source_wildcard_name?: string;
  target_wildcard_name?: string;
  matrix: ConstraintMatrix;
  exceptions: ConstraintException[];
  broken_exceptions?: BrokenConstraintException[];
  /**
   * SP3 library-default reach selector — decides which downstream
   * instances of `target_wildcard_id` the constraint covers when no
   * per-instance override is set. Library authoring offers `first` /
   * `next N` / `all` only; `pick` references live per-instance `_uid`s
   * that don't exist at authoring time, so it's instance-only (set on
   * the modal, see `TargetSelect` in `widgets/_shared.ts`). Absent =
   * engine default `{mode:"all"}`.
   */
  target_select?: { mode: "first" | "next" | "all"; count?: number };
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
  /**
   * Community origin (engine migration 013). Stamped on rows that
   * were installed via the community embed's host-bridge install
   * call with `origin: { post_slug, version_number }`. Drives the
   * "installed from community" badge + the update-available check
   * that compares `community_version_number` against the post's
   * current `latest_version_number`. Null on locally-authored rows.
   */
  community_post_slug?: string | null;
  community_version_number?: number | null;
  /**
   * NSFW flag (engine migration 015). 'safe' by default; flipped to
   * 'nsfw' by the IdentityCard toggle in any editor or auto-stamped
   * at install time when a community post carried content_rating='nsfw'.
   * Drives the `18+` pill on ModuleListView.
   */
  content_rating?: "safe" | "nsfw";
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
  content_rating?: "safe" | "nsfw";
}

export interface ModuleUpdateInput {
  name?: string;
  description?: string;
  category_id?: string | null;
  tags?: string[];
  payload?: Record<string, unknown>;
  is_favorite?: boolean;
  content_rating?: "safe" | "nsfw";
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
  /** See ModuleRow.community_post_slug — same semantics for bundles. */
  community_post_slug?: string | null;
  community_version_number?: number | null;
  /** See ModuleRow.content_rating — same semantics for bundles. */
  content_rating?: "safe" | "nsfw";
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
  content_rating?: "safe" | "nsfw";
}

export interface BundleUpdateInput {
  name?: string;
  description?: string;
  color?: string | null;
  category_id?: string | null;
  tags?: string[];
  children?: Array<Record<string, unknown>>;
  is_favorite?: boolean;
  content_rating?: "safe" | "nsfw";
}

export interface TemplateRow {
  id: string;
  name: string;
  description: string;
  category_id: string | null;
  tags: string[];
  is_favorite: boolean;
  template_string: string;
  created_at: string;
  updated_at: string;
}

export interface TemplateListResponse {
  items: TemplateRow[];
  total: number;
}

export interface TemplateCreateInput {
  name: string;
  template_string?: string;
  description?: string;
  category_id?: string | null;
  tags?: string[];
  is_favorite?: boolean;
}

export interface TemplateUpdateInput {
  name?: string;
  template_string?: string;
  description?: string;
  category_id?: string | null;
  tags?: string[];
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
    option_weights?: Record<string, number> | null;
    exclude_null?: boolean | null;
    // SP2a multi-select pick range + the separator that joins a bare `$var`.
    pick_min?: number | null;
    pick_max?: number | null;
    pick_separator?: string | null;
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

/* ------------------------------------------------------------------ */
/* Scenario runs — POST /wp/api/test/run (mirrors engine/scenario.py)   */
/* ------------------------------------------------------------------ */

/** One entry in a scenario's stack: a library module or a whole bundle. */
export type ScenarioStackItem =
  | { module: string; enabled?: boolean; instance?: Record<string, unknown> }
  | { bundle: string; enabled?: boolean };

/** Which chain seeds to run: a consecutive range, N random seeds, or a list. */
export type ScenarioSeedSpec =
  | { from: number; count: number }
  | { random: true; count: number }
  | { list: number[] };

export interface ScenarioRunRequest {
  stack: ScenarioStackItem[];
  /** `$var` name (with or without `$`) → value, as if passed in from upstream. */
  pins?: Record<string, string>;
  /** Defaults to 100 random seeds. */
  seeds?: ScenarioSeedSpec;
  /** Samples returned in full (0..1000, default 200). Counts always cover every seed. */
  sample_limit?: number;
  /** Distinct values kept per variable (0..5000, default 500); the rest fold into `other`. */
  value_limit?: number;
}

/** A multi-pick variable keeps its items so `$name.K` can index it. */
export type ScenarioValue = string | { items: string[]; sep: string };

export interface ScenarioTraceWrite { variable: string; value: ScenarioValue; overwrite: boolean }

/** A nested `@{ref}` pick made while a module resolved, in pre-order;
 *  `depth` 0 is a ref written directly in the module's own option. */
export interface ScenarioTraceRef {
  uuid: string;
  name: string;
  option_id: string | null;
  depth: number;
  /** What the ref expanded to, nested refs included. */
  value: ScenarioValue;
}

export interface ScenarioTraceRow {
  id: string;
  /** Stack uid: `s{i}` for a module, `s{i}.{j}` for a bundle child. */
  _uid: string;
  type: string;
  name: string;
  binding: string;
  status: string;
  seed: number | null;
  error: string | null;
  writes: ScenarioTraceWrite[];
  refs: ScenarioTraceRef[];
}

export interface ScenarioWarning {
  type: string;
  message: string;
  [key: string]: unknown;
}

export interface ScenarioSample {
  seed: number;
  vars: Record<string, ScenarioValue>;
  trace: ScenarioTraceRow[];
  warnings: ScenarioWarning[];
  error: string | null;
}

export interface ScenarioVariable {
  /** Fully expanded value → runs that produced it (top `value_limit`). */
  counts: Record<string, number>;
  distinct: number;
  /** Runs whose value fell outside `counts`. */
  other: number;
  /** Marked internal by its module: feeds other modules, never the prompt. */
  internal: boolean;
}

export interface ScenarioStackLayout {
  index: number;
  kind: "module" | "bundle";
  id: string;
  name: string;
  type: ModuleType | "bundle";
  uids: string[];
}

export interface ScenarioRunResponse {
  runs: number;
  failed: number;
  elapsed_ms: number;
  seeds: { first: number | null; count: number };
  variables: Record<string, ScenarioVariable>;
  /** Wildcard library id → option id → times picked. */
  picks: Record<string, Record<string, number>>;
  /** Constraint uid → downstream hits summed over every seed. */
  constraint_hits: Record<string, number>;
  warnings: (ScenarioWarning & { count: number; seeds: number[] })[];
  samples: ScenarioSample[];
  stack: ScenarioStackLayout[];
  missing: { kind: "module" | "bundle"; id: string }[];
  pins: Record<string, string>;
}

/** A saved Test Runner scenario — GET/POST/PUT /wp/api/test/scenarios. */
export interface ScenarioRow {
  id: string;
  name: string;
  description: string;
  is_pinned: boolean;
  stack: ScenarioStackItem[];
  pins: Record<string, string>;
  seeds: ScenarioSeedSpec;
  output_var: string | null;
  /** Opaque snapshot of the run to compare against; written by the Test Runner. */
  baseline: Record<string, unknown> | null;
  /** Opaque summary of the latest run; written by the Test Runner. */
  last_run: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export type ScenarioCreateInput =
  Pick<ScenarioRow, "name"> & Partial<Omit<ScenarioRow, "id" | "created_at" | "updated_at">>;
export type ScenarioUpdateInput = Partial<Omit<ScenarioRow, "id" | "created_at" | "updated_at">>;

export interface ScenarioListResponse { items: ScenarioRow[]; total: number }

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

export type DatabasePathSource =
  | "WP_DB_PATH"
  | "COMFYUI_USER_DIR"
  | "user"
  | "global"
  | "root"
  | "unknown";

export interface DatabaseAppliedMigration {
  version: number;
  name: string;
  applied_at: string;
}

export interface DatabasePragma {
  journal_mode: string;
  foreign_keys: number;
  page_size: number;
  page_count: number;
  freelist_count: number;
}

export interface DatabaseInfo {
  path: string;
  source: DatabasePathSource;
  size_bytes: number;
  mtime_iso: string;
  counts: Record<string, number>;
  migration: {
    current_version: number;
    applied: DatabaseAppliedMigration[];
  };
  pragma: DatabasePragma;
}

export type MaintenanceOp = "vacuum" | "integrity" | "analyze" | "migrate";

export type MaintenanceResult =
  | {
      ok: true;
      op: "vacuum";
      duration_ms: number;
      bytes_reclaimed: number;
    }
  | {
      ok: true;
      op: "integrity";
      duration_ms: number;
      output: string[];
    }
  | {
      ok: true;
      op: "analyze";
      duration_ms: number;
    }
  | {
      ok: true;
      op: "migrate";
      duration_ms: number;
      applied: number[];
    }
  | {
      ok: false;
      op: MaintenanceOp;
      duration_ms: number;
      error?: string;
      output?: string[];
    };

export type DatabasePreference = "user" | "global" | "root";
export type MoveMode = "copy" | "move";

export interface PendingMove {
  from: string;
  to: string;
  mode: MoveMode;
}

export interface DatabaseLocationEntry {
  path: string | null;
  exists: boolean;
  size_bytes: number | null;
}

export interface DatabaseLocations {
  user: DatabaseLocationEntry;
  global: DatabaseLocationEntry;
  root: DatabaseLocationEntry;
}

export interface DatabaseConfig {
  preference: DatabasePreference | null;
  pending_move: PendingMove | null;
  locations: DatabaseLocations;
  env_locked: boolean;
}

export interface DatabaseConfigUpdate {
  /** Omit to leave unchanged; pass `null` to explicitly clear. */
  preference?: DatabasePreference | null;
  /** Omit to leave unchanged; pass `null` to explicitly clear. */
  pending_move?: PendingMove | null;
}

/* ── Tag autocomplete ─────────────────────────────────────────────────── */

/** Danbooru's numeric tag categories. `null` when the installed file is the
 *  two-column `name,count` shape, which carries no category at all. */
export type TagCategoryName =
  | "general" | "artist" | "copyright" | "character" | "meta";

export interface TagSuggestion {
  /** The tag that gets INSERTED — always the canonical one, even when the
   *  query matched an alias. */
  name: string;
  /** What the query actually matched. Differs from `name` only for an alias,
   *  which is how the row can explain why it appeared. */
  matched: string;
  count: number;
  category: number | null;
  category_name: TagCategoryName | null;
}

export interface TagSuggestResponse {
  available?: boolean;
  tags: TagSuggestion[];
}

/** One installed LoRA or embedding, as an autocomplete row. */
export interface ModelSuggestion {
  /** Shown on screen — filename without folder or extension. */
  name: string;
  /** What gets INSERTED. The full relative path as ComfyUI knows it: two
   *  folders can hold the same filename and ComfyUI resolves by path, so
   *  inserting the display name would silently pick the wrong file. */
  path: string;
  /** Folder prefix, or "" at the root. The row's subtitle, so two same-named
   *  files in different folders are tellable apart. */
  folder: string;
}

export type ModelKind = "lora" | "embedding";

export interface ModelSuggestResponse {
  /** Keyed by kind. A kind the caller did not ask for is simply absent. */
  results: Partial<Record<ModelKind, ModelSuggestion[]>>;
}

export interface ModelSourceStatus {
  sources: Array<{ kind: ModelKind; count: number }>;
}

export interface TagStatus {
  /** A file is installed AND parsed. The user setting is separate — the two
   *  together are what decide whether suggestions appear. */
  available: boolean;
  /** Where the file is looked for, even when nothing is there yet. */
  path: string | null;
  tag_count: number;
  /** False for a two-column file. The UI drops the colour column entirely
   *  rather than rendering it grey and meaningless. */
  has_categories: boolean;
}

export interface TagDownloadResult {
  path: string;
  bytes: number;
  tag_count: number;
  has_categories: boolean;
  /** Echoed back so the UI can name exactly where the file came from. */
  source: string;
}
