/**
 * Pure helpers for the Import / Export selection UI.
 *
 * All functions here are deterministic and free of DOM / network dependencies
 * so they can be unit-tested under vanilla Vitest. The view layer composes
 * them on top of reactive selection state.
 */

import type {
  BundleRow,
  CategoryRow,
  ImportBundle,
  ModuleRow,
  ModuleType,
} from "../api/types";

/** Selection group keys ↔ module types. Bundles + categories are
 *  pseudo-groups (no `type` field on the row — bundles have their own
 *  shape, categories are not modules at all). */
export type GroupKey =
  | "wildcard"
  | "fixed_values"
  | "combine"
  | "derivation"
  | "constraint"
  | "bundle"
  | "category";

export interface GroupMeta {
  key: GroupKey;
  label: string;
  icon: string;
  color: string;
  /** Module type this group represents — `null` for groups that don't
   *  live in the modules table (bundle, category). */
  type: ModuleType | null;
}

/**
 * Display order mirrors the prototype's MODULE_GROUPS in
 * docs/design-handoff/wildcardpipeline/project/screens/utilities.jsx,
 * with bundles slotted just before categories so the library-side
 * group sits next to its categories counterpart in the selection tree.
 */
export const GROUPS: GroupMeta[] = [
  { key: "wildcard",     label: "Wildcards",    icon: "pi pi-sparkles",                color: "var(--wp-kind-wildcard)",   type: "wildcard" },
  { key: "fixed_values", label: "Fixed Values", icon: "pi pi-tag",                     color: "var(--wp-kind-fixed)",      type: "fixed_values" },
  { key: "combine",      label: "Combines",     icon: "pi pi-link",                    color: "var(--wp-kind-combine)",    type: "combine" },
  { key: "derivation",   label: "Derivations",  icon: "pi pi-arrow-right-arrow-left",  color: "var(--wp-kind-derivation)", type: "derivation" },
  { key: "constraint",   label: "Constraints",  icon: "pi pi-filter",                  color: "var(--wp-kind-constraint)", type: "constraint" },
  { key: "bundle",       label: "Bundles",      icon: "pi pi-box",                     color: "var(--wp-bundle-default, #6366f1)", type: null },
  { key: "category",     label: "Categories",   icon: "pi pi-bookmark",                color: "var(--wp-kind-category, #60a5fa)", type: null },
];

/** Stable selection key — `<group>:<id>`. */
export function selectionKey(group: GroupKey, id: string): string {
  return `${group}:${id}`;
}

/** Map a module's type to its selection group. */
export function groupForModule(type: ModuleType): GroupKey {
  return type;
}

/**
 * Stable canonical JSON for a payload — sorts keys recursively. Used to
 * compute a quick payload hash so import can flag rows where the id matches
 * but the payload diverged (the "modified" badge).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return value;
}

/**
 * Cheap, deterministic 32-bit FNV-1a hash of an arbitrary string. Returned
 * as 8 hex chars. Used purely for change-detection — never security.
 */
export function quickHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Hash of a module's payload — stable across reorders. */
export function hashPayload(payload: Record<string, unknown> | undefined): string {
  return quickHash(canonicalJson(payload ?? {}));
}

export interface FilteredBundleInput {
  modules: ModuleRow[];
  categories: CategoryRow[];
  /** Bundle library entries. Optional so existing callers that pre-date
   *  bundle support continue to compile; new callers should always pass
   *  the array (possibly empty). */
  bundles?: BundleRow[];
  /** Selection key set — see `selectionKey()`. */
  selected: Set<string>;
}

/**
 * Build a partial ImportBundle from the source library + a selection set.
 *
 * Modules and bundles are filtered by their per-row checkbox.
 * Categories are kept if:
 *   - they are explicitly checked in the categories group, OR
 *   - they are referenced by any selected module / bundle
 *     (`category_id` match).
 *
 * The second rule guarantees the imported bundle is self-consistent:
 * every module / bundle that mentions a category brings that category
 * along, even when the user only ticked the parent row.
 */
export function buildFilteredBundle(input: FilteredBundleInput): ImportBundle {
  const { modules, categories, bundles = [], selected } = input;

  const pickedModules = modules.filter((m) =>
    selected.has(selectionKey(groupForModule(m.type), m.id)),
  );

  const pickedBundles = bundles.filter((b) =>
    selected.has(selectionKey("bundle", b.id)),
  );

  const referenced = new Set<string>();
  for (const m of pickedModules) {
    if (m.category_id) referenced.add(m.category_id);
  }
  for (const b of pickedBundles) {
    if (b.category_id) referenced.add(b.category_id);
  }

  const pickedCategories = categories.filter(
    (c) => selected.has(selectionKey("category", c.id)) || referenced.has(c.id),
  );

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    modules: pickedModules,
    categories: pickedCategories,
    bundles: pickedBundles,
  };
}

