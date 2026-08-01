/**
 * Option pools a nested `@{uuid}` ref can resolve against, and which one wins.
 *
 * The engine's precedence is embedded-first: if the referenced wildcard is ALSO
 * a module picked into the same Context node, that node's frozen snapshot
 * supplies the pool and the live library is never consulted. Only when the uuid
 * is absent from the node does the library answer (see
 * `wp_nodes/context_node.py:_expand_catalog_via_live_db`).
 *
 * The hover card used to read the library unconditionally, so a node holding a
 * drifted snapshot reported the library's numbers while the graph ran the
 * snapshot's — "the SPA says 1 of 11 options match, the graph says 0 of 10".
 * The counts were each correct about a different pool, and nothing said which.
 *
 * This module answers "what will actually run" by mirroring the engine's
 * precedence, and keeps the losing pool around so the card can say the library
 * has moved on rather than silently hiding it.
 *
 * Pure + graph-free so it unit-tests without a canvas; the widget provides the
 * built map and `RefChip` injects it (the chip sits six components below the
 * widget, and every layer in between is agnostic about pools).
 */
import type { InjectionKey, Ref } from "vue";

/** One wildcard's pool, as a Context node holds it. */
export interface ContextPool {
  uuid: string;
  /** Display name of the module inside the node — not necessarily the library
   *  row's name, since a node-local rename is an instance override. */
  name: string;
  /** Per-option `sub_categories`, one array per option in declaration order.
   *  Same shape `preview-resolver` exposes for library rows, so the card's
   *  filter-match maths is identical whichever pool wins. */
  tagSets: string[][];
  /** The pool's DECLARED sub-category vocabulary — what the filter picker
   *  offers as checkboxes. Distinct from `tagSets`, which is what each option
   *  actually carries: a declared tag with no option using it is offerable but
   *  matches nothing. */
  subCategories: string[];
  /** Declared tag groups (axis → tags), for the picker's grouped layout. */
  tagGroups: Record<string, string[]>;
  /** Whether the pool declares a null option, which drives the picker's
   *  exclude-null toggle. */
  hasNull: boolean;
}

export type ContextPoolMap = ReadonlyMap<string, ContextPool>;

/** Injection key for the per-node pool map. `undefined` where no Context node
 *  is an ancestor — the SPA library views, for instance, where every ref
 *  necessarily resolves against the library. */
export const CONTEXT_POOLS_KEY = Symbol("wp-context-pools") as InjectionKey<
  Ref<ContextPoolMap>
>;

/**
 * Injection key for "which OTHER nodes hold this uuid".
 *
 * A function rather than a map because answering it means walking the whole
 * graph, and the answer is only ever read while a hover card is open — doing
 * that eagerly, on every render of every chip, would be pure waste.
 *
 * Provided only on the canvas; the SPA has no graph to walk.
 */
export const FOREIGN_POOL_LOOKUP_KEY = Symbol(
  "wp-foreign-pool-lookup",
) as InjectionKey<(uuid: string) => string[]>;

/** Minimal shape of a node module this builder reads. */
interface ModuleLike {
  id?: unknown;
  type?: unknown;
  meta?: { name?: unknown } | unknown;
  payload?: unknown;
}

const onlyStrings = (xs: unknown): string[] =>
  Array.isArray(xs) ? xs.filter((s): s is string => typeof s === "string") : [];

function optionTagSets(payload: unknown): string[][] {
  const options = (payload as { options?: unknown } | null)?.options;
  if (!Array.isArray(options)) return [];
  return options.map((o) => onlyStrings((o as { sub_categories?: unknown } | null)?.sub_categories));
}

/** Declared tag groups, narrowed to `axis → string[]`. Mirrors
 *  `buildWildcardRefData`'s handling so the picker renders a node pool and a
 *  library row identically. */
function tagGroupsOf(payload: unknown): Record<string, string[]> {
  const raw = (payload as { tag_groups?: unknown } | null)?.tag_groups;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [axis, tags] of Object.entries(raw as Record<string, unknown>)) {
    out[axis] = onlyStrings(tags);
  }
  return out;
}

function hasNullOption(payload: unknown): boolean {
  const options = (payload as { options?: unknown } | null)?.options;
  if (!Array.isArray(options)) return false;
  return options.some((o) => Boolean((o as { is_null?: unknown } | null)?.is_null));
}

/**
 * Build the uuid → pool map for one Context node's module list.
 *
 * Wildcards only: they are the only kind with an option pool, and the only
 * kind a `@{uuid}` ref can target.
 *
 * Disabled modules are INCLUDED deliberately. A disabled module still supplies
 * its pool to nested refs at run time — disabling stops it binding its own
 * `$var`, it does not remove it from the node — so excluding it here would make
 * the card disagree with the engine in exactly the situation where a user is
 * already confused about where a value came from.
 */
