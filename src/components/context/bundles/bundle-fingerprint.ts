/**
 * Bundle MOD detection — content fingerprint helpers.
 *
 * A BundleInstance carries a `snapshot_fingerprint` captured at the
 * moments the bundle is "in sync" with its library snapshot:
 *
 *   - Insert from library (`onPickBundle`)
 *   - Cross-node receive (cross-node bundle drop)
 *   - Save to library (`saveBundleToLibrary`)
 *   - Reset to library (`resetBundleToLibrary`)
 *   - Backfill on initial workflow load (false-clean baseline)
 *
 * After any of those, the local children equal the library snapshot,
 * so the stored fingerprint == the live fingerprint. Subsequent user
 * edits (payload tweaks, refresh-from-module-library, drag-out,
 * drag-in, etc.) shift one of the inputs and the fingerprints
 * diverge — `bundleSnapshotModified` flips true and the UI surfaces a
 * "modified" badge on the bundle header.
 *
 * What the fingerprint covers (and why):
 *
 *   - leaf `_uid`        → add/remove of children (uid set changes)
 *   - leaf `bundle_origin` → drag-out of a child / inner-bundle membership
 *   - leaf `payload_hash` → user edit OR refresh-from-module-library
 *
 * What it deliberately does NOT cover (v1 scope):
 *
 *   - Inner BundleInstance properties (name, color, collapsed state).
 *     These are runtime UI / cosmetic — round-trip already preserves
 *     names via library, and collapsed state is per-instance UI.
 *   - Per-row `instance` overrides (locked_seed, etc). They're tracked
 *     by the existing `isModified(m)` per-card MOD signal; folding
 *     them into bundle fingerprint would double-count. The bundle's
 *     own MOD reflects STRUCTURAL change, not per-leaf overrides.
 *
 * Pure functions — no DOM, no Vue, no I/O.
 */

import type { BundleInstance, ModuleEntry } from "../../../widgets/_shared";

/** djb2 hash → 8 hex chars. Small, order-sensitive, collision rate
 *  acceptable for ~10 children × 12-char-uid + hash strings (the
 *  largest realistic bundle). Not cryptographic; we only need
 *  inequality to surface a diff. */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Build the per-leaf signature string fed into the hash. Order
 *  matters: rearranging leaves inside a bundle changes the fingerprint.
 *  Empty/missing fields collapse to "" so a leaf without a
 *  bundle_origin (top-level) still hashes deterministically. */
function leafSignature(m: ModuleEntry & { bundle_origin?: string }): string {
  const uid = m._uid ?? "";
  const origin = m.bundle_origin ?? "";
  const hash = m.payload_hash ?? "";
  return `${uid}|${origin}|${hash}`;
}

/** Stable content fingerprint of a bundle's children at the current
 *  state of `modules[]`. Returns "0" for empty bundles (sentinel range
 *  end_idx < start_idx) so they hash distinctly from a 1-child bundle.
 */
export function computeBundleFingerprint(
  bundle: BundleInstance,
  modules: ModuleEntry[],
): string {
  if (bundle.end_idx < bundle.start_idx) return "0";
  const parts: string[] = [];
  for (let i = bundle.start_idx; i <= bundle.end_idx; i++) {
    const m = modules[i] as (ModuleEntry & { bundle_origin?: string }) | undefined;
    if (!m) continue;
    parts.push(leafSignature(m));
  }
  return djb2(parts.join("\n"));
}

/** True when the bundle's current children diverge from the snapshot
 *  fingerprint stored on the instance. Returns FALSE when no
 *  fingerprint is stored — that's the backfill case for workflows
 *  saved before MOD detection landed, treated as "clean baseline" so
 *  upgrades don't spuriously light up. */
export function bundleSnapshotModified(
  bundle: BundleInstance,
  modules: ModuleEntry[],
): boolean {
  if (!bundle.snapshot_fingerprint) return false;
  return computeBundleFingerprint(bundle, modules) !== bundle.snapshot_fingerprint;
}
