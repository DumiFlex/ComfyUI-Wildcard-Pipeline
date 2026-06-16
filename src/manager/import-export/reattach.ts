/**
 * Install-time reference reattachment (spec §4).
 *
 * Pure helper: given ONE referencing module's referenced uuids + the
 * installing post's dependency edges + a view of the local library, decide
 * which referenced uuids should be remapped to which local module ids.
 *
 * The match is the slug-bridge: a referenced uuid X (a constraint
 * source/target id, or a nested `@{X}` ref) is associated with a community
 * post slug S by the post's own dependency edge `{module_id: X, slug: S}`;
 * a local module installed from S carries `community_post_slug == S`. So
 * X reattaches to that local module's id. No new server data — the edge
 * already carries both module_id + slug (community `dependencies.list_for_post`).
 *
 * No I/O, no store access, never throws. A uuid it can't confidently map is
 * simply absent from the result, so `walkRemap` leaves it untouched.
 */

/** One dependency edge from the installing post. `module_id` is the
 *  depended-on post's published module uuid (== the referenced uuid);
 *  optional because a dep with no published version yet reports null. */
export interface InstallDependencyEdge {
  module_id?: string;
  slug: string;
}

/** referenced uuid (publisher id) → local module id to remap it to. */
export type ReattachRemap = Record<string, string>;

/**
 * Build the remap table for ONE referencing module being installed.
 *
 * @param refUuids     `listReferencedUuids(module)` — constraint source/target + nested `@{}` uuids.
 * @param deps         the installing post's dependency edges.
 * @param localBySlug  community_post_slug → local module ids (array → ambiguity detectable).
 * @param liveLocalIds ids that already resolve locally (exact-match short-circuit).
 * @param renameMap    collision renames applied THIS install (oldId → freshId).
 */
export function buildReattachRemap(
  refUuids: string[],
  deps: InstallDependencyEdge[],
  localBySlug: Map<string, string[]>,
  liveLocalIds: Set<string>,
  renameMap: Record<string, string>,
): ReattachRemap {
  // First dep edge wins per module_id (a well-formed post has one edge each).
  const slugByModuleId = new Map<string, string>();
  for (const d of deps) {
    const mid = d.module_id;
    if (typeof mid === "string" && mid && typeof d.slug === "string" && d.slug) {
      if (!slugByModuleId.has(mid)) slugByModuleId.set(mid, d.slug);
    }
  }

  const out: ReattachRemap = {};
  for (const uuid of refUuids) {
    // 1. A co-installed entity got renamed-on-collision → follow the rename.
    const renamed = renameMap[uuid];
    if (renamed) {
      out[uuid] = renamed;
      continue;
    }
    // 2. Already resolves locally at the same id → nothing to do.
    if (liveLocalIds.has(uuid)) continue;
    // 3. Slug-bridge via the post's dependency edge.
    const slug = slugByModuleId.get(uuid);
    if (!slug) continue;
    const locals = localBySlug.get(slug);
    if (!locals || locals.length !== 1) continue; // zero or ambiguous → skip
    out[uuid] = locals[0];
  }
  return out;
}
