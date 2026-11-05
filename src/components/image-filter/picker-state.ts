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
  return !!edit && (edit.positive !== undefined || edit.negative !== undefined || !!edit.mask || !!edit.label);
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

/** Rename one image's label; empty or the default drops the rename. */
export function withLabel(current: PickEdits, key: string, text: string, fallback: string): PickEdits {
  const next: PickEdits = { ...current };
  const edit: PickEdit = { ...(next[key] ?? {}) };
  const clean = cleanLabel(text);
  if (clean && clean !== fallback) edit.label = clean;
  else delete edit.label;
  if (hasEdit(edit)) next[key] = edit;
  else delete next[key];
  return next;
}

/** Labels are one line, at most `MAX_LABEL` characters (engine `clean_label`). */
export const MAX_LABEL = 200;
export function cleanLabel(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(" ").slice(0, MAX_LABEL);
}

/** True when an edit changes what goes on (a prompt or a mask; a label rides apart). */
export function isRefined(edit: PickEdit | undefined): boolean {
  return !!edit && (edit.positive !== undefined || edit.negative !== undefined || !!edit.mask);
}

/** The edits to send: only for images that go on. */
export function editsFor(all: PickEdits, keys: readonly string[]): PickEdits | undefined {
  const out: PickEdits = {};
  for (const k of keys) {
    const edit = all[k];
    if (!edit || !isRefined(edit)) continue;
    // Labels go on their own (`labels` on the answer).
    const rest: PickEdit = { ...edit };
    delete rest.label;
    out[k] = rest;
  }
  return Object.keys(out).length ? out : undefined;
}

const MODE_KEY = "wp-image-filter-mode";
const TILE_KEY = "wp-image-filter-tile";
/** Before the three modes: "opens zoomed" and "Fit" flags. Read once as the defaults. */
const OLD_ZOOM_KEY = "wp-image-filter-zoom";
const OLD_FIT_KEY = "wp-image-filter-fit";

export type PickerMode = "grid" | "detail" | "zoom";
export type TileSize = "s" | "m" | "l" | "fit";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the picker just opens with the defaults.
  }
}

/** The mode the picker opens in (the one it was left in last time). */
export function readModePref(): PickerMode {
  const v = read(MODE_KEY);
  if (v === "grid" || v === "detail" || v === "zoom") return v;
  return read(OLD_ZOOM_KEY) === "1" ? "detail" : "grid";
}
export function writeModePref(mode: PickerMode): void {
  write(MODE_KEY, mode);
  write(OLD_ZOOM_KEY, null);
}

/** The Grid mode's tile size; Fit makes the images as big as the picker allows. */
export function readTilePref(): TileSize {
  const v = read(TILE_KEY);
  if (v === "s" || v === "m" || v === "l" || v === "fit") return v;
  return read(OLD_FIT_KEY) === "1" ? "fit" : "m";
}
export function writeTilePref(size: TileSize): void {
  write(TILE_KEY, size);
  write(OLD_FIT_KEY, null);
}

/** The largest side of a tile at each size: a lone batch, a frame card, a sweep table cell. */
export const TILE_PX: Record<Exclude<TileSize, "fit">, { flat: number; frame: number; table: number }> = {
  s: { flat: 120, frame: 96, table: 80 },
  m: { flat: 200, frame: 150, table: 120 },
  l: { flat: 320, frame: 240, table: 200 },
};

export interface FitBox {
  /** Space for the images (px). */
  width: number;
  height: number;
  /** Gap between cells and what each cell adds around its image (frame card). */
  gap: number;
  extraW: number;
  extraH: number;
}

/** The largest square bound (the tile's max width = max height) that lays
 *  `count` images of height/width `aspect` out in `box` without scrolling,
 *  over every column count. Clamped to 80..1600. */
export function fitTileSize(count: number, aspect: number, box: FitBox): number {
  if (count <= 0 || box.width <= 0 || box.height <= 0) return 200;
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const wPer = Math.min(1, 1 / a);
  const hPer = Math.min(1, a);
  let best = 0;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const w = (box.width - box.gap * (cols - 1)) / cols - box.extraW;
    const h = (box.height - box.gap * (rows - 1)) / rows - box.extraH;
    best = Math.max(best, Math.min(w / wPer, h / hPer));
  }
  return Math.round(Math.min(1600, Math.max(80, best)));
}
