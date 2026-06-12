/**
 * Bundle insert-time UUID remapping.
 *
 * Bundles save deep-cloned child snapshots with the original library
 * uuids intact. When the same bundle is inserted into a Context twice,
 * those uuids would collide. This module:
 *
 *   1. Regenerates a fresh 12-char hex id for every child.
 *   2. Walks every child's `payload` + `instance` recursively, rewriting:
 *      - bare-string fields whose value matches an old id → new id
 *      - any `@{<hex>}` substring inside string values, when the hex
 *        matches a key in the remap table → `@{<new-id>}`
 *
 * Refs to modules OUTSIDE the bundle (uuids not in the remap table)
 * stay verbatim — they'll resolve against whatever lives in the target
 * Context (or fail to resolve, like any other unresolved ref).
 *
 * Pure-TS, no engine imports. Safe to import from frontend bundle code.
 */

import { newRowUid } from "../../../widgets/_shared";

export interface ChildSnapshot {
  id: string;
  type: string;
  payload?: Record<string, unknown>;
  instance?: Record<string, unknown>;
  /** Any other module fields (entries, meta, etc) pass through unchanged. */
  [key: string]: unknown;
}

export interface RemapResult {
  /** Children with regenerated ids + remapped payload/instance. */
  children: ChildSnapshot[];
  /** Old-id → new-id mapping. Surfaced so callers can stamp
   *  `bundle_origin` or do any additional rewriting that needs to
   *  know what was remapped. */
  remap: Record<string, string>;
}

// Canonical `@{uuid[#name][:subcat]}` form. Captures the uuid + the
// optional `#name` cache + the optional `:subcat` list as separate
// groups so the remap rewrites only the uuid and preserves the rest
// verbatim. Pre-2026-05 pure-uuid refs still match because both
// inner groups are optional.
const REF_RE = /@\{([0-9a-f]{6,16})(#[^#:}@{]*)?(:[^}]*)?\}/gi;

/** Deep walks an unknown value, applying the remap. Returns a new
 *  object — never mutates input. Exported so the cascade-restore path
 *  can re-point constraint source/target + `@{}` refs at restored module
 *  uuids using a partial remap table (not a full id regen). */
export function walkRemap(value: unknown, remap: Record<string, string>): unknown {
  if (typeof value === "string") {
    let out = value;
    // Whole-string match — e.g. constraint.source_wildcard_id = "src11111"
    if (remap[out] !== undefined) {
      out = remap[out];
    }
    // Embedded `@{uuid}` refs — e.g. wildcard option text "see @{abc} here"
    out = out.replace(REF_RE, (whole, uuid: string, nameSeg?: string, subSeg?: string) => {
      const r = remap[uuid];
      if (!r) return whole;
      // Preserve the cached `#name` + `:subcat` segments verbatim —
      // only the uuid gets remapped. Without this the remap path
      // stripped the suffix and broke the display label / filter.
      return `@{${r}${nameSeg ?? ""}${subSeg ?? ""}}`;
    });
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((v) => walkRemap(v, remap));
  }
  if (value && typeof value === "object") {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      obj[k] = walkRemap(v, remap);
    }
    return obj;
  }
  return value;
}

/** Regenerate every child uuid in the snapshot list, then deep-walk
 *  every child's `payload` + `instance` rewriting any references to
 *  match. Constraint source/target ids + `@{uuid}` text refs all flow
 *  through `walkRemap` since they live inside `payload` / `instance`. */
export function remapBundleUuids(children: ChildSnapshot[]): RemapResult {
  const remap: Record<string, string> = {};
  for (const c of children) {
    remap[c.id] = newRowUid();
  }
  const remapped: ChildSnapshot[] = children.map((c) => {
    const next: ChildSnapshot = { ...c, id: remap[c.id] };
    if (c.payload) {
      next.payload = walkRemap(c.payload, remap) as Record<string, unknown>;
    }
    if (c.instance) {
      next.instance = walkRemap(c.instance, remap) as Record<string, unknown>;
    }
    return next;
  });
  return { children: remapped, remap };
}
