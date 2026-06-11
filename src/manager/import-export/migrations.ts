/**
 * Versioned migration chain for import payloads.
 *
 * Two distinct migration domains live in this file:
 *
 *   1. `migrateImportEnvelope` — operates on the FULL multi-row import
 *      envelope (`RawPayload` with `bundles[]`, `wildcards[]`, etc).
 *      Used by the manual JSON-paste importer in `parse.ts`.
 *
 *   2. `migratePayload` — operates on a SINGLE ROW (a module or bundle
 *      dict). Per spec §2: forward-only chain with registry-keyed
 *      dispatch by (kind, fromVersion); context is opt-in via
 *      `requiresContext`; bundle migrators recurse into children via
 *      the `applyModuleStep` helper enforcing the
 *      single-version-per-root invariant.
 *
 * Adding a new schema version:
 *   1. Bump CURRENT_SCHEMA_VERSION below.
 *   2. For envelope-shape entities, add a function `migrateVNToVN_plus_1`
 *      and register it in MIGRATION_CHAIN.
 *   3. For per-row migrations (modules / bundles), call `registerMigrator`
 *      with a `MigratorDefinition` for each (kind, fromVersion) interval.
 *      Bundle migrators must recurse into children via
 *      `ctx.applyModuleStep` rather than re-dispatching `migratePayload`.
 */

import { RESERVED } from "../parsing/subcatFilter";

export const CURRENT_SCHEMA_VERSION = 2;

/**
 * Community catalog version for the SP2b nested multi-pick TEXT grammar
 * (`{N-M~$$sep$$…}` — range count and/or the `~` independent flag).
 *
 * SP2b is NOT a structural shape change: a v2 payload is byte-identical in
 * SHAPE to an SP2b one — only the free-text grammar inside string fields is
 * new. So there is deliberately NO `migrateV2ToV3` and `CURRENT_SCHEMA_VERSION`
 * stays 2 (the migration chain has nothing to do). The bump exists purely so
 * the community catalog can refuse the new text to a pre-SP2b consumer whose
 * tokenizer would mis-parse it (server-first rollout). Publish stamps THIS
 * version only when the payload actually uses range/`~` — see
 * `schemaVersionForPayload`.
 */
export const SP2B_SCHEMA_VERSION = 3;

/**
 * Community catalog version for the SP3 constraint reach selector
 * (`target_select` with a non-default `mode`/`count`/`picks`).
 *
 * Like SP2b this is an ADDITIVE shape change: a v2/v3 payload is shape-
 * compatible — a constraint that omits `target_select` (or carries the
 * default `{mode:"all"}`) is byte-identical to a pre-SP3 one. The new
 * `target_select` field only appears when a constraint actually narrows
 * its reach, so there is no `migrateV3ToV4` and `CURRENT_SCHEMA_VERSION`
 * stays 2 (the per-row migration chain has nothing to do). The bump
 * exists purely so the community catalog (already at v4, additive) can
 * tolerant-strip the new field for a pre-SP3 consumer (server-first
 * rollout). Publish stamps THIS version only when a constraint's reach
 * is non-default — see `schemaVersionForPayload` / `usesTargetSelectReach`.
 */
export const SP3_REACH_SCHEMA_VERSION = 4;

export interface MigrationOk<T> {
  ok: true;
  migrated: T;
  /**
   * Total count of ENTITIES (bundles + wildcards + fixed_values + combines +
   * derivations + constraints + categories + templates) that passed through
   * ANY migration step. A single 10-entity payload going through 1 step → 10.
   * A 5-entity payload going through 2 steps → 10.
   */
  migratedEntityCount: number;
}

export interface MigrationLossy {
  ok: false;
  reason: string;
  affected?: string[];
}

export type MigrationResult<T> = MigrationOk<T> | MigrationLossy;

export interface RawPayload {
  schema_version: number;
  bundles: Array<Record<string, unknown>>;
  wildcards: Array<Record<string, unknown>>;
  fixed_values: Array<Record<string, unknown>>;
  combines: Array<Record<string, unknown>>;
  derivations: Array<Record<string, unknown>>;
  constraints: Array<Record<string, unknown>>;
  categories: Array<Record<string, unknown>>;
  templates: Array<Record<string, unknown>>;
}

type VersionMigration = (payload: RawPayload) => RawPayload;

function migrateV0ToV1(payload: RawPayload): RawPayload {
  const tag = (e: Record<string, unknown>) => ({ ...e, migrated_from: 0 });
  return {
    ...payload,
    schema_version: 1,
    // NOTE: explicitly enumerates all eight known entity arrays. If a future
    // schema version adds a ninth entity array to RawPayload, update both
    // RawPayload AND every migration in the chain to tag the new array.
    // Otherwise migrations will silently pass the new array through untagged.
    bundles: payload.bundles.map(tag),
    wildcards: payload.wildcards.map(tag),
    fixed_values: payload.fixed_values.map(tag),
    combines: payload.combines.map(tag),
    derivations: payload.derivations.map(tag),
    constraints: payload.constraints.map(tag),
    categories: payload.categories.map(tag),
    templates: payload.templates.map(tag),
  };
}

