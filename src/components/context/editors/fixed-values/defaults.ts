/**
 * Pure helpers for the fixed-values v2 modal. No Vue imports — these
 * are reusable shape utilities for the row state machine and the
 * `instance.values_overrides` patch shaper.
 *
 * Engine semantics (engine/modules/fixed_values_handler.py): when
 * `values_overrides` is a non-empty list, the engine ignores
 * `payload.values` entirely and emits one binding per override row.
 * So the UI must always emit the FULL effective row list (library
 * defaults + user diffs + instance-added rows) when any override is
 * active. Collapses to null when nothing diverges from library.
 *
 * See: docs/superpowers/specs/2026-05-09-instance-overrides-v2-fixed-values-design.md
 */

export interface LibraryRow {
  id: string;
  name: string;
  value: string;
}

export interface DraftRow {
  id: string;
  name: string;
  value: string;
  enabled: boolean;
  /** Original library row id when this draft maps to one. `null` for
   *  instance-added rows that have no library counterpart. */
  libraryId: string | null;
}

export type OverrideKind = "none" | "value" | "name" | "both" | "added";

export function effectiveRow(
  library: LibraryRow | undefined,
  override: { id: string; name: string; value: string } | undefined,
): { id: string; name: string; value: string } {
  if (override) return override;
  if (library) return library;
  throw new Error("effectiveRow called with neither library nor override");
}

export function rowOverrideKind(
  library: LibraryRow | undefined,
  override: { id: string; name: string; value: string } | undefined,
): OverrideKind {
  if (!library) return override ? "added" : "none";
  if (!override) return "none";
  const nameDiff = override.name !== library.name;
  const valueDiff = override.value !== library.value;
  if (nameDiff && valueDiff) return "both";
  if (nameDiff) return "name";
  if (valueDiff) return "value";
  return "none";
}

export function rowEnabled(
  rowId: string,
  enabledOptions: readonly string[] | null | undefined,
): boolean {
  if (!Array.isArray(enabledOptions)) return true;
  return enabledOptions.includes(rowId);
}

/**
 * Shape the `values_overrides` patch for the engine. Returns the full
 * row list (library + diffs + added) when any override exists, null
 * when nothing diverges from library so the engine falls through to
 * `payload.values`.
 *
 * Disabled rows still appear in the array — the engine drops them
 * separately via `instance.enabled_options`. Keeping them in the
 * values list means re-enabling never loses the row.
 */
export function shapeValuesPatch(
  draft: readonly DraftRow[],
  library: readonly LibraryRow[],
): Array<{ id: string; name: string; value: string }> | null {
  const libIds = new Set(library.map((r) => r.id));
  const libById = new Map(library.map((r) => [r.id, r]));

  const anyAdded = draft.some((r) => r.libraryId === null);
  const anyDisabled = draft.some((r) => !r.enabled);
  const anyDiff = draft.some((r) => {
    if (r.libraryId === null) return true;
    const lib = libById.get(r.libraryId);
    if (!lib) return true;
    return lib.name !== r.name || lib.value !== r.value;
  });
  const sameOrder = draft.every((r, i) => r.libraryId === library[i]?.id);
  const sameSet = draft.length === library.length
    && draft.every((r) => r.libraryId !== null && libIds.has(r.libraryId));

  if (!anyAdded && !anyDisabled && !anyDiff && sameOrder && sameSet) {
    return null;
  }

  return draft.map((r) => ({ id: r.id, name: r.name, value: r.value }));
}
