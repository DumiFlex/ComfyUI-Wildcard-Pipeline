/**
 * Bundle insert-time glue.
 *
 * Given a bundle library entry + the index where it's being inserted
 * into a Context's `modules[]`, produces:
 *   1. The list of module entries to splice into `modules[]` — each
 *      one a deserialized child snapshot with regenerated uuid +
 *      `bundle_origin` stamped + fresh `_uid` for Vue v-for keys.
 *   2. A `BundleInstance` record to push into `ContextWidgetValue.bundles[]`
 *      with `start_idx` / `end_idx` covering the spliced range.
 *
 * Caller (ContextWidget) is responsible for the actual splice +
 * BundleInstance push + writing back the new widget value.
 *
 * Bundle children carry the same fields top-level modules do
 * (id, type, payload, instance, _uid, payload_hash) plus an optional
 * `bundle_origin` pointer back to the parent BundleInstance._uid.
 * The engine ignores `bundle_origin`; it's a frontend-only marker
 * for the bundle frame renderer + the bundle-aware menu logic.
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
   *  Each entry already has `id` regenerated, `_uid` minted,
   *  `bundle_origin` stamped, and any `@{uuid}` refs rewritten. */
  modulesToSplice: Array<ChildSnapshot & {
    _uid: string;
    bundle_origin: string;
    payload_hash?: string;
  }>;
  /** BundleInstance to push into `ContextWidgetValue.bundles[]`.
   *  Already has `library_id`, `start_idx`, `end_idx`,
   *  `inserted_at_hash` filled in. */
  bundleInstance: BundleInstance;
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
  const bundleInstance = emptyBundleInstance(entry.id);
  bundleInstance.start_idx = insertIdx;
  bundleInstance.end_idx = insertIdx + entry.children.length - 1;
  bundleInstance.inserted_at_hash = entry.payload_hash;
  // Denormalize library metadata onto the instance so the bundle
  // header can render immediately + saved workflows retain the
  // name/color even if the library entry gets renamed or deleted.
  bundleInstance.name = entry.name;
  bundleInstance.color = entry.color ?? null;

  // Children keep their ORIGINAL library uuids — that's what the
  // existing per-kind drift logic (`isDrifted` / `isMissingFromLibrary`)
  // matches against. Regenerating ids here breaks the library link
  // and surfaces every child as "missing".
  //
  // Multi-instance bundles (same bundle inserted twice into one
  // Context) intentionally produce children that share `id` — same
  // pattern existing modules use when duplicate-fork'd. Per-instance
  // disambiguation lives in `_uid` (fresh per row).
  //
  // Known limitation: constraints + @{uuid} refs inside a bundle
  // that target other bundle children will cross-talk between
  // instances. Documented as v2 polish — adds bundle-scope-aware
  // ref resolution.
  const modulesToSplice = entry.children.map((c) => ({
    ...c,
    _uid: newRowUid(),
    bundle_origin: bundleInstance._uid,
  }));

  return { modulesToSplice, bundleInstance };
}
