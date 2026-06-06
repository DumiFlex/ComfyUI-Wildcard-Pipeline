/**
 * Per-module collision classifier. Pure function.
 *
 *   no-collision    — UUID absent from receiver library.
 *   type-conflict   — UUID present but the live row is a DIFFERENT kind
 *                     (the 8-hex module id-space is shared across all 5
 *                     kinds). Only safe resolution is install-as-new;
 *                     replace/refresh would clobber an unrelated item.
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

import {
  moduleFingerprint,
  templateFingerprint,
  type ModuleRow,
  type TemplateRow,
} from "./fingerprint";

export type CollisionState =
  | "no-collision"
  | "type-conflict"
  | "silent-skip"
  | "conflict"
  | "exists-unknown";

export interface LibraryRow {
  /**
   * Entity kind of the live row. When present, an incoming entity of a
   * DIFFERENT kind at the same id is a `type-conflict` (the module
   * id-space is shared across all 5 kinds). Optional so legacy callers
   * that only carry a fingerprint keep their existing behavior.
   */
  type?: string;
  snapshot_fingerprint?: string;
  /**
   * Template content fingerprint (djb2 over the template's literal
   * fields; see `templateFingerprint`). Templates carry no
   * `snapshot_fingerprint`, so the orchestrator stamps this on the live
   * row and `detectTemplateCollisions` compares it against the incoming
   * row's recomputed fingerprint.
   */
  template_fingerprint?: string;
}

/**
 * Library-side row for `classifyOne`: the entity `type` plus an opaque
 * `contentKey`. The key is whatever the CALLER compares — the import
 * picker passes the module `snapshot_fingerprint`; the in-graph workflow
 * drift path passes the `payload_hash`. `classifyOne` never interprets
 * the key, it only checks equality, so a single verdict serves both.
 */
export interface ClassifyRow {
  type?: string;
  contentKey?: string | null;
}

/**
 * Classify ONE entity against its (optional) live-library row. The shared
 * identity verdict used by the import picker, the install collision
 * pre-check, and the in-graph workflow drift/missing path.
 *
 * Ordered — `type` gates BEFORE the content-key check, so a cross-kind id
 * clash can never be mislabeled as content drift. The type gate runs
 * independently of content-key availability (a null/empty key never masks
 * a type clash). `incomingContentKey` is the caller's content key for the
 * incoming entity (fingerprint or payload_hash — must match what it stores
 * in `ClassifyRow.contentKey`).
 */
export function classifyOne(
  incomingType: string,
  incomingContentKey: string,
  libRow: ClassifyRow | undefined,
): CollisionState {
  if (!libRow) return "no-collision";
  if (libRow.type !== undefined && libRow.type !== incomingType) return "type-conflict";
  const libKey = libRow.contentKey;
  if (!libKey) {
    // Library row exists but we have no content key to compare. Surface
    // the presence-only state instead of falsely promising "MODIFIED".
    return "exists-unknown";
  }
  return incomingContentKey === libKey ? "silent-skip" : "conflict";
}

export function detectCollisions(
  incoming: Array<ModuleRow & { id: string }>,
  library: Map<string, LibraryRow>,
): Record<string, CollisionState> {
  const result: Record<string, CollisionState> = {};
  for (const entity of incoming) {
    const libRow = library.get(entity.id);
    result[entity.id] = classifyOne(
      entity.type,
      moduleFingerprint(entity),
      libRow ? { type: libRow.type, contentKey: libRow.snapshot_fingerprint } : undefined,
    );
  }
  return result;
}

/**
 * Template collision classifier. Same state machine as
 * `detectCollisions`, but templates collide on `id` and compare the
 * NEW `templateFingerprint` (computed on both sides) instead of the
 * server-supplied `snapshot_fingerprint`:
 *
 *   no-collision   — id absent from receiver library.
 *   silent-skip    — id matches AND template fingerprints match. True dup.
 *   conflict       — id matches AND fingerprints differ. User picks
 *                    Skip / Replace / Import as new.
 *   exists-unknown — id matches but the library row carries no
 *                    `template_fingerprint`. Defensive fallback only —
 *                    the orchestrator always stamps one, so this should
 *                    not arise in normal flow; badged EXISTING rather
 *                    than overclaiming MODIFIED.
 */
export function detectTemplateCollisions(
  incoming: Array<TemplateRow & { id: string }>,
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
    const libFp = libRow.template_fingerprint;
    if (!libFp) {
      result[id] = "exists-unknown";
      continue;
    }
    const incomingFp = templateFingerprint(entity);
    result[id] = incomingFp === libFp ? "silent-skip" : "conflict";
  }
  return result;
}
