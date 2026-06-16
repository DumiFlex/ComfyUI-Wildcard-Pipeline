/**
 * Bundle "extract to library" (Feature 4).
 *
 * Pure transform: take a bundle's frozen child snapshots and produce
 * standalone library-module entities with FRESH ids, remapping every
 * intra-bundle reference (constraint source/target ids + nested `@{uuid}`)
 * to the new ids. References pointing OUTSIDE the extracted set stay
 * verbatim (they'll resolve against whatever lives in the target library,
 * or become ordinary danglers eligible for reattach).
 *
 * Bundle-typed children are skipped (a nested bundle isn't a leaf module);
 * the count is returned so the caller can surface "N skipped". Per-instance
 * overrides are intentionally NOT extracted — a library module is the
 * definition (payload), instance overrides are graph-specific.
 *
 * No I/O. The id minter is injected (defaults to `newShortId`) so tests can
 * assert deterministic remaps.
 */
import { newShortId } from "../../../manager/utils/ids";
import { walkRemap } from "./uuid-remap";

/** Minimal child-snapshot shape this reads. Bundle children carry more
 *  (`instance`, `enabled`, `payload_hash`…) — ignored here. */
export interface ExtractableChild {
  id: string;
  type: string;
  payload?: Record<string, unknown>;
  meta?: { name?: string; description?: string; tags?: string[] };
}

/** A standalone library-module entity ready to install (engine-row shape). */
export interface ExtractedModule {
  id: string;
  type: string;
  name: string;
  description?: string;
  tags?: string[];
  payload: Record<string, unknown>;
}

export interface ExtractResult {
  modules: ExtractedModule[];
  /** oldChildId → freshId, for every extracted leaf. */
  remap: Record<string, string>;
  /** count of bundle-typed children skipped. */
  skipped: number;
}

export function extractBundleChildren(
  children: ExtractableChild[],
  mintId: () => string = newShortId,
): ExtractResult {
  const leaves = children.filter((c) => c.type !== "bundle");
  const skipped = children.length - leaves.length;

  // Pass 1: mint a fresh id for every leaf so intra-bundle refs can resolve
  // against the COMPLETE table (a constraint's sibling may come later).
  const remap: Record<string, string> = {};
  for (const c of leaves) remap[c.id] = mintId();

  // Pass 2: walkRemap each payload with the full table + lift meta → fields.
  const modules: ExtractedModule[] = leaves.map((c) => {
    const mod: ExtractedModule = {
      id: remap[c.id],
      type: c.type,
      name: c.meta?.name ?? c.id,
      payload: walkRemap(c.payload ?? {}, remap) as Record<string, unknown>,
    };
    if (c.meta?.description) mod.description = c.meta.description;
    if (c.meta?.tags && c.meta.tags.length > 0) mod.tags = c.meta.tags;
    return mod;
  });

  return { modules, remap, skipped };
}
