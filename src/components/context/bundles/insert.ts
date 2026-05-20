/**
 * Bundle insert-time glue.
 *
 * Given a bundle library entry + the index where it's being inserted
 * into a Context's `modules[]`, produces:
 *   1. The flat list of leaf modules to splice into `modules[]`. Each
 *      leaf is a deep-cloned child snapshot with `_uid` minted +
 *      `bundle_origin` stamped at its immediate bundle's `_uid`.
 *   2. One or more `BundleInstance` records to push into
 *      `ContextWidgetValue.bundles[]`. Tier-2 nesting (an inner-bundle
 *      reference) produces TWO instances: the outer (no `parent_uid`)
 *      and the inner (`parent_uid` points at the outer's `_uid`). Both
 *      cover overlapping ranges over `modules[]`; the outer's span
 *      contains the inner's.
 *
 * The caller (ContextWidget) is responsible for the actual splice +
 * BundleInstance push + writing back the new widget value.
 *
 * Bundle children carry the same fields top-level modules do
 * (id, type, payload, instance, _uid, payload_hash) plus an optional
 * `bundle_origin` pointer back to the parent BundleInstance._uid.
 * The engine ignores `bundle_origin`; it's a frontend marker for the
 * bundle frame renderer + the bundle-aware menu logic AND the bundle
 * enable-gate (engine reads bundle_origin via deserialize_node_input
 * to apply BundleInstance.enabled at execute time).
 */
import {
  emptyBundleInstance,
  newRowUid,
  type BundleInstance,
} from "../../../widgets/_shared";
import { type ChildSnapshot } from "./uuid-remap";

/** Minimal shape of a bundle library entry — same shape the
 *  `/wp/api/bundles/{id}` endpoint returns. Frontend doesn't need
 *  every field (description, tags, etc) for insertion; this interface
 *  documents the subset insertion consumes. */
export interface BundleLibraryEntry {
  id: string;
  name: string;
  color?: string | null;
  children: ChildSnapshot[];
  payload_hash: string;
}

/** Output shape from `buildBundleInsertion`. */
export interface BundleInsertion {
  /** Module rows to `modules.splice(insertIdx, 0, ...modulesToSplice)`.
   *  Each entry already has `_uid` minted, `bundle_origin` stamped
   *  (at the immediate bundle's `_uid`), `collapsed: true`. */
  modulesToSplice: Array<ChildSnapshot & {
    _uid: string;
    bundle_origin: string;
    payload_hash?: string;
  }>;
  /** BundleInstance for the outer bundle. Always present. */
  bundleInstance: BundleInstance;
  /** BundleInstances for any inner-bundle references inside the outer.
   *  Each has `parent_uid` set to the outer's `_uid` + a range covering
   *  just its own leaves. Empty when the outer has no bundle children.
   *  Tier-2 cap guarantees these inner instances themselves have no
   *  bundle children, so the list is flat (no recursion). */
  innerInstances: BundleInstance[];
}

/** Builds the splice payload for inserting a bundle into a Context at
 *  the given module-list index. The caller's splice happens AFTER
 *  this returns; this function just produces the canonical shape +
 *  metadata.
 *
 *  Empty bundles produce zero modules; their BundleInstance ends up
 *  with `end_idx < start_idx` which the renderer treats as "no
 *  children, dissolve the frame on next interaction". Saves a special-
 *  case at the call-site. */
export function buildBundleInsertion(
  entry: BundleLibraryEntry,
  insertIdx: number,
): BundleInsertion {
  const outer = emptyBundleInstance(entry.id);
  outer.inserted_at_hash = entry.payload_hash;
  outer.name = entry.name;
  outer.color = entry.color ?? null;

  // Walk the entry's children, expanding any bundle-typed reference
  // inline. Each leaf gets a fresh _uid and a bundle_origin pointing
  // at the bundle whose snapshot it came from (the outer for direct
  // leaves, the inner BundleInstance for inner-bundle leaves). The
  // tier-2 API cap guarantees inner-bundle children are themselves
  // leaves — no recursion needed.
  const modulesToSplice: BundleInsertion["modulesToSplice"] = [];
  const innerInstances: BundleInstance[] = [];

  for (const c of entry.children) {
    if (c.type === "bundle") {
      const innerChildren = (c as ChildSnapshot & { children?: ChildSnapshot[] }).children;
      if (!Array.isArray(innerChildren) || innerChildren.length === 0) {
        // Missing reference (server flagged `_missing_ref`) or empty
        // inner bundle — drop the entry. The outer BundleInstance's
        // drift detection still surfaces staleness via inserted_at_hash.
        continue;
      }
      const innerLibraryId = typeof c.id === "string" ? c.id : "";
      const inner = emptyBundleInstance(innerLibraryId);
      inner.parent_uid = outer._uid;
      inner.name = (c as { name?: string }).name ?? innerLibraryId;
      inner.color = (c as { color?: string | null }).color ?? null;
      // Inner bundle's start_idx = the next module position post-splice.
      // end_idx fills in once we know how many leaves it contributes.
      const innerStart = insertIdx + modulesToSplice.length;
      for (const gc of innerChildren) {
        modulesToSplice.push({
          ...(gc as ChildSnapshot),
          _uid: newRowUid(),
          bundle_origin: inner._uid,
          collapsed: true,
        });
      }
      inner.start_idx = innerStart;
      inner.end_idx = innerStart + innerChildren.length - 1;
      innerInstances.push(inner);
      continue;
    }
    // Direct leaf: belongs to the outer.
    modulesToSplice.push({
      ...c,
      _uid: newRowUid(),
      bundle_origin: outer._uid,
      collapsed: true,
    });
  }

  outer.start_idx = insertIdx;
  outer.end_idx = insertIdx + modulesToSplice.length - 1;

  return { modulesToSplice, bundleInstance: outer, innerInstances };
}
