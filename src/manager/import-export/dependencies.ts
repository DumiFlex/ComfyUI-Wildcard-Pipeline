/**
 * Upload dependency detection (Feature B2a).
 *
 * `listReferencedUuids(module)` — given ONE library module, returns the
 * de-duplicated set of wildcard uuids it references, so the upload flow
 * (B2b `single-row-publish.ts`) can resolve which referenced wildcards
 * are already published (prefill) vs. unpublished (warn).
 *
 * Pure function. No I/O, no store access — it reads only the module's
 * `id` / `type` / `payload`, the structural intersection of `ModuleRow`
 * (library row, the publish path) and `ModuleEntry` (in-graph instance).
 *
 * Two reference shapes exist in a payload:
 *   - constraint source/target: WHOLE-id fields (`source_wildcard_id` /
 *     `target_wildcard_id`), each an 8-hex `ModuleRow.id`. Taken verbatim
 *     (skipping null/empty/whitespace) — same as `dep-graph.ts`.
 *   - nested `@{uuid}` tokens inside resolvable string values (wildcard
 *     option values, derivation action values, constraint exception
 *     strings). Scanned with the SAME `REF_TOKEN_RE` the conflict scanner
 *     uses (`@\{[0-9a-f]{8}…\}`) — one shared 8-hex token regex, never a
 *     forked copy. Combine templates are intentionally NOT scanned: the
 *     engine treats their `@{}` as literal text, mirroring
 *     `scanConflicts`' broken-nested-ref exclusion.
 *
 * The module's OWN id is excluded — a self-reference is not a dependency.
 */

import { REF_TOKEN_RE } from "../../extension/conflicts";
import type {
  BundleRow,
  ConstraintException,
  ConstraintPayload,
  DerivationPayload,
  ModuleRow,
  ModuleType,
  WildcardPayload,
} from "../api/types";

/** Module kinds that can appear in a publish. `ModuleType` covers the five
 *  module subtypes; bundles arrive as a `"bundle"` row with `children`
 *  instead of a typed payload, so the detector accepts the wider union and
 *  returns `[]` for it (children are frozen self-contained snapshots —
 *  out of scope per the B2 spec). */
export type ReferencingModuleType = ModuleType | "bundle";

/** Minimal structural shape `listReferencedUuids` reads — satisfied by both
 *  `ModuleRow` (library row) and `ModuleEntry` (in-graph instance). */
export interface ReferencingModule {
  id: string;
  type: ReferencingModuleType;
  payload?: Record<string, unknown>;
}

/** Push every `@{8hex}` ref found in `text` into `out`. `matchAll` (never
 *  `.exec`) so the shared global `REF_TOKEN_RE` stays stateless across
 *  calls and the security pre-tool hook stays quiet. */
function collectNestedRefs(text: unknown, out: string[]): void {
  if (typeof text !== "string") return;
  for (const match of text.matchAll(REF_TOKEN_RE)) out.push(match[1]);
}

/** Whole-id field (constraint source/target): keep iff a non-blank string. */
function pushWholeId(id: unknown, out: string[]): void {
  if (typeof id === "string" && id.trim() !== "") out.push(id);
}

/**
 * The de-duplicated set of wildcard uuids `module` references, excluding
 * its own id. Returns a fresh array (insertion order preserved, first
 * occurrence wins). Unknown / ref-free types return `[]`.
 */
