/**
 * Import-time friend→local id follow-through (#4 import path).
 *
 * When a user imports a constraint WITH its source + target and resolves a
 * collision by install-as-new (rename → fresh local id), the constraint's
 * `source_wildcard_id` / `target_wildcard_id` (and any embedded `@{}` refs
 * in matrix / exception values) still carry the FRIEND's old uuid. One
 * `walkRemap` pass over the imported entity set, keyed by the friend→local
 * map the user's collision resolutions produced, makes those refs follow
 * whatever the user already chose (spec "Remap-everywhere scope" row 3).
 *
 * Reuses the hardened `walkRemap` verbatim (segments preserved, 1:1 uuid
 * swap) — NOT `rewriteBrokenRef` (that rebuilds segments for a DIFFERENT
 * wildcard; here the wildcard is the SAME entity under a new local id).
 */
import { walkRemap } from "../../components/context/bundles/uuid-remap";

/** Build the friend→local id map from rename pairs (old friend id → minted
 *  local id). Adds + replaces keep identity, so they contribute no entry. */
export function buildImportRemapTable(
  renames: ReadonlyArray<{ oldId: string; newId: string }>,
): Record<string, string> {
  const table: Record<string, string> = {};
  for (const r of renames) {
    if (r.oldId && r.newId && r.oldId !== r.newId) table[r.oldId] = r.newId;
  }
  return table;
}

/** Run one walkRemap pass over each entity's `payload` + `instance`, leaving
 *  every other field (incl. the entity's own already-final `id`) untouched. */
export function applyImportRemap(
  entities: ReadonlyArray<Record<string, unknown>>,
  table: Record<string, string>,
): Record<string, unknown>[] {
  if (Object.keys(table).length === 0) return entities.map((e) => ({ ...e }));
  return entities.map((e) => {
    const next: Record<string, unknown> = { ...e };
    if (next.payload && typeof next.payload === "object") {
      next.payload = walkRemap(next.payload, table) as Record<string, unknown>;
    }
    if (next.instance && typeof next.instance === "object") {
      next.instance = walkRemap(next.instance, table) as Record<string, unknown>;
    }
    return next;
  });
}
