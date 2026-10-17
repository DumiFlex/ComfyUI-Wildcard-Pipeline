import type { BundleInstance, ModuleEntry } from "../../widgets/_shared";
import { classifyOne, type CollisionState } from "../../manager/import-export/collision";
import { bundleHashes, hashes as libraryHashes } from "./drift-store";

/**
 * Library verdicts for canvas rows and bundles — missing / drifted /
 * type-clash for a module, drifted / missing / unlinked for a bundle —
 * read from the shared drift-store poll. Every predicate answers "not
 * yet" (false / null) until the first poll lands so nothing flashes.
 */

/**
 * True when a module's id isn't in the live library set. Modules
 * with no `payload_hash` are treated as LOCAL-ONLY by design (no
 * library tie expected). This covers two cases at once:
 *   - inline-created `fixed_values` entries (never had a library
 *     row — payload_hash never set)
 *   - duplicates of any kind (the duplicate path strips
 *     payload_hash so the clone reads as local; see `duplicateModule`)
 *
 * Returns false until `libraryHashes` first loads so we don't flash
 * "missing" everywhere while the initial fetch is in flight.
 */
/**
 * Identity verdict of an embedded row against the live library — or null
 * until the first poll lands / for local-only rows (no payload_hash).
 * Single source for the card dots. Content key is `payload_hash`, so
 * drift semantics match the historical behavior (content-only); the
 * `type` gate is the new cross-kind clash detector. Shared verdict logic
 * lives in `classifyOne` (import-export/collision).
 */
export function matchStateOf(m: ModuleEntry): CollisionState | null {
  if (libraryHashes.value === null) return null;
  const live = libraryHashes.value[m.id];
  if (!m.payload_hash) {
    // No local hash. Only meaningful when the uuid IS in the library — a
    // workflow copy that lost its hash (malformed import, or a builder that
    // wrote payload_hash: ""). Treat as drift so the bulk "refresh drifted"
    // button relinks it. A genuinely inline module (fresh uuid, not in the
    // library) stays verdict-less exactly as before.
    return live ? "conflict" : null;
  }
  return classifyOne(
    m.type,
    m.payload_hash,
    live ? { type: live.type, contentKey: live.payload_hash } : undefined,
  );
}

export function isMissingFromLibrary(m: ModuleEntry): boolean {
  return matchStateOf(m) === "no-collision";
}

/**
 * Drift = library still has this uuid (SAME kind), but the live
 * `payload_hash` differs from what was embedded at pick time. Independent
 * of `isModified` (user overrides). Mutually exclusive with the clash
 * state below — a different-kind row is `type-conflict`, not drift.
 */
export function isDrifted(m: ModuleEntry): boolean {
  return matchStateOf(m) === "conflict";
}

/**
 * Type clash = the live library row at this uuid is a DIFFERENT kind (the
 * 8-hex id-space is shared across all 5 kinds). Refresh / Push-update
 * would clobber an unrelated item, so the card offers neither — only
 * "Push to library…" as a fresh entry.
 */
export function isTypeConflict(m: ModuleEntry): boolean {
  return matchStateOf(m) === "type-conflict";
}

// Per-bundle drift count — sums isDrifted over the bundle's child
// range. Drives the `${count} drifted` suffix on the bundle header
// subtitle so users can glance-spot bundles whose children fell out
// of sync with their library snapshots. Read at render time so the
// libraryHashes poll naturally feeds updates without a watcher.
export function bundleChildDriftCount(bundle: BundleInstance, mods: ModuleEntry[]): number {
  let n = 0;
  for (let i = bundle.start_idx; i <= bundle.end_idx; i++) {
    if (isDrifted(mods[i])) n++;
  }
  return n;
}

/** True when the bundle library entry has changed since this bundle
 *  was inserted: compare the locally captured `inserted_at_hash` with
 *  the freshest hash from the polled `bundleHashes` map. Returns false
 *  until first poll lands so the UI doesn't flash a drift state before
 *  the truth is known. Distinct from per-child drift — a library may
 *  have a new payload_hash even when every embedded child still
 *  matches its individual snapshot (e.g. the library author only
 *  reordered children, or swapped a child the user previously
 *  detached locally). */
export function isBundleLibraryDrifted(bundle: BundleInstance): boolean {
  const map = bundleHashes.value;
  if (map === null) return false;
  const live = map[bundle.library_id];
  if (live === undefined) return false;
  if (!bundle.inserted_at_hash) return false;
  return live !== bundle.inserted_at_hash;
}

/** True when the bundle has NO live library entry behind it. Covers both
 *  shapes of that: it carries a `library_id` the polled map no longer knows,
 *  OR it carries no `library_id` at all.
 *
 *  The second case used to early-return false, so an unlinked bundle could
 *  never show MISSING — leaving MODIFIED as its only badge, which then
 *  compared its children against a snapshot baseline from a library entry that
 *  isn't there. "Modified against what?" was a fair question with no answer.
 *
 *  Returns false until the first poll lands so we don't flash MISSING before
 *  the truth is known. */
export function isBundleMissingFromLibrary(bundle: BundleInstance): boolean {
  const map = bundleHashes.value;
  if (map === null) return false;
  if (!bundle.library_id) return true;
  return !(bundle.library_id in map);
}

/** True when the bundle never had a library entry to diverge FROM — no
 *  `library_id` at all. MODIFIED is meaningless in that state: there is no
 *  insert to be modified since. Distinct from "the entry was deleted", where
 *  the local snapshot IS a real baseline and MOD still reads correctly. */
export function isBundleUnlinked(bundle: BundleInstance): boolean {
  return bundleHashes.value !== null && !bundle.library_id;
}
