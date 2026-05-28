/**
 * Versioned migration chain for import payloads.
 *
 * Each version delta has a single function. The dispatcher walks from
 * payload's schema_version up to CURRENT_SCHEMA_VERSION, applying each
 * delta in turn. Lossy migrations short-circuit with reason.
 *
 * Adding a new schema version:
 *   1. Bump CURRENT_SCHEMA_VERSION below.
 *   2. Add a function `migrateVNToVN_plus_1` operating on entity-shape payloads.
 *   3. Register it in MIGRATION_CHAIN below.
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

export function migratePayload(payload: Partial<RawPayload>): MigrationResult<RawPayload> {
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