export function listReferencedUuids(module: ReferencingModule): string[] {
  const payload = (module.payload ?? {}) as Record<string, unknown>;
  const refs: string[] = [];

  switch (module.type) {
    case "constraint": {
      const cp = payload as Partial<ConstraintPayload>;
      pushWholeId(cp.source_wildcard_id, refs);
      pushWholeId(cp.target_wildcard_id, refs);
      // Exception strings may embed `@{}` refs (migration 010 mirrors
      // runtime keys onto `*_value`; scan whichever forms are present).
      const exceptions = (cp.exceptions ?? []) as Array<Partial<ConstraintException> & {
        source_value?: unknown;
        target_value?: unknown;
      }>;
      for (const ex of exceptions) {
        collectNestedRefs(ex?.source, refs);
        collectNestedRefs(ex?.target, refs);
        collectNestedRefs(ex?.source_value, refs);
        collectNestedRefs(ex?.target_value, refs);
      }
      break;
    }
    case "wildcard": {
      const wp = payload as Partial<WildcardPayload>;
      for (const opt of wp.options ?? []) collectNestedRefs(opt?.value, refs);
      break;
    }
    case "derivation": {
      const dp = payload as Partial<DerivationPayload>;
      for (const rule of dp.rules ?? []) {
        for (const branch of rule?.branches ?? []) {
          collectNestedRefs(branch?.action?.value, refs);
        }
        collectNestedRefs(rule?.else?.action?.value, refs);
      }
      break;
    }
    // fixed_values / combine / bundle: no wildcard refs the downloader
    // would need to reattach. Combine `@{}` is literal text; bundle
    // children are self-contained snapshots.
    default:
      break;
  }

  // De-duplicate (first occurrence wins) and drop the module's own id —
  // a self-reference isn't a dependency.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const uuid of refs) {
    if (uuid === module.id || seen.has(uuid)) continue;
    seen.add(uuid);
    out.push(uuid);
  }
  return out;
}

/** A referenced wildcard the publishing user has ALREADY published to the
 *  community — keyed by its community post slug so the embed can prefill the
 *  dependency row, pre-verified "exists". `optional` is always `false` here:
 *  a detected ref is a hard dependency of the module being published (the
 *  user can still toggle it optional in the embed). */
export interface ResolvedDependency {
  slug: string;
  optional: false;
}

/** A referenced wildcard that is NOT on the community (no `community_post_slug`
 *  on its catalog row, or absent from the catalog entirely). The embed warns
 *  about these — a downloader couldn't reattach them. `name` is the catalog
 *  row's display name, falling back to the raw uuid when unknown. */
export interface UnmetDependency {
  name: string;
}

/** The split of a module's referenced uuids into prefill-able dependencies
 *  (published) and unmet refs (warn). See `resolveDependencies`. */
export interface ResolvedDependencies {
  dependencies: ResolvedDependency[];
  unmet: UnmetDependency[];
}

/** The minimal catalog-row shape the dependency resolvers read: a stable `id`,
 *  a display `name`, and the published signal `community_post_slug`. BOTH
 *  `ModuleRow` (module wildcard refs) AND `BundleRow` (inner-bundle refs)
 *  satisfy it — bundles resolve against the bundle catalog (BR-A2), and a
 *  `BundleRow` carries no `type`, so the dialog's kind-icon falls back to the
 *  bundle glyph. Kept structural so callers can pass either catalog without a
 *  cast; the matched rows are returned as-is. */
export interface CatalogRow {
  id: string;
  name?: string;
  community_post_slug?: string | null;
}

/**
 * Resolve the uuids from `listReferencedUuids` against the library `catalog`
 * (the unfiltered `useModuleStore().catalog` — passed in so this stays a pure,
 * store-free function the publish flow + tests can call directly):
 *   - uuid → catalog row WITH a non-blank `community_post_slug` → a
 *     **dependency** `{ slug, optional: false }` (the embed prefills it).
 *   - uuid → catalog row WITHOUT a slug, OR uuid absent from the catalog → an
 *     **unmet** `{ name }` (the embed warns). Name is the row's display name,
 *     or the raw uuid when the row is unknown.
 *
 * Both lists are de-duplicated independently: dependencies by `slug`, unmet by
 * `name` (two different uuids that resolve to the same slug/name collapse to a
 * single entry). Insertion order is preserved (first occurrence wins).
 */
export function resolveDependencies(
  refUuids: string[],
  catalog: CatalogRow[],
): ResolvedDependencies {
  const byId = new Map<string, CatalogRow>();
  for (const row of catalog) byId.set(row.id, row);

  const dependencies: ResolvedDependency[] = [];
  const unmet: UnmetDependency[] = [];
  const seenSlugs = new Set<string>();
  const seenNames = new Set<string>();

  for (const uuid of refUuids) {
    const row = byId.get(uuid);
    const slug = row?.community_post_slug;
    if (typeof slug === "string" && slug.trim() !== "") {
      if (seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);
      dependencies.push({ slug, optional: false });
    } else {
      const name = row?.name ?? uuid;
      if (seenNames.has(name)) continue;
      seenNames.add(name);
      unmet.push({ name });
    }
  }

  return { dependencies, unmet };
}

