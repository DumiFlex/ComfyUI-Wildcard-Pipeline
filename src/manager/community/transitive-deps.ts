/**
 * Pure transitive-dependency closure walker for community posts (Feature 2).
 *
 * BFS from the root slugs, expanding each post's dependency slugs (fetched via
 * the injected `fetchDeps`), deduped + cycle-safe, bounded by `maxPosts`.
 * Returns the full set of slugs to download (roots included) + whether the cap
 * was hit (so the caller can warn instead of silently truncating).
 *
 * No I/O of its own — `fetchDeps` is injected so it's unit-testable and the
 * caller controls the real community fetch.
 */
export interface TransitiveDepsResult {
  /** All slugs in the closure, roots first, deduped. */
  slugs: string[];
  /** True if the walk stopped at `maxPosts` before exhausting the graph. */
  capped: boolean;
}

export async function collectTransitiveDeps(
  rootSlugs: string[],
  fetchDeps: (slug: string) => Promise<string[]>,
  opts: { maxPosts?: number } = {},
): Promise<TransitiveDepsResult> {
  const maxPosts = opts.maxPosts ?? 50;
  const seen = new Set<string>();
  const order: string[] = [];
  const queue: string[] = [];

  for (const s of rootSlugs) {
    if (!seen.has(s)) {
      seen.add(s);
      order.push(s);
      queue.push(s);
    }
  }

  let capped = false;
  while (queue.length > 0) {
    if (order.length > maxPosts) {
      capped = true;
      break;
    }
    const slug = queue.shift() as string;
    let deps: string[];
    try {
      deps = await fetchDeps(slug);
    } catch {
      // A post we can't resolve deps for: keep it in the closure (already
      // added) but don't expand. The caller's install surfaces a real
      // fetch/install error for it.
      continue;
    }
    for (const d of deps) {
      if (!seen.has(d)) {
        seen.add(d);
        order.push(d);
        queue.push(d);
      }
    }
  }

  // Trim to the cap (the > check above lets one extra in before flagging).
  const slugs = capped ? order.slice(0, maxPosts) : order;
  return { slugs, capped };
}
