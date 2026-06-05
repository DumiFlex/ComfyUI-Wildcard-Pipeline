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

export const CURRENT_SCHEMA_VERSION = 1;

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

const MIGRATION_CHAIN: Record<number, VersionMigration> = {
  0: migrateV0ToV1,
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