/**
 * The library catalog rows `module` references that are IN the library but
 * NOT yet on the community — the gate set for the B3 guided-publish dialog.
 *
 * Each referenced uuid (`listReferencedUuids`) is matched against `catalog`;
 * a row is kept iff it EXISTS in the catalog AND has no `community_post_slug`
 * (in-library, unpublished). Two cases are excluded:
 *   - refs already published (carry a non-blank slug) — nothing to do.
 *   - refs absent from the catalog (dangling) — can't be published from here.
 * Bundles reference nothing (`listReferencedUuids` → []), so they return []
 * and are never gated.
 *
 * Returns the actual `ModuleRow`s (de-duplicated by id, first occurrence
 * wins) so the dialog can render each dep's name + type icon and build its
 * publishable. Pure — reads only the passed module + catalog.
 */
export function unmetDependencyRows(
  module: ReferencingModule,
  catalog: ModuleRow[],
): ModuleRow[] {
  return unmetRowsForRefs(listReferencedUuids(module), catalog);
}

/**
 * The deduped `id`s of a bundle's INNER-BUNDLE children — every child whose
 * `type === "bundle"` (a `{id, type:"bundle", name?, color?}` reference, see
 * `validators/bundle/v1.ts`). Leaf module children (wildcard/constraint/…) and
 * blank / non-string ids are skipped. First occurrence wins; a fresh array.
 *
 * These are the bundle's publish dependencies: a downloader can't reattach an
 * inner bundle that isn't itself on the community, so the publish flow surfaces
 * them in the SAME guided-publish dialog a constraint's wildcard refs use —
 * resolved against the BUNDLE catalog (`bundleUnmetDependencyRows`), since inner
 * bundles live in the bundle store, not the module store.
 */
export function bundleChildBundleRefs(
  children: Array<{ id?: unknown; type?: unknown }>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const child of children) {
    if (child?.type !== "bundle") continue;
    const id = child.id;
    if (typeof id !== "string" || id.trim() === "" || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Shared resolver: the catalog rows for `refUuids` that EXIST in `catalog` but
 * carry no `community_post_slug` (in-library, unpublished) — the gate set for
 * the guided-publish dialog. Refs already published (non-blank slug) and refs
 * absent from the catalog (dangling) are excluded. De-duplicated by id (first
 * occurrence wins). Backs both `unmetDependencyRows` (module wildcard refs vs.
 * the module catalog) and `bundleUnmetDependencyRows` (inner-bundle refs vs.
 * the bundle catalog) — same published/unpublished/dangling split either way.
 */
function unmetRowsForRefs<T extends CatalogRow>(refUuids: string[], catalog: T[]): T[] {
  const byId = new Map<string, T>();
  for (const r of catalog) byId.set(r.id, r);

  const out: T[] = [];
  const seen = new Set<string>();
  for (const uuid of refUuids) {
    if (seen.has(uuid)) continue;
    const row = byId.get(uuid);
    if (!row) continue; // dangling — not in the catalog, can't publish here.
    const slug = row.community_post_slug;
    if (typeof slug === "string" && slug.trim() !== "") continue; // published.
    seen.add(uuid);
    out.push(row);
  }
  return out;
}

/**
 * The inner-bundle children of `children` that are IN the bundle library but
 * NOT yet on the community — the bundle analogue of `unmetDependencyRows`. Refs
 * come from `bundleChildBundleRefs`; they're resolved against `bundleCatalog`
 * (the unfiltered `useBundleStore().catalog`, passed in to keep this pure).
 * Returns the matched `BundleRow`s (deduped by id) so the dialog renders each
 * inner bundle's name + bundle kind icon (a `BundleRow` has no `type`, so the
 * icon falls back to the bundle glyph).
 */
export function bundleUnmetDependencyRows(
  children: Array<{ id?: unknown; type?: unknown }>,
  bundleCatalog: BundleRow[],
): BundleRow[] {
  return unmetRowsForRefs(bundleChildBundleRefs(children), bundleCatalog);
}