export function buildContextPools(modules: readonly unknown[] | undefined): ContextPoolMap {
  const map = new Map<string, ContextPool>();
  for (const raw of modules ?? []) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as ModuleLike;
    if (m.type !== "wildcard") continue;
    if (typeof m.id !== "string" || m.id.length === 0) continue;
    // First writer wins: if the same uuid is picked twice, the earlier entry is
    // the one the engine's catalog build keeps.
    if (map.has(m.id)) continue;
    const meta = (m.meta ?? {}) as { name?: unknown };
    map.set(m.id, {
      uuid: m.id,
      name: typeof meta.name === "string" ? meta.name : "",
      tagSets: optionTagSets(m.payload),
      subCategories: onlyStrings(
        (m.payload as { sub_categories?: unknown } | null)?.sub_categories,
      ),
      tagGroups: tagGroupsOf(m.payload),
      hasNull: hasNullOption(m.payload),
    });
  }
  return map;
}

/** Which pool a ref will actually resolve against. */
export type PoolSource = "context" | "library";

export interface ResolvedPool {
  source: PoolSource;
  tagSets: string[][];
  /** Module name, when the context supplied the pool. */
  name?: string;
  /** Option count of the pool that LOST, when the two disagree. `undefined`
   *  when there is no second pool or the two agree — the card only mentions
   *  the loser to explain a discrepancy, never as noise. */
  otherTotal?: number;
}

/**
 * Apply the engine's precedence to one ref.
 *
 * `libraryTagSets` is the live-library pool (`undefined` when the row is
 * unknown / not yet fetched). Returns `null` when neither pool exists, which
 * the card renders as "not in library".
 */
export function resolvePoolFor(
  uuid: string,
  pools: ContextPoolMap | undefined,
  libraryTagSets: string[][] | undefined,
): ResolvedPool | null {
  const ctx = pools?.get(uuid);
  if (ctx) {
    const drifted =
      libraryTagSets !== undefined && libraryTagSets.length !== ctx.tagSets.length;
    return {
      source: "context",
      tagSets: ctx.tagSets,
      name: ctx.name,
      ...(drifted ? { otherTotal: libraryTagSets.length } : {}),
    };
  }
  if (libraryTagSets && libraryTagSets.length > 0) {
    return { source: "library", tagSets: libraryTagSets };
  }
  return null;
}

/**
 * The per-wildcard maps the `@{}` autocomplete and its step-2 sub-category
 * picker read. Structural mirror of `buildWildcardRefData`'s result, declared
 * here so this module stays free of manager-layer imports.
 *
 * `uuidToName` is deliberately absent: it holds each wildcard's VARIABLE
 * binding, which is what the chip labels itself with. A node-local rename
 * changes the module's display name, not its binding, so overlaying it would
 * relabel chips with the wrong thing.
 */
export interface RefPickerData {
  uuidToSubCategories: Map<string, string[]>;
  uuidToTagGroups: Map<string, Record<string, string[]>>;
  uuidToHasNull: Map<string, boolean>;
  uuidToOptionTagSets: Map<string, string[][]>;
  uuidToOptionsCount: Map<string, number>;
}

/**
 * Overlay the node's own pools on top of library-derived picker data.
 *
 * The picker's tag checkboxes were built purely from the library, but the
 * engine filters a nested ref against the NODE's pool whenever that uuid is
 * also a module in the node. On a drifted snapshot the two disagree, and the
 * picker would offer a tag no option in the running pool carries — pick it and
 * the ref resolves to nothing, which is precisely the dead end that made the
 * original bug so hard to read.
 *
 * Same precedence `resolvePoolFor` applies to the hover card, so the card, the
 * picker and the engine now agree on one pool.
 *
 * Returns new Maps; the inputs are left alone (they are `computed` results
 * shared with other consumers).
 */
export function overlayContextPools<T extends RefPickerData>(
  library: T,
  pools: ContextPoolMap | undefined,
): T {
  if (!pools || pools.size === 0) return library;
  const merged: RefPickerData = {
    uuidToSubCategories: new Map(library.uuidToSubCategories),
    uuidToTagGroups: new Map(library.uuidToTagGroups),
    uuidToHasNull: new Map(library.uuidToHasNull),
    uuidToOptionTagSets: new Map(library.uuidToOptionTagSets),
    uuidToOptionsCount: new Map(library.uuidToOptionsCount),
  };
  for (const [uuid, pool] of pools) {
    merged.uuidToSubCategories.set(uuid, pool.subCategories);
    merged.uuidToTagGroups.set(uuid, pool.tagGroups);
    merged.uuidToHasNull.set(uuid, pool.hasNull);
    merged.uuidToOptionTagSets.set(uuid, pool.tagSets);
    merged.uuidToOptionsCount.set(uuid, pool.tagSets.length);
  }
  return { ...library, ...merged };
}
