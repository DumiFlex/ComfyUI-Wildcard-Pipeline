/**
 * Per-module version-history helpers.
 *
 * History is stored as a sidecar inside `payload.history`: an array of the
 * last `HISTORY_MAX` saved snapshots, oldest first. The sidecar lives inside
 * the payload itself (not on `ModuleRow`) so it round-trips cleanly through
 * the existing API without backend schema changes — the engine handlers all
 * use `payload.get(...)` so the extra key is ignored.
 *
 * On save, the editor:
 *   1. Reads existing history from the *current* payload via `readHistory`.
 *   2. Builds a snapshot of the *pre-save* record (name/desc/cat/tags/payload),
 *      passing the pre-save payload through `stripHistory` so snapshots never
 *      recurse.
 *   3. Appends the snapshot via `appendSnapshot`, trimming to `HISTORY_MAX`.
 *   4. Writes the new payload as `{ ...newPayload, history: nextHistory }`.
 */
import type { ModuleHistoryEntry } from "../api/types";

export const HISTORY_MAX = 3;

const HISTORY_KEY = "history";

export interface SnapshotInput {
  name: string;
  description?: string;
  category_id?: string | null;
  tags?: string[];
  /** Pre-save payload — stored value comes from `oldPayload` argument; this
   *  field is accepted for API symmetry but is otherwise ignored. */
  payload?: Record<string, unknown>;
}

/** Read the history sidecar from a module's payload. Returns `[]` if missing. */
export function readHistory(payload: unknown): ModuleHistoryEntry[] {
  if (!payload || typeof payload !== "object") return [];
  const raw = (payload as Record<string, unknown>)[HISTORY_KEY];
  if (!Array.isArray(raw)) return [];
  // Filter out malformed entries so a corrupt save can't poison the panel.
  return raw.filter((e): e is ModuleHistoryEntry => {
    if (!e || typeof e !== "object") return false;
    const r = e as Record<string, unknown>;
    return typeof r.saved_at === "string" && typeof r.name === "string";
  });
}

/**
 * Append a snapshot of the pre-save record, trimming to `HISTORY_MAX`.
 *
 * The new payload's `history` array is the OLD record's history plus the
 * given snapshot, so saving N times preserves the last `HISTORY_MAX`
 * versions (oldest dropped first).
 *
 * The snapshot's stored payload is run through `stripHistory` to avoid
 * recursive nesting of history-in-history.
 */
export function appendSnapshot(
  oldRecord: SnapshotInput,
  oldPayload: Record<string, unknown>,
): ModuleHistoryEntry[] {
  const prev = readHistory(oldPayload);
  // The snapshot's stored payload comes from `oldPayload` (the pre-save
  // payload), with `history` stripped so saved snapshots never recurse.
  // `oldRecord.payload` is accepted for API compatibility but the canonical
  // source of truth is `oldPayload` — the spec is `payload: stripHistory(oldPayload)`.
  const snapshot: ModuleHistoryEntry = {
    saved_at: new Date().toISOString(),
    name: oldRecord.name,
    description: oldRecord.description,
    category_id: oldRecord.category_id ?? null,
    tags: oldRecord.tags ? [...oldRecord.tags] : [],
    payload: stripHistory(oldPayload),
  };
  const next = [...prev, snapshot];
  // Keep last HISTORY_MAX (oldest dropped).
  return next.length > HISTORY_MAX ? next.slice(next.length - HISTORY_MAX) : next;
}

/** Return a copy of `payload` with the `history` key removed. Pure. */
export function stripHistory(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return {};
  // Object spread with destructuring drops `history` cleanly without mutating
  // the input.
  const { [HISTORY_KEY]: _omit, ...rest } = payload;
  void _omit;
  return rest;
}
