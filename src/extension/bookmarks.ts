/**
 * WP Bookmark — a frontend-only node that marks a spot on the canvas to jump
 * back to. Pure logic only: the stored config, the jump maths and the
 * shortcut combos with their conflict check. The node is registered in
 * `widgets/bookmark.ts`, the live keymap is read in `bookmark-keymap.ts`.
 */

/** Where the bookmark node lands on screen after a jump: a 3×3 grid. */
/** Where the bookmark lands on screen: a 3×3 grid, or "custom", a view the
 *  user set (`view`). */
export type BookmarkAnchor = "tl" | "tc" | "tr" | "ml" | "c" | "mr" | "bl" | "bc" | "br" | "custom";
export type BookmarkZoomMode = "fixed" | "keep";

export interface BookmarkConfig {
  version: 1;
  anchor: BookmarkAnchor;
  /** Fixed: jump to `zoom`. Keep: leave the zoom as it is. */
  zoomMode: BookmarkZoomMode;
  zoom: number;
  /** Canonical combo ("Alt+1", "Ctrl+Shift+K") or "" for none. */
  shortcut: string;
  /** Hex colour for the dock dot and the node's edge, "" for the accent. */
  color: string;
  /** PrimeIcons name without the `pi-` prefix. */
  icon: string;
  /** Hidden: not drawn on the canvas and not clickable there. Only the dock
   *  can show it again. */
  hidden: boolean;
  /** Position in the dock; ties fall back to the title. */
  order: number;
  /** With anchor "custom": the canvas point that goes to the middle of the
   *  free screen (the view the user set), else null. */
  view: { x: number; y: number } | null;
  /** A Step note's number, shown in the dock instead of the icon. Never
   *  stored on a WP Bookmark. */
  step?: number;
}

/** The jump settings a WP Note keeps when it is also a bookmark. */
export type BookmarkJump = Pick<BookmarkConfig, "anchor" | "zoomMode" | "zoom" | "shortcut" | "order" | "view">;

export function jumpFields(c: BookmarkConfig): BookmarkJump {
  return { anchor: c.anchor, zoomMode: c.zoomMode, zoom: c.zoom, shortcut: c.shortcut, order: c.order, view: c.view };
}

export const BOOKMARK_ANCHORS: { id: Exclude<BookmarkAnchor, "custom">; label: string; fx: number; fy: number }[] = [
  { id: "tl", label: "Top left", fx: 0, fy: 0 },
  { id: "tc", label: "Top", fx: 0.5, fy: 0 },
  { id: "tr", label: "Top right", fx: 1, fy: 0 },
  { id: "ml", label: "Left", fx: 0, fy: 0.5 },
  { id: "c", label: "Centre", fx: 0.5, fy: 0.5 },
  { id: "mr", label: "Right", fx: 1, fy: 0.5 },
  { id: "bl", label: "Bottom left", fx: 0, fy: 1 },
  { id: "bc", label: "Bottom", fx: 0.5, fy: 1 },
  { id: "br", label: "Bottom right", fx: 1, fy: 1 },
];

/** ComfyUI's own zoom limits (`DragAndScale.min_scale` / `max_scale`). */
export const BOOKMARK_ZOOM_MIN = 0.1;
export const BOOKMARK_ZOOM_MAX = 10;
/** Gap between the bookmark and the screen edge it is anchored to, in
 *  screen pixels. */
export const BOOKMARK_MARGIN = 24;

export function defaultBookmarkConfig(): BookmarkConfig {
  return {
    version: 1,
    anchor: "tl",
    zoomMode: "fixed",
    zoom: 1,
    shortcut: "",
    color: "",
    icon: "bookmark",
    hidden: false,
    order: 0,
    view: null,
  };
}

function clampZoom(z: number): number {
  return Math.min(BOOKMARK_ZOOM_MAX, Math.max(BOOKMARK_ZOOM_MIN, Math.round(z * 100) / 100));
}

/** Reads a stored bookmark. Anything missing or broken falls back to the
 *  default for that field, so a hand-edited workflow never breaks the node. */