// === v1 -> v2 (SP1 multi-tag) — mirror of engine/migrations/v1_to_v2.py ===
// option sub_category -> sub_categories[]; sub-category names slugified
// (whitespace/grammar chars -> `_`, reserved suffixed, de-duped, cascaded);
// instance category_filter list -> boolean-expr string + exclude_null;
// nested @{uuid:a,b,null} refs -> @{uuid:a or b!null}. Idempotent.
const _BAD = /[\s()!,#:}@{$]+/gu;
const _REF = /@\{([0-9a-f]{8})(#[^:}]*)?(:[^}]*)?\}/g;

function _slug(name: string): string {
  return name.replace(_BAD, "_").replace(/^_+|_+$/g, "") || "_";
}

function _nameMap(registry: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const raw of registry) {
    let s = _slug(raw);
    if (RESERVED.has(s.toLowerCase())) s = `${s}_1`;
    const base = s;
    let n = 1;
    while (used.has(s)) { n += 1; s = `${base}_${n}`; }
    used.add(s);
    out.set(raw, s);
  }
  return out;
}

function _rewriteRefs(s: string): string {
  return s.replace(_REF, (full, uuid: string, nameSeg: string | undefined, tail: string | undefined) => {
    if (tail === undefined) return full;
    const lst = tail.slice(1); // strip leading ':'
    const hasComma = lst.includes(",");
    const parts = lst.split(",").map((x) => x.trim());
    const hasNull = parts.includes("null");
    if (!hasComma && !hasNull) return full; // single tag / v2 expr — leave
    // Slug each tag so a cross-wildcard ref tracks the target's renamed
    // registry entry (deterministic — same _slug the target applies).
    const expr = parts.filter((p) => p && p !== "null").map(_slug).join(" or ");
    let out = "@{" + uuid + (nameSeg ?? "");
    if (expr) out += ":" + expr;
    if (hasNull) out += "!null";
    return out + "}";
  });
}

function _strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

function _isWildcardPayload(p: unknown): p is Record<string, unknown> {
  if (typeof p !== "object" || p === null) return false;
  const o = p as Record<string, unknown>;
  if (!Array.isArray(o.options)) return false;
  if ("sub_categories" in o) return true;
  return o.options.some((opt) => typeof opt === "object" && opt !== null && "sub_category" in opt);
}

function _applyWildcardPayload(
  p: Record<string, unknown>,
  nmap?: Map<string, string>,
): Record<string, unknown> {
  const reg = _strArray(p.sub_categories);
  const map = nmap ?? _nameMap(reg);
  const opts = Array.isArray(p.options) ? p.options : [];
  const out: Record<string, unknown> = {
    ...p,
    sub_categories: reg.map((s) => map.get(s) ?? _slug(s)),
    options: opts.map((raw) => {
      if (typeof raw !== "object" || raw === null) return raw;
      const o = { ...(raw as Record<string, unknown>) };
      if (Array.isArray(o.sub_categories)) {
        o.sub_categories = o.sub_categories.map((t) => (typeof t === "string" ? (map.get(t) ?? _slug(t)) : t));
      } else {
        const sc = o.sub_category;
        delete o.sub_category;
        o.sub_categories = typeof sc === "string" && sc ? [map.get(sc) ?? _slug(sc)] : [];
      }
      if (typeof o.value === "string") o.value = _rewriteRefs(o.value);
      return o;
    }),
  };
  if (typeof p.tag_groups === "object" && p.tag_groups !== null) {
    const tg: Record<string, unknown> = {};
    for (const [g, mem] of Object.entries(p.tag_groups as Record<string, unknown>)) {
      tg[g] = Array.isArray(mem)
        ? mem.map((m) => (typeof m === "string" ? (map.get(m) ?? _slug(m)) : m))
        : mem;
    }
    out.tag_groups = tg;
  }
  return out;
}

function _migrateInstance(inst: Record<string, unknown>, nmap: Map<string, string>): Record<string, unknown> {
  if (!Array.isArray(inst.category_filter)) return inst;
  const cf = inst.category_filter;
  const out = { ...inst };
  out.category_filter = cf
    .filter((c): c is string => typeof c === "string" && !!c && c !== "null")
    .map((c) => nmap.get(c) ?? _slug(c))
    .join(" or ");
  out.exclude_null = Boolean(out.exclude_null) || cf.includes("null");
  return out;
}

function _deepMigrate(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(_deepMigrate);
  if (typeof obj === "object" && obj !== null) {
    if (_isWildcardPayload(obj)) return _applyWildcardPayload(obj as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) out[k] = _deepMigrate(v);
    return out;
  }
  if (typeof obj === "string") return _rewriteRefs(obj);
  return obj;
}

function _migrateWildcardEntry(w: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...w };
  let nmap = new Map<string, string>();
  const p = w.payload;
  if (typeof p === "object" && p !== null && !Array.isArray(p)) {
    nmap = _nameMap(_strArray((p as Record<string, unknown>).sub_categories));
    out.payload = _applyWildcardPayload(p as Record<string, unknown>, nmap);
  }
  const inst = w.instance;
  if (typeof inst === "object" && inst !== null && !Array.isArray(inst)) {
    out.instance = _migrateInstance(inst as Record<string, unknown>, nmap);
  }
  return out;
}

function migrateV1ToV2(payload: RawPayload): RawPayload {
  const deep = (arr: Array<Record<string, unknown>>) =>
    arr.map((e) => _deepMigrate(e) as Record<string, unknown>);
  return {
    ...payload,
    schema_version: 2,
    wildcards: payload.wildcards.map((w) => _migrateWildcardEntry(w)),
    bundles: deep(payload.bundles),
    fixed_values: deep(payload.fixed_values),
    combines: deep(payload.combines),
    derivations: deep(payload.derivations),
    constraints: deep(payload.constraints),
    categories: deep(payload.categories),
    templates: deep(payload.templates),
  };
}

const MIGRATION_CHAIN: Record<number, VersionMigration> = {
  0: migrateV0ToV1,
  1: migrateV1ToV2,
};

export function migrateImportEnvelope(payload: Partial<RawPayload>): MigrationResult<RawPayload> {
  if (typeof payload.schema_version !== "number") {
    return { ok: false, reason: "payload missing schema_version field" };
  }
  if (payload.schema_version > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `future schema version ${payload.schema_version} (current: ${CURRENT_SCHEMA_VERSION})`,
    };
  }
  let current: RawPayload = {
    schema_version: payload.schema_version,
    bundles: payload.bundles ?? [],
    wildcards: payload.wildcards ?? [],
    fixed_values: payload.fixed_values ?? [],
    combines: payload.combines ?? [],
    derivations: payload.derivations ?? [],
    constraints: payload.constraints ?? [],
    categories: payload.categories ?? [],
    // Back-compat: pre-templates exports lack this key entirely; default
    // to [] so the migration chain + downstream picker treat it as empty.
    templates: payload.templates ?? [],
  };
  let migratedEntityCount = 0;
  while (current.schema_version < CURRENT_SCHEMA_VERSION) {
    const fn = MIGRATION_CHAIN[current.schema_version];
    if (!fn) {
      return { ok: false, reason: `no migration registered for v${current.schema_version}` };
    }
    const entitiesBefore =
      current.bundles.length +
      current.wildcards.length +
      current.fixed_values.length +
      current.combines.length +
      current.derivations.length +
      current.constraints.length +
      current.categories.length +
      current.templates.length;
    current = fn(current);
    migratedEntityCount += entitiesBefore;
  }
  return { ok: true, migrated: current, migratedEntityCount };
}

