/**
 * HSV / RGB / hex color conversion utilities.
 *
 * `h` in `[0, 360)`, `s` and `v` in `[0, 1]`. Hex strings are `#rrggbb`
 * lowercase. Functions are tolerant of out-of-range input — they clamp
 * rather than throw, which keeps the picker UI robust under fast drags.
 *
 * Lives in shared/ so both the manager-side ColorPicker / TweaksPanel
 * AND the canvas-side bundle modal can drive the same HsvPicker
 * without a cross-package import.
 */

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_PATTERN = /^#?([0-9a-fA-F]{6})$/;

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

export function hsvToRgb(hsv: Hsv): Rgb {
  const H = (((hsv.h % 360) + 360) % 360);
  const S = clamp(hsv.s, 0, 1);
  const V = clamp(hsv.v, 0, 1);

  const C = V * S;
  const X = C * (1 - Math.abs(((H / 60) % 2) - 1));
  const M = V - C;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (H < 60)        { r1 = C; g1 = X; b1 = 0; }
  else if (H < 120)  { r1 = X; g1 = C; b1 = 0; }
  else if (H < 180)  { r1 = 0; g1 = C; b1 = X; }
  else if (H < 240)  { r1 = 0; g1 = X; b1 = C; }
  else if (H < 300)  { r1 = X; g1 = 0; b1 = C; }
  else               { r1 = C; g1 = 0; b1 = X; }
  return {
    r: Math.round((r1 + M) * 255),
    g: Math.round((g1 + M) * 255),
    b: Math.round((b1 + M) * 255),
  };
}

export function rgbToHsv(rgb: Rgb): Hsv {
  const R = clamp(rgb.r, 0, 255) / 255;
  const G = clamp(rgb.g, 0, 255) / 255;
  const B = clamp(rgb.b, 0, 255) / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const delta = max - min;

  let h = 0;
  if (delta > 0) {
    if (max === R)      h = ((G - B) / delta) % 6;
    else if (max === G) h = (B - R) / delta + 2;
    else                h = (R - G) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return { h, s, v };
}

export function rgbToHex(rgb: Rgb): string {
  const part = (n: number): string => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}

export function hexToRgb(hex: string): Rgb | null {
  const matches = hex.trim().match(HEX_PATTERN);
  if (!matches) return null;
  const v = matches[1];
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

export function hexToHsv(hex: string): Hsv | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHsv(rgb) : null;
}

export function hsvToHex(hsv: Hsv): string {
  return rgbToHex(hsvToRgb(hsv));
}
