/**
 * Per-module collision classifier. Pure function.
 *
 *   no-collision    — UUID absent from receiver library.
 *   silent-skip     — UUID + content fingerprint both match. True dup.
 *   conflict        — UUID matches AND library row carries a fingerprint
 *                     that differs from the incoming row. Definitely
 *                     modified content; user picks Skip / Replace /
 *                     Import as new.
 *   exists-unknown  — UUID matches but the library row carries NO
 *                     stored fingerprint (legacy row pre-dating the
 *                     fingerprint backfill, or a bundle row which
 *                     never gets a stored fingerprint in this picker).
 *                     We cannot prove the row is modified — just that
 *                     it already exists by id. Badged "EXISTING"
 *                     (drift / amber), distinct from the orange
 *                     "MODIFIED" badge so users aren't misled into
 *                     thinking every legacy row has drifted.
 *
 * Operates on module rows uniformly via `moduleFingerprint`. Bundles
 * are out of scope here — they have their own MOD detection flow via
 * `bundle-fingerprint.ts`; the caller (picker UI) routes bundle
 * collision detection separately if needed.
 */

import { moduleFingerprint, type ModuleRow } from "./fingerprint";

export type CollisionState =
  | "no-collision"
  | "silent-skip"
  | "conflict"
  | "exists-unknown";

export interface LibraryRow {
  snapshot_fingerprint?: string;
}

export function detectCollisions(
  incoming: Array<ModuleRow & { id: string }>,
  library: Map<string, LibraryRow>,
): Record<string, CollisionState> {
  const result: Record<string, CollisionState> = {};
  for (const entity of incoming) {
    const id = entity.id;
    const libRow = library.get(id);
    if (!libRow) {
      result[id] = "no-collision";
      continue;
    }
    const libFp = libRow.snapshot_fingerprint;
    if (!libFp) {
      // Library row exists but we have no fingerprint to compare. Surface
      // the presence-only state instead of falsely promising "MODIFIED".
      result[id] = "exists-unknown";
      continue;
    }
    const incomingFp = moduleFingerprint(entity);
    result[id] = incomingFp === libFp ? "silent-skip" : "conflict";
  }
  return result;
}