/** Approximate bundle size in bytes — `JSON.stringify(bundle).length`. */
export function bundleSizeBytes(bundle: ImportBundle): number {
  return JSON.stringify(bundle).length;
}

/** Human-friendly bytes — "1.2 KB", "340 B", "2.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

/** Per-group counts of selected items, plus total. */
export function selectionCounts(
  selected: Set<string>,
): Record<GroupKey, number> & { total: number } {
  const counts: Record<GroupKey, number> & { total: number } = {
    wildcard: 0, fixed_values: 0, combine: 0,
    derivation: 0, constraint: 0, bundle: 0,
    category: 0, total: 0,
  };
  for (const key of selected) {
    const idx = key.indexOf(":");
    if (idx <= 0) continue;
    const g = key.slice(0, idx) as GroupKey;
    if (g in counts) {
      counts[g] += 1;
      counts.total += 1;
    }
  }
  return counts;
}

// ---------- Presets ----------

/**
 * "Full library" — every module + every bundle + every category.
 */
export function presetFull(
  modules: ModuleRow[], categories: CategoryRow[], bundles: BundleRow[] = [],
): Set<string> {
  const s = new Set<string>();
  for (const m of modules) s.add(selectionKey(groupForModule(m.type), m.id));
  for (const b of bundles) s.add(selectionKey("bundle", b.id));
  for (const c of categories) s.add(selectionKey("category", c.id));
  return s;
}

/** "Wildcards only" — every wildcard module, nothing else. */
export function presetWildcardsOnly(modules: ModuleRow[]): Set<string> {
  const s = new Set<string>();
  for (const m of modules) {
    if (m.type === "wildcard") s.add(selectionKey("wildcard", m.id));
  }
  return s;
}

/** "Favorites only" — every favorited module + bundle across all kinds. */
export function presetFavoritesOnly(
  modules: ModuleRow[], bundles: BundleRow[] = [],
): Set<string> {
  const s = new Set<string>();
  for (const m of modules) {
    if (m.is_favorite) s.add(selectionKey(groupForModule(m.type), m.id));
  }
  for (const b of bundles) {
    if (b.is_favorite) s.add(selectionKey("bundle", b.id));
  }
  return s;
}

// ---------- Import-side conflict detection ----------

export type ConflictKind = "new" | "exists" | "modified";

export interface ConflictResult {
  kind: ConflictKind;
  /** Existing local module id, when the incoming row clashes with one. */
  existingId?: string;
}

/**
 * Classify an incoming module row against the current local library.
 *
 * - `new`      — id not present locally
 * - `exists`   — id matches and payload looks identical
 * - `modified` — id matches but payload diverged (different shape)
 */
export function classifyModule(
  incoming: ModuleRow,
  localById: Map<string, ModuleRow>,
): ConflictResult {
  const local = localById.get(incoming.id);
  if (!local) return { kind: "new" };
  const a = hashPayload(local.payload);
  const b = hashPayload(incoming.payload);
  if (a === b) return { kind: "exists", existingId: local.id };
  return { kind: "modified", existingId: local.id };
}

export function classifyCategory(
  incoming: CategoryRow,
  localById: Map<string, CategoryRow>,
): ConflictResult {
  const local = localById.get(incoming.id);
  if (!local) return { kind: "new" };
  if (local.name === incoming.name && local.color === incoming.color) {
    return { kind: "exists", existingId: local.id };
  }
  return { kind: "modified", existingId: local.id };
}

/**
 * Classify an incoming bundle row against the current local library.
 * Compares the server-supplied `payload_hash` — which covers the
 * children blob — instead of re-hashing locally, since the children
 * array is heavier than a module payload and the hash is already
 * stable across exports.
 */
export function classifyBundle(
  incoming: BundleRow,
  localById: Map<string, BundleRow>,
): ConflictResult {
  const local = localById.get(incoming.id);
  if (!local) return { kind: "new" };
  if (local.payload_hash === incoming.payload_hash) {
    return { kind: "exists", existingId: local.id };
  }
  return { kind: "modified", existingId: local.id };
}
