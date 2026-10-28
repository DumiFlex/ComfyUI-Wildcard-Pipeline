/**
 * Mask maths for the Image Filter painter, on plain alpha buffers (one byte
 * per pixel, 0 = not masked, 255 = masked) so it runs and tests without a
 * canvas. The painter only draws the result.
 *
 * A stroke, lasso or fill first goes into a COVER buffer (how much of the
 * tool touches each pixel); `composite` then lays the cover onto the mask at
 * the tool's strength, painting (over) or erasing (away). Inside one stroke
 * the stamps combine by max, so a 50% stroke stays 50% where it crosses
 * itself.
 */

export interface MaskBuf {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** A box of pixels a change touched: [x0, y0) to [x1, y1). */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function makeBuf(width: number, height: number): MaskBuf {
  return { width, height, data: new Uint8ClampedArray(Math.max(0, width * height)) };
}

export function copyBuf(b: MaskBuf): MaskBuf {
  return { width: b.width, height: b.height, data: new Uint8ClampedArray(b.data) };
}

export function isBlank(b: MaskBuf): boolean {
  for (let i = 0; i < b.data.length; i++) if (b.data[i] > 0) return false;
  return true;
}

export function fullRect(b: MaskBuf): Rect {
  return { x0: 0, y0: 0, x1: b.width, y1: b.height };
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

function clip(b: MaskBuf, r: Rect): Rect | null {
  const out = {
    x0: Math.max(0, Math.floor(r.x0)),
    y0: Math.max(0, Math.floor(r.y0)),
    x1: Math.min(b.width, Math.ceil(r.x1)),
    y1: Math.min(b.height, Math.ceil(r.y1)),
  };
  return out.x1 > out.x0 && out.y1 > out.y0 ? out : null;
}

/** How much a round brush of `radius` covers a pixel `d` from its centre.
 *  `hardness` 1 is a solid disc with a one-pixel smooth edge; lower values
 *  fade from `radius * hardness` out to the rim. */
export function brushCover(d: number, radius: number, hardness: number): number {
  if (radius <= 0) return 0;
  const h = Math.min(1, Math.max(0, hardness));
  const solid = radius * h;
  if (h >= 1 || radius - solid < 1) return Math.min(1, Math.max(0, radius - d + 0.5));
  if (d <= solid) return 1;
  if (d >= radius) return 0;
  const t = (d - solid) / (radius - solid);
  // Smoothstep, so the soft edge has no visible ring at either end.
  return 1 - t * t * (3 - 2 * t);
}

/** One brush stamp into `cover` (max with what is there). */
export function stamp(cover: MaskBuf, cx: number, cy: number, radius: number, hardness: number): Rect | null {
  const r = clip(cover, { x0: cx - radius - 1, y0: cy - radius - 1, x1: cx + radius + 2, y1: cy + radius + 2 });
  if (!r) return null;
  for (let y = r.y0; y < r.y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = r.x0; x < r.x1; x++) {
      const dx = x + 0.5 - cx;
      const v = Math.round(brushCover(Math.hypot(dx, dy), radius, hardness) * 255);
      const i = y * cover.width + x;
      if (v > cover.data[i]) cover.data[i] = v;
    }
  }
  return r;
}

/** Stamps from (x0, y0) to (x1, y1), close enough that the line reads as one. */
export function segment(
  cover: MaskBuf,
  x0: number, y0: number, x1: number, y1: number,
  radius: number, hardness: number,
): Rect | null {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const gap = Math.max(0.5, radius * 0.15);
  const n = Math.max(1, Math.ceil(len / gap));
  let dirty: Rect | null = null;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    dirty = unionRect(dirty, stamp(cover, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, hardness));
  }
  return dirty;
}

