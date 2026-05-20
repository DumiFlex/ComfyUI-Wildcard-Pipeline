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
 *  cannot itself contain a bundle child. */
export function buildLibraryChildren(
  target: BundleInstance,
  modules: ModuleEntry[],
  bundles: BundleInstance[],
): Record<string, unknown>[] {
  const innerByLeadingIdx = new Map<number, BundleInstance>();
  const skipIndices = new Set<number>();
  for (const ib of bundles) {
    if (ib.parent_uid !== target._uid) continue;
    innerByLeadingIdx.set(ib.start_idx, ib);
    for (let i = ib.start_idx; i <= ib.end_idx; i++) skipIndices.add(i);
  }
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
    if (m) out.push(toChildSnapshot(m));
  }
  return out;
}
