/**
 * Import payload parse pipeline: raw JSON string → validated, migrated,
 * fingerprint-verified payload. Pure function — no I/O.
 *
 * Pipeline order:
 *   1. JSON.parse (catches malformed JSON)
 *   2. Shape check (required keys, types)
 *   3. Migration chain dispatch (per migrations.ts)
 *   4. Fingerprint verify per module (recompute moduleFingerprint, compare
 *      against payload's stamped snapshot_fingerprint when present)
 */

import { migratePayload, type RawPayload } from "./migrations";
import { moduleFingerprint, type ModuleRow } from "./fingerprint";

export type WarningField = "bundle" | "wildcard" | "fixed_value" | "combine" | "derivation" | "constraint" | "category";

export interface IntegrityWarning {
  /** Short UUID of the entity (the `id` field of the entity row, per
   *  migration 004 of the SQLite schema). Empty string when the row is
   *  missing the field entirely — picker UIs should fall back to index
   *  routing in that case. */
  id: string;
  field: WarningField;
  reason: string;
}

export interface ParseOk {
  ok: true;
  payload: RawPayload;
  /** Total entity count across all migration steps (NOT distinct entity count).
   *  A 5-entity v0 payload passing through 1 step returns 5; through 2 steps
   *  returns 10. Matches `migratePayload.migratedEntityCount` semantics. */
  migratedEntityCount: number;
  integrityWarnings: IntegrityWarning[];
}

export interface ParseFail {
  ok: false;
  reason: string;
}

export type ParseResult = ParseOk | ParseFail;

const ENTITY_ARRAYS = ["bundles", "wildcards", "fixed_values", "combines", "derivations", "constraints", "categories"] as const;

const PLURAL_TO_SINGULAR: Record<string, WarningField> = {
  bundles: "bundle",
  wildcards: "wildcard",
  fixed_values: "fixed_value",
  combines: "combine",
  derivations: "derivation",
  constraints: "constraint",
  categories: "category",
};

function verifyOne(entity: Record<string, unknown>, kind: WarningField): IntegrityWarning | null {
  const stamped = entity.snapshot_fingerprint;
  if (typeof stamped !== "string" || stamped.length === 0) return null;
  // Bundle fingerprints use a different algorithm (see bundle-fingerprint.ts)
  // and are out of scope for this verify pass. The bundle-side MOD flow
  // already covers bundle fingerprint drift via existing infrastructure.
  if (kind === "bundle") return null;
  // Categories are organizational metadata (name-based merge-or-create).
  // They carry no snapshot_fingerprint, so fingerprint verification is N/A.
  if (kind === "category") return null;
  const recomputed = moduleFingerprint(entity as unknown as ModuleRow);
  if (recomputed === stamped) return null;
  return {
    id: typeof entity.id === "string" ? entity.id : "",  // TODO(task-7): pass index fallback when picker needs routing
    field: kind,
    reason: `${kind} fingerprint mismatch (stamped ${stamped}, recomputed ${recomputed})`,
  };
}

export function parsePayload(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: `invalid JSON: ${(e as Error).message}` };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, reason: "payload must be a JSON object" };
  }
  const obj = json as Record<string, unknown>;
  if (typeof obj.schema_version !== "number") {
    return { ok: false, reason: "missing schema_version" };
  }
  for (const key of ENTITY_ARRAYS) {
    if (!Array.isArray(obj[key])) {
      return { ok: false, reason: `missing or non-array '${key}'` };
    }
  }
  const migrationResult = migratePayload(obj as Partial<RawPayload>);
  if (!migrationResult.ok) return { ok: false, reason: migrationResult.reason };
  const { migrated, migratedEntityCount } = migrationResult;

  const integrityWarnings: IntegrityWarning[] = [];
  for (const [kindPlural, arr] of [
    ["bundles", migrated.bundles] as const,
    ["wildcards", migrated.wildcards] as const,
    ["fixed_values", migrated.fixed_values] as const,
    ["combines", migrated.combines] as const,
    ["derivations", migrated.derivations] as const,
    ["constraints", migrated.constraints] as const,
    ["categories", migrated.categories] as const,
  ]) {
    const kindSingular = PLURAL_TO_SINGULAR[kindPlural];
    for (const e of arr) {
      const w = verifyOne(e, kindSingular);
      if (w) integrityWarnings.push(w);
    }
  }

  return { ok: true, payload: migrated, migratedEntityCount, integrityWarnings };
}