export function parseBookmarkConfig(raw: unknown): BookmarkConfig {
  const base = defaultBookmarkConfig();
  let data: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return base;
    try {
      data = JSON.parse(raw);
    } catch {
      return base;
    }
  }
  if (!data || typeof data !== "object") return base;
  const d = data as Record<string, unknown>;
  const v = d.view as { x?: unknown; y?: unknown } | null | undefined;
  const view = v && typeof v === "object" && typeof v.x === "number" && typeof v.y === "number"
    && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : null;
  // "custom" needs its view; without one it falls back to the default.
  const anchor = d.anchor === "custom" && view ? "custom"
    : BOOKMARK_ANCHORS.find((a) => a.id === d.anchor)?.id ?? base.anchor;
  return {
    version: 1,
    anchor,
    zoomMode: d.zoomMode === "keep" ? "keep" : "fixed",
    zoom: typeof d.zoom === "number" && Number.isFinite(d.zoom) ? clampZoom(d.zoom) : base.zoom,
    shortcut: typeof d.shortcut === "string" ? normalizeCombo(d.shortcut) : "",
    color: typeof d.color === "string" && /^#[0-9a-f]{6}$/i.test(d.color) ? d.color.toLowerCase() : "",
    icon: typeof d.icon === "string" && /^[a-z0-9-]{1,40}$/.test(d.icon) ? d.icon : base.icon,
    hidden: d.hidden === true,
    order: typeof d.order === "number" && Number.isFinite(d.order) ? Math.round(d.order) : 0,
    view: anchor === "custom" ? view : null,
  };
}

// ── jump maths ────────────────────────────────────────────────────────

/** A box on screen: `[left, top, right, bottom]` in CSS pixels, relative to
 *  the canvas element. */
export type ScreenBox = readonly [number, number, number, number];

export interface JumpInput {
  /** The bookmark's box in canvas units, title bar included:
   *  `[x, y, w, h]`. */
  rect: readonly [number, number, number, number];
  /** Visible canvas size in screen (CSS) pixels. */
  viewport: readonly [number, number];
  anchor: BookmarkAnchor;
  scale: number;
  margin?: number;
  /** Screen pixels the host's own bars cover at each edge of the canvas
   *  (`[left, top, right, bottom]`): the sidebar, the breadcrumb and the
   *  floating toolbar. The anchors measure from what is left. */
  inset?: readonly [number, number, number, number];
  /** Boxes the bookmark should not land under (the open dock). */
  avoid?: readonly ScreenBox[];
  /** With anchor "custom": the canvas point to put in the middle of the
   *  free screen. */
  view?: { x: number; y: number } | null;
}

function overlaps(a: ScreenBox, b: ScreenBox): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

/**
 * The smallest move `[dx, dy]` (screen px) that takes `box` off every box in
 * `avoid`, preferring moves that keep it inside `free`. `[0, 0]` when it
 * covers nothing. Each obstacle is cleared in turn, so two docks side by side
 * still work out.
 */
export function clearOf(box: ScreenBox, avoid: readonly ScreenBox[], free: ScreenBox, margin: number): [number, number] {
  let [l, t, r, b] = box;
  let dx = 0;
  let dy = 0;
  for (const o of avoid) {
    if (!overlaps([l, t, r, b], o)) continue;
    const moves: [number, number][] = [
      [o[2] + margin - l, 0],
      [o[0] - margin - r, 0],
      [0, o[3] + margin - t],
      [0, o[1] - margin - b],
    ];
    const inside = (m: [number, number]): boolean =>
      l + m[0] >= free[0] && r + m[0] <= free[2] && t + m[1] >= free[1] && b + m[1] <= free[3];
    const size = (m: [number, number]): number => Math.abs(m[0]) + Math.abs(m[1]);
    const ok = moves.filter(inside);
    const pick = (ok.length ? ok : moves).reduce((best, m) => (size(m) < size(best) ? m : best));
    l += pick[0]; r += pick[0]; t += pick[1]; b += pick[1];
    dx += pick[0]; dy += pick[1];
  }
  return [dx, dy];
}

/**
 * The canvas offset that puts the bookmark at its anchor. LiteGraph draws a
 * canvas point at `(p + offset) * scale`, so the offset that lands canvas
 * point `p` on screen point `s` is `s / scale - p`. The anchor picks both
 * points: the matching corner, edge middle or centre of the bookmark goes to
 * the same spot of the free part of the screen (inside the host's bars),
 * kept `margin` px from its edges. Then, if the bookmark would sit under the
 * dock, it moves the least it can to clear it.
 */
