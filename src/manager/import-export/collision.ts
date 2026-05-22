/**
 * Per-module collision classifier. Pure function.
 *
 *   no-collision   — UUID absent from receiver library.
 *   silent-skip    — UUID + content fingerprint both match. True dup.
 *   conflict       — UUID matches but fingerprint differs (or library
 *                    row missing fingerprint). User picks
 *                    Skip / Replace / Import as new.
 *
 * Operates on module rows uniformly via `moduleFingerprint`. Bundles
 * are out of scope here — they have their own MOD detection flow via
 * `bundle-fingerprint.ts`; the caller (picker UI) routes bundle
 * collision detection separately if needed.
 */

import { moduleFingerprint, type ModuleRow } from "./fingerprint";

export type CollisionState = "no-collision" | "silent-skip" | "conflict";

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
      result[id] = "conflict";
      continue;
    }
    const incomingFp = moduleFingerprint(entity);
    result[id] = incomingFp === libFp ? "silent-skip" : "conflict";
  }
  return result;
}
