/**
 * Library autocomplete suggestion walkers.
 *
 * Three SPA editors today (CombineEditor / DerivationEditor /
 * WildcardEditor) duplicate near-identical code that walks the
 * `moduleStore.items` library catalog to populate autocomplete
 * dropdowns. This file is the single source: each editor imports
 * the relevant walker, passes its props.id as `excludeId` so the
 * module being edited doesn't appear as its own suggestion.
 *
 *   - `collectLibraryVarHints(store, excludeId?): VarHint[]` — pulls
 *     per-kind binding names (`$var` autocomplete). Returns
 *     kind-tagged hints so callers can color-code dropdown rows by
 *     producing module kind.
 *
 *   - `collectLibraryWildcardRefs(store, excludeId?, uuidToName?): string[]`
 *     — pulls wildcard UUIDs (`@{uuid}` autocomplete on wildcard
 *     surface), sorted by display name when a uuidToName map is
 *     provided.
 *
 *   - `buildUuidToName` — re-export from wildcardSyntax.ts so callers
 *     have one import path for autocomplete-related helpers.
 */
import type { ModuleRow, WildcardPayload } from "../api/types";
import { toIdentifier } from "./slug";
import { buildUuidToName } from "./wildcardSyntax";

/** Minimal shape of the Pinia module store the walkers need. Loose
 *  interface so tests can pass plain mock objects without spinning up
 *  a real Pinia instance. */
export interface ModuleStoreLike {
  items: ModuleRow[];
}

export interface VarHint {
  label: string;
  kind: "wildcard" | "fixed_values" | "combine";
}

/** Walk the library catalog and surface every var name a producer
 *  module emits. Kinds:
 *    - wildcard: `payload.var_binding` (or `toIdentifier(name)` if
 *      legacy module has no binding set yet)
 *    - fixed_values: each row's `name` (leading `$` stripped)
 *    - combine: `payload.output_var`
 *
 *  Dedups labels across kinds (first occurrence wins) + sorts
 *  alphabetically for stable dropdown ordering. Skips the module
 *  whose id matches `excludeId` so the editor doesn't suggest the
 *  module being edited as its own dependency.
 */
export function collectLibraryVarHints(
  store: ModuleStoreLike,
  excludeId?: string,
): VarHint[] {
  const seen = new Set<string>();
  const out: VarHint[] = [];

  for (const m of store.items) {
    if (excludeId && m.id === excludeId) continue;

    if (m.type === "wildcard") {
      const p = (m.payload ?? {}) as Partial<WildcardPayload>;
      const trimmed = (p.var_binding ?? "").trim();
      const label = trimmed || toIdentifier(m.name);
      if (label && !seen.has(label)) {
        seen.add(label);
        out.push({ label, kind: "wildcard" });
      }
    } else if (m.type === "fixed_values") {
      const values = ((m.payload ?? {}) as { values?: { name?: string }[] }).values ?? [];
      for (const row of values) {
        const label = (row.name ?? "").replace(/^\$+/, "").trim();
        if (label && !seen.has(label)) {
          seen.add(label);
          out.push({ label, kind: "fixed_values" });
        }
      }
    } else if (m.type === "combine") {
      const p = (m.payload ?? {}) as { output_var?: string };
      const label = (p.output_var ?? "").replace(/^\$+/, "").trim();
      if (label && !seen.has(label)) {
        seen.add(label);
        out.push({ label, kind: "combine" });
      }
    }
  }

  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** Walk the library catalog for wildcard UUIDs to power the
 *  `@{uuid}` autocomplete in the wildcard editor. UUIDs sort by
 *  display name (read from `uuidToName`) so the popover orders by
 *  what the user sees, not by hex. Falls back to lex sort on the UUID
 *  string when no name map is provided.
 */
export function collectLibraryWildcardRefs(
  store: ModuleStoreLike,
  excludeId?: string,
  uuidToName?: Map<string, string>,
): string[] {
  const out: string[] = [];
  for (const m of store.items) {
    if (m.type !== "wildcard") continue;
    if (excludeId && m.id === excludeId) continue;
    out.push(m.id);
  }
  return out.sort((a, b) => {
    if (uuidToName) {
      const na = uuidToName.get(a) ?? a;
      const nb = uuidToName.get(b) ?? b;
      return na.localeCompare(nb);
    }
    return a.localeCompare(b);
  });
}

// Re-export so callers have a single import path for autocomplete
// helpers — matches the spec § Files note.
export { buildUuidToName };
