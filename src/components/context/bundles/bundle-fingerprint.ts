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

/** Stable JSON-like stringify with sorted keys — small enough for the
 *  scoped shapes we hash (`meta`, `instance`). Output is deterministic
 *  for objects (key order doesn't depend on insertion), arrays keep
 *  their declared order. Used to fold per-leaf metadata + instance
 *  overrides into the bundle fingerprint so name / variable_binding
 *  / per-card instance edits flip the bundle's MOD signal even when
 *  payload_hash is unchanged. */
function stableStringify(value: unknown): string {
  if (value == null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    // Drop the `_ui` namespace — that's transient scratch state (last
    // locked seed cached for the seed lock toggle, etc.) and we don't
    // want it counting as a "user edit" for bundle MOD purposes.
    if (k === "_ui") continue;
    parts.push(JSON.stringify(k) + ":" + stableStringify(obj[k]));
  }
  return "{" + parts.join(",") + "}";
}

/** Build the per-leaf signature string fed into the hash. Order
 *  matters: rearranging leaves inside a bundle changes the fingerprint.
 *  Empty/missing fields collapse to "" so a leaf without a
 *  bundle_origin (top-level) still hashes deterministically.
 *
 *  Folds in `meta` + `instance` so per-card edits the user perceives
 *  as "I changed something inside this bundle" (display name, variable
 *  binding override, locked seed, per-rule disables, …) flip the
 *  bundle's modified badge even when those edits don't bump the row's
 *  own `payload_hash`. Previously fingerprint covered only structural
 *  shape (uid / bundle_origin / payload_hash) and silently missed
 *  identity/instance changes — user reported that editing a module
 *  inside a bundle didn't surface the bundle-level MOD signal. */
function leafSignature(m: ModuleEntry & { bundle_origin?: string }): string {
  const uid = m._uid ?? "";
  const origin = m.bundle_origin ?? "";
  const hash = m.payload_hash ?? "";
  const meta = stableStringify(m.meta ?? {});
  const inst = stableStringify(m.instance ?? {});
  return `${uid}|${origin}|${hash}|${meta}|${inst}`;
}

/** Stable content fingerprint of a bundle's children at the current
 *  state of `modules[]`. Returns "0" for empty bundles (sentinel range
 *  end_idx < start_idx) so they hash distinctly from a 1-child bundle.
 */
/** Version prefix on every fingerprint string. Bumped when the
 *  signature shape changes so existing stored fingerprints from an
 *  older shape don't permanently mark a bundle "modified" against a
 *  baseline that was computed under a different formula.
 *
 *  v1 = uid|origin|hash only (initial MOD detection).
 *  v2 = + meta + instance via stableStringify (folds per-card name +
 *       variable binding + locked_seed + … into the bundle MOD).
 *
 *  `bundleSnapshotModified` treats a stored value lacking the current
 *  prefix as "stale baseline" — returns false, lets the existing
 *  backfill pass re-snap it cleanly on the next commit. Bundles
 *  saved before the bump appear as clean (not modified) on first
 *  load after the upgrade, then track edits correctly from there. */
const FINGERPRINT_VERSION = "v2";

export function computeBundleFingerprint(
  bundle: BundleInstance,
  modules: ModuleEntry[],
): string {
  if (bundle.end_idx < bundle.start_idx) return `${FINGERPRINT_VERSION}:0`;
  const parts: string[] = [];
  for (let i = bundle.start_idx; i <= bundle.end_idx; i++) {
    const m = modules[i] as (ModuleEntry & { bundle_origin?: string }) | undefined;
    if (!m) continue;
    parts.push(leafSignature(m));
  }
  return `${FINGERPRINT_VERSION}:${djb2(parts.join("\n"))}`;
}

/** True when the bundle's current children diverge from the snapshot
 *  fingerprint stored on the instance. Returns FALSE when:
 *   - no fingerprint stored (workflow predates MOD detection), OR
 *   - stored fingerprint uses an older format version (auto-rebaselined
 *     on next commit via the version-aware `ensureBundleFingerprints`
 *     check at the caller).
 *  Both fall into the same "clean baseline" path so upgrades don't
 *  spuriously light up the modified badge on unmodified bundles. */
export function bundleSnapshotModified(
  bundle: BundleInstance,
  modules: ModuleEntry[],
): boolean {
  const stored = bundle.snapshot_fingerprint;
  if (!stored) return false;
  if (!stored.startsWith(`${FINGERPRINT_VERSION}:`)) return false;
  return computeBundleFingerprint(bundle, modules) !== stored;
}

/** True when a stored fingerprint string is current — used by the
 *  ensure-fingerprints backfill pass to detect stale-version
 *  baselines and recompute them. */
export function isFingerprintCurrent(stored: string | undefined): boolean {
  if (!stored) return false;
  return stored.startsWith(`${FINGERPRINT_VERSION}:`);
}