/** Fill a closed polygon (even-odd, pixel centres) into `cover` at full. */
export function polygon(cover: MaskBuf, points: readonly { x: number; y: number }[]): Rect | null {
  if (points.length < 3) return null;
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of points) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
  }
  const box = clip(cover, { x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1 });
  if (!box) return null;
  const xs: number[] = [];
  for (let y = box.y0; y < box.y1; y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i];
      const b = points[j];
      if ((a.y > sy) !== (b.y > sy)) xs.push(a.x + ((sy - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(box.x0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(box.x1, Math.ceil(xs[k + 1] - 0.5));
      for (let x = from; x < to; x++) cover.data[y * cover.width + x] = 255;
    }
  }
  return box;
}

/**
 * The area a bucket fill at (x, y) takes: every pixel 4-connected to it whose
 * mask value is within `tolerance` (0..255) of the clicked one, at full.
 * So a click inside a brushed outline fills the inside; a click on a masked
 * area takes that area.
 */
export function floodFill(mask: MaskBuf, cover: MaskBuf, x: number, y: number, tolerance = 32): Rect | null {
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  const { width: w, height: h } = mask;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const seed = mask.data[sy * w + sx];
  const seen = new Uint8Array(w * h);
  const stack = [sy * w + sx];
  seen[sy * w + sx] = 1;
  let x0 = sx, x1 = sx, y0 = sy, y1 = sy;
  while (stack.length) {
    const i = stack.pop() as number;
    cover.data[i] = 255;
    const px = i % w;
    const py = (i - px) / w;
    if (px < x0) x0 = px; else if (px > x1) x1 = px;
    if (py < y0) y0 = py; else if (py > y1) y1 = py;
    const next = [px > 0 ? i - 1 : -1, px < w - 1 ? i + 1 : -1, py > 0 ? i - w : -1, py < h - 1 ? i + w : -1];
    for (const n of next) {
      if (n < 0 || seen[n]) continue;
      seen[n] = 1;
      if (Math.abs(mask.data[n] - seed) <= tolerance) stack.push(n);
    }
  }
  // Take the soft rim of what bounds it too, or the fill leaves a faint line
  // of half-masked pixels along a brushed outline.
  return grow(cover, { x0, y0, x1: x1 + 1, y1: y1 + 1 }, FILL_GROW);
}

/** How far a fill reaches past the area it found, in px. */
export const FILL_GROW = 2;

/** Grow the full (255) part of `cover` by `r` px (square), inside `rect` grown by r. */
export function grow(cover: MaskBuf, rect: Rect, r: number): Rect {
  const out = clip(cover, { x0: rect.x0 - r, y0: rect.y0 - r, x1: rect.x1 + r, y1: rect.y1 + r }) ?? rect;
  const { width: w } = cover;
  const src = new Uint8ClampedArray(cover.data);
  for (let y = out.y0; y < out.y1; y++) {
    for (let x = out.x0; x < out.x1; x++) {
      if (src[y * w + x] === 255) continue;
      let hit = false;
      for (let dy = -r; dy <= r && !hit; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= cover.height) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && src[yy * w + xx] === 255) { hit = true; break; }
        }
      }
      if (hit) cover.data[y * w + x] = 255;
    }
  }
  return out;
}

/** Soften `cover`'s edges by about `radius` px (three box blurs ≈ a Gaussian),
 *  inside `rect` grown by the radius. Returns the grown rect. */
export function feather(cover: MaskBuf, rect: Rect, radius: number): Rect {
  const r = Math.round(radius / 3);
  if (r < 1) return rect;
  const grown = clip(cover, { x0: rect.x0 - radius, y0: rect.y0 - radius, x1: rect.x1 + radius, y1: rect.y1 + radius }) ?? rect;
  const w = grown.x1 - grown.x0;
  const h = grown.y1 - grown.y0;
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = cover.data[(y + grown.y0) * cover.width + x + grown.x0];
  const b = new Float32Array(w * h);
  for (let pass = 0; pass < 3; pass++) {
    boxLine(a, b, w, h, r, true);
    boxLine(b, a, w, h, r, false);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cover.data[(y + grown.y0) * cover.width + x + grown.x0] = Math.round(a[y * w + x]);
  return grown;
}

/** One box blur along rows (`horizontal`) or columns; edges clamp. */
function boxLine(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean): void {
  const lines = horizontal ? h : w;
  const len = horizontal ? w : h;
  const at = (line: number, k: number) => (horizontal ? line * w + k : k * w + line);
  const span = 2 * r + 1;
  for (let line = 0; line < lines; line++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[at(line, Math.min(len - 1, Math.max(0, k)))];
    for (let k = 0; k < len; k++) {
      dst[at(line, k)] = sum / span;
      sum += src[at(line, Math.min(len - 1, k + r + 1))] - src[at(line, Math.max(0, k - r))];
    }
  }
}

/** Lay `cover` onto `base` into `out` (all one size) inside `rect`, at
 *  `strength` (0..1): paint goes over, erase takes away. */
export function composite(
  base: MaskBuf, cover: MaskBuf, out: MaskBuf, rect: Rect,
  strength: number, erase: boolean,
): void {
  const s = Math.min(1, Math.max(0, strength));
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      const i = y * base.width + x;
      const m = base.data[i];
      const c = (cover.data[i] / 255) * s;
      out.data[i] = Math.round(erase ? m * (1 - c) : m + (255 - m) * c);
    }
  }
}

export function invertBuf(b: MaskBuf): void {
  for (let i = 0; i < b.data.length; i++) b.data[i] = 255 - b.data[i];
}

/** Undo / redo of whole masks, newest last, at most `limit` back. */
export class MaskHistory {
  private past: Uint8ClampedArray[] = [];
  private future: Uint8ClampedArray[] = [];
  constructor(private readonly limit = 30) {}

  /** Call before a change, with the mask as it was. */
  push(before: MaskBuf): void {
    this.past.push(new Uint8ClampedArray(before.data));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: MaskBuf): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(new Uint8ClampedArray(current.data));
    current.data.set(prev);
    return true;
  }

  redo(current: MaskBuf): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(new Uint8ClampedArray(current.data));
    current.data.set(next);
    return true;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
