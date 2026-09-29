/**
 * Library tags — the free-form labels on modules, bundles and templates.
 *
 * They are the library's many-to-many grouping (a module can be "outfit" AND
 * "nsfw"), shown in the sidebar and on the Tags page. Not the same thing as a
 * wildcard option's sub-categories, which live inside the payload.
 *
 * Counted client-side from the catalogs the layout already holds, so the
 * sidebar updates the moment a row's tags change.
 */

export interface LibraryTagCount {
  tag: string;
  modules: number;
  bundles: number;
  templates: number;
  total: number;
}

interface Tagged { tags?: string[] | null }

/** One entry per distinct tag, most-used first, ties by name. */
export function libraryTagCounts(
  modules: readonly Tagged[],
  bundles: readonly Tagged[],
  templates: readonly Tagged[],
): LibraryTagCount[] {
  const map = new Map<string, LibraryTagCount>();
  const add = (rows: readonly Tagged[], key: "modules" | "bundles" | "templates") => {
    for (const r of rows) {
      // A row carrying the same tag twice (hand-edited import) counts once.
      for (const t of new Set(r.tags ?? [])) {
        let e = map.get(t);
        if (!e) {
          e = { tag: t, modules: 0, bundles: 0, templates: 0, total: 0 };
          map.set(t, e);
        }
        e[key] += 1;
        e.total += 1;
      }
    }
  };
  add(modules, "modules");
  add(bundles, "bundles");
  add(templates, "templates");
  return [...map.values()].sort((a, b) => b.total - a.total || a.tag.localeCompare(b.tag));
}

export type TagMatchMode = "any" | "all";

/** Whether a row's tags pass the tag filter. No wanted tags passes everything. */
export function matchesTags(
  rowTags: readonly string[] | null | undefined,
  wanted: readonly string[],
  mode: TagMatchMode,
): boolean {
  if (wanted.length === 0) return true;
  const have = new Set(rowTags ?? []);
  return mode === "all" ? wanted.every((t) => have.has(t)) : wanted.some((t) => have.has(t));
}
