/**
 * D3b — import-time content-duplicate detection (pure).
 *
 * An incoming entity whose uuid does NOT collide still installs as a brand-new
 * library row, even when a row with byte-identical content already exists
 * under a DIFFERENT uuid. Re-importing an iterated pack that way multiplies
 * duplicate rows, and every workflow pointing at the older uuid drifts away
 * from the one the user just installed.
 *
 * This finds those cases so the picker can OFFER "link to the existing row"
 * (a `link` CollisionDecision — drop the incoming entity + remap refs onto
 * the existing id). Never applied automatically: it only reports, and only
 * when the answer is unambiguous.
 *
 * Content identity is `moduleFingerprint` (type + name + description + sorted
 * tags + payload_hash), the same key the import collision picker already
 * compares — so "identical" here means identical the way the rest of the
 * import pipeline means it.
 *
 * Pure — no store, no fetch, no Vue.
 */
import { moduleFingerprint, type ModuleRow } from "./fingerprint";

/** A live library row reduced to what duplicate detection needs. */
export interface LibraryContentRow {
  id: string;
  type: string;
  /** `moduleFingerprint` of the live row (or its stored snapshot_fingerprint). */
  fingerprint: string;
}

/**
 * Map incoming entity id -> existing library id holding identical content.
 *
 * An entry is emitted only when EXACTLY ONE library row of the same kind
 * matches the incoming fingerprint and carries a different id. Zero matches
 * means it's genuinely new; two or more is ambiguous and stays a deliberate
 * user choice (mirrors `autoRelinkTarget`). A row matching at the SAME id is
 * an ordinary uuid collision, already handled by `classifyOne`.
 */
export function findContentDuplicates(
  incoming: ReadonlyArray<ModuleRow & { id: string }>,
  library: ReadonlyArray<LibraryContentRow>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entity of incoming) {
    const fp = moduleFingerprint(entity);
    const matches = library.filter(
      (row) => row.fingerprint === fp && row.type === entity.type && row.id !== entity.id,
    );
    if (matches.length === 1) out[entity.id] = matches[0].id;
  }
  return out;
}

/**
 * The subset of content duplicates worth OFFERING a link for: the incoming
 * id must not already exist in the library. An incoming id that DOES exist
 * is an ordinary uuid collision — the batch-conflict path already asks
 * skip/replace/rename for it, and surfacing a second competing question
 * about the same row would be noise.
 *
 * `libraryIds` is the id set of the live library (the same map the collision
 * detector reads).
 */
export function findLinkableDuplicates(
  incoming: ReadonlyArray<ModuleRow & { id: string }>,
  library: ReadonlyArray<LibraryContentRow>,
  libraryIds: ReadonlySet<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, targetId] of Object.entries(findContentDuplicates(incoming, library))) {
    if (!libraryIds.has(id)) out[id] = targetId;
  }
  return out;
}
