/**
 * Picker state that has to outlive the modal: tucking the picker away
 * unmounts it, and the edits made so far must be there when it reopens.
 * Module-level, in the picker's lazy chunk (which stays loaded once fetched).
 */
import type { PickEdit, PickEdits } from "./types";

const edits = new Map<string, PickEdits>();

/** Edits made so far on one waiting request. */
export function draftEdits(token: string): PickEdits {
  return { ...(edits.get(token) ?? {}) };
}

export function saveDraftEdits(token: string, next: PickEdits): void {
  edits.set(token, next);
}

export function dropDraftEdits(token: string): void {
  edits.delete(token);
}

/** True when an edit carries anything. */
export function hasEdit(edit: PickEdit | undefined): boolean {
  return !!edit && (edit.positive !== undefined || edit.negative !== undefined || !!edit.mask);
}

/**
 * Set (or clear, when it matches the original) one prompt on a group of
 * images. With Same shape a frame's picks share one prompt, so the picker
 * passes every image of the frame; with One per image just the one.
 */
export function withText(
  current: PickEdits,
  keys: readonly string[],
  field: "positive" | "negative",
  text: string,
  original: string | undefined,
): PickEdits {
  const next: PickEdits = { ...current };
  for (const key of keys) {
    const edit: PickEdit = { ...(next[key] ?? {}) };
    if (text === (original ?? "")) delete edit[field];
    else edit[field] = text;
    if (hasEdit(edit)) next[key] = edit;
    else delete next[key];
  }
  return next;
}

export function withMask(current: PickEdits, key: string, mask: string): PickEdits {
  const next: PickEdits = { ...current };
  const edit: PickEdit = { ...(next[key] ?? {}) };
  if (mask) edit.mask = mask;
  else delete edit.mask;
  if (hasEdit(edit)) next[key] = edit;
  else delete next[key];
  return next;
}

/** The edits to send: only for images that go on. */
export function editsFor(all: PickEdits, keys: readonly string[]): PickEdits | undefined {
  const out: PickEdits = {};
  for (const k of keys) if (hasEdit(all[k])) out[k] = all[k];
  return Object.keys(out).length ? out : undefined;
}

const ZOOM_KEY = "wp-image-filter-zoom";

/** Whether the picker opens zoomed in (remembered from last time). */
export function readZoomPref(): boolean {
  try {
    return localStorage.getItem(ZOOM_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeZoomPref(on: boolean): void {
  try {
    if (on) localStorage.setItem(ZOOM_KEY, "1");
    else localStorage.removeItem(ZOOM_KEY);
  } catch {
    // Storage blocked: the picker just opens in the grid.
  }
}
