/**
 * Adapter: convert the manager's live-library snapshot (ModuleRow[],
 * BundleRow[], CategoryRow[]) into a RawPayload-shaped object so the
 * dep-graph helpers (buildDepGraph, transitiveClosure,
 * constraintsBothSidesIn) can walk references.
 *
 * Why this exists: the dep-graph code was written against parsed export
 * payloads, which carry wildcard `options` at the top level. Live library
 * rows from api.modules.list nest `options` under `payload`. The adapter
 * flattens that one field up for wildcards; other types pass through
 * unchanged (constraint `payload.source_wildcard_id` is already read
 * nested by dep-graph; bundles' `children` is already top-level).
 *
 * Pure function — no I/O.
 */
import type { ModuleRow, BundleRow, CategoryRow } from "../api/types";
import type { RawPayload } from "./migrations";

const MODULE_TYPE_TO_BUCKET: Record<string, keyof Omit<RawPayload, "schema_version" | "bundles" | "categories">> = {
  wildcard:      "wildcards",
  fixed_values:  "fixed_values",
  combine:       "combines",
  derivation:    "derivations",
  constraint:    "constraints",
};

export function liveLibraryToRawPayload(
  modules: ModuleRow[],
  bundles: BundleRow[],
  categories: CategoryRow[],
): RawPayload {
  const out: RawPayload = {
    schema_version: 1,
    bundles: [],
    wildcards: [],
    fixed_values: [],
    combines: [],
    derivations: [],
    constraints: [],
    categories: [],
  };

  for (const m of modules) {
    const bucket = MODULE_TYPE_TO_BUCKET[m.type];
    if (!bucket) continue;
    if (m.type === "wildcard") {
      // Flatten payload.options up to top level so dep-graph's
      // `(w as { options? }).options` reads work against this row.
      // Keep all other fields intact so downstream consumers can read
      // them if needed.
      const opts = (m.payload as { options?: Array<{ value: string }> } | undefined)?.options;
      out.wildcards.push({
        ...m,
        ...(Array.isArray(opts) ? { options: opts } : {}),
      });
    } else {
      // For non-wildcards (fixed_values/combine/derivation/constraint),
      // dep-graph either reads nested payload.* (constraint) or returns
      // empty edges (fixed_values/combine/derivation). Pass through.
      out[bucket].push({ ...m });
    }
  }

  for (const b of bundles) out.bundles.push({ ...b });
  for (const c of categories) out.categories.push({ ...c });

  return out;
}