// === Per-row migration API (spec §2) ===

export interface MigrationContext {
  categoryTree?: { lookup: (id: string) => string };
  /** Bundle migrators call this to recurse into children — see spec
   * §2 single-version-per-root invariant. The bundle migrator owns
   * its tree; children never carry an independent schema_version. */
  applyModuleStep: (child: Record<string, unknown>, fromVersion: number) => Record<string, unknown>;
}

export interface MigratorDefinition {
  kind: "module" | "bundle";
  fromVersion: number;
  requiresContext?: (keyof MigrationContext)[];
  migrate: (
    payload: Record<string, unknown>,
    context: MigrationContext,
  ) => Record<string, unknown>;
}

const ROW_REGISTRY: Map<string, MigratorDefinition> = new Map();

function rowKey(kind: "module" | "bundle", fromVersion: number): string {
  return `${kind}:${fromVersion}`;
}

export function registerMigrator(def: MigratorDefinition): void {
  ROW_REGISTRY.set(rowKey(def.kind, def.fromVersion), def);
}

/** Test-only: clear the registry between tests. */
export function _resetRegistryForTests(): void {
  ROW_REGISTRY.clear();
}

/**
 * Per-row migration chain dispatcher.
 *
 * See spec §2. Forward-only; pure-by-default with declared context
 * injection. Bundle migrators MUST recurse into children via the
 * `applyModuleStep` helper on the injected context.
 */
export function migratePayload(
  payload: Record<string, unknown>,
  kind: "module" | "bundle",
  fromVersion: number,
  toVersion: number,
  context: Partial<MigrationContext> = {},
): Record<string, unknown> {
  let current = payload;
  for (let v = fromVersion; v < toVersion; v++) {
    const migrator = ROW_REGISTRY.get(rowKey(kind, v));
    if (!migrator) {
      throw new Error(`no migrator for ${kind} ${v}->${v + 1}`);
    }
    for (const req of migrator.requiresContext ?? []) {
      if (!(req in context)) {
        throw new Error(
          `migrator ${kind} ${v}->${v + 1} requires context: ${req}`,
        );
      }
    }
    const fullContext: MigrationContext = {
      ...context,
      applyModuleStep: (child, childFromVersion) => {
        const childMigrator = ROW_REGISTRY.get(rowKey("module", childFromVersion));
        if (!childMigrator) {
          throw new Error(
            `bundle recursion: no module migrator for ${childFromVersion}->${childFromVersion + 1}`,
          );
        }
        return childMigrator.migrate(child, { ...fullContext });
      },
    };
    current = migrator.migrate(current, fullContext);
  }
  return current;
}