export function jumpOffset(input: JumpInput): [number, number] {
  const a = BOOKMARK_ANCHORS.find((x) => x.id === input.anchor) ?? { fx: 0, fy: 0 };
  const m = input.margin ?? BOOKMARK_MARGIN;
  const s = input.scale;
  const [x, y, w, h] = input.rect;
  const [vw, vh] = input.viewport;
  const [il, it, ir, ib] = input.inset ?? [0, 0, 0, 0];
  if (input.anchor === "custom" && input.view) {
    // The user's own view: its point goes to the middle of the free screen.
    const cx = il + (vw - il - ir) / 2;
    const cy = it + (vh - it - ib) / 2;
    return [cx / s - input.view.x, cy / s - input.view.y];
  }
  const sx = il + m + a.fx * Math.max(0, vw - il - ir - 2 * m);
  const sy = it + m + a.fy * Math.max(0, vh - it - ib - 2 * m);
  let ox = sx / s - (x + a.fx * w);
  let oy = sy / s - (y + a.fy * h);
  if (input.avoid?.length) {
    const box: ScreenBox = [(x + ox) * s, (y + oy) * s, (x + w + ox) * s, (y + h + oy) * s];
    const free: ScreenBox = [il, it, vw - ir, vh - ib];
    const [dx, dy] = clearOf(box, input.avoid, free, m);
    ox += dx / s;
    oy += dy / s;
  }
  return [ox, oy];
}

/** The zoom a jump ends at. */
export function jumpScale(config: BookmarkConfig, current: number): number {
  return config.zoomMode === "keep" ? current : clampZoom(config.zoom);
}

/** Ease-in-out for the jump animation (the same curve ComfyUI's
 *  `animateToBounds` uses). */
export function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

// ── shortcut combos ───────────────────────────────────────────────────

/** The parts of a key combo, in ComfyUI's model (Meta counts as Ctrl). */
export interface ComboParts {
  key: string;
  ctrl?: boolean | undefined;
  alt?: boolean | undefined;
  shift?: boolean | undefined;
  meta?: boolean | undefined;
}

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph", "OS"]);

const KEY_NAMES: Record<string, string> = {
  " ": "Space",
  Spacebar: "Space",
  Esc: "Escape",
  Del: "Delete",
  Left: "ArrowLeft",
  Right: "ArrowRight",
  Up: "ArrowUp",
  Down: "ArrowDown",
};

/** One key name: letters upper-case, a few aliases folded. */
function keyName(key: string): string {
  const k = KEY_NAMES[key] ?? key;
  return k.length === 1 ? k.toUpperCase() : k;
}

/** Builds the canonical "Ctrl+Alt+Shift+K" string. */
export function comboToString(p: ComboParts): string {
  if (!p.key || MODIFIER_KEYS.has(p.key)) return "";
  const parts: string[] = [];
  if (p.ctrl || p.meta) parts.push("Ctrl");
  if (p.alt) parts.push("Alt");
  if (p.shift) parts.push("Shift");
  parts.push(keyName(p.key));
  return parts.join("+");
}

/** Parses "ctrl + shift + k" or "Alt+1" back into its canonical form. */
export function normalizeCombo(text: string): string {
  const raw = text.split("+").map((s) => s.trim()).filter(Boolean);
  if (!raw.length) return "";
  const p: ComboParts = { key: "" };
  for (const part of raw) {
    const low = part.toLowerCase();
    if (low === "ctrl" || low === "control" || low === "cmd" || low === "meta" || low === "mod") p.ctrl = true;
    else if (low === "alt" || low === "option") p.alt = true;
    else if (low === "shift") p.shift = true;
    else p.key = part;
  }
  return comboToString(p);
}

interface KeyEventLike {
  key: string;
  code?: string | undefined;
  ctrlKey?: boolean | undefined;
  metaKey?: boolean | undefined;
  altKey?: boolean | undefined;
  shiftKey?: boolean | undefined;
}

/**
 * The combo a key press makes. Letters and digits come from the physical key
 * (`code`), so Shift+1 stays "Shift+1" rather than "!" and Alt+K stays K on
 * a Mac, where Option turns it into another character.
 */
