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
import type { DerivationPayload, ModuleRow, WildcardPayload } from "../api/types";
import { toIdentifier } from "./slug";
import { buildUuidToName, wildcardVarName } from "./wildcardSyntax";

/** Minimal shape of the Pinia module store the walkers need. The
 *  walkers consume `catalog` (the unfiltered library cache) — not
 *  `items` (the list-view filtered cache). When the user is editing
 *  inside e.g. CombineEditor, `items` only contains rows visible in
 *  the last list view, so a walker reading from `items` would miss
 *  every var binding outside the current filter. Loose interface so
 *  tests can pass plain mock objects without spinning up Pinia. */
export interface ModuleStoreLike {
  catalog: ModuleRow[];
}

export interface VarHint {
  label: string;
  kind: "wildcard" | "fixed_values" | "combine" | "derivation";
}

/** Walk the library catalog and surface every var name a producer
 *  module emits. Kinds:
 *    - wildcard: `payload.var_binding` (or `toIdentifier(name)` if
 *      legacy module has no binding set yet)
 *    - fixed_values: each row's `name` (leading `$` stripped)
 *    - combine: `payload.output_var`
 *    - derivation: each rule's branch `action.target_var` + else
 *      `action.target_var`
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
  const push = (label: string, kind: VarHint["kind"]) => {
    if (label && !seen.has(label)) {
      seen.add(label);
      out.push({ label, kind });
    }
  };

  for (const m of store.catalog) {
    if (excludeId && m.id === excludeId) continue;

    if (m.type === "wildcard") {
      const p = (m.payload ?? {}) as Partial<WildcardPayload>;
      const trimmed = (p.var_binding ?? "").trim();
      push(trimmed || toIdentifier(m.name), "wildcard");
    } else if (m.type === "fixed_values") {
      const values = ((m.payload ?? {}) as { values?: { name?: string }[] }).values ?? [];
      for (const row of values) {
        push((row.name ?? "").replace(/^\$+/, "").trim(), "fixed_values");
      }
    } else if (m.type === "combine") {
      const p = (m.payload ?? {}) as { output_var?: string };
      push((p.output_var ?? "").replace(/^\$+/, "").trim(), "combine");
    } else if (m.type === "derivation") {
      const p = (m.payload ?? {}) as Partial<DerivationPayload>;
      for (const rule of p.rules ?? []) {
        for (const br of rule.branches ?? []) {
          push((br.action?.target_var ?? "").replace(/^\$+/, "").trim(), "derivation");
        }
        const elseTarget = rule.else?.action?.target_var;
        if (elseTarget) push(elseTarget.replace(/^\$+/, "").trim(), "derivation");
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
  for (const m of store.catalog) {
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

/** The per-wildcard maps RichTextInput's `@{}` nested-ref autocomplete +
 *  step-2 sub-category picker consume. Single source so the wildcard editor
 *  and the derivation editor (action values are `@{}` carriers post-Layer-A)
 *  feed the SAME reused machinery without duplicating six catalog walkers. */
export interface WildcardRefData {
  /** 8-hex UUID → display name (`var_binding` or slug of `name`). */
  uuidToName: Map<string, string>;
  /** UUID → declared `sub_categories` (string-only; `[]` when absent). */
  uuidToSubCategories: Map<string, string[]>;
  /** UUID → true iff some option is `is_null`. */
  uuidToHasNull: Map<string, boolean>;
  /** UUID → total option count (incl. null). */
  uuidToOptionsCount: Map<string, number>;
  /** UUID → each NON-null option's `sub_categories` (match-count denominator). */
  uuidToOptionTagSets: Map<string, string[][]>;
  /** UUID → `tag_groups` axes (`{}` when absent). */
  uuidToTagGroups: Map<string, Record<string, string[]>>;
}

/** Build every per-wildcard map RichTextInput's nested-ref UI needs in ONE
 *  pass over the catalog. Pure (no store/reactivity) so both the wildcard
 *  editor and the derivation editor call it identically. Only `wildcard`
 *  rows contribute; other module kinds are ignored. Replaces the six
 *  hand-rolled `computed`s that previously lived in WildcardEditor.vue. */
export function buildWildcardRefData(catalog: ModuleRow[]): WildcardRefData {
  const uuidToName = new Map<string, string>();
  const uuidToSubCategories = new Map<string, string[]>();
  const uuidToHasNull = new Map<string, boolean>();
  const uuidToOptionsCount = new Map<string, number>();
  const uuidToOptionTagSets = new Map<string, string[][]>();
  const uuidToTagGroups = new Map<string, Record<string, string[]>>();

  const onlyStrings = (xs: unknown): string[] =>
    Array.isArray(xs) ? xs.filter((s): s is string => typeof s === "string") : [];

  for (const mod of catalog) {
    if (mod.type !== "wildcard") continue;
    uuidToName.set(mod.id, wildcardVarName(mod));

    const p = (mod.payload ?? {}) as {
      sub_categories?: unknown;
      options?: unknown[];
      tag_groups?: unknown;
    };

    uuidToSubCategories.set(mod.id, onlyStrings(p.sub_categories));

    const opts = Array.isArray(p.options) ? p.options : [];
    uuidToOptionsCount.set(mod.id, opts.length);

    const isNull = (o: unknown): boolean => (o as { is_null?: boolean } | null)?.is_null === true;
    uuidToHasNull.set(mod.id, opts.some(isNull));
    uuidToOptionTagSets.set(
      mod.id,
      opts
        .filter((o) => !isNull(o))
        .map((o) => onlyStrings((o as { sub_categories?: unknown } | null)?.sub_categories)),
    );

    const tg = p.tag_groups;
    uuidToTagGroups.set(mod.id, tg && typeof tg === "object" ? (tg as Record<string, string[]>) : {});
  }

  return {
    uuidToName,
    uuidToSubCategories,
    uuidToHasNull,
    uuidToOptionsCount,
    uuidToOptionTagSets,
    uuidToTagGroups,
  };
}

// Re-export so callers have a single import path for autocomplete
// helpers — matches the spec § Files note.
export { buildUuidToName };
