/**
 * Bundle save-to-library helpers.
 *
 * Mirror of `insert.ts` for the opposite direction: given a Context's
 * live `modules[]` + `bundles[]`, reconstruct the canonical library
 * `children[]` shape the server expects on PUT.
 *
 * The interesting case is nested (tier-2) bundles. The outer's
 * `modules[]` range contains a mix of:
 *   - the outer's direct leaves (`bundle_origin === outer._uid`)
 *   - leaves owned by an inner BundleInstance (`bundle_origin ===
 *     inner._uid`, where the inner's `parent_uid === outer._uid`).
 *
 * On save we must emit one bundle-reference entry per inner — NOT a
 * flat dump of its leaves. The server stores references by id and
 * re-expands them on read, so:
 *   - flat-dumping would freeze the inner's leaves at save time,
 *     breaking the live-resolution contract (the reason references
 *     exist in the first place).
 *   - the server's `_normalise_bundle_children` strips bundle-typed
 *     entries to ref-only fields anyway, so any extra payload on a
 *     bundle child would be discarded — emitting the bare ref shape
 *     matches the stored shape exactly.
 *
 * Pure helpers — no Vue / no DOM. Used by ContextWidget's
 * saveBundleToLibrary, exercised by `save.test.ts`.
 */
import type { BundleInstance, ModuleEntry } from "../../../widgets/_shared";

/** Canonical ChildSnapshot dict for a leaf module — strips per-instance
 *  fields (`_uid`, `bundle_origin`). Shared by saveBundleToLibrary +
 *  wrapIntoNewBundle so the library shape stays consistent. */
export function toChildSnapshot(m: ModuleEntry): Record<string, unknown> {
  return {
    id: m.id, type: m.type, enabled: m.enabled, collapsed: m.collapsed,
    meta: m.meta, entries: m.entries, payload: m.payload,
    instance: m.instance, payload_hash: m.payload_hash,
  };
}

/** Rebuild a bundle library entry's `children[]` from the live Context
 *  state for a save-to-library round-trip.
 *
 *  Walks the outer bundle's range over `modules[]` and emits:
 *    - direct leaves as full snapshots (`toChildSnapshot`)
 *    - each nested inner bundle as a single `{type:"bundle", id, name,
 *      color}` reference at its leading index; subsequent leaves of
 *      that inner are skipped (the server re-expands them on read).
 *
 *  Inner BundleInstances are recognised via `parent_uid === target._uid`.
 *  Tier-2 cap (one hop max) means we never need to recurse — an inner
 *  cannot itself contain a bundle child.
 *
 *  Defensive integrity check: any module in `target`'s range whose
 *  `bundle_origin` points at a bundle uid that's neither `target._uid`
 *  nor one of the detected inners is an "orphan" — its owning bundle
 *  either has the wrong `parent_uid` or doesn't exist. Such modules
 *  serialise as direct children of `target`, which silently flattens
 *  the user's intended nesting. We surface the orphan list so callers
 *  can warn + flag the corrupted state without changing the save
 *  contract (still emits something for every module, never crashes).
 */
export interface LibraryChildrenResult {
  children: Record<string, unknown>[];
  /** Bundle uids of modules whose `bundle_origin` pointed at a bundle
   *  that didn't qualify as an inner of `target` (wrong parent_uid,
   *  missing BundleInstance, or other corruption). Empty in the happy
   *  path. Callers may surface these via toast/log. */
  orphanedInnerUids: string[];
}

export function buildLibraryChildren(
  target: BundleInstance,
  modules: ModuleEntry[],
  bundles: BundleInstance[],
): Record<string, unknown>[] {
  return buildLibraryChildrenWithIntegrity(target, modules, bundles).children;
}

/** Same as `buildLibraryChildren` but returns the orphan-uid set so
 *  the caller can surface a warning. Kept separate from the legacy
 *  signature so existing call sites + tests don't need to destructure. */
export function buildLibraryChildrenWithIntegrity(
  target: BundleInstance,
  modules: ModuleEntry[],
  bundles: BundleInstance[],
): LibraryChildrenResult {
  const innerByLeadingIdx = new Map<number, BundleInstance>();
  const innerUids = new Set<string>();
  const skipIndices = new Set<number>();
  for (const ib of bundles) {
    if (ib.parent_uid !== target._uid) continue;
    innerByLeadingIdx.set(ib.start_idx, ib);
    innerUids.add(ib._uid);
    for (let i = ib.start_idx; i <= ib.end_idx; i++) skipIndices.add(i);
  }
  const orphanedInnerUids = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (let i = target.start_idx; i <= target.end_idx; i++) {
    const inner = innerByLeadingIdx.get(i);
    if (inner) {
      out.push({
        id: inner.library_id,
        type: "bundle",
        name: inner.name ?? null,
        color: inner.color ?? null,
      });
      continue;
    }
    if (skipIndices.has(i)) continue;
    const m = modules[i];
    if (!m) continue;
    const origin = (m as ModuleEntry & { bundle_origin?: string }).bundle_origin;
    // Orphan detection: module claims membership in a bundle that's
    // neither the target nor one of its detected inners. Likely cause:
    // an inner bundle exists with a stale/wrong parent_uid. Save still
    // emits the leaf snapshot so user data isn't lost on round-trip,
    // but the nesting structure is flattened.
    if (origin && origin !== target._uid && !innerUids.has(origin)) {
      orphanedInnerUids.add(origin);
    }
    out.push(toChildSnapshot(m));
  }
  return { children: out, orphanedInnerUids: [...orphanedInnerUids] };
}