export function comboFromEvent(e: KeyEventLike): string {
  let key = e.key;
  const code = e.code ?? "";
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  return comboToString({ key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey });
}

/** True for a bare key or Shift+key: these fire while the canvas has focus,
 *  which is fine, but typing past the canvas would trip them. */
export function isBareCombo(combo: string): boolean {
  return !/(^|\+)(Ctrl|Alt)\+/.test(combo);
}

// ── conflicts ─────────────────────────────────────────────────────────

/**
 * Combos the browser keeps for itself on Windows and Linux (no page can
 * claim them reliably). ComfyUI's own list (`@comfyorg/keybindings`
 * `RESERVED_BY_BROWSER`) plus the tab and address-bar keys it leaves out.
 */
export const BROWSER_RESERVED = new Set([
  "Ctrl+T", "Ctrl+W", "Ctrl+N", "Ctrl+Shift+N", "Ctrl+Tab", "Ctrl+Shift+Tab",
  "Ctrl+Shift+Delete", "Ctrl+H", "Ctrl+J", "Ctrl+D", "Ctrl+Shift+B", "Ctrl+Shift+O",
  "Ctrl+Shift+I", "Ctrl+Shift+J", "F5", "Ctrl+F5", "Ctrl+R", "Ctrl+Shift+R", "F7",
  "F11", "F12", "Alt+F4",
  "Ctrl+1", "Ctrl+2", "Ctrl+3", "Ctrl+4", "Ctrl+5", "Ctrl+6", "Ctrl+7", "Ctrl+8", "Ctrl+9",
  "Ctrl+Shift+T", "Ctrl+L", "Ctrl+F", "Ctrl+Q", "Alt+D", "Alt+F", "Alt+Home",
  "Alt+ArrowLeft", "Alt+ArrowRight",
]);

export type ConflictSeverity = "error" | "warning" | "info";

export interface KeyOwner {
  combo: string;
  /** What the combo does, e.g. "Save workflow". */
  label: string;
  /** Who owns it: "ComfyUI", an extension name, "WP Bookmark"… */
  source: string;
}

export interface Conflict {
  severity: ConflictSeverity;
  message: string;
}

/**
 * Everything wrong with using `combo`. `owners` is the live keymap
 * (ComfyUI core, user rebinds, other extensions, other bookmarks); the
 * caller leaves the bookmark being edited out of it.
 */
export function findConflicts(combo: string, owners: readonly KeyOwner[]): Conflict[] {
  if (!combo) return [];
  const out: Conflict[] = [];
  if (BROWSER_RESERVED.has(combo)) {
    out.push({ severity: "error", message: `${combo} belongs to the browser, so it can't be used.` });
  }
  const seen = new Set<string>();
  for (const o of owners) {
    if (o.combo !== combo) continue;
    const key = `${o.source}\u0000${o.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ severity: "warning", message: `Also ${o.label} (${o.source}).` });
  }
  if (isBareCombo(combo)) {
    out.push({
      severity: "info",
      message: "No Ctrl or Alt: it fires whenever the canvas has focus, never while you type.",
    });
  }
  return out;
}

/** Candidates for "Suggest a free combo", in order. Not Alt+Shift (Windows
 *  switches the keyboard layout on it) and not Ctrl+Alt (AltGr types
 *  characters with it on many layouts). */
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const SUGGESTIONS = [
  ...DIGITS.map((k) => `Alt+${k}`),
  ...DIGITS.map((k) => `Ctrl+Shift+${k}`),
  ...["F1", "F2", "F3", "F5", "F6", "F7", "F8", "F9"].map((k) => `Alt+${k}`),
];

/** The first suggestion nobody in `owners` uses, or "" when all are taken. */
export function suggestFreeCombo(owners: readonly KeyOwner[]): string {
  const used = new Set(owners.map((o) => o.combo));
  return SUGGESTIONS.find((c) => !used.has(c) && !BROWSER_RESERVED.has(c)) ?? "";
}

// ── ordering ──────────────────────────────────────────────────────────

export interface BookmarkEntryLike {
  title: string;
  config: BookmarkConfig;
}

/** Dock order: `order`, then title. */
export function sortBookmarks<T extends BookmarkEntryLike>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.config.order - b.config.order || a.title.localeCompare(b.title));
}
