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
  /** Send-to-negative (schema v8): words this option puts in the negative
   * prompt of any Assembler that renders its variable. Same grammar as
   * `value` (text, `{a|b}`, `@{ref}`). Library content, never overridden per
   * instance. An empty negative is stored as absent. */
  negative?: string;
  /** Fallback (schema v9): at most one non-null option per wildcard. It
   * rolls normally and is also used when nothing else is left to pick
   * (constraints excluded every option, or every weight is 0). Stored
   * only as `true`; absent otherwise. See `engine/modules/_fallback.py`. */
  fallback?: boolean;
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
  /** Send-to-negative (schema v8): the phrase's own negative, on top of the
   * negatives of every variable its template reads. `$vars` + `{a|b}`. */
  negative?: string;
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
  | "is_not_empty"
  // The editor's NOT toggle (schema v10).
  | "not_contains"
  | "not_matches";
/** `negative` (schema v8) is "Add to negative": the value is added to the
 *  target variable's negatives and the variable itself is left alone.
 *  `negative_replace` (v8) is "Replace negative": the value becomes the
 *  variable's only negative. */
export type DerivationMode = "replace" | "append" | "prepend" | "negative" | "negative_replace";

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

/** A group of tests combined with AND (`all`) or OR (`any`); members may be
 *  tests or further groups. Schema v7 — see `src/extension/derivation-conditions.ts`. */
export interface DerivationConditionGroup {
  match: "all" | "any";
  conditions: DerivationConditionNode[];
}

export type DerivationConditionNode = DerivationCondition | DerivationConditionGroup;

export interface DerivationBranch {
  /** One test, or an AND / OR group of them. */
  condition: DerivationConditionNode;
  action: DerivationAction;
  /** THEN ... AND ... (schema v8): actions that run, in order, after
   *  `action`. Absent (never `[]`) when the branch has one action. */
  extra_actions?: DerivationAction[];
}

/**
 * Else clause matches the backend validator shape: an object with an `action`.
 * (See engine/modules/derivation_handler.py::_validate_action.)
 */
export interface DerivationElse {
  action: DerivationAction;
  extra_actions?: DerivationAction[];
}

export interface DerivationRule {
  id: string;
  branches: DerivationBranch[];
  else?: DerivationElse;
}

export interface DerivationPayload {
  rules: DerivationRule[];
}

/** `only` (linked picks) turns its row into an allow-list: when the source
 *  fires, every target without a rule of its own is excluded. */
export type ConstraintMode = "allow" | "exclude" | "boost" | "reduce" | "only";

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
  /** 8 hex: create at this id (a proposed module, or one Undo brings back). */
  id?: string;
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
  /** 8 hex: create at this id (Undo on a delete brings it back). */
  id?: string;
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

/** Rows changed per kind by a library-tag rename or delete. */
export interface LibraryTagUpdateCounts {
  modules: number;
  bundles: number;
  templates: number;
}

export interface TemplateRow {
  id: string;
  name: string;
  description: string;
  category_id: string | null;
  tags: string[];
  is_favorite: boolean;
  template_string: string;
  /** The Assembler's negative box (migration 019). `null`/absent = saved
   *  before negatives existed: loading leaves the negative box alone. */
  negative_template?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateListResponse {
  items: TemplateRow[];
  total: number;
}

export interface TemplateCreateInput {
  /** 8 hex: create at this id (Undo on a delete brings it back). */
  id?: string;
  name: string;
  template_string?: string;
  negative_template?: string | null;
  description?: string;
  category_id?: string | null;
  tags?: string[];
  is_favorite?: boolean;
}

export interface TemplateUpdateInput {
  name?: string;
  template_string?: string;
  negative_template?: string | null;
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
  /** Up to 8 variables whose rendered value is returned for each seed (see `tracked`). */
  track?: string[];
  /** Seeds `track` covers, from the first (0..2000, default 1000). */
  track_limit?: number;
}

/** A multi-pick variable keeps its items so `$name.K` can index it. */
export type ScenarioValue = string | { items: string[]; sep: string };

export interface ScenarioTraceWrite {
  variable: string;
  value: ScenarioValue;
  overwrite: boolean;
  /** The joined negatives the variable carries after this write (only when non-empty). */
  negative?: string;
}

/** One negative entry filed under a variable (send-to-negative). `source`
 *  is the binding it came from (or a derivation carrier key / "injector");
 *  `pick` the multi-pick slot, null for the whole value. */
export interface ScenarioNegativeEntry { text: string; pick: number | null; source: string }

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
  /** Each variable's negatives on this seed; absent from older servers. */
  negatives?: Record<string, ScenarioNegativeEntry[]>;
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
  /** Per-seed values of the requested `track` variables (null when none were
   *  asked for); `values[name][i]` belongs to `seeds[i]`, null = unset/failed.
   *  `negatives` is the same per-seed list of each variable's joined negative
   *  ("" = none); absent from older servers. */
  tracked?: {
    seeds: number[];
    values: Record<string, (string | null)[]>;
    negatives?: Record<string, (string | null)[]>;
  } | null;
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

/* ── Backups + server settings ───────────────────────────────────────── */

export type BackupReason = "manual" | "daily" | "pre-migration" | "pre-restore";

export interface BackupEntry {
  name: string;
  size: number;
  /** ISO timestamp (UTC). */
  created_at: string;
  reason: BackupReason;
}

export interface BackupList {
  dir: string;
  backups: BackupEntry[];
  /** Backup name staged to replace the database on the next ComfyUI start. */
  pending_restore: string | null;
}

export interface ServerSettings {
  /** How deep nested @{uuid} references resolve at run time (1–32). */
  max_ref_depth: number;
  backups: {
    enabled: boolean;
    /** Automatic backups kept; manual ones are never pruned. */
    keep: number;
    daily: boolean;
  };
}

export interface ServerSettingsPatch {
  max_ref_depth?: number;
  backups?: Partial<ServerSettings["backups"]>;
}

/* ── AI assistant (/wp/api/ai/*) ──────────────────────────────────────── */

export type AiProviderId = "anthropic" | "openai" | "openrouter" | "ollama" | "lmstudio" | "llamacpp" | "custom";
/** How the embedding server is spoken to ("auto": like the chat server, or
 *  guessed from another address). */
export type AiEmbedApi = "auto" | "ollama" | "openai";

export interface AiPreset {
  label: string;
  api: "anthropic" | "openai" | "ollama";
  /** Runs on the user's machine, so prompts don't leave it. */
  local: boolean;
  needs_key: boolean;
  base_url: string;
  /** The chat server itself can embed (meaning search). */
  embeds: boolean;
  /** An embedding model to suggest, or "". */
  embed_model: string;
  /** What Settings says about embeddings with this provider, or "". */
  embed_note: string;
}

/** The saved AI settings. The key itself is never sent back: `key_set` says
 *  whether one is saved (or comes from the environment, `key_from_env`). */
export interface AiConfig {
  enabled: boolean;
  provider: AiProviderId;
  /** Empty means the preset's address. */
  base_url: string;
  model: string;
  unload_after_s: number;
  /** Most tokens of context a request may ask a local server for. */
  context_max: number;
  /** How much the assistant asks of the model ("auto" reads the name). */
  model_size: "auto" | AiModelSize;
  /** What "auto" picks for the chosen model. */
  model_size_auto: AiModelSize;
  /** How the chat calls tools: native tool calls, the JSON step format, or
   *  automatic (native where the server says the model takes tools). */
  tool_format: AiToolFormat;
  /** "off" asks the server to skip a thinking model's reasoning. */
  thinking: "auto" | "off";
  /** Meaning search: the embedding model ("" = off). */
  embed_model: string;
  /** Where the embedding model runs ("" = the server address). */
  embed_base_url: string;
  embed_api: AiEmbedApi;
  /** A key goes to the embedding server: the chat key (same address) or
   *  one saved for it. */
  embed_key_set: boolean;
  /** A key is saved for the embedding server itself. */
  embed_key_own: boolean;
  /** The chat model runs on this machine or the home network (a local
   *  preset pointed at an internet address is a cloud service). */
  local: boolean;
  key_set: boolean;
  key_from_env: boolean;
  /** A key is saved (or set in the environment) for another address, so it
   *  isn't sent to this one: the host it belongs to. */
  key_for_host: string | null;
  /** Providers that already have a key (saved or from the environment).
   *  Each provider keeps its own address, model and key. */
  keys_saved: AiProviderId[];
  presets: Record<AiProviderId, AiPreset>;
  /** Web search for the chat ("off" by default). */
  search_engine: AiSearchEngineId | "off";
  /** The SearXNG address. */
  search_url: string;
  /** Engines with a key saved for their own address. Never the keys. */
  search_keys_saved: AiSearchEngineId[];
  search_engines: Record<AiSearchEngineId, { label: string; needs_key: boolean }>;
  /** How read_result fetches a page from an allowed search ("off" stops it). */
  reader_engine: AiReaderId | "off";
  /** The Crawl4AI / Firecrawl address ("" = Firecrawl's hosted API). */
  reader_url: string;
  reader_keys_saved: AiReaderId[];
  reader_engines: Record<AiReaderId, {
    label: string; needs_key: boolean; needs_url: boolean; base_url: string;
  }>;
  /** The Danbooru tag lookup (wiki, aliases, related tags). Off by default. */
  danbooru_lookup: boolean;
  /** Web searches, page reads and Danbooru lookups run without asking. */
  web_always_allow: boolean;
  /** The chat may propose deleting items, categories and tags (each card
   *  still needs its own confirm). Off by default. */
  allow_delete: boolean;
  /** Small changes (descriptions, tags, categories) from the chat apply
   *  without a click, and can be undone. Off by default. */
  auto_apply: boolean;
}

export type AiSearchEngineId = "searxng" | "brave" | "tavily" | "kagi";
export type AiReaderId = "builtin" | "crawl4ai" | "firecrawl";

export type AiModelSize = "small" | "medium" | "large";
export type AiToolFormat = "auto" | "native" | "json";

export interface AiConfigPatch {
  enabled?: boolean;
  provider?: AiProviderId;
  base_url?: string;
  model?: string;
  unload_after_s?: number;
  context_max?: number;
  model_size?: "auto" | AiModelSize;
  tool_format?: AiToolFormat;
  thinking?: "auto" | "off";
  embed_model?: string;
  embed_base_url?: string;
  embed_api?: AiEmbedApi;
  /** Write-only, bound to the embedding server's address. `""` removes it. */
  embed_api_key?: string;
  /** Write-only. `""` removes the saved key. */
  api_key?: string;
  search_engine?: AiSearchEngineId | "off";
  search_url?: string;
  /** Write-only, for the chosen engine. `""` removes it. */
  search_key?: string;
  reader_engine?: AiReaderId | "off";
  reader_url?: string;
  /** Write-only, for the chosen page reader. `""` removes it. */
  reader_key?: string;
  danbooru_lookup?: boolean;
  web_always_allow?: boolean;
  allow_delete?: boolean;
  auto_apply?: boolean;
}

export interface AiTestResult {
  ok: boolean;
  models: string[];
  /** `null` when no model is chosen yet. */
  model_found: boolean | null;
  json_ok: boolean | null;
  latency_ms: number | null;
  /** The context a local server loaded the model with, when it says. */
  context: number | null;
  /** True when that is too small for the assistant's instructions. */
  context_low: boolean;
  error: string | null;
  /** The embedding model's check, when meaning search is on. `swapped`:
   *  Ollama unloaded the chat model to load it. */
  embed?: { ok: boolean; dims: number | null; error: string | null; swapped: boolean } | null;
  /** What a new chat sends before its first message (instructions, `tools`
   *  tool declarations, library summary), in tokens, fitted to `window`;
   *  `lean` is how far it was cut down (0 = not at all). `parts` splits
   *  `tokens` (`tools` is 0 in JSON mode, where the tools are listed in the
   *  instructions); `split`: steps are asked in two parts (small and medium
   *  models). */
  prefix?: {
    tokens: number; window: number; tools: number; lean: number; format: string;
    parts?: { instructions: number; tools: number; library: number };
    fits?: boolean; size?: string; split?: boolean;
  } | null;
}

/** The chat's library index (`GET /wp/api/ai/index`). */
export interface AiIndexStatus {
  /** False when ComfyUI's Python has no SQLite full-text search. */
  available: boolean;
  items: number;
  embed_model: string | null;
  /** Items with a vector from that model. */
  vectors: number;
  /** Vectors are being made right now. */
  filling: boolean;
}

/** One earlier turn of an AI conversation, sent back with a follow-up so the
 *  model refines its last answer instead of starting over. */
export interface AiTurn {
  instruction: string;
  /** The model's raw answer for that turn (each result's `answer`). */
  answer: Record<string, unknown>;
  /** What the user did with it, e.g. which items they kept. */
  note?: string;
}

/** Fields every AI drafting request and result share. */
export interface AiConversational {
  /** Earlier turns, oldest first; `instruction` is then the follow-up. */
  history?: AiTurn[];
  /** Reference images (shrunk data URLs) sent with the newest message. */
  images?: string[];
  /** Web results the user allowed in this conversation
   *  (`api.ai.packSearch`), sent with every later request. */
  web?: AiWebResult[];
  /** Searches already run or skipped in this conversation: the model isn't
   *  offered them again. */
  searched?: string[];
  /** The user skipped the last answer's searches (sent once). */
  skipped?: boolean;
}

export interface AiWebResult {
  query: string;
  text: string;
}

export interface AiDraftOption {
  value: string;
  weight: number;
  tags: string[];
  negative: string;
}

export interface AiWildcardDraftRequest extends AiConversational {
  instruction: string;
  count: number;
  wildcard: {
    name: string;
    var_binding: string;
    /** What the wildcard is for: its description and library tags. */
    description?: string;
    tags?: string[];
    payload: {
      options: Array<{ value: string }>;
      sub_categories: string[];
      tag_groups?: Record<string, string[]>;
      tag_group_kinds?: Record<string, "accepts">;
    };
  };
}

/** A tag group the draft adds or extends: `tags` go into group `name`
 *  (created when new); `kind` "accepts" makes it an accepts group. */
export interface AiDraftGroup {
  name: string;
  kind: "classify" | "accepts";
  tags: string[];
}

export interface AiWildcardDraftResult {
  options: AiDraftOption[];
  /** Tags the draft uses that the wildcard doesn't have yet. */
  new_tags: string[];
  /** Tag groups the request asked for (older servers leave it out). */
  groups?: AiDraftGroup[];
  skipped: Array<{ text: string; reason: string }>;
  model: string;
  /** The model's raw answer, for a follow-up's `history`. */
  answer: Record<string, unknown>;
  /** Web searches the model would like to run (only when web search is set
   *  up); the panel asks the user before running them. */
  research?: string[];
}

export type AiWildcardEditAction = "remove" | "rewrite" | "retag" | "reweight";

export interface AiWildcardEditRequest extends AiConversational {
  action: AiWildcardEditAction;
  instruction: string;
  wildcard: {
    name: string;
    var_binding: string;
    /** What the wildcard is for: its description and library tags. */
    description?: string;
    tags?: string[];
    payload: {
      /** The rows to edit (whole list or the selection), with real ids. */
      options: Array<{ id: string; value: string; weight: number; sub_categories: string[]; is_null?: boolean }>;
      sub_categories: string[];
      tag_groups?: Record<string, string[]>;
    };
  };
}

/** One proposed change. `after` is null for a removal. */
export interface AiWildcardEditChange {
  option_id: string;
  before: { value?: string; tags?: string[]; weight?: number };
  after: { value?: string; tags?: string[]; weight?: number } | null;
  reason?: string;
}

export interface AiWildcardEditResult {
  action: AiWildcardEditAction;
  changes: AiWildcardEditChange[];
  new_tags: string[];
  skipped: Array<{ text: string; reason: string }>;
  model: string;
  /** The model's raw answer, for a follow-up's `history`. */
  answer: Record<string, unknown>;
  /** Web searches the model would like to run (only when web search is set
   *  up); the panel asks the user before running them. */
  research?: string[];
}

export interface AiDerivationDraftRequest extends AiConversational {
  instruction: string;
  derivation: { name: string; description?: string; tags?: string[]; rules: DerivationRule[] };
}

export interface AiDerivationDraftRule {
  rule: DerivationRule;
  summary: string;
  /** Things that work but look wrong: a variable nothing sets, an option
   *  the wildcard doesn't have. */
  warnings: string[];
}

export interface AiDerivationDraftResult {
  rules: AiDerivationDraftRule[];
  skipped: Array<{ text: string; reason: string }>;
  model: string;
  /** The model's raw answer, for a follow-up's `history`. */
  answer: Record<string, unknown>;
}

export interface AiConstraintDraftRequest extends AiConversational {
  instruction: string;
  constraint: {
    name?: string;
    description?: string;
    tags?: string[];
    source_wildcard_id: string;
    target_wildcard_id: string;
    matrix: ConstraintMatrix;
    exceptions: ConstraintException[];
  };
}

export interface AiConstraintCellDraft {
  source_tag: string;
  target_tag: string;
  cell: ConstraintCell;
  reason: string;
  /** The constraint already has a rule for this tag pair. */
  replaces: boolean;
}

export interface AiConstraintExceptionDraft {
  exception: ConstraintException;
  reason: string;
  /** "#tag → option" when the model's rule named a tag on one side and
   *  was expanded into one exception per option; "" otherwise. */
  from: string;
  replaces: boolean;
}

export interface AiConstraintDraftResult {
  cells: AiConstraintCellDraft[];
  exceptions: AiConstraintExceptionDraft[];
  skipped: Array<{ text: string; reason: string }>;
  model: string;
  /** The model's raw answer, for a follow-up's `history`. */
  answer: Record<string, unknown>;
}

export type AiDescribeKind =
  | "wildcard" | "fixed_values" | "combine" | "derivation" | "constraint" | "bundle" | "template";

export interface AiDescribeRequest extends AiConversational {
  kind: AiDescribeKind;
  name: string;
  description: string;
  tags: string[];
  /** What the editor holds now: a module payload, a bundle's children or a
   *  template's text. */
  payload: unknown;
  hint?: string;
}

export interface AiDescribeResult {
  description: string;
  /** `new`: nothing in the library uses it yet. `has`: the item already has it. */
  tags: Array<{ tag: string; new: boolean; has: boolean }>;
  model: string;
  /** The model's raw answer, for a follow-up's `history`. */
  answer: Record<string, unknown>;
}

export interface AiOrganizeRequest extends AiConversational {
  items: Array<{ kind: "module" | "bundle"; id: string }>;
  /** Optional steer ("split by subject"). */
  instruction?: string;
}

export interface AiOrganizeChange {
  kind: "module" | "bundle";
  id: string;
  name: string;
  /** Module type, or "bundle". */
  type: string;
  /** `id` is null for a category the library doesn't have yet. */
  category: { name: string; new: boolean; id: string | null } | null;
  tags_add: Array<{ tag: string; new: boolean }>;
  tags_remove: string[];
  rating: "safe" | "nsfw" | null;
  reason: string;
  before: { category: string; tags: string[]; rating: "safe" | "nsfw" };
}

export interface AiOrganizeResult {
  /** Only items with something to change. */
  changes: AiOrganizeChange[];
  new_categories: string[];
  skipped: Array<{ text: string; reason: string }>;
  /** How many items the model looked at. */
  count: number;
  model: string;
  /** The model's raw answer, for a follow-up's `history`. */
  answer: Record<string, unknown>;
}

/** One message of an assistant chat. Assistant messages carry the reply
 *  plus a line per proposal saying what the user did with it. */
/** The item open in an editor, as it stands (unsaved changes included). */
export interface AiChatEditorState {
  id: string;
  /** A new item, not saved yet: `id` is reserved for it and `type` says
   *  what it is (the server has no row to read either from). */
  new?: true;
  type?: string;
  name: string;
  description: string;
  tags: string[];
  category_id: string | null;
  content_rating: "safe" | "nsfw";
  /** Absent for editors that only share the item's info. */
  payload?: Record<string, unknown>;
  dirty: boolean;
}

/** Where the user is and what they see, so "this" means what's on screen. */
export interface AiChatPage {
  route: string;
  id?: string;
  /** Docs page id on a docs page. */
  doc?: string;
  /** A short description of what the page shows (filters, selection, results). */
  note?: string;
  editor?: AiChatEditorState;
}

/** What the user did with a proposal card since the last message. */
/** The user used one of a card's own fixes (`AiCardFix.key`). */
export interface AiChatFixEvent {
  pid: string;
  fix: string;
  /** The fix's label, for the line the model reads. */
  label?: string;
}

export interface AiChatStatusEvent {
  pid: string;
  status: "applied" | "editor" | "dismissed" | "undone" | "failed" | "opened" | "replaced";
  /** The row an applied create made, so a reopened chat can Open it. */
  created?: string;
  /** Options the user unticked on the card before applying it. */
  left_out?: number;
}

export type AiChatEvent = AiChatStatusEvent | AiChatFixEvent;

/** One chat turn. The server keeps the chat: send only the new message and
 *  the `chat_id` it returned (none starts a new chat). */
export interface AiChatRequest {
  message: string;
  chat_id?: string;
  page?: AiChatPage;
  events?: AiChatEvent[];
  /** Images as data URLs (`utils/chat-image.ts` shrinks them first). */
  images?: Array<{ data: string }>;
}

/** Run the chat's last message again: its answer is dropped first. A
 *  non-empty `message` replaces the message (the user edited it). */
export interface AiChatRetry {
  chat_id: string;
  retry: true;
  message: string;
  page?: AiChatPage;
  events?: AiChatEvent[];
}

/** The browser's answer to one call a paused turn waits on: what a page
 *  tool did, that the user said no, or (web search) that they allowed it. */
export type AiCallAnswer =
  | { id: string; text: string }
  | { id: string; denied: true }
  | { id: string; approve: "once" | "chat" }
  | { id: string; answers: AiAskAnswer[] };

/** One answer of an `ask` question, as the server checked it. */
export interface AiAskChoice {
  label: string;
  hint?: string;
}

/** One question the model asked (`engine/ai/ask.py`). */
export interface AiAskQuestion {
  header: string;
  question: string;
  multi: boolean;
  choices: AiAskChoice[];
}

/** The user's answer to question `q` (numbers count from 0): the choices
 *  picked, their own words, or "decide for me". Only numbers go back; the
 *  server reads the labels from the call it stored. */
export type AiAskAnswer =
  | { q: number; picked: number[] }
  | { q: number; other: string }
  | { q: number; decide: true };

/** What an answered ask shows: each header with its answer, or that the
 *  user answered in their next message instead. */
export interface AiAskAnswered {
  answers?: Array<{ header: string; answer: string }>;
  own?: boolean;
}

/** Carries a paused turn on once its calls are answered. */
export interface AiChatResume {
  chat_id: string;
  results: AiCallAnswer[];
  page?: AiChatPage;
  events?: AiChatEvent[];
}

/** A call the turn waits on: a page tool for the browser to run, or a web
 *  search for the user to allow. Args were checked by the server. */
export type AiPendingCall =
  | { id: string; tool: "open"; label: string;
      args: { doc: string } | { page: string; section?: string } | { id: string; type: string }
        | { proposal: string } }
  | { id: string; tool: "read_page"; label: string; args: { within?: string } }
  | { id: string; tool: "highlight"; label: string;
      args: { points: Array<{ anchor: string; caption: string; text?: string }> }
        | { anchor: string; caption: string } }
  | { id: string; tool: "select_rows"; label: string; args: { ids: string[] } }
  | { id: string; tool: "organize"; label: string; args: { ids: string[]; note: string } }
  | { id: string; tool: "draft_options"; label: string;
      args: { id: string; instruction: string; count: number } }
  | { id: string; tool: "show_test"; label: string; args: AiShowTestArgs }
  | { id: string; tool: "use_panel"; label: string;
      args: { id: string; type: string; panel: string; request: string } }
  | { id: string; tool: "web_search"; label: string; args: { query: string } }
  | { id: string; tool: "read_result"; label: string; args: { url: string } }
  | { id: string; tool: "danbooru"; label: string; args: { tag: string } }
  | { id: string; tool: "ask"; label: string;
      args: { questions: AiAskQuestion[]; settled?: string[] } };

/** One "worked on" line; a run_test step carries its run as a card. */
export interface AiChatStep {
  tool: string;
  note: string;
  ok: boolean;
  /** What the model said before calling its tools (`note` is the text). */
  say?: boolean;
  /** What the model thought in that step (its reasoning, or a JSON-mode
   *  step's plan): shown folded as "Thinking". */
  think?: boolean;
  card?: AiTestCard;
}

/** A run_test as data (`chat_tools._test_card`). `was` is the share before
 *  the proposed changes, when the run compared them. */
export interface AiTestCard {
  kind: "test";
  runs: number;
  failed: number;
  compared: boolean;
  seeds: number;
  /** The saved items of the run, for "Open in Test Runner". */
  stack: Array<{ module: string } | { bundle: string }>;
  pins?: Record<string, string>;
  vars: Array<{ name: string; distinct: number; internal?: boolean;
    tops: Array<{ v: string; pct: number; was?: number }> }>;
  never: Array<{ name: string; values: string[]; more: number }>;
  warnings: Array<{ text: string; count: number }>;
  prompts: Array<{ p: string; n?: string }>;
}

/** What the chat's `show_test` sets up in the Test Runner. Everything past
 *  `stack` and `seeds` is optional (older stored calls carry only those). */
export interface AiShowTestArgs {
  stack: ScenarioStackItem[];
  seeds: number;
  /** Run consecutive seeds from here instead of random ones. */
  from?: number;
  /** Variables set from outside, like an Injector. */
  pins?: Record<string, string>;
  /** The variable the results show first. */
  output?: string;
  /** Save the scenario under this name after it runs. */
  save?: string;
  /** Set it up without running. */
  run?: boolean;
}

/** Tokens the last model step used, as the provider reported them. */
export interface AiChatUsage {
  prompt?: number;
  /** Prompt tokens the provider reused from its cache. */
  cached?: number;
  /** Ollama: prompt tokens it had to read (the rest came from its cache). */
  evaluated?: number;
  output?: number;
  /** The answer stopped at the output limit. */
  cut?: boolean;
}

export type AiChatOp =
  | { op: "create"; kind: "module"; new_category: string; body: ModuleCreateInput }
  | { op: "create"; kind: "bundle"; new_category: string; body: BundleCreateInput }
  | { op: "create"; kind: "template"; new_category: string; body: TemplateCreateInput }
  | {
      op: "update"; kind: "module" | "bundle" | "template"; type: string; id: string;
      name: string; body: ModuleUpdateInput & BundleUpdateInput & TemplateUpdateInput;
      before: ModuleUpdateInput & BundleUpdateInput & TemplateUpdateInput;
      new_category?: string;
      /** "editor": built on the open editor's unsaved version; goes into it. */
      basis?: "editor";
    }
  | { op: "open"; kind: "module" | "bundle" | "template"; type: string; id: string }
  | { op: "open"; kind: "doc"; type: "doc"; id: string }
  | { op: "open"; kind: "page"; type: "page"; id: string; section?: string }
  /** Hands a description to the Pack builder, which plans the pack. */
  | { op: "open"; kind: "pack"; type: "pack"; id: string; description: string }
  | {
      op: "categories"; kind: "categories"; create: string[];
      rename: Array<{ id: string; from: string; to: string }>;
      /** Colors and icons: on a new category by name; on one that exists
       *  by id, with what it had for Undo. */
      styles?: Array<{
        name: string; id?: string; color?: string; icon?: string;
        before?: { color: string | null; icon: string | null };
      }>;
    }
  /** One change to many items (`update_many`). `to_new`: into the
   *  category the card creates (`new_category`). */
  | {
      op: "bulk"; kind: "bulk"; new_category: string;
      items: Array<{
        kind: "module" | "bundle" | "template"; id: string; name: string; to_new?: boolean;
        body: { category_id?: string | null; tags?: string[]; content_rating?: "safe" | "nsfw" };
        before: { category_id?: string | null; tags?: string[]; content_rating?: string };
      }>;
    }
  | {
      op: "tags"; kind: "tags";
      /** `members`: each item that has `from`, with its tags before. */
      rename: Array<{ from: string; to: string; merge: boolean; members: AiTagMember[] }>;
    }
  /** Needs Settings › AI assistant › "Let the assistant delete items" and
   *  a confirm on the card. Undo creates the items again at their ids. */
  | {
      op: "delete"; kind: "delete";
      items: Array<{
        kind: "module" | "bundle" | "template"; type: string; id: string; name: string;
        row: Record<string, unknown>;
      }>;
      categories: Array<{
        id: string; name: string; color: string | null; icon: string | null;
        sort_order: number; members: Array<{ kind: "module" | "bundle" | "template"; id: string }>;
      }>;
      tags: Array<{ tag: string; members: AiTagMember[] }>;
    };

/** An item a tag change touches, with its tags as they were. */
export interface AiTagMember {
  kind: "module" | "bundle" | "template";
  id: string;
  tags: string[];
}

/** A change the assistant proposes. Nothing is saved until Apply. */
export interface AiChatProposal {
  pid: string;
  tool: string;
  title: string;
  summary: string;
  preview: string[];
  warnings: string[];
  /** The proposal this one builds on (same item); apply that first. */
  after: string | null;
  /** Every card this one points at (a constraint between two new
   *  wildcards needs both); `after` is the last of them. */
  needs?: string[];
  /** Names of the items the card points at, by id (a constraint's source
   *  and target, proposed ones too). */
  names?: Record<string, string>;
  /** An earlier answer's unapplied card this one replaces (an edit of an
   *  item that card would create). */
  replaces?: string;
  op: AiChatOp;
  /** "low": the server judged it small (descriptions, tags, categories),
   *  so auto-apply may apply it. */
  risk?: "low";
  /** Warnings (some of `warnings`) that only inform: what was kept, what
   *  to apply first. They get no Ask to fix. */
  notes?: string[];
  /** Warnings the card can fix by itself (`engine/ai/lint.py::fixes`);
   *  the rest are fixed by asking the model. */
  fixes?: AiCardFix[];
}

export interface AiCardFix {
  /** The warning (one of `warnings`) this fixes. */
  warning: string;
  key: string;
  label: string;
}

export interface AiChatResult {
  chat_id: string;
  message: string;
  proposals: AiChatProposal[];
  /** What the model looked at or tried, for the "worked on" lines. */
  steps: AiChatStep[];
  model: string;
  /** How this chat calls tools. */
  format?: "native" | "json";
  /** Tool calls this answer made, and how many of them the server rescued
   *  from text (a native-mode model that wrote its calls out). */
  tool_use?: { calls: number; salvaged: number };
  usage?: AiChatUsage;
  /** [[Name]] mentions in `message` that name a real item. */
  refs?: Record<string, AiChatRef>;
  /** Calls the turn waits on; answer them with `AiChatResume`. */
  pending?: AiPendingCall[];
  /** A reopened chat: what the user answered to this answer's `ask`
   *  questions, by call id. */
  answered?: Record<string, AiAskAnswered>;
  /** How full the model's window is, for the meter. */
  context?: AiChatContext;
  /** An emoji on the user's message (the model's `react`, or a thanks). */
  reaction?: string;
  /** The message was only thanks: it got `reaction` and no answer. */
  aside?: boolean;
}

/** The meter: tokens the last request used against what the model holds.
 *  `estimated` when the provider gave no count; `about` when the window is
 *  a cloud model's usual size rather than one the server reported. */
export interface AiChatContext {
  used: number;
  window: number;
  estimated: boolean;
  about: boolean;
  /** How many times older turns were summarised. */
  compactions: number;
}

/** A stored chat in the list. Times are ISO strings. */
export interface AiChatSummary {
  id: string;
  title: string;
  pinned: boolean;
  turns: number;
  created_at: string;
  updated_at: string;
}

/** One turn of a reopened chat, as the user saw it. */
export type AiChatTurn =
  | { role: "user"; text: string; images?: string[]; reaction?: string; aside?: boolean }
  | {
      role: "assistant";
      view: Omit<AiChatResult, "chat_id">;
      status: Record<string, "applied" | "editor" | "dismissed" | "failed">;
      created: Record<string, string>;
    };

export interface AiChatDetail {
  id: string;
  title: string;
  pinned: boolean;
  updated_at: string;
  model?: string;
  turns: AiChatTurn[];
  /** The chat paused on a page tool or search when it was left. */
  waiting: boolean;
  context: AiChatContext;
}

/** What a streamed chat turn sends while the model works. */
export type AiChatStreamEvent =
  | { type: "step"; n?: number }
  | { type: "status"; v: string }
  | { type: "thinking" }
  | { type: "text"; v: string }
  | { type: "tool"; step: AiChatStep }
  | { type: "done"; result: AiChatResult }
  | { type: "error"; status: number; message: string };

/** A library item an assistant message mentions. */
/** An item an answer mentions. `shared`: that many items have this name
 *  and the answer didn't say which, so the chip opens nothing. */
export interface AiChatRef {
  id: string; type: string; name: string; shared?: string;
  /** The card (pid) that creates it: not in the library yet. */
  pending?: string;
}

/* ── Pack builder ───────────────────────────────────────────────────── */

/** `library`: a wildcard or fixed values the user already has, used as it is. */
export type AiPackKind =
  | "wildcard" | "library" | "fixed_values" | "derivation" | "combine" | "constraint"
  | "template";

export interface AiPackItem {
  key: string;
  /** The module id reserved for it when the plan was made (a library
   *  item's is the library row's), so refs and rules can point at it
   *  before it is built. */
  id: string;
  kind: AiPackKind;
  name: string;
  /** The variable it sets ("" for constraints and the template). */
  var: string;
  /** The sub-bundle it goes in ("" for the pack bundle itself). */
  section: string;
  about: string;
  /** Options to write (wildcards only). */
  count: number;
  /** Option tags (wildcards only). */
  tags: string[];
  /** A constraint's two wildcards, by variable. */
  source: string;
  target: string;
  /** Per-use settings on the bundle ("pick 2-3; hold"), or "". */
  use: string;
  /** The library row a `library` item uses ("" otherwise). */
  library_id: string;
  /** That row's type: "wildcard" or "fixed_values". */
  library_type: string;
  /** Already in the bundle "Extend with AI" adds to: shown, never built
   *  into it again, not editable here. */
  existing?: boolean;
}

/** A value the pack reads but doesn't set: a WP Context Injector row. */
export interface AiPackInput {
  var: string;
  about: string;
  /** What the check pins it to. */
  example: string;
}

/** What the user picks before planning; every plan request carries them. */
export interface AiPackSettings {
  /** reuse: library items that fit go in as they are; inspire: everything
   *  new, written like the library; new: ignore the library. */
  library: "reuse" | "inspire" | "new";
  /** auto: a standing negative plus option negatives where they help. */
  negatives: "auto" | "template" | "none";
  /** sections: a sub-bundle per section inside the pack bundle. */
  structure: "sections" | "flat";
  style: "auto" | "tags" | "sentences";
  rating: "auto" | "safe" | "nsfw";
  /** Options per wildcard, 0 for the planner's choice. */
  count: number;
  /** family: quality and negative tags per $model_variant (WP Model Info). */
  model: "any" | "family";
  /** on: an NSFW pack's template negative gets the youth block (child,
   *  loli, …); off: nothing is added. */
  youth_negative: "on" | "off";
  /** graph: the model writes slots, axes and relations and the code wires
   *  the pack; items: the model writes every item and payload itself. */
  planner: "graph" | "items";
}

/** One way a slot's options are sorted, for a relation to key on. */
export interface AiPackAxis {
  name: string;
  /** Tags (lowercase words). */
  values: string[];
}

/** One choice the image makes: one wildcard, one variable. */
export interface AiPackSlot {
  name: string;
  var: string;
  /** What its options are (one concept). */
  what: string;
  section: string;
  count: number;
  /** prompt: the template reads it; internal: a driver rules need. */
  show: "prompt" | "internal";
  /** "" for one pick, "2" or "2-3" for several. */
  pick: string;
  hold: boolean;
  /** Percent of runs that get nothing (0 = never). */
  sometimes_none: number;
  axes: AiPackAxis[];
  /** The axis this slot IS (a Season slot with axis season): its options
   *  are the axis values, written by the code. "" otherwise. */
  self_axis?: string;
}

export interface AiPackFixed {
  name: string;
  var: string;
  text: string;
  negative: string;
}

export type AiPackRelationKind = "exclude" | "only" | "boost" | "reduce" | "agree" | "accepts" | "derive" | "append";

/** One side of a relation: a slot, and the axis value it keys on ("" on
 *  an agree / accepts side, which names only the shared axis). */
export interface AiPackRelationSide {
  slot: string;
  axis: string;
  value: string;
}

/** How one slot's pick changes another's odds, or writes text. The code
 *  compiles each (source, target) pair into one constraint and each
 *  written variable into one derivation. */
export interface AiPackRelation {
  kind: AiPackRelationKind;
  from: AiPackRelationSide;
  /** The target (not on derive / append). */
  to?: AiPackRelationSide;
  /** agree / accepts: the axis values both slots share. */
  values?: string[];
  /** boost / reduce. */
  factor?: number;
  /** derive / append: the variable written and the text. */
  var?: string;
  text?: string;
  /** derive: the text for every other pick ("" leaves it unset). */
  otherwise?: string;
  /** What the relation is about, as an option says it ("sandals"): the
   *  target slot must hold options saying them, and the check reads the
   *  prompts for them. */
  words?: string[];
}

export interface AiPackGraphTemplate {
  lead: string;
  /** Variables in reading order. */
  order: string[];
  tail: string;
  negative: string;
}

/** The pack as the graph planner writes it: the code compiles it into the
 *  plan's items and writes every payload but the slots' options. */
export interface AiPackGraph {
  title: string;
  summary: string;
  design: string;
  rating: "safe" | "nsfw";
  style: "tags" | "sentences";
  model: string;
  anchor: string;
  questions: AiPackQuestion[];
  assumptions: string[];
  from_images: string[];
  research: string[];
  run: AiPackRun;
  inputs: AiPackInput[];
  sections: AiPackSection[];
  slots: AiPackSlot[];
  fixed: AiPackFixed[];
  relations: AiPackRelation[];
  template: AiPackGraphTemplate;
  /** Relations the model wrote that named nothing the graph declares. */
  dropped?: string[];
}

export interface AiPackRun {
  mode: "single" | "story" | "sweep";
  /** Frames of the Loop a story runs over (2–12); 0 otherwise. */
  frames: number;
}

export interface AiPackQuestion {
  /** A short label ("Outfits"). */
  header: string;
  question: string;
  /** More than one choice may be picked. */
  multi: boolean;
  choices: string[];
}

/** A question the user already answered; never asked again. */
export interface AiPackDecision {
  question: string;
  answer: string;
}

export interface AiPackSection {
  name: string;
  about: string;
}

export interface AiPackDropped {
  kind: "constraint";
  name: string;
  source: string;
  target: string;
  about: string;
  why: string;
}

export interface AiPackPlan {
  title: string;
  summary: string;
  /** How the pack fits together: what decides what, and why each rule is there. */
  design?: string;
  rating: "safe" | "nsfw";
  /** How every option is written: Danbooru-style tags or natural phrases. */
  style: "tags" | "sentences";
  /** The image model family the pack targets, or "". */
  model: string;
  /** The variable the other picks follow, or "". */
  anchor: string;
  questions: AiPackQuestion[];
  /** What the planner guessed instead of asking. */
  assumptions: string[];
  /** What the planner took from the reference images (none without). */
  from_images?: string[];
  /** Web searches the planner would like to run (needs the user's OK). */
  research: string[];
  decisions: AiPackDecision[];
  settings: AiPackSettings;
  /** How the pack runs, read from the request: single images, a story a
   *  WP Context Loop plays over `frames` frames ($beat from $iteration),
   *  or a sweep sheet. */
  run?: AiPackRun;
  inputs: AiPackInput[];
  sections: AiPackSection[];
  items: AiPackItem[];
  /** What the checker left out of the model's plan. */
  warnings: string[];
  /** Constraints the checker had to leave out (a side isn't a wildcard),
   *  kept until one between the same variables is planned; the plan review
   *  and the check both report them. */
  dropped?: AiPackDropped[];
  /** "Extend with AI": the bundle the plan adds to. */
  base?: { id: string; name: string; nested: boolean; sets: string[] };
  /** Variables the user's open canvas sets (Injector rows, the Loop). */
  canvas?: AiCanvasVar[];
  /** The graph the items were compiled from (graph planner): hand edits
   *  change it, and the server compiles the items again. */
  graph?: AiPackGraph;
}

/** A variable an open ComfyUI canvas sets at run time, as the canvas tab
 *  reports it to the manager (`utils/canvas-facts.ts`). */
export interface AiCanvasVar {
  name: string;
  source: "injector" | "loop" | "model";
  about?: string;
}

export interface AiPackPlanRequest extends AiConversational {
  instruction: string;
  /** A prompt the user likes, to rebuild as a pack. */
  sample?: string;
  settings?: AiPackSettings;
  decisions?: AiPackDecision[];
  /** The plan as the user sees it now (hand edits included). */
  previous?: AiPackPlan;
  /** Reference images (JPEG data URLs), for a vision model. A follow-up
   *  sends them only when they changed or the user asked to. */
  images?: string[];
  /** A follow-up: how many images went with the first request. */
  image_count?: number;
  /** Search results the user allowed, for the planner to use. */
  web?: Array<{ query: string; text: string }>;
  /** Searches already run or skipped, never asked for again. */
  searched?: string[];
  /** "Extend with AI": the bundle the plan adds to. */
  bundle_id?: string;
}

/** A change a finding can make to the plan without the model. */
export type AiPackPatch = (
  | { op: "edit"; key: string; set: Partial<Omit<AiPackItem, "key" | "id">> }
  | { op: "add"; item: Partial<AiPackItem> & { kind: AiPackKind } }
  | { op: "remove"; key: string }
  /** A plan-wide field, e.g. pointing a stray anchor at a set variable. */
  | { op: "plan"; set: Partial<Pick<AiPackPlan, "anchor" | "inputs" | "run">> }
) & {
  /** The button's words when the server picked them ("Use $scene"). */
  label?: string;
};

/** One thing the plan review found. `fix`: it would break the pack or
 *  leave a rule doing nothing; `tip`: it would make prompts more coherent. */
export interface AiPackFinding {
  id: string;
  /** The plan item it is about, or "" for the whole pack. */
  key: string;
  level: "fix" | "tip";
  text: string;
  /** "model" when the model's review found it. */
  by?: "model";
  patch?: AiPackPatch;
}

export interface AiPackPlanResult {
  plan: AiPackPlan;
  model: string;
  answer: Record<string, unknown>;
  /** The plan checked against the guide. */
  review: AiPackFinding[];
  /** Web search is set up, so research can run. */
  web?: boolean;
  /** About how much of the model's window the request and its answer took. */
  context?: Pick<AiChatContext, "used" | "window" | "estimated" | "about">;
  /** What the model thought while planning, when its server sends it. */
  thinking?: string;
}

export interface AiPackReview {
  findings: AiPackFinding[];
  /** The findings as a refine request for the planner. */
  note: string;
  /** The plan as the server reads it. */
  plan: AiPackPlan;
}

export interface AiPackChangeResult {
  plan: AiPackPlan;
  review: AiPackFinding[];
  model: string;
}

/** Built items by plan key. A template's payload is
 *  `{template_string, negative_template}`. */
export type AiPackBuilt = Record<string, { id: string; payload: Record<string, unknown> }>;

export interface AiPackItemResult {
  key: string;
  id: string;
  kind: AiPackKind;
  payload: Record<string, unknown>;
  preview: string[];
  warnings: string[];
  /** Warnings worth one automatic rebuild, as its note ("" when none). */
  repair: string;
  model: string;
  /** What the model thought while building it, when its server sends it. */
  thinking?: string;
}

export interface AiPackCheck {
  runs: number;
  failed: number;
  /** What went wrong, by item key. */
  problems: Record<string, string[]>;
  notes: string[];
  variables: Array<{ var: string; distinct: number; top: Array<{ value: string; share: number }> }>;
  prompts: Array<{ seed: number; text: string; negative: string }>;
  /** Variety advice: options never picked, too few distinct values, one
   *  value taking most runs. */
  quality: Array<{ key: string; text: string }>;
  /** Item keys in the order they run (and install). */
  order?: string[];
  /** A graph plan's relations as the check verified them on engine runs
   *  (boost / reduce are odds, so `checked` is false for them). */
  relations?: Array<{ text: string; kind: string; checked: boolean; seen: number; broken: number; holds: boolean }>;
  /** Distinct prompts over the check's runs ÷ runs. */
  distinct?: number;
  /** Items the check fixed without the model (words the prompt said twice,
   *  pieces another wildcard picks): their new payload and preview, and the
   *  lines to add to their warnings. The report was run on these. */
  tidied?: Record<string, { payload: Record<string, unknown>; preview: string[]; warnings: string[] }>;
}

export interface AiPackInstallResult {
  undo_entry_id: string;
  ids: Record<string, string>;
  bundle_id: string;
  /** One per section: the bundles inside the pack bundle. */
  sub_bundles: Array<{ id: string; name: string }>;
  template_id: string;
  tag: string;
  /** How to wire the pack on the canvas. */
  notes: string[];
}

/** One sub-bundle the AI suggests: children `start`..`end` (inclusive,
 *  neighbours, so the run order never changes). */
export interface AiBundleSplitGroup {
  name: string;
  about: string;
  start: number;
  end: number;
}

export interface AiTextDraftRequest extends AiConversational {
  kind: "fixed_values" | "combine" | "template";
  instruction: string;
  item: {
    id?: string;
    name: string;
    description?: string;
    tags?: string[];
    payload?: Record<string, unknown>;
    template_string?: string;
    negative_template?: string;
  };
}

/** Fixed values: the whole value list. Combine: its payload. Template:
 *  `{template_string, negative_template}`. */
export interface AiTextDraftResult {
  payload: Record<string, unknown>;
  preview: string[];
  warnings: string[];
  model: string;
  answer: Record<string, unknown>;
  /** Web searches the model would like to run (only when web search is set
   *  up); the panel asks the user before running them. */
  research?: string[];
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
